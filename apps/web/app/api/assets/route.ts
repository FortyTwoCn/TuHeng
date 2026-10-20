import { actor } from '../../../lib/auth';
import { checkOrigin, errorResponse, limitedBody } from '../../../lib/http';
import { uploadAsset } from '@tuheng/infrastructure';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const a = await actor();
    const body = await limitedBody(
      request,
      Number(process.env.UPLOAD_MAX_BYTES ?? 15728640) + 65536,
    );
    const form = await new Response(body, {
      headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
    }).formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'FILE_REQUIRED' }, { status: 400 });
    return Response.json(
      await uploadAsset(
        a,
        { name: file.name, bytes: Buffer.from(await file.arrayBuffer()), mime: file.type },
        String(form.get('purpose') ?? 'SUBMISSION'),
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
