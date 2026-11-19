import { AuthRealm } from '@tuheng/contracts';
import { actor, realmFromRequest } from '../../../../lib/auth';
import { checkOrigin, errorResponse } from '../../../../lib/http';
import { cancelStagedAsset, downloadAsset } from '@tuheng/infrastructure';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const realm = AuthRealm.parse(new URL(request.url).searchParams.get('realm'));
    const { asset, buffer } = await downloadAsset(await actor(realm), id);
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': asset.mime,
        'Content-Length': String(buffer.length),
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
