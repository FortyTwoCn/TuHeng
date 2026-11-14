'use client';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { transact, planeFromPoints } from '@tuheng/geometry-core';
import { PropertyFields } from './PropertyFields';
export function Inspector(props: ComponentProps<typeof PropertyFields>) {
  return <PropertyFields {...props} />;
}
export function PlaneCreator({
  document: doc,
  viewId,
  role,
  commit,
  report,
}: {
  document: GeometryDocument;
  viewId: string;
  role: 'teacher' | 'student';
  commit: (doc: GeometryDocument) => void;
  report: (s: string) => void;
}) {
  const [coordinates, setCoordinates] = useState('0,0,0;10,0,0;0,10,0');
  return (
    <details>
      <summary>新投影面</summary>
      <label>
        三个空间点，按 x,y,z 分号分隔
        <input value={coordinates} onChange={(e) => setCoordinates(e.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => {
          try {
            const points = coordinates.split(';').map((s) => {
              const values = s.split(',').map(Number);
              if (values.length !== 3 || values.some((n) => !Number.isFinite(n)))
                throw new Error('请填写三个空间坐标');
              return { x: values[0], y: values[1], z: values[2] };
            });
            if (points.length !== 3) throw new Error('需要三个点');
            const geometry = planeFromPoints(points[0], points[1], points[2]);
            commit(
              transact(
                doc,
                (d) =>
                  d.entities.push({
                    id: crypto.randomUUID(),
                    kind: 'plane',
                    viewId,
                    layerId: doc.layers.find(
                      (l) => l.role === (role === 'teacher' ? 'PROBLEM_STEM' : 'CONSTRUCTION'),
                    )!.id,
                    lineStyle: role === 'teacher' ? 'PROBLEM_VISIBLE' : 'CONSTRUCTION',
                    ...geometry,
                    referencePlaneId: null,
                    relation: 'ARBITRARY',
                  }),
                role,
              ),
            );
          } catch (error) {
            report((error as Error).message);
          }
        }}
      >
        创建投影面
      </button>
    </details>
  );
}
