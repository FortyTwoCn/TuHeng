'use client';
import { useState } from 'react';
import type { GeometryDocument, GeometryEntity } from '@tuheng/contracts';
import {
  angle,
  editable,
  length,
  lineGeometry,
  setSegment,
  setLineStyle,
  transact,
  planeFromPoints,
} from '@tuheng/geometry-core';
export function Inspector({
  document: doc,
  selected,
  role,
  readOnly,
  commit,
  report,
}: {
  document: GeometryDocument;
  selected: string[];
  role: 'teacher' | 'student';
  readOnly: boolean;
  commit: (doc: GeometryDocument) => void;
  report: (s: string) => void;
}) {
  const e = doc.entities.find((e) => e.id === selected[0]);
  if (!e) return <p className="geo-status">选择对象查看坐标和属性</p>;
  const locked = readOnly || !editable(doc, e, role);
  const change = (edit: (e: GeometryEntity) => void) => {
    try {
      commit(transact(doc, (d) => edit(d.entities.find((item) => item.id === e.id)!), role));
    } catch (error) {
      report((error as Error).message);
    }
  };
  const numeric = (label: string, value: number, update: (n: number) => void) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        step="0.1"
        defaultValue={Number(value.toFixed(3))}
        key={`${e.id}-${label}-${value}`}
        disabled={locked}
        onBlur={(event) => {
          const n = event.target.valueAsNumber;
          if (Number.isFinite(n)) update(n);
          else report('请输入有限数值');
        }}
      />
    </label>
  );
  const segment = e.kind === 'segment' ? lineGeometry(doc, e) : null;
  return (
    <details className="geo-inspector" open>
      <summary>
        对象属性 · {e.kind}
        {locked ? ' · 只读' : ''}
      </summary>
      <p className="geo-id">{e.id}</p>
      <div className="geo-fields">
        {e.kind === 'point' && (
          <>
            <label>
              点名称
              <input
                value={e.name}
                disabled={locked}
                onChange={(event) =>
                  change((item) => {
                    if (item.kind === 'point') item.name = event.target.value;
                  })
                }
              />
            </label>
            {numeric('X (mm)', e.position.x, (n) =>
              change((item) => {
                if (item.kind === 'point') {
                  item.position.x = n;
                  item.spatial = null;
                }
              }),
            )}
            {numeric('Y (mm)', e.position.y, (n) =>
              change((item) => {
                if (item.kind === 'point') {
                  item.position.y = n;
                  item.spatial = null;
                }
              }),
            )}
            <p>空间坐标 {e.spatial ? JSON.stringify(e.spatial) : '未知'}</p>
          </>
        )}
        {segment && (
          <>
            {numeric('长度 (mm)', length(segment.d), (n) => {
              try {
                commit(setSegment(doc, e.id, n, angle(segment.d), role));
              } catch (error) {
                report((error as Error).message);
              }
            })}
            {numeric('角度 (°)', angle(segment.d), (n) => {
              try {
                commit(setSegment(doc, e.id, length(segment.d), n, role));
              } catch (error) {
                report((error as Error).message);
              }
            })}
          </>
        )}
        {(e.kind === 'circle' || e.kind === 'arc') &&
          numeric('半径 (mm)', e.radius, (n) =>
            change((item) => {
              if (item.kind === 'circle' || item.kind === 'arc') item.radius = n;
            }),
          )}
        {e.kind === 'arc' && (
          <>
            {numeric('起始角 (°)', e.startAngle, (n) =>
              change((item) => {
                if (item.kind === 'arc') item.startAngle = n;
              }),
            )}
            {numeric('有向扫角 (°)', e.sweep, (n) =>
              change((item) => {
                if (item.kind === 'arc') item.sweep = n;
              }),
            )}
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                change((item) => {
                  if (item.kind === 'arc')
                    item.sweep =
                      Math.abs(item.sweep) === 360
                        ? -item.sweep
                        : item.sweep > 0
                          ? item.sweep - 360
                          : item.sweep + 360;
                })
              }
            >
              切换弧方向
            </button>
          </>
        )}
        <label>
          线型
          <select
            value={e.lineStyle}
            disabled={locked}
            onChange={(event) => {
              try {
                commit(
                  setLineStyle(doc, e.id, event.target.value as GeometryEntity['lineStyle'], role),
                );
              } catch (error) {
                report((error as Error).message);
              }
            }}
          >
            {Object.entries({
              ANSWER_VISIBLE: '答案实线',
              ANSWER_HIDDEN: '答案虚线',
              CONSTRUCTION: '辅助线',
              ...(role === 'teacher'
                ? { PROBLEM_VISIBLE: '题干实线', PROBLEM_HIDDEN: '题干虚线' }
                : {}),
            }).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        {doc.projectionGroups
          .filter((g) => g.entityIds.includes(e.id))
          .map((g) => `关联 ${g.entityIds.join('、')}`)
          .join('\n')}
      </p>
    </details>
  );
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
