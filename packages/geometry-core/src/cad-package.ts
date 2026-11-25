import type JSZip from 'jszip';
import { GEOMETRY_DOCUMENT_MAX_BYTES, type GeometryDocument } from '@tuheng/contracts';
import { serializeGeometryDocument } from './document-json';
import { exportSheetSvg } from './svg';
import { exportGeometryNarrative } from './analysis';

/** 图纸包使用同一份正式 JSON，附带覆盖整张图纸的预览和文字说明。 */
export async function exportCadPackage(document: GeometryDocument): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('drawing.json', serializeGeometryDocument(document));
  zip.file('sheet.svg', exportSheetSvg(document));
  zip.file('geometry.txt', exportGeometryNarrative(document));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export const cadPackageLimit = 8_000_000;

export async function readCadPackage(bytes: ArrayBuffer): Promise<string> {
  if (bytes.byteLength > cadPackageLimit) throw Error('图纸包超过 8MB');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('drawing.json');
  if (!entry || entry.unsafeOriginalName !== 'drawing.json')
    throw Error('图纸包内没有 drawing.json');
  // JSZip 3.10 的类型未声明这个流接口。按解压字节计数，过大时直接停止。
  const stream = (
    entry as JSZip.JSZipObject & {
      internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
    }
  ).internalStream('uint8array');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0,
    json = '';
  return new Promise((resolve, reject) => {
    stream.on('data', (part: Uint8Array) => {
      size += part.length;
      try {
        if (size > GEOMETRY_DOCUMENT_MAX_BYTES) throw Error('几何文档超过 2MB');
        json += decoder.decode(part, { stream: true });
      } catch (error) {
        stream.pause();
        reject(error);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      try {
        resolve(json + decoder.decode());
      } catch (error) {
        reject(error);
      }
    });
    stream.resume();
  });
}
