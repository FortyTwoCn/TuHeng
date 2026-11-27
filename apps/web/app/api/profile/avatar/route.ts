import { z } from 'zod';
import { AuthRealm, AVATAR_MAX_BYTES } from '@tuheng/contracts';
import { ensure } from '@tuheng/domain';
import {
  readAvatar,
  removeAvatar,
  replaceAvatar,
} from '../../../../../../packages/infrastructure/src/avatars';
import { actor, realmFromRequest } from '../../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../../lib/http';
import { resourceRedirect } from '../../../../lib/resource-response';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const realm = AuthRealm.parse(params.get('realm'));
    const version = z.uuid().parse(params.get('version'));
    const size = z.enum(['small', 'large']).parse(params.get('size'));
    const { location, stream } = await readAvatar(
      await actor(realm),
      version,
      size,
      params.get('proxy') === '1',
    );
    if (location) return resourceRedirect(location);
    return new Response(stream, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor(realmFromRequest(request));
    const form = await new Response(await limitedBody(request, AVATAR_MAX_BYTES + 32_768), {
      headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
    }).formData();
    const revision = z.coerce.number().int().nonnegative().parse(form.get('revision'));
    const file = form.get('file');
    ensure(file instanceof File && form.has('revision'), 'FILE_REQUIRED');
    const data = await replaceAvatar(
      a,
      revision,
      Buffer.from(await file.arrayBuffer()),
      JSON.parse(String(form.get('crop'))),
    );
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor(realmFromRequest(request));
    const input = z
      .strictObject({ revision: z.number().int().nonnegative() })
      .parse(JSON.parse((await limitedBody(request, 4096)).toString()));
    return Response.json({ data: await removeAvatar(a, input.revision) });
  } catch (error) {
    return errorResponse(error);
  }
}
