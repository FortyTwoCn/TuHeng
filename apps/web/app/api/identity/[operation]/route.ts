import { z } from 'zod';
import { prisma } from '@tuheng/database';
import { AuthRealm, VerificationPurpose } from '@tuheng/contracts';
import { actor, rotateIdentitySession } from '../../../../lib/auth';
import {
  checkOrigin,
  limitedBody,
  errorResponse,
  trustedClientNetworkKey,
} from '../../../../lib/http';
import { requestVerification } from '../../../../../../packages/infrastructure/src/identity-challenges';
import {
  changeOwnPassword,
  bindVerifiedEmail,
  recoverPassword,
} from '../../../../../../packages/infrastructure/src/identity-auth';
import { reauthenticate } from '../../../../../../packages/infrastructure/src/identity-security';
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    checkOrigin(request);
    const { operation } = await context.params;
    const input = JSON.parse((await limitedBody(request, 16000)).toString());
    const realm = AuthRealm.parse(input.realm);
    if (operation === 'request-code') {
      const v = z
        .object({
          realm: AuthRealm,
          purpose: VerificationPurpose,
          email: z.string(),
          proof: z.string().optional(),
        })
        .parse(input);
      const a = ['BIND_EMAIL', 'CHANGE_EMAIL', 'SENSITIVE_REAUTH'].includes(v.purpose)
        ? await actor(realm, true)
        : undefined;
      return Response.json(
        {
          data: await requestVerification({
            ...v,
            actor: a,
            ipKey: trustedClientNetworkKey(request.headers),
          }),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (operation === 'recover-password') {
      await recoverPassword(
        z
          .object({
            realm: AuthRealm,
            challengeId: z.string(),
            code: z.string(),
            password: z.string(),
          })
          .parse(input),
      );
      return Response.json({ data: { ok: true } });
    }
    const a = await actor(realm, true);
    if (operation === 'reauthenticate')
      return Response.json(
        { data: await reauthenticate(a, z.string().parse(input.password)) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    if (operation === 'change-password')
      await changeOwnPassword(a, z.string().parse(input.current), z.string().parse(input.password));
    else if (operation === 'bind-email')
      await bindVerifiedEmail(
        a,
        z
          .object({
            purpose: z.enum(['BIND_EMAIL', 'CHANGE_EMAIL']),
            challengeId: z.string(),
            code: z.string(),
          })
          .parse(input),
      );
    else return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    await rotateIdentitySession(a.id, realm);
    return Response.json({ data: { ok: true } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request) {
  try {
    const a = await actor(AuthRealm.parse(new URL(request.url).searchParams.get('realm')), true);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    return Response.json(
      {
        data: {
          id: u.id,
          name: u.name,
          kind: u.kind,
          realm: u.realm,
          mustChangePassword: u.mustChangePassword,
          emailVerified: !!u.emailVerifiedAt,
          emailHint: u.emailNormalized?.replace(/^(.).+(@.+)$/, '$1***$2'),
          onboarding: a.onboarding,
          installationComplete: u.installationComplete,
          smtpConfigured: !!(await prisma.sMTPConfigurationVersion.findFirst({
            where: { enabled: true },
          })),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
