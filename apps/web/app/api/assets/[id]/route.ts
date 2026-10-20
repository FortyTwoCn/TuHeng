import { actor } from '../../../../lib/auth';
import { errorResponse } from '../../../../lib/http';
import { downloadAsset } from '@tuheng/infrastructure';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { asset, buffer } = await downloadAsset(await actor(), id);
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
