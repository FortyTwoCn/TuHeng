import { revalidatePath } from 'next/cache';
import { database } from '@tuheng/database';
import { readSiteSettings, saveSiteSettings } from '@tuheng/domain';
import { actor } from '../../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../../lib/http';

const headers = { 'Cache-Control': 'no-store' };

/** Public display fields only; SMTP, credentials and account metadata are never returned. */
export async function GET() {
  try {
    return Response.json({ data: await readSiteSettings(database) }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const current = await actor('STAFF');
    const input: unknown = JSON.parse((await limitedBody(request, 2000)).toString());
    const data = await saveSiteSettings(database, current, input);
    revalidatePath('/', 'layout');
    return Response.json({ data }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
