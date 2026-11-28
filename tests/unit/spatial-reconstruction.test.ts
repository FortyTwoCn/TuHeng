import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  auditDrawing,
  createDocument,
  loadGeometryDocument,
  reconstructDrawing3D,
} from '@tuheng/geometry-core';
import type { GeometryDocument } from '@tuheng/contracts';
import { outline } from '../drawing-projection-fixtures';

const load = () =>
  loadGeometryDocument(
    readFileSync('docs/geometry-examples/reconstruction/3-19-VH-SPATIAL.json', 'utf8'),
  );
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const spatial = (doc: GeometryDocument) => {
  const result = reconstructDrawing3D(doc);
  if (!result.ok) throw Error(result.reason);
  if (result.scene.kind !== 'DESCRIPTIVE_GEOMETRY') throw Error('需要画法几何场景');
  return result.scene;
};

describe('画法几何三维还原', () => {
  it('3-19 精确恢复空间点、AB、△CDE 及过 N 的解平面', () => {
    const doc = load();
    expect(auditDrawing(doc)).toMatchObject({
      status: 'PASS',
      reconstructionKind: 'DESCRIPTIVE_GEOMETRY',
      canReconstruct3D: true,
    });
    const scene = spatial(doc);
    const positions = Object.fromEntries(
      scene.points.map(({ name, position }) => [name, position]),
    );
    expect(positions).toMatchObject({
      A: [74, 23.5, 25],
      B: [60, 23.5, 35.5],
      C: [44, 33, 38],
      D: [26, 13.5, 38],
      E: [52.5, 13.5, 18.5],
      N: [13.5, 27, 31],
    });
    const expectedFoot = [22.820209740491, 18.396729470316, 43.66592605759];
    positions['1'].forEach((coordinate, i) => expect(coordinate).toBeCloseTo(expectedFoot[i], 8));
    positions[''].forEach((coordinate, i) =>
      expect(coordinate).toBeCloseTo([0.62, 27, 40.66][i], 10),
    );
    expect(scene.points).toHaveLength(8);
    expect(scene.segments).toHaveLength(6);
    const lineAB = scene.segments.find(({ sources }) =>
      sources.some(({ entityId }) => entityId === 'v-ab'),
    )!;
    expect(lineAB).toMatchObject({ points: [positions.A, positions.B], role: 'PROBLEM' });
    const stem = scene.faces.find(({ kind, role }) => kind === 'POLYGON' && role === 'PROBLEM')!;
    expect(stem.points).toHaveLength(3);
    for (const name of ['C', 'D', 'E']) expect(stem.points).toContainEqual(positions[name]);
    const answer = scene.faces.find(({ kind }) => kind === 'SPANNED')!;
    const ab = positions.B.map((n, i) => n - positions.A[i]);
    expect(dot(stem.normal, answer.normal)).toBeCloseTo(0, 10);
    expect(dot(ab, answer.normal)).toBeCloseTo(0, 10);
    expect(
      dot(
        positions.N.map((n, i) => n - answer.points[0][i]),
        answer.normal,
      ),
    ).toBeCloseTo(0, 10);
    expect(
      dot(
        positions['1'].map((n, i) => n - positions.C[i]),
        stem.normal,
      ),
    ).toBeCloseTo(0, 10);
    expect(scene.rightAngles).toHaveLength(1);
    expect(scene.projectionPlanes.map(({ direction }) => direction)).toEqual(['V', 'H']);
    expect(scene.projectionRays).toHaveLength(16);
    expect(scene.points.find(({ name }) => name === 'N')?.projections).toMatchObject([
      { direction: 'V', entityId: 'v-n', position: { x: 13.5, y: 31 } },
      { direction: 'H', entityId: 'h-n', position: { x: 13.5, y: -27 } },
    ]);
  });

  it('按唯一 X 配对无标签开放端点，保留开放空间线段', () => {
    const doc = createDocument('VH_PROJECTION');
    outline(
      doc,
      0,
      'front-line',
      [
        [5, 3],
        [14, 3],
      ],
      false,
    );
    outline(
      doc,
      1,
      'top-line',
      [
        [5, 8],
        [14, 13],
      ],
      false,
    );
    const scene = spatial(doc);
    expect(scene.points.map(({ position }) => position)).toEqual([
      [5, 8, 3],
      [14, 13, 3],
    ]);
    expect(scene.segments).toMatchObject([
      {
        points: [
          [5, 8, 3],
          [14, 13, 3],
        ],
        role: 'ANSWER',
      },
    ]);
    expect(scene.faces).toHaveLength(0);
  });

  it('三面匹配支持 Unicode 双撇并诊断 X、Y、Z 同名点错位', () => {
    const original = load();
    const three = createDocument('VHW_PROJECTION');
    three.entities = original.entities;
    const w = three.views[2].id;
    three.entities.push({
      id: 'w-a',
      kind: 'point',
      viewId: w,
      name: 'a″',
      position: { x: 23.5, y: 25 },
      labelVisible: true,
      spatial: null,
      layerId: 'stem',
      lineStyle: 'PROBLEM_VISIBLE',
    });
    const scene = spatial(three);
    expect(scene.projectionPlanes.map(({ direction }) => direction)).toEqual(['V', 'H', 'W']);
    expect(scene.points.find(({ name }) => name === 'A')?.projections).toHaveLength(3);
    for (const entity of three.entities)
      if (entity.kind === 'point') {
        if (entity.id === 'h-a') entity.position.x += 1;
        if (entity.id === 'w-a') {
          entity.position.x += 2;
          entity.position.y += 3;
        }
      }
    const report = auditDrawing(three);
    expect(report.canReconstruct3D).toBe(false);
    expect(
      report.checks.filter(({ severity }) => severity === 'ERROR').map(({ title }) => title),
    ).toEqual(['长对正', '高平齐', '宽相等']);
  });
});
