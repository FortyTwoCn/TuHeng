import { getServerSession, type NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { encode } from 'next-auth/jwt';
import { createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { prisma } from '@tuheng/database';
import { AuthRealm, type AuthRealm as Realm } from '@tuheng/contracts';
import { DomainError, ensure, needsOnboarding, type Actor } from '@tuheng/domain';
import { authenticate, loadIdentity } from '../../../packages/infrastructure/src/identity-auth';
import { trustedClientNetworkKey } from './http';
import { appAuthRedirect, allowedAppOrigins } from './app-origins';

export function authOptionsFor(realm: Realm): NextAuthOptions {
  const secure = (process.env.NEXTAUTH_URL ?? '').startsWith('https://');
  const prefix = `${secure ? '__Secure-' : ''}tuheng.${realm.toLowerCase()}`;
  const options = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure };
  const secret = process.env.AUTH_SECRET;
  ensure(secret && secret.length >= 32, 'AUTH_CONFIGURATION_REQUIRED', 503);
  return {
    secret: createHmac('sha256', secret).update(`tuheng-auth-domain:${realm}`).digest('hex'),
    session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
    cookies: {
      sessionToken: { name: `${prefix}.session-token`, options },
      csrfToken: { name: `${prefix}.csrf-token`, options },
      callbackUrl: { name: `${prefix}.callback-url`, options },
    },
    pages: { signIn: `/login/${realm.toLowerCase()}`, error: `/login/${realm.toLowerCase()}` },
    providers: [
      Credentials({
        name: realm === 'STUDENT' ? '学生登录' : '教师与管理登录',
        credentials: {
          identifier: { type: 'text' },
          schoolId: { type: 'text' },
          method: { type: 'text' },
          password: { type: 'password' },
          code: { type: 'text' },
          challengeId: { type: 'text' },
        },
        async authorize(credentials, request) {
          try {
            return await authenticate(
              { ...credentials, code: credentials?.code || undefined, realm },
              { ipKey: trustedClientNetworkKey(request.headers ?? {}) },
            );
          } catch {
            return null;
          }
        },
      }),
    ],
    callbacks: {
      redirect: async ({ url, baseUrl }) => appAuthRedirect(url, baseUrl),
      async jwt({ token, user }) {
        if (user) {
          const account = user as unknown as {
            id: string;
            tokenVersion: number;
            onboarding: boolean;
          };
          token.sub = account.id;
          token.version = account.tokenVersion;
          token.realm = realm;
          token.aud = realm;
          token.onboarding = account.onboarding;
        }
        return token;
      },
      async session({ session, token }) {
        if (token.realm !== realm || token.aud !== realm) return { ...session, user: undefined };
        if (session.user)
          Object.assign(session.user, {
            id: token.sub,
            tokenVersion: token.version,
            realm,
            onboarding: token.onboarding,
          });
        return session;
      },
    },
  };
}
export async function actor(realm?: Realm, allowOnboarding = false): Promise<Actor> {
  if (!realm) {
    const h = await headers();
    const explicit = AuthRealm.safeParse(h.get('x-tuheng-realm'));
    if (explicit.success) realm = explicit.data;
    else {
      try {
        const url = new URL(h.get('referer') ?? '');
        if (allowedAppOrigins().includes(url.origin)) {
          if (/^\/(student|login\/student)/.test(url.pathname)) realm = 'STUDENT';
          if (/^\/(teacher|school|admin|login\/staff)/.test(url.pathname)) realm = 'STAFF';
        }
      } catch {
        /* direct navigation has no referring realm */
      }
    }
  }
  const candidates = realm ? [realm] : (['STUDENT', 'STAFF'] as const);
  const identities: Actor[] = [];
  for (const domain of candidates) {
    const session = await getServerSession(authOptionsFor(domain));
    const s = session?.user as
      { id?: string; tokenVersion?: number; realm?: Realm; onboarding?: boolean } | undefined;
    if (!s?.id || s.realm !== domain || typeof s.tokenVersion !== 'number') continue;
    try {
      identities.push(await loadIdentity(s.id, domain, s.tokenVersion, !!s.onboarding));
    } catch (error) {
      if (realm) throw error;
    }
  }
  ensure(identities.length === 1, identities.length ? 'SELECT_AUTH_REALM' : 'UNAUTHENTICATED', 401);
  const result = identities[0];
  if (!allowOnboarding && result.onboarding) throw new DomainError('ONBOARDING_REQUIRED', 403);
  return result;
}
export async function rotateIdentitySession(id: string, realm: Realm) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id } });
  ensure(u.realm === realm && u.active, 'SESSION_REVOKED', 401);
  const config = authOptionsFor(realm),
    cookie = config.cookies!.sessionToken!;
  const token = await encode({
    secret: config.secret!,
    maxAge: 8 * 3600,
    token: {
      sub: id,
      name: u.name,
      realm,
      aud: realm,
      version: u.tokenVersion,
      onboarding: needsOnboarding(u),
    },
  });
  (await cookies()).set(cookie.name, token, { ...cookie.options, maxAge: 8 * 3600 });
}
