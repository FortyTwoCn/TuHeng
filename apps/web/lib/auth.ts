import { getServerSession, type NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@tuheng/database';
import { Role } from '@tuheng/contracts';
import { DomainError, type Actor } from '@tuheng/domain';
import { createHash } from 'node:crypto';
export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: '图衡账号',
      credentials: {
        email: { label: '邮箱', type: 'email' },
        password: { label: '密码', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password || email.length > 200 || password.length > 200) return null;
        const id = createHash('sha256').update(email).digest('hex');
        const throttle = await prisma.loginThrottle.findUnique({ where: { id } });
        if (throttle?.blockedUntil && throttle.blockedUntil > new Date()) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await compare(
          password,
          user?.passwordHash ?? '$2b$12$W8X7WOfB8gHxYRxQbGy.rOIJfbdU72u2H0vghdOsmQGykb00lVjKq',
        );
        if (!user?.active || !valid) {
          const row = await prisma.loginThrottle.upsert({
            where: { id },
            create: { id, failures: 1 },
            update: { failures: { increment: 1 } },
          });
          if (row.failures >= 8)
            await prisma.loginThrottle.update({
              where: { id },
              data: { failures: 0, blockedUntil: new Date(Date.now() + 15 * 60000) },
            });
          return null;
        }
        await prisma.loginThrottle.deleteMany({ where: { id } });
        return { id: user.id, name: user.name, email: user.email, tokenVersion: user.tokenVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.version = (user as unknown as { tokenVersion: number }).tokenVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        Object.assign(session.user, { id: token.sub, tokenVersion: token.version });
      }
      return session;
    },
  },
};
export async function actor(): Promise<Actor> {
  const session = await getServerSession(authOptions);
  const s = session?.user as { id?: string; tokenVersion?: number } | undefined;
  if (!s?.id) throw new DomainError('UNAUTHENTICATED', 401);
  const u = await prisma.user.findUnique({ where: { id: s.id } });
  if (!u?.active || u.tokenVersion !== s.tokenVersion)
    throw new DomainError('SESSION_REVOKED', 401);
  return { id: u.id, name: u.name, roles: u.roles.map((r) => Role.parse(r)) };
}
