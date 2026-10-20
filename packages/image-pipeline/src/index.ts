import sharp from 'sharp';
import type { GradingRequest, VisionImage } from '@tuheng/contracts';
export interface ImageOptions {
  maxDimension: number;
  rotate: number;
  crop: { left: number; top: number; width: number; height: number } | null;
}
export interface PerspectiveStrategy {
  correct(buffer: Buffer): Promise<{ buffer: Buffer; homography: number[]; warnings: string[] }>;
}
export const VERSION = 'sharp-conservative/1.0.0';
export async function inspectImage(buffer: Buffer) {
  const meta = await sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
  if (
    !['jpeg', 'png'].includes(meta.format ?? '') ||
    !meta.width ||
    !meta.height ||
    (meta.pages && meta.pages > 1)
  )
    throw new Error('UNSUPPORTED_IMAGE');
  return {
    mime: meta.format === 'png' ? 'image/png' : 'image/jpeg',
    width: meta.width,
    height: meta.height,
    orientation: meta.orientation ?? 1,
  };
}
export function mapPoint(p: { x: number; y: number }, matrix: number[]) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const w = g * p.x + h * p.y + i;
  if (!Number.isFinite(w) || Math.abs(w) < 1e-9) throw new Error('INVALID_TRANSFORM');
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}
export async function preprocess(buffer: Buffer, options: ImageOptions) {
  const original = await inspectImage(buffer);
  if (![0, 90, 180, 270].includes(options.rotate)) throw new Error('INVALID_ROTATION');
  // autoOrient is lossless in intent; retain untouched original bytes separately.
  const oriented = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .autoOrient()
    .toBuffer({ resolveWithObject: true });
  let image = sharp(oriented.data);
  let width = oriented.info.width,
    height = oriented.info.height;
  const c = options.crop;
  if (c) {
    if (
      [c.left, c.top, c.width, c.height].some((n) => !Number.isFinite(n)) ||
      c.left < 0 ||
      c.top < 0 ||
      c.width <= 0 ||
      c.height <= 0 ||
      c.left + c.width > 1 ||
      c.top + c.height > 1
    )
      throw new Error('INVALID_CROP');
    const left = Math.floor(c.left * width),
      top = Math.floor(c.top * height),
      w = Math.max(1, Math.floor(c.width * width)),
      h = Math.max(1, Math.floor(c.height * height));
    image = sharp(await image.extract({ left, top, width: w, height: h }).toBuffer());
    width = w;
    height = h;
  }
  image = image
    .rotate(options.rotate)
    .resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .linear(1.02, -2)
    .sharpen({ sigma: 0.3, m1: 0.2, m2: 0.4 });
  const result = await image.png().toBuffer({ resolveWithObject: true });
  const stats = await sharp(result.data).stats();
  const warnings: string[] = [];
  if (Math.min(width, height) < 600) warnings.push('图像短边不足600像素，细图线可能不可判读');
  if (stats.channels[0].stdev < 8) warnings.push('图像对比度过低');
  // Matrices map normalized EXIF-oriented original → processed; EXIF is recorded separately.
  const cropM = c
    ? [1 / c.width, 0, -c.left / c.width, 0, 1 / c.height, -c.top / c.height, 0, 0, 1]
    : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const rotations: Record<number, number[]> = {
    0: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    90: [0, -1, 1, 1, 0, 0, 0, 0, 1],
    180: [-1, 0, 1, 0, -1, 1, 0, 0, 1],
    270: [0, 1, 0, -1, 0, 1, 0, 0, 1],
  };
  const r = rotations[options.rotate];
  const matrix = Array.from({ length: 9 }, (_, n) => {
    const row = Math.floor(n / 3),
      col = n % 3;
    return [0, 1, 2].reduce((s, k) => s + r[row * 3 + k] * cropM[k * 3 + col], 0);
  });
  return {
    buffer: result.data,
    mime: 'image/png' as const,
    width: result.info.width,
    height: result.info.height,
    warnings,
    record: {
      version: VERSION,
      original,
      steps: [
        'EXIF_AUTO_ORIENT',
        ...(c ? ['MANUAL_CROP'] : []),
        'MANUAL_ROTATE',
        'RESIZE',
        'MILD_CONTRAST',
        'LIGHT_SHARPEN',
      ],
      parameters: options,
      transform: {
        basis: 'EXIF_ORIENTED_ORIGINAL_NORMALIZED',
        matrix,
        exifOrientation: original.orientation,
      },
      quality: { contrast: stats.channels[0].stdev, warnings },
      perspective: 'NOT_APPLIED',
      denoise: 'NOT_APPLIED_TO_PRESERVE_FINE_LINES',
    },
  };
}
export class SharpImagePipeline {
  constructor(
    private load: (id: string) => Promise<Buffer>,
    private save: (parentId: string, buffer: Buffer, record: unknown) => Promise<string>,
  ) {}
  async prepare(request: GradingRequest) {
    const images: VisionImage[] = [],
      warnings: string[] = [],
      records: unknown[] = [];
    for (const [role, refs] of [
      ['QUESTION', request.question.assets],
      ['REFERENCE', request.reference.assets],
      ['SUBMISSION', request.submissionAssets],
    ] as const) {
      for (const ref of refs) {
        if (ref.mime === 'application/pdf') throw new Error('PDF_REQUIRES_IMAGE_SELECTION');
        let input: Buffer;
        try {
          input = await this.load(ref.id);
        } catch {
          throw new Error('ASSET_UNREADABLE');
        }
        const processed = await preprocess(
          input,
          role === 'SUBMISSION'
            ? request.imageOptions
            : { ...request.imageOptions, rotate: 0, crop: null },
        );
        const id = await this.save(ref.id, processed.buffer, processed.record);
        images.push({
          role,
          assetId: ref.id,
          version: ref.version,
          dataUrl: `data:image/png;base64,${processed.buffer.toString('base64')}`,
        });
        records.push({ originalId: ref.id, processedId: id, ...processed.record });
        warnings.push(...processed.warnings);
      }
    }
    return { images, warnings, records };
  }
}
