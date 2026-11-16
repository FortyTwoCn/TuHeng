import { z } from 'zod';
import { prisma } from '@tuheng/database';
import { actor } from '../../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../../lib/http';
import { ensure } from '@tuheng/domain';
import { manageSMTP, saveSMTP } from '../../../../../../packages/infrastructure/src/email';
export async function GET() {
  try {
    const a = await actor('STAFF', true);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    ensure(a.kind === 'SITE_ADMIN' && !u.mustChangePassword, 'FORBIDDEN', 403);
    const rows = await prisma.sMTPConfigurationVersion.findMany({
      orderBy: { version: 'desc' },
      take: 30,
    });
    return Response.json(
      {
        data: rows.map((r) => ({
          id: r.id,
          version: r.version,
          config: r.config,
          enabled: r.enabled,
          secretConfigured: !!r.secretId,
          createdAt: r.createdAt,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor('STAFF', true),
      b = JSON.parse((await limitedBody(request, 20000)).toString());
    const proof = z.string().parse(b.proof);
    const data =
      b.action === 'SAVE'
        ? await saveSMTP(a, b.config, z.string().max(2000).optional().parse(b.password), proof)
        : await manageSMTP(
            a,
            z.enum(['VERIFY', 'TEST', 'ENABLE', 'DISABLE']).parse(b.action),
            z.string().parse(b.id),
            proof,
            b.recipient,
          );
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
