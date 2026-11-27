import { GeometryDocument, type GeometryEntity, type Vec2 } from '@tuheng/contracts';
import { createDocument } from '@tuheng/geometry-core';

type Pair = readonly [number, string | number];
export const dxfPairs = (pairs: Pair[]) =>
  pairs.map(([code, value]) => `  ${code}\n${value}\n`).join('');
export function dxfFixture(
  entities: Pair[],
  {
    blocks = [],
    tables = [],
    units = 4,
  }: { blocks?: Pair[]; tables?: Pair[]; units?: number } = {},
) {
  return dxfPairs([
    [0, 'section'],
    [2, 'Header'],
    [9, '$INSUNITS'],
    [70, units],
    [0, 'ENDSEC'],
    [0, 'SECTION'],
    [2, 'TABLES'],
    ...tables,
    [0, 'ENDSEC'],
    [0, 'SECTION'],
    [2, 'BLOCKS'],
    ...blocks,
    [0, 'ENDSEC'],
    [0, 'SECTION'],
    [2, 'ENTITIES'],
    ...entities,
    [0, 'ENDSEC'],
    [0, 'eof'],
  ]);
}
export const dxfLine = (a: Vec2, b: Vec2, layer = '0'): Pair[] => [
  [0, 'LINE'],
  [8, layer],
  [10, a.x],
  [20, a.y],
  [11, b.x],
  [21, b.y],
];

export function dxfRoundTripFixture() {
  const doc = createDocument('VH_PROJECTION');
  const base = { viewId: 'view-0', layerId: 'answer', lineStyle: 'ANSWER_VISIBLE' } as const;
  const points: GeometryEntity[] = [
    { x: 13.123456, y: 17.987654 },
    { x: 21.314, y: 21.124 },
    { x: 25.493, y: 14.158 },
    { x: 32.14159, y: 23.26535 },
  ].map((position, i) => ({
    ...base,
    id: 'p' + i,
    kind: 'point',
    position,
    spatial: null,
    name: i === 0 ? '定位点' : '',
    labelVisible: i === 0,
  }));
  doc.entities = [
    {
      ...base,
      id: 'first',
      kind: 'segment',
      startPoint: 'p0',
      endPoint: 'p1',
      appearance: { color: '#336da7', widthMm: 0.369, pattern: 'PHANTOM' },
    },
    { ...base, id: 'second', kind: 'segment', startPoint: 'p1', endPoint: 'p2' },
    { ...base, id: 'circle', kind: 'circle', center: 'p0', radius: 4.123456 },
    {
      ...base,
      id: 'ccw',
      kind: 'arc',
      center: 'p0',
      radius: 6.156,
      startAngle: 311.246,
      sweep: 142.3,
    },
    {
      ...base,
      id: 'cw',
      kind: 'arc',
      center: 'p1',
      radius: 7.31,
      startAngle: 22.76,
      sweep: -228.17,
    },
    {
      ...base,
      id: 'ellipse',
      kind: 'ellipse',
      center: 'p2',
      majorRadius: 6.78913,
      minorRadius: 3.1488,
      angle: 38.291,
      startAngle: 22.989,
      sweep: -143.65,
    },
    {
      ...base,
      id: 'cubic',
      kind: 'curve',
      pointIds: ['p0', 'p1', 'p2', 'p3'],
      interpolation: 'CUBIC_HERMITE',
      parameterRange: [0.21, 0.92],
    },
    {
      ...base,
      id: 'quadratic',
      kind: 'curve',
      pointIds: ['p3', 'p2', 'p1'],
      interpolation: 'QUADRATIC_BSPLINE',
    },
    {
      ...base,
      id: 'poly',
      kind: 'polyline',
      viewId: 'view-1',
      fitStatus: 'UNFITTED',
      points: [
        { x: 2.1, y: -5.1 },
        { x: 7.2, y: -5.3 },
        { x: 9.1, y: -10 },
        { x: 2.1, y: -5.1 },
      ],
    },
    {
      ...base,
      id: 'text',
      kind: 'text',
      position: { x: 15.2215, y: 36.9132 },
      size: 2.641,
      angle: -25.211,
      content: String.raw`两面投影 %%d \U+4E00`,
    },
    {
      ...base,
      id: 'multiline',
      kind: 'text',
      viewId: 'view-1',
      position: { x: 9, y: -19 },
      size: 3,
      angle: 17,
      content: '正投影{说明}\n换面轴，保持比例'.repeat(7),
    },
    {
      ...base,
      id: 'dim',
      kind: 'dimension',
      dimensionType: 'ALIGNED',
      referenceIds: ['p0', 'p1'],
      position: { x: 18, y: 30 },
      precision: 3,
      textOverride: '定位长度',
      textSize: 2.5,
      arrowStyle: 'CLOSED',
    },
    {
      ...base,
      id: 'hatch',
      kind: 'hatch',
      loops: [['circle']],
      origin: { x: 13, y: 17 },
      angle: 31,
      spacing: 1.5,
    },
    {
      ...base,
      id: 'symbol',
      kind: 'symbol',
      symbolType: 'DIRECTION',
      label: '向视 A',
      position: { x: 44, y: 26 },
      size: 2.5,
      angle: 32,
    },
    {
      ...base,
      id: 'datum',
      kind: 'engineeringAnnotation',
      annotationType: 'DATUM',
      fields: ['基准 B'],
      position: { x: 38, y: 31 },
      size: 3,
      angle: 0,
    },
    {
      ...base,
      id: 'line',
      kind: 'line',
      layerId: 'construction',
      lineStyle: 'CONSTRUCTION',
      anchor: { x: 40, y: 12 },
      direction: { x: 2, y: 1 },
      referenceEntityId: null,
    },
    ...points,
  ];
  return GeometryDocument.parse(doc);
}
