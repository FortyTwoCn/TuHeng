import { z } from 'zod';
import { actor } from '../../../../lib/auth';
import { checkOrigin, limitedBody, errorResponse } from '../../../../lib/http';
import { rosterTemplate } from '../../../../../../packages/infrastructure/src/roster-xlsx';
import {
  previewRosterImport,
  mapRosterImport,
  commitRosterImport,
  rosterImportStatus,
  retryRosterImport,
} from '../../../../../../packages/infrastructure/src/roster-import';
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    checkOrigin(request);
    const a = await actor('STAFF'),
      { operation } = await context.params;
    let data: unknown;
    if (operation === 'preview') {
      const url = new URL(request.url),
        bytes = await limitedBody(request, 5 * 1024 * 1024);
      data = await previewRosterImport(a, {
        schoolId: z
          .string()
          .min(1)
          .parse(a.kind === 'SITE_ADMIN' ? url.searchParams.get('schoolId') : a.schoolId),
        offeringId: z.string().min(1).parse(url.searchParams.get('offeringId')),
        kind: a.kind === 'TEACHER' ? 'TEACHER' : 'SCHOOL',
        filename: url.searchParams.get('filename') ?? '',
        bytes,
      });
    } else {
      const body = JSON.parse((await limitedBody(request, 2 * 1024 * 1024)).toString());
      if (operation === 'retry') data = await retryRosterImport(a, z.string().parse(body.id));
      else if (operation === 'map')
        data = await mapRosterImport(a, z.string().parse(body.id), body.mapping);
      else if (operation === 'commit')
        data = await commitRosterImport(
          a,
          z
            .object({
              importBatchId: z.string(),
              fingerprint: z.string(),
              mappingVersion: z.number().int(),
              rosterVersion: z.number().int(),
            })
            .parse(body),
        );
      else return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function GET(request: Request, context: { params: Promise<{ operation: string }> }) {
  try {
    const a = await actor('STAFF'),
      { operation } = await context.params;
    if (operation === 'template')
      return new Response(
        new Uint8Array(await rosterTemplate(a.kind === 'TEACHER' ? 'TEACHER' : 'SCHOOL')),
        {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="roster-template.xlsx"',
            'Cache-Control': 'no-store',
          },
        },
      );
    return Response.json(
      {
        data: await rosterImportStatus(
          a,
          z.string().parse(new URL(request.url).searchParams.get('id')),
        ),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
