import { GeometryDocument, type GeometryEntity } from '@tuheng/contracts';
import { createDocument } from '@tuheng/geometry-core';

export function cadPerformanceDrawing(columns: number, rows: number) {
  const doc = createDocument('THREE_VIEW');
  const base = {
    viewId: doc.views[0].id,
    layerId: doc.layers.find((l) => l.role === 'STUDENT_ANSWER')!.id,
    lineStyle: 'ANSWER_VISIBLE' as const,
  };
  const pid = (i: number, j: number) => 'p-' + i + '-' + j;
  const edge = (i: number, j: number, vertical: boolean) =>
    'e-' + i + '-' + j + '-' + Number(vertical);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      doc.entities.push({
        ...base,
        id: pid(i, j),
        kind: 'point',
        position: { x: i * 6, y: j * 6 },
        name: '',
        spatial: null,
        labelVisible: false,
      });
      if (i + 1 < columns)
        doc.entities.push({
          ...base,
          id: edge(i, j, false),
          kind: 'segment',
          startPoint: pid(i, j),
          endPoint: pid(i + 1, j),
        });
      if (j + 1 < rows)
        doc.entities.push({
          ...base,
          id: edge(i, j, true),
          kind: 'segment',
          startPoint: pid(i, j),
          endPoint: pid(i, j + 1),
        });
      if (i % 3 || j % 3 || i + 2 >= columns || j + 1 >= rows) continue;
      const t = (i / 3 + j / 3) % 4;
      const common = { ...base, id: 'c-' + i + '-' + j };
      const type: GeometryEntity =
        t === 0
          ? {
              ...common,
              kind: 'ellipse',
              center: pid(i, j),
              majorRadius: 2.5,
              minorRadius: 1.4,
              angle: 35,
              startAngle: 0,
              sweep: 360,
            }
          : t === 1
            ? { ...common, kind: 'arc', center: pid(i, j), radius: 2.2, startAngle: 24, sweep: 230 }
            : t === 2
              ? { ...common, kind: 'circle', center: pid(i, j), radius: 2.3 }
              : {
                  ...common,
                  kind: 'curve',
                  pointIds: [pid(i, j), pid(i + 1, j + 1), pid(i + 2, j)],
                  interpolation: 'CUBIC_HERMITE',
                };
      doc.entities.push(type);
    }
  const ring = [edge(0, 0, false), edge(1, 0, true), edge(0, 1, false), edge(0, 0, true)];
  doc.entities.push({
    ...base,
    kind: 'hatch',
    id: 'hatch',
    loops: [ring],
    origin: { x: 0, y: 0 },
    angle: 45,
    spacing: 1,
  });
  return GeometryDocument.parse(doc);
}
