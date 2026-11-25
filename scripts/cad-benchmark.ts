import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { cadPerformanceDrawing } from '../tests/cad-performance-fixture';
import { DocumentHistory, snapCandidates, transformSelection } from '@tuheng/geometry-core';

function timings(action: (i: number) => unknown, iterations: number) {
  for (let i = 0; i < 12; i++) action(i);
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    action(i);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return {
    iterations,
    medianMs: +times[Math.floor(times.length * 0.5)].toFixed(6),
    p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(6),
  };
}
function measure(columns: number, rows: number) {
  const doc = cadPerformanceDrawing(columns, rows),
    view = doc.views[0].id;
  const ids = doc.entities
    .filter((e) => e.kind === 'segment')
    .slice(0, 40)
    .map((e) => e.id);
  const target = (i: number) => ({
    x: ((i * 13) % (columns - 1)) * 6 + 1.5 * Math.cos(i),
    y: ((i * 7) % (rows - 1)) * 6 + 1.5 * Math.sin(i),
  });
  const preview = (i: number) =>
    transformSelection(
      doc,
      ids,
      { kind: 'move', from: { x: 0, y: 0 }, to: { x: i % 2, y: (i % 3) / 2 } },
      'student',
      true,
    );
  const history = new DocumentHistory(doc);
  history.commit(preview(1), '基准性能取样');
  return {
    counts: Object.fromEntries(
      [...new Set(doc.entities.map((e) => e.kind))].map((kind) => [
        kind,
        doc.entities.filter((e) => e.kind === kind).length,
      ]),
    ),
    total: doc.entities.length,
    snap: timings(
      (i) =>
        snapCandidates(doc, view, target(i), 4, { x: 12, y: 12 }, { projection: true, grid: true }),
      120,
    ),
    drag40: timings(preview, 120),
    undoRedo: timings(() => {
      history.undo();
      history.redo();
    }, 120),
  };
}
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      os: os.platform() + ' ' + os.arch(),
      cpu: os.cpus()[0].model,
      scenarios: [measure(14, 10), measure(34, 19)],
    },
    null,
    2,
  ),
);
