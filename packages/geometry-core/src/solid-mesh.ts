import type { SolidPanel } from './solid-panels';
import { cross3 as cross, dot3 as dot, sub3 as subtract, type SolidPoint } from './spatial-math';

export type SolidTriangle = [number, number, number];
const weldDistance = 1e-7;
const vertexLimit = 30000;

export function meshSolidPanels(panels: SolidPanel[]) {
  const vertices: SolidPoint[] = [];
  const cells = new Map<string, number[]>();
  const indexVertex = (position: SolidPoint) => {
    const [x, y, z] = position.map((value) => Math.floor(value / weldDistance));
    for (let i = x - 1; i <= x + 1; i++)
      for (let j = y - 1; j <= y + 1; j++)
        for (let k = z - 1; k <= z + 1; k++)
          for (const index of cells.get(`${i},${j},${k}`) ?? []) {
            const d = subtract(position, vertices[index]);
            if (dot(d, d) <= weldDistance ** 2) return index;
          }
    if (vertices.length >= vertexLimit) throw Error('三维顶点数量超过 30000 个');
    const key = `${x},${y},${z}`,
      id = vertices.length;
    const cell = cells.get(key) ?? [];
    cell.push(id);
    cells.set(key, cell);
    vertices.push(position);
    return id;
  };
  const rings = panels.map(({ points }) =>
    points.map(indexVertex).filter((id, i, ids) => id !== ids[(i + ids.length - 1) % ids.length]),
  );
  const sorted = [0, 1, 2].map((axis) =>
    vertices.map((_, id) => id).sort((a, b) => vertices[a][axis] - vertices[b][axis]),
  );
  let comparisons = 0;
  function splitEdge(a: SolidPoint, b: SolidPoint) {
    const d = subtract(b, a);
    const abs = d.map(Math.abs),
      axis = abs.indexOf(Math.max(...abs));
    const ids = sorted[axis],
      low = Math.min(a[axis], b[axis]),
      high = Math.max(a[axis], b[axis]);
    let from = 0,
      to = ids.length;
    while (from < to) {
      const mid = (from + to) >>> 1;
      if (vertices[ids[mid]][axis] <= low + weldDistance) from = mid + 1;
      else to = mid;
    }
    const cuts: { id: number; t: number }[] = [];
    for (let j = from; j < ids.length; j++) {
      if (++comparisons > 3_000_000) throw Error('网格接缝过密，已达到计算上限');
      const id = ids[j],
        p = vertices[id];
      if (p[axis] >= high - weldDistance) break;
      const dp = subtract(p, a),
        t = dp[axis] / d[axis];
      if (Math.hypot(dp[0] - d[0] * t, dp[1] - d[1] * t, dp[2] - d[2] * t) <= weldDistance)
        cuts.push({ id, t });
    }
    return cuts.sort((a, b) => a.t - b.t).map(({ id }) => id);
  }

  const triangles: SolidTriangle[] = [],
    normals: SolidPoint[] = [];
  const faceSources: { viewId: string; entityId: string }[] = [];
  let volumeMm3 = 0;
  const origin = vertices[0] ?? [0, 0, 0];
  const addTriangle = (triangle: SolidTriangle, source: (typeof faceSources)[number]) => {
    const [a, b, c] = triangle.map((id) => vertices[id]);
    const normal = cross(subtract(b, a), subtract(c, a));
    const length = Math.hypot(...normal);
    if (length < 1e-13) return;
    if (triangles.length >= 50000) throw Error('三维网格面数超过 50000 个');
    triangles.push(triangle);
    normals.push([normal[0] / length, normal[1] / length, normal[2] / length]);
    faceSources.push(source);
    volumeMm3 += dot(subtract(a, origin), normal) / 6;
  };
  rings.forEach((ring, index) => {
    if (ring.length < 3) return;
    const { viewId, entityId } = panels[index],
      source = { viewId, entityId };
    const split = ring.flatMap((id, i) => [
      id,
      ...splitEdge(vertices[id], vertices[ring[(i + 1) % ring.length]]),
    ]);
    const needsCenter =
      split.length !== ring.length ||
      ring
        .slice(2)
        .some(
          (id, i) =>
            Math.hypot(
              ...cross(
                subtract(vertices[ring[i + 1]], vertices[ring[0]]),
                subtract(vertices[id], vertices[ring[0]]),
              ),
            ) < 1e-13,
        );
    if (!needsCenter) {
      for (let i = 2; i < ring.length; i++) addTriangle([ring[0], ring[i - 1], ring[i]], source);
    } else {
      // Preserve all shared boundary vertices, including T junctions between clipped panels.
      const midpoint: SolidPoint = [0, 0, 0];
      for (const id of ring)
        for (const axis of [0, 1, 2]) midpoint[axis] += vertices[id][axis] / ring.length;
      const center = indexVertex(midpoint);
      split.forEach((id, i) => addTriangle([center, id, split[(i + 1) % split.length]], source));
    }
  });
  if (!triangles.length || volumeMm3 <= 1e-8) throw Error('投影正交交集为空或退化为零体积');
  const adjacency = new Map<number, { from: number; to: number; faces: number[]; sign: number }>();
  triangles.forEach((triangle, face) => {
    triangle.forEach((from, i) => {
      const to = triangle[(i + 1) % 3];
      const key = Math.min(from, to) * vertexLimit + Math.max(from, to);
      const edge = adjacency.get(key) ?? { from, to, faces: [], sign: 0 };
      edge.faces.push(face);
      edge.sign += from < to ? 1 : -1;
      adjacency.set(key, edge);
    });
  });
  const edges: [SolidPoint, SolidPoint][] = [];
  for (const { from, to, faces, sign } of adjacency.values()) {
    if (faces.length !== 2 || sign !== 0)
      throw Error('投影交集存在开放或相切的非流形接缝，无法生成可靠实体');
    // Keep actual creases and hole rims while suppressing internal triangulation edges.
    if (dot(normals[faces[0]], normals[faces[1]]) < 0.95)
      edges.push([vertices[from], vertices[to]]);
  }
  const incident = Array.from({ length: vertices.length }, () => 0);
  for (const triangle of triangles) for (const id of triangle) incident[id]++;
  const visited = new Uint8Array(vertices.length);
  for (const [face, triangle] of triangles.entries())
    for (const id of triangle) {
      if (visited[id]) continue;
      visited[id] = 1;
      let from = face,
        current = face,
        count = 0;
      do {
        const next = triangles[current].flatMap((neighbor) => {
          if (neighbor === id) return [];
          const key = Math.min(id, neighbor) * vertexLimit + Math.max(id, neighbor);
          return adjacency.get(key)!.faces.filter((index) => index !== current);
        });
        const across = next.find((neighbor) => neighbor !== from);
        if (across === undefined) break;
        from = current;
        current = across;
        count++;
      } while (current !== face && count <= incident[id]);
      if (count !== incident[id]) throw Error('投影交集存在仅在顶点接触的表面，无法生成可靠实体');
    }
  const mapping = new Map<number, number>();
  const min: SolidPoint = [Infinity, Infinity, Infinity],
    max: SolidPoint = [-Infinity, -Infinity, -Infinity];
  const compact: SolidPoint[] = [];
  for (const triangle of triangles) {
    triangle.forEach((id, i) => {
      if (!mapping.has(id)) {
        mapping.set(id, compact.length);
        const point = vertices[id];
        compact.push(point);
        for (const axis of [0, 1, 2]) {
          min[axis] = Math.min(min[axis], point[axis] || 0);
          max[axis] = Math.max(max[axis], point[axis] || 0);
        }
      }
      triangle[i] = mapping.get(id)!;
    });
  }
  return {
    vertices: compact,
    triangles,
    normals,
    edges,
    faceSources,
    volumeMm3,
    bounds: { min, max, size: subtract(max, min) },
  };
}
