import { expect, it } from 'vitest';
import { createDocument, cadStep, startCadSession } from '@tuheng/geometry-core';
import type { GeometryEntity, GeometryDocument } from '@tuheng/contracts';

it('a tap in either adjacent face finds only its boundaries and excludes inner holes and hidden layers', () => {
  const d = createDocument('VHW_PROJECTION'),
    base = {
      viewId: 'view-0',
      lineStyle: 'ANSWER_VISIBLE',
      layerId: d.layers.find((l) => l.role === 'STUDENT_ANSWER')!.id,
    } as const;
  const nodes = [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
    [40, 0],
    [40, 20],
    [5, 8],
  ];
  d.entities.push(
    ...nodes.map(([x, y], i): GeometryEntity => ({
      ...base,
      kind: 'point',
      id: 'v' + i,
      position: { x, y },
      spatial: null,
      labelVisible: false,
      name: '',
    })),
  );
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [1, 4],
    [4, 5],
    [5, 2],
  ];
  d.entities.push(
    ...pairs.map(([a, b], i): GeometryEntity => ({
      ...base,
      kind: 'segment',
      id: 's' + i,
      startPoint: 'v' + a,
      endPoint: 'v' + b,
    })),
  );
  d.entities.push({ ...base, kind: 'circle', id: 'hole', center: 'v6', radius: 2 });
  const resolve = (x: number, hiddenLayers: string[] = []) =>
    cadStep(startCadSession('hatch', d, 'view-0', 'student'), d, {
      type: 'point',
      position: { x, y: 8 },
      hiddenLayers,
    });
  const left = resolve(12);
  expect(left.session?.phase).toBe('confirm');
  const saved = cadStep(left.session!, d, { type: 'confirm' }).document as GeometryDocument;
  const hatch = saved.entities.find((e) => e.kind === 'hatch')!;
  expect(hatch.loops.flat().sort()).toEqual(['hole', 's0', 's1', 's2', 's3']);
  expect(resolve(30).session?.ids.sort()).toEqual(['s1', 's4', 's5', 's6']);
  expect(resolve(100).message).toContain('闭合区域');
  expect(resolve(12, [base.layerId]).message).toContain('闭合区域');
});
