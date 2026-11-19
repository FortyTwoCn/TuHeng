import { database } from '@tuheng/database';
import { saveNotificationPreferences } from '@tuheng/domain';
import { ownProfile } from '../../../../../packages/infrastructure/src/profile';
import { actor, realmFromRequest } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';

export async function GET(request: Request) {
  try {
    const a = await actor(realmFromRequest(request));
    return Response.json(
      { data: await ownProfile(a) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor(realmFromRequest(request));
    const input = JSON.parse((await limitedBody(request, 4096)).toString());
    const data = await saveNotificationPreferences(database, a, input);
    return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
