import { AuthRealm } from '@tuheng/contracts';
import { actor, realmFromRequest } from '../../../../lib/auth';
import { checkOrigin, errorResponse } from '../../../../lib/http';
import { resourceRedirect } from '../../../../lib/resource-response';
import { cancelStagedAsset, readAsset } from '@tuheng/infrastructure';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const realm = AuthRealm.parse(query.get('realm'));
    const { asset, location, stream, length } = await readAsset(
      await actor(realm),
      id,
      query.get('proxy') === '1',
    );
    if (location) return resourceRedirect(location);
    return new Response(stream, {
      headers: {
        'Content-Type': asset.mime,
        ...(length !== undefined ? { 'Content-Length': String(length) } : {}),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        ...(asset.mime === 'application/pdf'
          ? { 'Content-Security-Policy': "sandbox; default-src 'none'" }
          : {}),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    await cancelStagedAsset(await actor(realmFromRequest(request)), (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
