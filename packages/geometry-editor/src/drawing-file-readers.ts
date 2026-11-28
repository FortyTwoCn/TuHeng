import { GEOMETRY_DOCUMENT_MAX_BYTES } from '@tuheng/contracts';
import {
  cadPackageLimit,
  decodeDxfBytes,
  DXF_MAX_BYTES,
  readCadPackage,
} from '@tuheng/geometry-core';

export function readDrawingFile(file: File) {
  if (file.name.toLowerCase().endsWith('.zip')) {
    if (file.size > cadPackageLimit) throw Error('图纸包超过 8MB');
    return file.arrayBuffer().then(readCadPackage);
  }
  if (file.size > GEOMETRY_DOCUMENT_MAX_BYTES) throw Error('几何文档超过 2MB');
  return file.text();
}

export async function readDxfFile(file: File) {
  if (file.size > DXF_MAX_BYTES) throw Error('DXF 文件超过 8 MB');
  return decodeDxfBytes(new Uint8Array(await file.arrayBuffer()));
}
