'use client';
import { useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { relatedPlane } from '@tuheng/geometry-core';
export function RelatedPlaneTools({
  document: doc,
  role,
  commit,
  report,
}: {
  document: GeometryDocument;
  role: 'teacher' | 'student';
  commit: (doc: GeometryDocument) => void;
  report: (s: string) => void;
}) {
  const [reference, setReference] = useState(''),
    [offset, setOffset] = useState(5),
    [axis, setAxis] = useState('x');
  const planes = doc.entities.filter((e) => e.kind === 'plane');
  if (!planes.length) return null;
  const create = (relation: 'PARALLEL' | 'PERPENDICULAR') => {
    try {
      commit(
        relatedPlane(
          doc,
          reference || planes[0].id,
          relation,
          offset,
          { x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 },
          role,
        ),
      );
    } catch (error) {
      report((error as Error).message);
    }
  };
  return (
    <details>
      <summary>平行 / 垂直投影面</summary>
      <div className="geo-fields">
        <label>
          参考投影面
          <select value={reference || planes[0].id} onChange={(e) => setReference(e.target.value)}>
            {planes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          法向偏移 (mm)
          <input type="number" value={offset} onChange={(e) => setOffset(e.target.valueAsNumber)} />
        </label>
        <label>
          新平面包含的方向轴
          <select value={axis} onChange={(e) => setAxis(e.target.value)}>
            {['x', 'y', 'z'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => create('PARALLEL')}>
          创建平行面
        </button>
        <button type="button" onClick={() => create('PERPENDICULAR')}>
          创建垂直面
        </button>
      </div>
    </details>
  );
}
