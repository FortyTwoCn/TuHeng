import { z } from 'zod';

export const EditorType = z.enum([
  'VHW_PROJECTION',
  'VH_PROJECTION',
  'THREE_VIEW',
  'ISOMETRIC',
  'OBLIQUE_DIMETRIC',
]);
export type EditorType = z.infer<typeof EditorType>;

export const geometryId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w.-]+$/);
export const geometryScalar = z.number().finite().min(-10000).max(10000);

export const Vec2 = z.object({ x: geometryScalar, y: geometryScalar }).strict();
export type Vec2 = z.infer<typeof Vec2>;
