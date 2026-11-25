import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { GeometryDocument, type GeometryEntity } from '@tuheng/contracts';
import {
  addDrawing,
  setLineStyle,
  setCadAppearance,
  CAD_COMMANDS,
  cadPreview,
  cadStep,
  combineAnswer,
  createDocument,
  dimensionValue,
  DocumentHistory,
  exportCadPackage,
  exportSheetSvg,
  startCadSession,
  type CadCommandId,
  type CadEvent,
} from '@tuheng/geometry-core';

const p = (x: number, y: number, entityId?: string): CadEvent => ({
  type: 'point',
  position: { x, y },
  entityId,
});
const param = (values: Record<string, string>): CadEvent => ({ type: 'parameters', values });
const confirm: CadEvent = { type: 'confirm' };
function run(
  id: CadCommandId,
  events: CadEvent[],
  doc = createDocument('VHW_PROJECTION'),
  ids: string[] = [],
  role: 'teacher' | 'student' = 'student',
) {
  let s = startCadSession(id, doc, 'view-0', role, ids);
  let committed = false;
  for (const event of events) {
    const prev = doc,
      result = cadStep(s, doc, event);
    if (result.document) {
      doc = result.document;
      committed = true;
    }
    if (!result.session) break;
    if (result.session === s && prev === doc && event.type !== 'parameters')
      throw Error(result.message);
    s = result.session;
  }
  expect(committed, id).toBe(true);
  expect(GeometryDocument.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  return doc;
}
const primitives: [CadCommandId, CadEvent[], GeometryEntity['kind']][] = [
  ['point', [p(0, 0)], 'point'],
  ['segment', [p(1, 1), p(4, 5)], 'segment'],
  ['line', [p(1, 1), p(4, 5)], 'line'],
  ['rectangle', [p(2, 3), p(6, 8)], 'segment'],
  ['circle', [p(2, 3), p(6, 3)], 'circle'],
  ['arc', [p(2, 3), p(6, 3), p(2, 7)], 'arc'],
  ['arc3', [p(1, 0), p(0, -1), p(-1, 0)], 'arc'],
  ['ellipse', [p(0, 0), p(4, 0), p(3, 2)], 'ellipse'],
  ['spline', [p(0, 0), p(2, 4), p(6, 0), confirm], 'curve'],
  ['polygon', [param({ sides: '6' }), confirm, p(0, 0), p(4, 0)], 'segment'],
  ['text', [param({ content: '孔口 <不能注入>' }), confirm, p(1, 1)], 'text'],
  ['direction', [p(2, 2), p(5,2)], 'symbol'],
  ['leftDirection', [p(2, 2)], 'symbol'],
  ['rightDirection', [p(2, 2)], 'symbol'],
  ['linearDimension', [p(0, 0), p(3, 4), p(0, 5)], 'dimension'],
  ['alignedDimension', [p(0, 0), p(3, 4), p(0, 5)], 'dimension'],
  ['angularDimension', [p(0, 0), p(3, 0), p(0, 3), p(2, 2)], 'dimension'],
  ['datum', [p(1, 1)], 'engineeringAnnotation'],
  ['roughness', [p(1, 1)], 'engineeringAnnotation'],
  ['toleranceFrame', [p(1, 1)], 'engineeringAnnotation'],
  ['toleranceText', [p(1, 1)], 'engineeringAnnotation'],
  ['compass', [p(0, 0), p(3, 4), p(12, 13), p(14, 13), p(12, 15), confirm], 'arc'],
];
describe('shared CAD command and immutable document workflows', () => {
  it.each(['student','teacher'] as const)('applies a dashed pattern to the shared line command within the %s layer', role => {
    const doc = createDocument('VHW_PROJECTION');
    const started = {...startCadSession('segment',doc,'view-0',role),appearance:{pattern:'DASHED' as const}};
    const anchored = cadStep(started,doc,p(1,1)).session!;
    const next = cadStep(anchored,doc,p(4,5)).document!;
    const line = next.entities.at(-1)!;
    expect(line.lineStyle).toBe(role==='student'?'ANSWER_HIDDEN':'PROBLEM_HIDDEN');
    expect(next.layers.find(l=>l.id===line.layerId)?.role).toBe(role==='student'?'STUDENT_ANSWER':'PROBLEM_STEM');
    expect(line.appearance?.pattern).toBe('DASHED');
  });
  it.each(primitives)(
    '%s persists its geometry, exports and undoes atomically',
    (id, events, kind) => {
      const d = createDocument('VHW_PROJECTION'),
        history = new DocumentHistory(d);
      const result = run(id, events, d);
      expect(result.entities.at(-1)?.kind).toBe(kind);
      history.commit(result);
      expect(history.undo()).toEqual(d);
      expect(history.redo()).toEqual(result);
      expect(exportSheetSvg(result)).toContain(result.entities.at(-1)!.id);
    },
  );
  it('rectangle/polygon form shared closed cycles; precise rectangle works at negative coordinates', () => {
    const d = run('rectangle', [p(-2, -3), param({ width: '-8', height: '4.5' }), confirm]);
    const lines = d.entities.filter((e) => e.kind === 'segment');
    expect(lines.length).toBe(4);
    lines.forEach((line, i) => expect(line.endPoint).toBe(lines[(i + 1) % 4].startPoint));
    const poly = run('polygon', [param({ sides: '3', mode: '外切于圆' }), confirm, p(0, 0), p(5, 0)]);
    const vertex = poly.entities.find((e) => e.kind === 'point')!;
    expect(Math.hypot(vertex.position.x, vertex.position.y)).toBeCloseTo(10);
  });
  it('associative radius and diameter read the geometry when text is overridden', () => {
    const d = run('circle', [p(4, 2), p(9, 2)]),
      c = d.entities.at(-1)!;
    for (const cmd of ['radiusDimension', 'diameterDimension'] as const) {
      const next = run(cmd, [param({ textOverride: '100' }), p(12, 4)], d, [c.id]);
      const dim = next.entities.find((e) => e.kind === 'dimension')!;
      expect(dimensionValue(next, dim)).toBe(cmd === 'radiusDimension' ? 5 : 10);
    }
  });
  it('hatches a rectangle with a circular hole, rejects an unclosed boundary', () => {
    const box = run('rectangle', [p(0, 0), p(30, 20)]);
    const d = run('circle', [p(10, 10), p(14, 10)], box);
    const edges = d.entities
      .filter((e) => e.kind === 'circle' || e.kind === 'segment')
      .map((e) => e.id);
    const valid = run('hatch', [confirm], d, edges);
    expect(valid.entities.find((e) => e.kind === 'hatch')?.loops).toHaveLength(2);
    const invalid = startCadSession('hatch', d, 'view-0', 'student', [edges[0]]);
    expect(cadStep(invalid, d, confirm).document).toBeUndefined();
  });
  it('rejects a collinear three point arc and discards unconfirmed or cancelled previews', () => {
    const d = createDocument('THREE_VIEW');
    let s = startCadSession('arc3', d, 'view-1', 'student');
    s = cadStep(s, d, p(0, 0)).session!;
    s = cadStep(s, d, p(5, 5)).session!;
    expect(cadPreview(s, d, { x: 7, y: 7 })).toBeNull();
    expect(cadStep(s, d, p(10, 10)).message).toContain('共线');
    expect(cadStep(s, d, { type: 'cancel' }).document).toBeUndefined();
    expect(d.entities).toHaveLength(0);
  });
  it('clear is one transaction, retains teacher geometry and project axes, and rejects forged content', () => {
    const stem = run('circle', [p(3, 3), p(5, 3)], createDocument('VHW_PROJECTION'), [], 'teacher');
    const answer = run('rectangle', [p(1, 2), p(6, 7)], stem),
      h = new DocumentHistory(answer);
    const cleared = run('clear', [confirm], answer);
    expect(cleared.entities).toEqual(stem.entities);
    expect(cleared.sheet).toEqual(stem.sheet);
    h.commit(cleared);
    expect(h.undo()).toEqual(answer);
    const forged = structuredClone(answer);
    const circle = forged.entities.find((e) => e.kind === 'circle')!;
    circle.radius = 3;
    expect(() => combineAnswer(stem, forged)).toThrow('GEOMETRY_STEM_CHANGED');
  });
  it('package includes a re-loadable authoritative JSON, full-sheet SVG and narrative', async () => {
    const d = run('ellipse', [p(10, 10), p(20, 10), p(10, 15)]);
    const zip = await JSZip.loadAsync(await (await exportCadPackage(d)).arrayBuffer());
    expect(
      GeometryDocument.parse(JSON.parse(await zip.file('drawing.json')!.async('text'))),
    ).toEqual(d);
    expect(await zip.file('sheet.svg')!.async('text')).toContain(d.entities.at(-1)!.id);
    expect(await zip.file('geometry.txt')!.async('text')).toContain('椭圆');
    expect(new Set(CAD_COMMANDS.map((c) => c.id)).size).toBe(CAD_COMMANDS.length);
  });
});

it('keeps semantic visibility and the displayed pattern in sync without changing ownership', () => {
  const initial = addDrawing(createDocument('VHW_PROJECTION'),'segment','view-0',[{x:1,y:2},{x:4,y:5}],'teacher');
  const original=initial.entities.at(-1)!;
  expect(()=>setCadAppearance(initial,[original.id],{pattern:'DASHED'},'student')).toThrow();
  const dashed=setCadAppearance(initial,[original.id],{pattern:'DASHED',color:'#ABCDEF'},'teacher');
  expect(dashed.entities.at(-1)).toMatchObject({id:original.id,layerId:original.layerId,lineStyle:'PROBLEM_HIDDEN',appearance:{pattern:'DASHED'}});
  const changed=setLineStyle(dashed,original.id,'PROBLEM_VISIBLE','teacher');
  expect(changed.entities.at(-1)?.appearance).toEqual({color:'#ABCDEF'});
});
