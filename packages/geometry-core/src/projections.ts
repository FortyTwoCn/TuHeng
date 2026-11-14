import type { EditorType, GeometryDocument, Vec2, Vec3 } from '@tuheng/contracts';
export const editorRegistry = {
  VHW_PROJECTION: { name: 'VHW 面投影', labels: true, views: ['V', 'H', 'W'] },
  THREE_VIEW: { name: '三视图', labels: false, views: ['主视图', '俯视图', '左视图'] },
  ISOMETRIC: { name: '正等轴测图', labels: true, views: ['轴测图'] },
  OBLIQUE_DIMETRIC: { name: '斜二等轴图', labels: true, views: ['斜二等轴图'] },
} satisfies Record<EditorType, { name: string; labels: boolean; views: string[] }>;
export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function viewAxes(doc: GeometryDocument, viewId: string): Record<string, Vec2> {
  if (doc.editorType === 'ISOMETRIC' || doc.editorType === 'OBLIQUE_DIMETRIC')
    return projectionAxes(doc);
  const view = doc.views.find((v) => v.id === viewId)!;
  return {
    [view.mapping[0]]: { x: view.signs[0], y: 0 },
    [view.mapping[1]]: { x: 0, y: view.signs[1] },
  };
}
export function createDocument(editorType: EditorType): GeometryDocument {
  const def = editorRegistry[editorType];
  return {
    schemaVersion: 'tuheng.geometry/1.0.0',
    editorType,
    units: 'mm',
    coordinateSystem: 'VIEW_LOCAL_X_RIGHT_Y_UP',
    projectionConfig: {
      convention: 'FIRST_ANGLE_LEFT',
      depthAngle: 45,
      depthScale: 0.5,
      axes: {
        x: { angle: 210, scale: 1 },
        y: { angle: 330, scale: 1 },
        z: { angle: 90, scale: 1 },
      },
    },
    views: def.views.map((name, i) => ({
      id: `view-${i}`,
      name,
      mapping: [
        ...(
          [
            ['x', 'z'],
            ['x', 'y'],
            ['y', 'z'],
          ] as const
        )[i],
      ],
      signs: [1, i === 1 ? -1 : 1],
    })),
    layers: [
      { id: 'stem', role: 'PROBLEM_STEM' },
      { id: 'answer', role: 'STUDENT_ANSWER' },
      { id: 'construction', role: 'CONSTRUCTION' },
    ],
    entities: [],
    constraints: [],
    projectionGroups: [],
    settings: { grid: 5, tolerance: 0.05, labels: def.labels },
    metadata: { title: '' },
  };
}
export function projectPoint(doc: GeometryDocument, point: Vec3, viewId: string): Vec2 {
  if (doc.editorType === 'VHW_PROJECTION' || doc.editorType === 'THREE_VIEW') {
    const view = doc.views.find((v) => v.id === viewId);
    if (!view) throw new Error('视图不存在');
    return { x: point[view.mapping[0]] * view.signs[0], y: point[view.mapping[1]] * view.signs[1] };
  }
  return (['x', 'y', 'z'] as const).reduce(
    (p, key) => {
      const axis = projectionAxes(doc)[key];
      return { x: p.x + point[key] * axis.x, y: p.y + point[key] * axis.y };
    },
    { x: 0, y: 0 },
  );
}
// Choose the smallest spatial translation with this screen projection; view depth is preserved.
export function spatialTranslation(doc: GeometryDocument, viewId: string, delta: Vec2): Vec3 {
  const axes = viewAxes(doc, viewId);
  const keys = ['x', 'y', 'z'] as const;
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const key of keys) {
    const a = axes[key] ?? { x: 0, y: 0 };
    xx += a.x * a.x;
    xy += a.x * a.y;
    yy += a.y * a.y;
  }
  const det = xx * yy - xy * xy;
  if (det < 1e-10) throw new Error('投影轴退化，无法移动空间对象');
  const u = (yy * delta.x - xy * delta.y) / det;
  const v = (xx * delta.y - xy * delta.x) / det;
  return Object.fromEntries(
    keys.map((key) => {
      const a = axes[key] ?? { x: 0, y: 0 };
      return [key, a.x * u + a.y * v];
    }),
  ) as Vec3;
}
export function projectionAxes(doc: GeometryDocument): Record<'x' | 'y' | 'z', Vec2> {
  const config = doc.projectionConfig;
  if (doc.editorType === 'OBLIQUE_DIMETRIC')
    return {
      x: { x: 1, y: 0 },
      y: {
        x: Math.cos(radians(config.depthAngle)) * config.depthScale,
        y: Math.sin(radians(config.depthAngle)) * config.depthScale,
      },
      z: { x: 0, y: 1 },
    };
  return Object.fromEntries(
    Object.entries(config.axes).map(([key, a]) => [
      key,
      { x: Math.cos(radians(a.angle)) * a.scale, y: Math.sin(radians(a.angle)) * a.scale },
    ]),
  ) as Record<'x' | 'y' | 'z', Vec2>;
}
