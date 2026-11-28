import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GeometryDocument } from '@tuheng/contracts';
import {
  createDocument,
  loadGeometryDocument,
  reconstructSolid3D,
  type ReconstructedSolid3D,
} from '@tuheng/geometry-core';
import {
  boxDrawing,
  cylinderDrawing,
  outline,
  projectedCircle,
  rectangle,
  type Position,
} from '../drawing-projection-fixtures';
import {
  cross3,
  dot3,
  norm3,
  sub3,
  type SolidPoint,
} from '../../packages/geometry-core/src/spatial-math';

function reconstruct(doc: GeometryDocument) {
  const result = reconstructSolid3D(doc);
  if (!result.ok) throw Error(result.reason);
  return result.solid;
}

function checkMesh(mesh: ReconstructedSolid3D, genus: number) {
  const pairs = new Map<string, number[]>();
  expect(mesh.normals).toHaveLength(mesh.triangles.length);
  expect(mesh.faceSources).toHaveLength(mesh.triangles.length);
  for (const [i, face] of mesh.triangles.entries()) {
    expect(Math.hypot(...mesh.normals[i])).toBeCloseTo(1, 8);
    expect(new Set(face).size).toBe(3);
    for (const [j, a] of face.entries()) {
      const b = face[(j + 1) % 3];
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(mesh.vertices.length);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      pairs.set(key, [...(pairs.get(key) ?? []), a < b ? 1 : -1]);
    }
  }
  expect([...pairs.values()].every((uses) => uses.length === 2 && uses[0] !== uses[1])).toBe(true);
  expect(mesh.vertices.length - pairs.size + mesh.triangles.length).toBe(2 - genus * 2);
}

function axialCrossings(mesh: ReconstructedSolid3D, p: Position) {
  const cross = ([ax, ay]: Position, [bx, by]: Position, [cx, cy]: Position) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return mesh.triangles.filter((face) => {
    const [a, b, c] = face.map((id) => mesh.vertices[id].slice(0, 2) as Position);
    if (Math.abs(cross(a, b, c)) < 1e-8) return false;
    const signs = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
    return signs.every((v) => v > 0) || signs.every((v) => v < 0);
  }).length;
}

function contains(mesh: ReconstructedSolid3D, point: SolidPoint) {
  const angle = mesh.triangles.reduce((sum, face) => {
    const [a, b, c] = face.map((id) => sub3(mesh.vertices[id], point));
    return (
      sum +
      2 *
        Math.atan2(
          dot3(a, cross3(b, c)),
          norm3(a) * norm3(b) * norm3(c) +
            dot3(a, b) * norm3(c) +
            dot3(b, c) * norm3(a) +
            dot3(c, a) * norm3(b),
        )
    );
  }, 0);
  return Math.abs(angle) > 2 * Math.PI;
}

const completeDrawing = () =>
  loadGeometryDocument(
    readFileSync('docs/geometry-examples/reconstruction/7-24-THREE-VIEW-COMPLETE.json', 'utf8'),
  );

