import { createId } from '@tuheng/contracts';
import type { GeometryDocument } from '@tuheng/contracts';
import { transact } from './document';
import { distance, point, sub, dot } from './math';
import {
  intersectionCandidates,
  confirmSnap,
  type SnapCandidate,
  type snapCandidates,
} from './snapping';
import { resampleStroke } from './pen';

/** Snap a freehand curve's interior knots without changing its recorded input samples. */
export function snapPenCurve(
  base: GeometryDocument,
  raw: GeometryDocument,
  role: 'teacher' | 'student',
  pixels: number,
  options: Parameters<typeof snapCandidates>[5],
) {
  const curve = raw.entities.at(-1);
  if (curve?.kind !== 'curve' || !curve.samples) return raw;
  const candidates = new Map<string, SnapCandidate>();
  for (const p of resampleStroke(curve.samples, 128))
    for (const c of intersectionCandidates(base, curve.viewId, p, pixels, options)) {
      const previous = candidates.get(c.id!);
      if (!previous || c.distance < previous.distance) candidates.set(c.id!, c);
    }
  const original = curve.pointIds.map((id) => point(raw, id));
  const nodes = curve.pointIds.map((id, i) => ({
    id,
    at: i,
    position: original[i],
    candidate: undefined as SnapCandidate | undefined,
  }));
  for (const c of [...candidates.values()].sort((a, b) => a.distance - b.distance)) {
    if (nodes.some((n) => n.candidate && distance(n.position, c.position) < 1e-7)) continue;
    let best = { distance: Infinity, at: 0 };
    for (let i = 1; i < original.length; i++) {
      const d = sub(original[i], original[i - 1]),
        t = Math.max(0, Math.min(1, dot(sub(c.position, original[i - 1]), d) / dot(d, d)));
      const q = { x: original[i - 1].x + t * d.x, y: original[i - 1].y + t * d.y };
      if (distance(q, c.position) < best.distance)
        best = { distance: distance(q, c.position), at: i - 1 + t };
    }
    const nearest = nodes.find((n) => n.id === curve.pointIds[Math.round(best.at)]);
    if (nearest && !nearest.candidate) {
      nearest.position = c.position;
      nearest.candidate = c;
    } else if (nodes.length < 128)
      nodes.push({ id: createId(), at: best.at, position: c.position, candidate: c });
  }
  if (!nodes.some((n) => n.candidate)) return raw;
  nodes.sort((a, b) => a.at - b.at);
  // Close intersections must not collapse neighbours or corrupt topology.
  if (nodes.some((n, i) => i > 0 && distance(n.position, nodes[i - 1].position) < 1e-8)) return raw;
  let next = transact(
    raw,
    (d) => {
      const c = d.entities.find((e) => e.id === curve.id)!;
      if (c.kind !== 'curve') return;
      const template = d.entities.find((e) => e.id === curve.pointIds[0])!;
      for (const n of nodes) {
        const p = d.entities.find((e) => e.id === n.id);
        if (p?.kind === 'point') p.position = n.position;
        else if (template.kind === 'point')
          d.entities.splice(d.entities.length - 1, 0, {
            ...template,
            id: n.id,
            name: '',
            position: n.position,
          });
      }
      c.pointIds = nodes.map((n) => n.id);
    },
    role,
  );
  for (const n of nodes) if (n.candidate) next = confirmSnap(base, next, n.candidate, n.id, role);
  return next;
}
