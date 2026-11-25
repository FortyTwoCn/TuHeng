import type { GeometryDocument } from '@tuheng/contracts';
import { exportCadPackage, exportSheetSvg, type Bounds } from '@tuheng/geometry-core';

/** 浏览器完成取用后释放临时 URL。JSON、图片和图纸包共用下载入口。 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function rasterize(doc: GeometryDocument, view?: Bounds): Promise<Blob> {
  const svg = new DOMParser().parseFromString(
    exportSheetSvg(doc, view),
    'image/svg+xml',
  ).documentElement;
  const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  if (!(w > 0 && h > 0)) throw new Error('图纸边界无效');
  const scale = 2048 / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  svg.setAttribute('width', String(canvas.width));
  svg.setAttribute('height', String(canvas.height));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成图片');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function downloadCadFile(
  doc: GeometryDocument,
  format: 'zip' | 'png',
  report: (message: string) => void,
  view?: Bounds,
) {
  try {
    const blob = format === 'png' ? await rasterize(doc, view) : await exportCadPackage(doc);
    downloadBlob(blob, view ? 'tuheng-view.png' : `tuheng.${format}`);
  } catch (error) {
    report(error instanceof Error ? error.message : '导出失败');
  }
}
