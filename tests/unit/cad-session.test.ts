import { describe, expect, it } from 'vitest';
import {
  createDocument,
  point,
  serializeGeometryDocument,
  loadGeometryDocument,
} from '@tuheng/geometry-core';
import { startCadSession, cadStep, cadPreview } from '../../packages/geometry-core/src/cad-session';
import { parseCadCoordinate } from '../../packages/geometry-core/src/cad-input';

describe('CAD local-mm command transactions', () => {
  const original = createDocument('VHW_PROJECTION');
  it('rejects a mixed transform selection instead of silently dropping the reference axis', () => {
    const placed = cadStep(startCadSession('point', original, 'view-0', 'student'), original, {
      type: 'input',
      value: '5,10',
    }).document!;
    expect(() =>
      startCadSession('move', placed, 'view-0', 'student', [placed.entities[0].id, 'baseAxis:X']),
    ).toThrow(/不可变换/);
    expect(point(placed, placed.entities[0].id)).toEqual({ x: 5, y: 10 });
  });
  it('does not create a default line on first click and continues from the shared endpoint', () => {
    const session = startCadSession('segment', original, 'view-0', 'student');
    const a = cadStep(session, original, { type: 'point', position: { x: 3, y: 4 } });
    expect(a.document).toBeUndefined();
    const preview = cadPreview(a.session!, original, { x: 23, y: 4 })!;
    expect(preview.entities.filter((e) => e.kind === 'segment')).toHaveLength(1);
    const b = cadStep(a.session!, original, { type: 'input', value: '@20,0' });
    const c = cadStep(b.session!, b.document!, { type: 'input', value: '@10<90' });
    const lines = loadGeometryDocument(serializeGeometryDocument(c.document!)).entities.filter(
      (e) => e.kind === 'segment',
    );
    expect(lines[0].endPoint).toBe(lines[1].startPoint);
    expect(point(c.document!, lines[1].endPoint)).toEqual({ x: 23, y: 14 });
    expect(original.entities).toHaveLength(0);
  });
  it('rejects invalid coordinate expressions and drops a stale command', () => {
    expect(() => parseCadCoordinate('@20<alert(0)', { x: 0, y: 0 })).toThrow();
    const s = startCadSession('circle', original, 'view-0', 'student');
    expect(
      cadStep(s, structuredClone(original), { type: 'input', value: '0,0' }).session,
    ).toBeNull();
  });
  it('uses the local positive rotation sense in a reflected front-view frame', () => {
    const line = startCadSession('segment', original, 'view-0', 'student');
    const first = cadStep(line, original, { type: 'input', value: '20,20' }).session!;
    const doc = cadStep(first, original, { type: 'input', value: '30,20' }).document!;
    const segment = doc.entities.find((e) => e.kind === 'segment')!;
    let op = startCadSession('rotate', doc, 'view-0', 'student', [segment.id]);
    op = cadStep(op, doc, { type: 'parameters', values: { angle: '90' } }).session!;
    op = cadStep(op, doc, { type: 'input', value: '20,20' }).session!;
    const rotated = cadStep(op, doc, { type: 'confirm' }).document!;
    expect(point(rotated, segment.endPoint).x).toBeCloseTo(20);
    expect(point(rotated, segment.endPoint).y).toBeCloseTo(30);
  });
});
