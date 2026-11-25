import { createId } from '@tuheng/contracts';
import type { GeometryDocument } from '@tuheng/contracts';
import { transact } from './document';
import { distance, point } from './math';
import { boundaryShape, nearestOnShape } from './parametric-geometry';
import {
  intersectionCandidates,
  confirmSnap,
  type SnapCandidate,
  type snapCandidates,
} from './snapping';
import { resampleStroke } from './pen';

/** Keep the few intersections that best match the fitted path and preserve its samples. */
export function snapPenCurve(
  base: GeometryDocument,
  raw: GeometryDocument,
  role: 'teacher' | 'student',
  pixels: number,
  options: Parameters<typeof snapCandidates>[5],
) {
  const curve = raw.entities.at(-1);
  if (curve?.kind !== 'curve' || !curve.samples) return raw;
  const shape = boundaryShape(raw, curve);
  if (!shape) return raw;
  const candidates = new Map<string, SnapCandidate>();
  for (const p of resampleStroke(curve.samples, 128))
    for (const c of intersectionCandidates(base, curve.viewId, p, pixels, options)) {
      const previous = candidates.get(c.id!);
      if (!previous || c.distance < previous.distance) candidates.set(c.id!, c);
    }
  const original = curve.pointIds.map((id) => point(raw, id));
  const nodes = curve.pointIds.map((id, i) => ({
    id,
    at: i / (original.length - 1),
    position: original[i],
    candidate: undefined as SnapCandidate | undefined,
  }));
  const radius = (options?.threshold ?? 10) / pixels;
  const eligible = [...candidates.values()].map((candidate) => {
    const fit = nearestOnShape(shape, candidate.position);
    return { candidate, at: fit.t, gap: distance(fit.position, candidate.position) };
  }).filter(({ gap }) => gap <= radius)
    .sort((a, b) => a.gap - b.gap || a.candidate.distance - b.candidate.distance);
  let accepted = 0;
  for (const { candidate: c, at } of eligible) {
    if (accepted >= 4) break;
    if (nodes.some((n) => n.candidate && distance(n.position, c.position) < radius * 1.5)) continue;
    const nearest = nodes.reduce((a, b) => Math.abs(a.at - at) <= Math.abs(b.at - at) ? a : b);
    if (!nearest.candidate && distance(nearest.position, c.position) <= radius * 0.5) {
      nearest.position = c.position;
      nearest.candidate = c;
    } else {
      if (nodes.some((n) => Math.abs(n.at - at) < 1e-7 || distance(n.position, c.position) < radius * 0.5))
        continue;
      nodes.push({ id: createId(), at, position: c.position, candidate: c });
    }
    accepted++;
  }
  if (!accepted) return raw;
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
