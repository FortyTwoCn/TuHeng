import { describe, expect, it } from 'vitest';
import type { GeometryDocument } from '@tuheng/contracts';
import {
  createDocument,
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

describe('正交投影实体重建', () => {
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
