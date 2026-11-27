import { GeometryDocument, type GeometryEntity } from '@tuheng/contracts';
import { createDocument } from '@tuheng/geometry-core';

export type Position = [number, number];
export const rectangle = (x: number, y: number, w: number, h: number): Position[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

type PathAppearance = Pick<GeometryEntity, 'lineStyle' | 'layerId' | 'appearance'>;
const answer: PathAppearance = { lineStyle: 'ANSWER_VISIBLE', layerId: 'answer' };

export function outline(
  doc: GeometryDocument,
  view: number,
  id: string,
  vertices: Position[],
  closed = true,
  style = answer,
) {
  const base = { viewId: doc.views[view].id, ...style };
  const points = vertices.map(([x, y], i) => {
    const pointId = `${id}-p${i}`;
    doc.entities.push({
      ...base,
      id: pointId,
      kind: 'point',
      name: '',
      labelVisible: false,
      spatial: null,
      position: { x: x * doc.views[view].signs[0], y: y * doc.views[view].signs[1] },
    });
    return pointId;
  });
  return points.slice(0, closed ? points.length : -1).map((startPoint, i) => {
    const entityId = `${id}-${i + 1}`;
    doc.entities.push({
      ...base,
      id: entityId,
      kind: 'segment',
      startPoint,
      endPoint: points[(i + 1) % points.length],
    });
    return entityId;
  });
}

export function projectedCircle(
  doc: GeometryDocument,
  view: number,
  id: string,
  center: Position,
  radius: number,
  arc?: { startAngle: number; sweep: number },
) {
  const base = { ...answer, viewId: doc.views[view].id };
  doc.entities.push({
    ...base,
    id: `${id}-center`,
    kind: 'point',
    labelVisible: false,
    name: '',
    spatial: null,
    position: { x: center[0] * doc.views[view].signs[0], y: center[1] * doc.views[view].signs[1] },
  });
  const geometry = { ...base, id, radius, center: `${id}-center` };
  doc.entities.push(arc ? { ...geometry, kind: 'arc', ...arc } : { ...geometry, kind: 'circle' });
  return id;
}

export function boxDrawing(type: 'THREE_VIEW' | 'VHW_PROJECTION' | 'VH_PROJECTION' = 'THREE_VIEW') {
  const doc = createDocument(type);
  outline(doc, 0, 'front', rectangle(0, 0, 20, 10));
  outline(doc, 1, 'top', rectangle(0, 0, 20, 14));
  if (type !== 'VH_PROJECTION') outline(doc, 2, 'left', rectangle(0, 0, 14, 10));
  return GeometryDocument.parse(doc);
}

export function cylinderDrawing(
  hollow = false,
  type: 'THREE_VIEW' | 'VH_PROJECTION' = 'THREE_VIEW',
) {
  const doc = createDocument(type);
  outline(doc, 0, 'front', rectangle(-10, 0, 20, 15));
  projectedCircle(doc, 1, 'outside', [0, 0], 10);
  if (type !== 'VH_PROJECTION') outline(doc, 2, 'left', rectangle(-10, 0, 20, 15));
  if (hollow) {
    projectedCircle(doc, 1, 'through', [0, 0], 4);
    for (const view of type === 'VH_PROJECTION' ? [0] : [0, 2])
      for (const x of [-4, 4])
        outline(
          doc,
          view,
          `hidden-${view}-${x}`,
          [
            [x, 0],
            [x, 15],
          ],
          false,
          { ...answer, lineStyle: 'ANSWER_HIDDEN' },
        );
  }
  return GeometryDocument.parse(doc);
}
