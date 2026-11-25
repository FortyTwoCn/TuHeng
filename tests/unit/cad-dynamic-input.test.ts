import { expect, it } from 'vitest';
import {
  cadLineEndpoint,
  cadStep,
  createDocument,
  point,
  startCadSession,
  addDrawing,
} from '@tuheng/geometry-core';
import { hitTargets } from '../../packages/geometry-editor/src/interaction-controller';

it('selects the body at the midpoint of a short on-screen line and the handle at its end', () => {
  const doc = addDrawing(
    createDocument('ISOMETRIC'),
    'segment',
    'view-0',
    [
      { x: 4, y: 8 },
      { x: 30, y: 8 },
    ],
    'student',
  );
  const box = { x: 0, y: 0, width: 100, height: 80 };
  const hits = hitTargets(doc, { x: 17, y: 8 }, 1, box, [], [], false, 18);
  expect(hits.map((h) => h.kind)).toEqual(['body', 'endpoint', 'endpoint']);
  expect(hitTargets(doc, { x: 5, y: 8 }, 1, box, [], [], false, 18)[0].kind).toBe('endpoint');
});

it('continues exact 40, 20, 30 mm segments using the previous committed endpoint ID', () => {
  let doc = createDocument('ISOMETRIC');
  let session = startCadSession('segment', doc, 'view-0', 'student');
  session = cadStep(session, doc, { type: 'point', position: { x: 3, y: 4 } }).session!;
  expect(doc.entities).toEqual([]);
  for (const [length, angle] of [
    ['40mm', '0'],
    ['2cm', '90°'],
    ['30', '180'],
  ]) {
    const anchor = session.points[0];
    const position = cadLineEndpoint(anchor, { x: 50, y: 24 }, { length, angle });
    const result = cadStep(session, doc, { type: 'point', position });
    doc = result.document!;
    session = result.session!;
  }
  const [a, b, c] = doc.entities.filter((e) => e.kind === 'segment');
  expect([a.endPoint, b.endPoint]).toEqual([b.startPoint, c.startPoint]);
  expect(point(doc, c.endPoint)).toMatchObject({
    x: expect.closeTo(13, 8),
    y: expect.closeTo(24, 8),
  });
  expect(doc.entities.filter((e) => e.kind === 'point')).toHaveLength(4);
  expect(cadStep(session, doc, { type: 'confirm' })).toMatchObject({ session: null });
});
it('resolves an unlocked angle from the cursor, rejects partial drafts and never rounds stored geometry', () => {
  expect(cadLineEndpoint({ x: 0, y: 0 }, { x: 3, y: 4 }, { length: '10' })).toMatchObject({
    x: expect.closeTo(6, 8),
    y: expect.closeTo(8, 8),
  });
  for (const bad of ['', '0', '-', '3e8', '1.2.3', 'Infinity'])
    expect(() => cadLineEndpoint({ x: 1, y: 1 }, { x: 3, y: 4 }, { length: bad })).toThrow();
});
it('connect and erase use one command service, require existing same-frame nodes and protect the stem', () => {
  let doc = createDocument('VHW_PROJECTION');
  doc = addDrawing(doc, 'point', 'view-0', [{ x: 10, y: 10 }], 'teacher');
  doc = addDrawing(doc, 'point', 'view-0', [{ x: 20, y: 10 }], 'student');
  doc = addDrawing(doc, 'point', 'view-1', [{ x: 20, y: 10 }], 'student');
  const [stem, end, other] = doc.entities;
  let s = startCadSession('connect', doc, 'view-0', 'student');
  s = cadStep(s, doc, { type: 'point', position: point(doc, stem.id), entityId: stem.id }).session!;
  expect(
    cadStep(s, doc, {
      type: 'point',
      position: point(doc, other.id),
      entityId: other.id,
      viewId: 'view-1',
    }).document,
  ).toBeUndefined();
  const connected = cadStep(s, doc, {
    type: 'point',
    position: point(doc, end.id),
    entityId: end.id,
  }).document!;
  const line = connected.entities.at(-1)!;
  expect(line).toMatchObject({ kind: 'segment', startPoint: stem.id, endPoint: end.id });
  expect(() => startCadSession('erase', connected, 'view-0', 'student', [stem.id])).toThrow();
  let erase = startCadSession('erase', connected, 'view-0', 'student');
  erase = cadStep(erase, connected, {
    type: 'point',
    position: { x: 15, y: 10 },
    entityId: line.id,
  }).session!;
  expect(cadStep(erase, connected, { type: 'confirm' }).document).toEqual(doc);
});
