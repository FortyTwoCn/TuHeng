import { z } from 'zod';
import { AnnouncementAudience, AnnouncementInput } from '@tuheng/contracts';
import { database } from '@tuheng/database';
import {
  announcementPeoplePage,
  ensure,
  previewAnnouncement,
  publishAnnouncement,
  saveAnnouncement,
} from '@tuheng/domain';
import { announcementClasses } from '../../../../../packages/infrastructure/src/announcement-queries';
import { actor, realmFromRequest } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';

const id = z.string().min(1).max(200);
const revision = z.number().int().positive();
async function publisher(request: Request) {
  const realm = realmFromRequest(request);
  ensure(realm === 'STAFF', 'ANNOUNCEMENT_FORBIDDEN', 403);
  return actor(realm);
}
export async function GET(request: Request) {
  try {
    const a = await publisher(request);
    const query = new URL(request.url).searchParams;
    const scope = AnnouncementAudience.shape.scope.parse(
      query.get('scope') === 'PLATFORM'
        ? { kind: 'PLATFORM' }
        : { kind: 'SCHOOL', schoolId: query.get('schoolId') },
    );
    const q = z
      .string()
      .trim()
      .max(100)
      .optional()
      .parse(query.get('q') ?? undefined);
    const after = id.optional().parse(query.get('after') ?? undefined);
    const data =
      query.get('view') === 'classes'
        ? await announcementClasses(a, scope, q, after)
        : await announcementPeoplePage(database, a, scope, {
            q,
            after,
            classId: id.optional().parse(query.get('classId') ?? undefined),
            kind: z
              .enum(['STUDENT', 'TEACHER'])
              .optional()
              .parse(query.get('kind') ?? undefined),
          });
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await publisher(request);
    const body = z
      .discriminatedUnion('operation', [
        z.strictObject({ operation: z.literal('preview'), input: AnnouncementInput }),
        z.strictObject({
          operation: z.literal('save'),
          input: AnnouncementInput,
          previous: z.object({ id, revision }).optional(),
        }),
        z.strictObject({
          operation: z.literal('publish'),
          id,
          revision,
          fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      ])
      .parse(JSON.parse((await limitedBody(request, 512_000)).toString()));
    let data;
    if (body.operation === 'preview') data = await previewAnnouncement(database, a, body.input);
    else if (body.operation === 'save') {
      const draft = await saveAnnouncement(database, a, body.input, body.previous);
      data = { id: draft.id, revision: draft.revision };
    } else data = await publishAnnouncement(database, a, body);
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
