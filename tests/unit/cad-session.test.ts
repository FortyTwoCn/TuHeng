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
  it('breaks the segment chain, resets drafts and accepts the next first point in another view', () => {
    const started = startCadSession('segment', original, 'view-0', 'student');
    const first = cadStep(started, original, {
      type: 'point',
      position: { x: 20, y: 25 },
      rawPosition: { x: 20.5, y: 25 },
      snap: { kind: 'GRID', position: { x: 20, y: 25 }, entityIds: [], distance: 0.5 },
    }).session!;
    expect(first.rawPoints).toHaveLength(1);
    expect(first.pointSnaps).toHaveLength(1);
    expect(cadStep(first, original, { type: 'cancel' }).session).toMatchObject({ points: [] });

    const saved = cadStep(first, original, { type: 'input', value: '40,25' });
    const doc = saved.document!;
    const drafted = cadStep(saved.session!, doc, {
      type: 'parameters',
      values: { length: '10', angle: '45' },
    }).session!;
    const stopped = cadStep(drafted, doc, { type: 'cancel' });
    expect(stopped.document).toBeUndefined();
    expect(stopped.message).toContain('请指定新起点');
    const waiting = stopped.session!;
    expect(waiting).toMatchObject({
      commandId: 'segment',
      phase: 'points',
      points: [],
      pointIds: [],
      parameters: { length: '', angle: '0' },
    });
    expect(waiting.baseDocument).toBe(doc);
    expect(waiting.prefix).not.toBe(drafted.prefix);
    expect(waiting.rawPoints).toBeUndefined();
    expect(waiting.pointSnaps).toBeUndefined();
    expect(cadPreview(waiting, doc)).toBeNull();
    expect(cadStep(waiting, doc, { type: 'cancel' }).session).toBeNull();

    const next = cadStep(waiting, doc, {
      type: 'point',
      viewId: 'view-1',
      position: { x: 20, y: -32 },
    }).session!;
    expect(next.viewId).toBe('view-1');
    const resumed = cadStep(next, doc, { type: 'input', value: '34,-32' }).document!;
    const segments = resumed.entities.filter((e) => e.kind === 'segment');
    expect(segments.map((segment) => segment.viewId)).toEqual(['view-0', 'view-1']);
    expect(segments[0]).toEqual(doc.entities.at(-1));
    expect(segments[1].startPoint).not.toBe(segments[0].endPoint);
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
