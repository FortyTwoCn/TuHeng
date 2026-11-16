import { z } from 'zod';
import { actor } from '../../../lib/auth';
import { checkOrigin, limitedBody, errorResponse } from '../../../lib/http';
import {
  prepareCredentialDownload,
  downloadCredentials,
} from '../../../../../packages/infrastructure/src/credential-delivery';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor('STAFF'),
      b = JSON.parse((await limitedBody(request, 10000)).toString());
    if (b.operation === 'prepare') {
      const p = z
        .object({
          batchId: z.string(),
          kind: z.enum(['TEACHER', 'STUDENT', 'SCHOOL_ADMIN']),
          proof: z.string(),
        })
        .parse(b);
      return Response.json(
        { data: await prepareCredentialDownload(a, p.batchId, p.kind, p.proof) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (b.format === 'card')
      return Response.json(
        { data: await downloadCredentials(a, z.string().max(100).parse(b.token), 'card') },
        { headers: { 'Cache-Control': 'no-store, private' } },
      );
    const file = await downloadCredentials(a, z.string().max(100).parse(b.token));
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
