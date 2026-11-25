import type JSZip from 'jszip';
import type { GeometryDocument } from '@tuheng/contracts';
import { serializeGeometryDocument } from './document';
import { exportSheetSvg } from './svg';
import { exportGeometryNarrative } from './analysis';

/** Self-contained export. JSON is authoritative; previews cover the full sheet. */
export async function exportCadPackage(document: GeometryDocument): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('drawing.json', serializeGeometryDocument(document));
  zip.file('sheet.svg', exportSheetSvg(document));
  zip.file('geometry.txt', exportGeometryNarrative(document));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

const documentLimit = 2_000_000;
export const cadPackageLimit = 8_000_000;

export async function readCadPackage(bytes: ArrayBuffer): Promise<string> {
  if (bytes.byteLength > cadPackageLimit) throw Error('图纸包超过 8MB');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('drawing.json');
  if (!entry || entry.unsafeOriginalName !== 'drawing.json') throw Error('图纸包内没有 drawing.json');
  // JSZip 3.10 exposes this stream but its JSZipObject type omits it.
  const stream = (entry as JSZip.JSZipObject & {
    internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
  }).internalStream('uint8array');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, json = '';
  return new Promise((resolve, reject) => {
    stream.on('data', (part: Uint8Array) => {
      size += part.length;
      try {
        if (size > documentLimit) throw Error('几何文档超过 2MB');
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