describe('正交投影实体重建', () => {
  it('从另一组矩形嵌套轮廓与虚线恢复独立的盲槽深度', () => {
    const doc = boxDrawing();
    outline(doc, 1, 'recess', rectangle(4, 3, 12, 8));
    const hidden = { lineStyle: 'ANSWER_HIDDEN', layerId: 'answer' } as const;
    outline(
      doc,
      0,
      'front-recess',
      [
        [4, 10],
        [4, 6],
        [16, 6],
        [16, 10],
      ],
      false,
      hidden,
    );
    outline(
      doc,
      2,
      'side-recess',
      [
        [3, 10],
        [3, 6],
        [11, 6],
        [11, 10],
      ],
      false,
      hidden,
    );
    const solid = reconstruct(doc);
    expect(solid.reconstructionMethod).toBe('PROJECTION_CELL_DECOMPOSITION');
    expect(solid.volumeMm3).toBeCloseTo(20 * 14 * 10 - 12 * 8 * 4, 7);
    expect(contains(solid, [8, 7, 8])).toBe(false);
    expect(contains(solid, [8, 7, 4])).toBe(true);
    checkMesh(solid, 0);
  });

  it('7-24 从 57 个投影图元重建斜坡、盲槽与带贯穿孔的圆角耳板', () => {
    const result = reconstructSolid3D(completeDrawing());
    if (!result.ok) throw Error(result.reason);
    const { solid } = result;
    expect(result.audit.status).toBe('PASS');
    expect(solid.reconstructionMethod).toBe('PROJECTION_CELL_DECOMPOSITION');
    expect(solid.verification).toMatchObject({ explainedEntities: 57, cylindricalCuts: 1 });
    expect(solid.bounds.size).toEqual([88, 53, 73]);
    const shell = 53 * ((51 * (17 + 53)) / 2 + 37 * 63);
    const slot = 33 * (41 * ((17 + 360 / 51 + 53) / 2 - 10) + 15 * (63 - 10));
    const ear = 10 * (15 * (58 - 10) + (Math.PI * 15 ** 2) / 4 + 31 * (73 - 10) + 12 * (73 - 63));
    const hole = 10 * Math.PI * 8.5 ** 2;
    expect(Math.abs(solid.volumeMm3 - (shell - slot + ear - hole))).toBeLessThan(5);
    checkMesh(solid, 1);

    expect(contains(solid, [55, 16, 20])).toBe(false); // 盲槽内，耳板外
    expect(contains(solid, [55, 16, 5])).toBe(true); // 槽底以下的材料
    expect(contains(solid, [40, 27, 55])).toBe(true); // 耳板内，孔径外
    for (const y of [21, 22.5, 27, 31.5, 33]) {
      expect(contains(solid, [53, y, 58])).toBe(false); // 连通两侧的圆孔
      if (y > 22 && y < 32) expect(contains(solid, [53, y, 68])).toBe(true);
    }
    expect(contains(solid, [83, 38, 46])).toBe(false); // 斜坡上方的切除区
    expect(contains(solid, [70, 27, 69])).toBe(false); // 圆角外侧
  });

  it('7-24 只有主、俯视图时保留内部凹槽与厚度的多解提示', () => {
    const partial = completeDrawing();
    partial.entities = partial.entities.filter(({ viewId }) => viewId !== 'view-2');
    const solid = reconstruct(partial);
    expect(solid.sourceViewMapping.map(({ direction }) => direction)).toEqual(['V', 'H']);
    expect(solid.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/两视图.*内部凹槽.*多解.*第三视图/)]),
    );
  });
  it.each(['THREE_VIEW', 'VHW_PROJECTION', 'VH_PROJECTION'] as const)('生成 %s 长方体', (type) => {
    const solid = reconstruct(boxDrawing(type));
    expect(solid.bounds).toEqual({ min: [0, 0, 0], max: [20, 14, 10], size: [20, 14, 10] });
    expect(solid.volumeMm3).toBeCloseTo(2800, 8);
    expect(solid.edges).toHaveLength(12);
    expect(solid.sourceViewMapping.map(({ direction }) => direction)).toEqual(
      type === 'VH_PROJECTION' ? ['V', 'H'] : ['V', 'H', 'W'],
    );
    if (type === 'VH_PROJECTION') expect(solid.confidenceNote).toContain('V/H 双视图');
    checkMesh(solid, 0);
  });

  it.each([
    [
      'L',
      [
        [0, 0],
        [20, 0],
        [20, 6],
        [8, 6],
        [8, 14],
        [0, 14],
      ],
      14,
      2208,
    ],
    [
      'T',
      [
        [6, 0],
        [14, 0],
        [14, 10],
        [20, 10],
        [20, 16],
        [0, 16],
        [0, 10],
        [6, 10],
      ],
      16,
      2400,
    ],
  ] as [string, Position[], number, number][])(
    '生成 %s 形阶梯，保留真实切角',
    (_name, profile, height, volume) => {
      const doc = createDocument('THREE_VIEW');
      outline(doc, 0, 'front', profile);
      outline(doc, 1, 'top', rectangle(0, 0, 20, 12));
      outline(doc, 2, 'left', rectangle(0, 0, 12, height));
      outline(
        doc,
        1,
        'seam',
        [
          [8, 0],
          [8, 12],
        ],
        false,
      );
      const solid = reconstruct(doc);
      expect(solid.bounds.size).toEqual([20, 12, height]);
      expect(solid.volumeMm3).toBeCloseTo(volume, 7);
      checkMesh(solid, 0);
    },
  );

  it('精确相交两张有倾斜边的多边形投影', () => {
    const doc = createDocument('VH_PROJECTION');
    outline(doc, 0, 'front', [
      [0, 0],
      [20, 0],
      [0, 10],
    ]);
    outline(doc, 1, 'top', [
      [0, 0],
      [20, 0],
      [0, 12],
    ]);
    const mesh = reconstruct(doc);
    expect(mesh.bounds.size).toEqual([20, 12, 10]);
    expect(mesh.volumeMm3).toBeCloseTo(800, 7);
    checkMesh(mesh, 0);
  });

  it.each([
    [false, 'THREE_VIEW'],
    [true, 'THREE_VIEW'],
    [true, 'VH_PROJECTION'],
  ] as const)('重建圆柱（带孔 %s，%s）并检查孔道连通', (hollow, type) => {
    const solid = reconstruct(cylinderDrawing(hollow, type));
    expect(solid.bounds.size).toEqual([20, 20, 15]);
    const expected = Math.PI * (100 - (hollow ? 16 : 0)) * 15;
    expect(Math.abs(solid.volumeMm3 - expected) / expected).toBeLessThan(0.004);
    expect(axialCrossings(solid, [0.13, 0.21])).toBe(hollow ? 0 : 2);
    expect(axialCrossings(solid, [6.11, 0.13])).toBe(2);
    checkMesh(solid, hollow ? 1 : 0);
  });

  it('用具有真实孔道的正交交集生成方块带贯通孔', () => {
    const doc = boxDrawing();
    projectedCircle(doc, 1, 'hole', [7, 6], 3);
    const solid = reconstruct(doc);
    expect(solid.bounds.size).toEqual([20, 14, 10]);
    expect(Math.abs(solid.volumeMm3 - (2800 - 90 * Math.PI))).toBeLessThan(2);
    expect(axialCrossings(solid, [7.21, 6.17])).toBe(0);
    expect(axialCrossings(solid, [16.13, 5.21])).toBe(2);
    expect(solid.faceSources.some(({ entityId }) => entityId === 'hole')).toBe(true);
    checkMesh(solid, 1);
  });

  it('闭合半圆和直边保留曲面及真实极值', () => {
    const doc = createDocument('VH_PROJECTION');
    outline(doc, 0, 'front', rectangle(-10, 0, 20, 8));
    // H 的图纸局部 y 为 -Y，局部上半圆对应物理负深度。
    projectedCircle(doc, 1, 'arc', [0, 0], 10, { startAngle: 0, sweep: 180 });
    outline(
      doc,
      1,
      'chord',
      [
        [-10, 0],
        [10, 0],
      ],
      false,
    );
    const solid = reconstruct(doc);
    expect(solid.bounds.min).toEqual([-10, -10, 0]);
    expect(solid.bounds.size).toEqual([20, 10, 8]);
    expect(Math.abs(solid.volumeMm3 - 400 * Math.PI)).toBeLessThan(3);
    checkMesh(solid, 0);
  });

  it('拒绝开放轮廓、缺少视图、严重错位及空交集', () => {
    const empty = createDocument('THREE_VIEW');
    expect(reconstructSolid3D(empty)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('缺少'),
    });
    const open = boxDrawing();
    open.entities = open.entities.filter((e) => e.id !== 'top-2');
    expect(reconstructSolid3D(open)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('悬空端点'),
    });
    const shifted = boxDrawing();
    for (const e of shifted.entities)
      if (e.kind === 'point' && e.viewId === 'view-1') e.position.x += 5;
    expect(reconstructSolid3D(shifted)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('长对正'),
    });
    for (const view of [0, 1, 2]) {
      outline(empty, view, `a-${view}`, rectangle(0, view === 2 ? 6 : 0, 4, 4));
      outline(empty, view, `b-${view}`, rectangle(6, view === 2 ? 0 : 6, 4, 4));
    }
    expect(reconstructSolid3D(empty)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('交集为空'),
    });
  });
});
