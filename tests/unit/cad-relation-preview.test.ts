import { describe, expect, it } from 'vitest';
import {
  addDrawing,
  createDocument,
  snapCandidates,
  dot,
  distance,
  cadStep,
  startCadSession,
  serializeGeometryDocument,
  sub,
  type SnapCandidate,
  type SnapOptions,
} from '@tuheng/geometry-core';
import type { GeometryDocument, Vec2 } from '@tuheng/contracts';

const xy = (x: number, y: number) => ({ x, y });
const opts: SnapOptions = { axes: false, grid: false, direction: true, lineRelations: true };
function snaps(
  doc: GeometryDocument,
  anchor: Vec2 | undefined,
  p: Vec2,
  options: SnapOptions = {},
  scale = 5,
) {
  return snapCandidates(doc, 'view-0', p, scale, anchor, { ...opts, ...options });
}
function find(candidates: SnapCandidate[], kind: SnapCandidate['kind']) {
  const candidate = candidates.find((c) => c.kind === kind);
  expect(candidate).toBeDefined();
  return candidate!;
}
describe('transient line relation references', () => {
  const line = addDrawing(
    createDocument('ISOMETRIC'),
    'segment',
    'view-0',
    [xy(5, 10), xy(30, 10)],
    'teacher',
  );
  const source = line.entities.at(-1)!;
  it('marks true reference positions for parallel, perpendicular and a foot only on the finite reference', () => {
    const a = xy(15, 25);
    const par = find(snaps(line, a, xy(29, 25.3)), 'PARALLEL');
    expect(par).toMatchObject({
      position: xy(29, 25),
      guide: {
        kind: 'parallel',
        sourceId: source.id,
        origin: xy(5, 10),
        contact: xy(15, 10),
        direction: xy(1, 0),
      },
    });
    expect(find(snaps(line, a, xy(15.2, 40)), 'PERPENDICULAR')).toMatchObject({
      position: xy(15, 40),
      guide: { kind: 'perpendicular', contact: xy(15, 10) },
    });
    expect(snaps(line, a, xy(15.18, 10.1))[0]).toMatchObject({
      kind: 'FOOT',
      position: xy(15, 10),
      guide: { kind: 'perpendicular', sourceId: source.id },
    });
    expect(snaps(line, xy(33, 25), xy(33, 10)).some((c) => c.kind === 'FOOT')).toBe(false);
    expect(snaps(line, a, xy(15.4, 25.65)).some((c) => c.guide)).toBe(false);
    expect(snaps(line, a, xy(29, 27)).some((c) => c.kind === 'PARALLEL')).toBe(false);
  });

  it('respects device scale, frame, object/angle switches, exclusions and hidden layers without changing the stem', () => {
    const before = structuredClone(line),
      a = xy(15, 25);
    for (const scale of [2, 5, 12])
      expect(
        find(snaps(line, a, xy(29, 25 + 2 / scale), {}, scale), 'PARALLEL').guide?.sourceId,
      ).toBe(source.id);
    for (const off of [
      { objects: false },
      { exclude: [source.id] },
      { hiddenLayers: [source.layerId] },
      { direction: false },
    ]) {
      expect(snaps(line, a, xy(29, 25.3), off).some((c) => c.guide?.kind === 'parallel')).toBe(
        false,
      );
    }
    expect(snaps(line, undefined, xy(15, 10)).some((c) => c.guide)).toBe(false);
    expect(snaps(line, a, xy(29, 25.3), { lineRelations: false }).some((c) => c.guide)).toBe(false);
    let projected = createDocument('VHW_PROJECTION');
    projected = addDrawing(projected, 'segment', 'view-1', [xy(5, 10), xy(30, 10)], 'student');
    expect(snaps(projected, a, xy(29, 25.3)).some((c) => c.guide)).toBe(false);
    expect(line).toEqual(before);
  });

  it('chooses a nearby parallel reference consistently and releases it for an actual endpoint', () => {
    const another = addDrawing(line, 'segment', 'view-0', [xy(5, 23), xy(30, 23)], 'student');
    const chosen = find(snaps(another, xy(15, 25), xy(29, 25.4)), 'PARALLEL');
    expect(chosen.guide?.sourceId).toBe(another.entities.at(-1)?.id);
    const shifted = find(
      snaps(another, xy(15, 25), xy(32, 25.5), { previous: chosen }),
      'PARALLEL',
    );
    expect(shifted.guide?.sourceId).toBe(chosen.guide?.sourceId);
    expect(shifted.position.x).toBe(32);
    expect(snaps(another, xy(15, 23), xy(30.1, 23), { previous: chosen })[0].kind).toBe(
      'COINCIDENT',
    );
  });

  it('keeps a real endpoint ID at a foot, including when committing the snapped segment', () => {
    const anchor = xy(30, 26);
    const picked = snaps(line, anchor, xy(30.12, 10.1))[0];
    const endpoint = line.entities.find((e) => e.kind === 'segment')!.endPoint;
    expect(picked).toMatchObject({
      kind: 'COINCIDENT',
      entityIds: [endpoint],
      position: xy(30, 10),
      guide: { kind: 'perpendicular', sourceId: source.id, contact: xy(30, 10) },
    });
    const session = cadStep(startCadSession('segment', line, 'view-0', 'teacher'), line, {
      type: 'point',
      position: anchor,
    }).session!;
    const finished = cadStep(session, line, {
      type: 'point',
      entityId: endpoint,
      position: picked.position,
      snap: picked,
    }).document!;
    expect(finished.entities.at(-1)).toMatchObject({ kind: 'segment', endPoint: endpoint });
    expect(finished.constraints).toEqual(line.constraints);
    expect(finished.referenceRelations).toEqual(line.referenceRelations);
    expect(serializeGeometryDocument(finished)).not.toContain('"guide"');
  });

  it('keeps an intersection, a grid point and a quadrant as the exact positional target', () => {
    const crossed = addDrawing(line, 'segment', 'view-0', [xy(15, 6), xy(15, 22)], 'student');
    const crossPick = snaps(crossed, xy(15, 26), xy(15.09, 10.1), { direction: false })[0];
    expect(crossPick).toMatchObject({
      kind: 'INTERSECTION',
      position: xy(15, 10),
      guide: { kind: 'perpendicular', sourceId: source.id },
    });
    expect(crossPick.entityIds).toEqual(
      expect.arrayContaining([source.id, crossed.entities.at(-1)!.id]),
    );
    const gridPick = snaps(line, xy(10, 25), xy(20, 25.14), { grid: true, gridSpacing: 5 })[0];
    expect(gridPick).toMatchObject({
      kind: 'GRID',
      position: xy(20, 25),
      entityIds: [],
      guide: { kind: 'parallel', sourceId: source.id },
    });
    const circle = addDrawing(
      createDocument('ISOMETRIC'),
      'circle',
      'view-0',
      [xy(10, 10), xy(15, 10)],
      'student',
    );
    const quadrant = snaps(circle, xy(22, 15), xy(10.11, 15.07), {
      objectTypes: ['quadrant', 'tangent'],
    })[0];
    expect(quadrant).toMatchObject({
      kind: 'QUADRANT',
      position: xy(10, 15),
      guide: { kind: 'tangent', sourceId: circle.entities.at(-1)!.id },
    });
  });

  it('omits relation marks for a nearby off-direction endpoint or a zero-length leg', () => {
    const offAxis = addDrawing(line, 'point', 'view-0', [xy(21, 25.015)], 'student');
    const winner = snaps(offAxis, xy(15, 25), xy(21, 25.015))[0];
    expect(winner.kind).toBe('COINCIDENT');
    expect(winner.position).toEqual(xy(21, 25.015));
    expect(winner.guide).toBeUndefined();
    const circle = addDrawing(
      createDocument('ISOMETRIC'),
      'circle',
      'view-0',
      [xy(10, 10), xy(15, 10)],
      'student',
    );
    for (const [doc, p] of [
      [line, xy(15, 10)],
      [circle, xy(10, 15)],
    ] as const) {
      const atStart = snaps(doc, p, p, { objectTypes: ['perpendicular', 'quadrant'] });
      expect(atStart.some((c) => c.kind === 'FOOT' || c.guide)).toBe(false);
    }
  });

  it('distinguishes tangency from an external point from departure at a contact and gives no tangent from inside', () => {
    const circle = addDrawing(
      createDocument('ISOMETRIC'),
      'circle',
      'view-0',
      [xy(10, 10), xy(15, 10)],
      'teacher',
    );
    const id = circle.entities.at(-1)!.id;
    const contact = xy(12.5, 10 + Math.sqrt(18.75));
    const outside = xy(20, 10),
      c = find(snaps(circle, outside, contact, { objectTypes: ['tangent'] }), 'TANGENT');
    expect(c.guide?.sourceId).toBe(id);
    expect(distance(c.guide!.contact, c.position)).toBeCloseTo(0, 10);
    expect(dot(c.guide!.direction, sub(c.position, xy(10, 10)))).toBeCloseTo(0, 8);
    const start = xy(10, 15);
    const departure = find(
      snaps(circle, start, xy(28, 15.4), { objectTypes: ['tangent'] }),
      'TANGENT',
    );
    expect(departure).toMatchObject({
      position: xy(28, 15),
      guide: { kind: 'tangent', contact: start, origin: start },
    });
    const farther = find(
      snaps(circle, start, xy(31, 15.7), { objectTypes: ['tangent'], previous: departure }),
      'TANGENT',
    );
    expect(farther.id).toBe(departure.id);
    expect(farther.position.x).toBe(31);
    expect(snaps(circle, xy(10, 14.9), xy(28, 15)).some((c) => c.kind === 'TANGENT')).toBe(false);
    expect(snaps(circle, xy(10, 10), contact).some((c) => c.kind === 'TANGENT')).toBe(false);
    expect(
      snaps(circle, start, xy(28, 15.3), { objectTypes: ['center'] }).some(
        (c) => c.kind === 'TANGENT',
      ),
    ).toBe(false);
  });
  it('rejects roots and departing tangents on the missing portion of an arc', () => {
    const base = addDrawing(
      createDocument('ISOMETRIC'),
      'arc',
      'view-0',
      [xy(10, 10), xy(15, 10), xy(10, 15)],
      'student',
    );
    expect(
      find(snaps(base, xy(10, 15), xy(27, 15.4), { objectTypes: ['tangent'] }), 'TANGENT').guide
        ?.contact,
    ).toEqual(xy(10, 15));
    expect(
      snaps(base, xy(10, 5), xy(27, 5.3), { objectTypes: ['tangent'] }).some(
        (c) => c.kind === 'TANGENT',
      ),
    ).toBe(false);
    expect(
      snaps(base, xy(20, 10), xy(12.5, 10 - Math.sqrt(18.75)), { objectTypes: ['tangent'] }).some(
        (c) => c.kind === 'TANGENT',
      ),
    ).toBe(false);
  });
});
