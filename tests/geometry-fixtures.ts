import type { GeometryDocument, GeometryEntity } from '@tuheng/contracts';
import { createDocument } from '@tuheng/geometry-core';
export function performanceDocument(): GeometryDocument {
  const doc = createDocument('VHW_PROJECTION');
  const base = { viewId: 'view-0', layerId: 'answer', lineStyle: 'ANSWER_VISIBLE' } as const;
  for (let i = 0; i < 100; i++)
    doc.entities.push({
      ...base,
      id: `p-${i}`,
      kind: 'point',
      position: { x: (i % 10) * 7, y: Math.floor(i / 10) * 5 },
      name: `P${i}`,
      spatial: null,
      labelVisible: true,
    });
  for (let i = 0; i < 300; i++)
    doc.entities.push({
      ...base,
      id: `s-${i}`,
      kind: 'segment',
      startPoint: `p-${i % 100}`,
      endPoint: `p-${(i + 13) % 100}`,
    });
  for (let i = 0; i < 50; i++) {
    doc.entities.push({ ...base, id: `c-${i}`, kind: 'circle', center: `p-${i}`, radius: 3 });
    doc.entities.push({
      ...base,
      id: `a-${i}`,
      kind: 'arc',
      center: `p-${i + 50}`,
      radius: 3,
      startAngle: 0,
      sweep: 90,
    });
  }
  for (let i = 0; i < 3; i++)
    doc.entities.push({
      ...base,
      id: `plane-${i}`,
      kind: 'plane',
      origin: { x: i * 10, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      orientation: { x: 1, y: 0, z: 0 },
      referencePlaneId: null,
      relation: 'ARBITRARY',
    });
  for (let i = 0; i < 10; i++) {
    const source = doc.entities[i] as Extract<GeometryEntity, { kind: 'point' }>;
    doc.entities.push({ ...source, id: `projection-${i}`, viewId: 'view-1' });
    doc.projectionGroups.push({
      id: `group-${i}`,
      kind: 'POINT',
      entityIds: [source.id, `projection-${i}`],
      source: 'USER',
    });
  }
  return doc;
}
