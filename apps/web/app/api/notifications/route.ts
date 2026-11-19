import { z } from 'zod';
import { NotificationCategory } from '@tuheng/contracts';
import {
  markNotificationsRead,
  notificationPage,
} from '../../../../../packages/infrastructure/src/notification-inbox';
import { actor, realmFromRequest } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';

const cursor = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .pipe(z.number().max(2147483647));
export async function GET(request: Request) {
  try {
    const a = await actor(realmFromRequest(request));
    const query = new URL(request.url).searchParams;
    const before = cursor.optional().parse(query.get('before') ?? undefined);
    const category = NotificationCategory.optional().parse(query.get('category') ?? undefined);
    const pageSize = query.get('mode') === 'recent' ? 6 : 25;
    const data = await notificationPage(a, {
      unread: query.get('unread') === '1',
      before,
      category,
      pageSize,
    });
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor(realmFromRequest(request));
    const selection = z
      .union([
        z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) }),
        z.strictObject({ through: cursor }),
      ])
      .parse(JSON.parse((await limitedBody(request, 8000)).toString()));
    return Response.json({ data: await markNotificationsRead(a, selection) });
  } catch (error) {
    return errorResponse(error);
  }
}
