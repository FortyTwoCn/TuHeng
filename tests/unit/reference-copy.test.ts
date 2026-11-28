import { describe, expect, it } from 'vitest';
import { GeometryDocument, type GeometryEntity } from '@tuheng/contracts';
import {
  combineAnswer,
  copyEntitiesFromReferenceDocument,
  createDocument,
  dimensionValue,
  DocumentHistory,
  hitDistance,
  length,
  lineGeometry,
  localToSheet,
  point,
  sub,
} from '@tuheng/geometry-core';
import { outline, projectedCircle } from '../drawing-projection-fixtures';

const segment = (doc: GeometryDocument, id: string) =>
  doc.entities.find(
    (entity): entity is Extract<GeometryEntity, { kind: 'segment' }> =>
      entity.kind === 'segment' && entity.id === id,
  )!;

it('picks an imported polyline that contains a repeated vertex', () => {
  const doc = createDocument('THREE_VIEW');
  const polyline: GeometryEntity = {
    id: 'polyline',
    kind: 'polyline',
    viewId: 'view-0',
    layerId: 'answer',
    lineStyle: 'ANSWER_VISIBLE',
    fitStatus: 'UNFITTED',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ],
  };
  doc.entities.push(polyline);
  expect(hitDistance(doc, polyline, { x: 10, y: 2 }, { x: 0, y: 0, width: 40, height: 40 })).toBe(
    2,
  );
});

describe('copyEntitiesFromReferenceDocument', () => {
  it('keeps local coordinates in a matching named view with a different ID and sheet origin', () => {
    const source = createDocument('THREE_VIEW');
    const [id] = outline(
      source,
      0,
      'edge',
      [
        [12, 8],
        [42, 13],
      ],
      false,
    );
    const target = createDocument('THREE_VIEW');
    target.views[0].id = 'target-front';
    target.views[0].transform!.origin = { x: 16, y: 27 };
    const result = copyEntitiesFromReferenceDocument(source, target, [id], { role: 'teacher' });
    const copied = segment(result.document, result.selectedIds[0]);
    expect(copied.viewId).toBe('target-front');
    expect(point(result.document, copied.startPoint)).toEqual({ x: 12, y: 8 });
    expect(point(result.document, copied.endPoint)).toEqual({ x: 42, y: 13 });
    expect(result.selectedIds).not.toContain(id);
  });

  it('moves millimetre geometry from THREE_VIEW into the visible ISOMETRIC view without scaling', () => {
    const source = createDocument('THREE_VIEW');
    const [id] = outline(
      source,
      0,
      'edge',
      [
        [130, 22],
        [160, 37],
      ],
      false,
    );
    const arc = projectedCircle(source, 0, 'arc', [130, 25], 4, { startAngle: 30, sweep: 85 });
    const visibleBounds = { x: -55, y: -40, width: 110, height: 90 };
    const target = createDocument('ISOMETRIC');
    const { document, selectedIds, bounds } = copyEntitiesFromReferenceDocument(
      source,
      target,
      [id, arc],
      { role: 'student', visibleBounds },
    );
    const copied = segment(document, selectedIds[0]);
    expect(document.entities.every(({ viewId }) => viewId === target.views[0].id)).toBe(true);
    const vector = (doc: GeometryDocument, edge: typeof copied) =>
      sub(
        localToSheet(doc, edge.viewId, point(doc, edge.endPoint)),
        localToSheet(doc, edge.viewId, point(doc, edge.startPoint)),
      );
    expect(vector(document, copied)).toEqual(vector(source, segment(source, id)));
    expect(document.entities.find(({ id }) => id === selectedIds[1])).toMatchObject({
      kind: 'arc',
      radius: 4,
      startAngle: expect.closeTo(150),
      sweep: -85,
    });
    expect(bounds.x).toBeGreaterThanOrEqual(visibleBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(visibleBounds.x + visibleBounds.width);
  });

  it('copies a shared endpoint once and remaps dimensions, hatch loops and constraint IDs', () => {
    const source = createDocument('VHW_PROJECTION');
    const edges = outline(source, 0, 'edge', [
      [12, 9],
      [24, 9],
      [24, 21],
    ]);
    source.entities.push(
      {
        id: 'dimension',
        viewId: 'view-0',
        layerId: 'answer',
        lineStyle: 'ANSWER_VISIBLE',
        kind: 'dimension',
        dimensionType: 'ALIGNED',
        referenceIds: ['edge-p0', 'edge-p1'],
        position: { x: 15, y: 5 },
        precision: 2,
        textOverride: '',
        textSize: 2,
        arrowStyle: 'CLOSED',
      },
      {
        id: 'hatch',
        viewId: 'view-0',
        layerId: 'answer',
        lineStyle: 'ANSWER_VISIBLE',
        kind: 'hatch',
        loops: [edges],
        origin: { x: 0, y: 0 },
        angle: 30,
        spacing: 2,
      },
    );
    source.constraints.push({
      id: 'right',
      source: 'USER',
      kind: 'PERPENDICULAR',
      entityIds: edges.slice(0, 2),
    });
    const target = structuredClone(source);
    const { document, selectedIds } = copyEntitiesFromReferenceDocument(
      source,
      target,
      ['dimension', 'hatch', ...edges.slice(0, 2)],
      { role: 'student' },
    );
    const [dimension, hatch] = selectedIds.map((id) => document.entities.find((e) => e.id === id));
    const first = segment(document, selectedIds[2]);
    const second = segment(document, selectedIds[3]);
    expect(first.endPoint).toBe(second.startPoint);
    expect(first.startPoint).not.toBe('edge-p0');
    expect(dimension).toMatchObject({
      kind: 'dimension',
      referenceIds: [first.startPoint, first.endPoint],
    });
    if (dimension?.kind === 'dimension') expect(dimensionValue(document, dimension)).toBe(12);
    expect(hatch).toMatchObject({
      loops: [[first.id, second.id, expect.not.stringMatching(/^edge-3$/)]],
    });
    expect(document.constraints.at(-1)).toMatchObject({
      entityIds: [first.id, second.id],
      status: 'SATISFIED',
    });
    expect(document.constraints.at(-1)?.id).not.toBe('right');
    expect(document.entities.slice(0, target.entities.length)).toEqual(target.entities);
  });

  it('adds only writable student geometry and supports one undo and redo', () => {
    const stem = createDocument('VH_PROJECTION');
    const [id] = outline(
      stem,
      0,
      'question',
      [
        [11, 18],
        [25, 18],
      ],
      false,
      { layerId: 'stem', lineStyle: 'PROBLEM_HIDDEN' },
    );
    const snapshot = structuredClone(stem);
    const result = copyEntitiesFromReferenceDocument(stem, stem, [id], { role: 'student' });
    const history = new DocumentHistory(stem);
    history.commit(combineAnswer(stem, result.document), '复制参考图元');
    expect(history.current.entities.slice(0, stem.entities.length)).toEqual(stem.entities);
    const added = history.current.entities.slice(stem.entities.length);
    expect(added).toHaveLength(3);
    expect(
      added.every((entity) => entity.layerId === 'answer' && entity.lineStyle === 'ANSWER_HIDDEN'),
    ).toBe(true);
    expect(
      length(lineGeometry(history.current, segment(history.current, result.selectedIds[0])).d),
    ).toBe(14);
    expect(history.operations).toEqual([{ label: '复制参考图元', applied: true }]);
    expect(history.undo()).toEqual(GeometryDocument.parse(snapshot));
    expect(history.redo().entities).toHaveLength(stem.entities.length + 3);
    expect(stem).toEqual(snapshot);
  });
});
