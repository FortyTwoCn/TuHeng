import { z } from 'zod';
import { prisma } from '@tuheng/database';
import { actor } from '../../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../../lib/http';
import { requireSMTPManager } from '@tuheng/domain';
import { manageSMTP, saveSMTP } from '../../../../../../packages/infrastructure/src/email';
export async function GET() {
  try {
    const a = await actor('STAFF');
    requireSMTPManager(a);
    const rows = await prisma.sMTPConfigurationVersion.findMany({
      orderBy: { version: 'desc' },
      take: 30,
    });
    const active = await prisma.sMTPConfigurationVersion.findFirst({ where: { enabled: true } });
    if (active && !rows.some((row) => row.id === active.id)) rows.push(active);
    const secrets = await prisma.secretRecord.findMany({
      where: { id: { in: rows.flatMap((r) => (r.secretId ? [r.secretId] : [])) } },
      select: { id: true, suffix: true, revokedAt: true, createdAt: true },
    });
    return Response.json(
      {
        data: rows.map((r) => ({
          id: r.id,
          version: r.version,
          config: r.config,
          enabled: r.enabled,
          secretConfigured: !!secrets.find((s) => s.id === r.secretId && !s.revokedAt),
          secretSuffix: secrets.find((s) => s.id === r.secretId)?.suffix ?? '',
          secretUpdatedAt: secrets.find((s) => s.id === r.secretId)?.createdAt ?? null,
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
    const a = await actor('STAFF'),
      b = JSON.parse((await limitedBody(request, 20000)).toString());
    const proof = z.string().parse(b.proof);
    const data =
      b.action === 'SAVE'
        ? await saveSMTP(
            a,
            b.config,
            z.string().max(2000).optional().parse(b.password),
            proof,
            z
              .object({
                expectedVersion: z.number().int().nonnegative(),
                sourceId: z.string().min(1).nullable(),
              })
              .parse(b),
          )
        : await manageSMTP(
            a,
            z.enum(['VERIFY', 'TEST', 'ENABLE', 'DISABLE', 'REVOKE_KEY']).parse(b.action),
            z.string().parse(b.id),
            proof,
            b.recipient,
            ['ENABLE', 'DISABLE'].includes(b.action)
              ? z.string().nullable().parse(b.expectedActiveId)
              : undefined,
          );
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
