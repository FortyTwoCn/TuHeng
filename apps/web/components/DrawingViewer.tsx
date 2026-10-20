'use client';
import { useState } from 'react';
import type { Annotation } from '@tuheng/contracts';
export function DrawingViewer({
  assets,
  annotations = [],
  processed = [],
}: {
  assets: { id: string; name: string; mime: string }[];
  annotations?: Annotation[];
  processed?: { originalId: string; processedId: string }[];
}) {
  const [index, setIndex] = useState(0),
    [mode, setMode] = useState<'original' | 'processed'>('original'),
    [zoom, setZoom] = useState(1);
  if (!assets.length) return <p className="muted">暂无图纸</p>;
  const a = assets[index] ?? assets[0],
    p = processed.find((p) => p.originalId === a.id);
  const id = mode === 'processed' && p ? p.processedId : a.id;
  return (
    <div className="drawing-viewer">
      <div className="viewer-toolbar">
        <select
          aria-label="选择图纸"
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {assets.map((a, i) => (
            <option value={i} key={a.id}>
              {i + 1}. {a.name}
            </option>
          ))}
        </select>
        <button
          className={mode === 'original' ? 'selected' : ''}
          onClick={() => setMode('original')}
        >
          原图
        </button>
        <button
          disabled={!p}
          className={mode === 'processed' ? 'selected' : ''}
          onClick={() => setMode('processed')}
        >
          处理图
        </button>
        <button onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="缩小">
          −
        </button>
        <button onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="放大">
          ＋
        </button>
      </div>
      <div className="drawing-scroll">
        {a.mime === 'application/pdf' ? (
          <iframe title={a.name} src={`/api/assets/${id}`} sandbox="" />
        ) : (
          <div className="drawing-surface" style={{ width: `${zoom * 100}%` }}>
            <img src={`/api/assets/${id}`} alt={a.name} />
            {mode === 'original' && (
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="教师及AI图纸批注">
                {annotations
                  .filter((n) => n.assetId === a.id && n.assetVersion === 'original')
                  .map((n) => (
                    <g key={n.id} className={`annotation ${n.category.toLowerCase()}`}>
                      <title>{n.text}</title>
                      {n.kind === 'point' ? (
                        <circle cx={n.point.x * 1000} cy={n.point.y * 1000} r="9" />
                      ) : n.kind === 'rectangle' ? (
                        <rect
                          x={Math.min(n.from.x, n.to.x) * 1000}
                          y={Math.min(n.from.y, n.to.y) * 1000}
                          width={Math.abs(n.to.x - n.from.x) * 1000}
                          height={Math.abs(n.to.y - n.from.y) * 1000}
                        />
                      ) : n.kind === 'line' ? (
                        <line
                          x1={n.from.x * 1000}
                          y1={n.from.y * 1000}
                          x2={n.to.x * 1000}
                          y2={n.to.y * 1000}
                        />
                      ) : n.kind === 'polyline' ? (
                        <polyline
                          points={n.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                        />
                      ) : (
                        <text x={n.point.x * 1000} y={n.point.y * 1000}>
                          {n.text}
                        </text>
                      )}
                    </g>
                  ))}
              </svg>
            )}
          </div>
        )}
      </div>
      <p className="viewer-caption">
        原图始终保留。缩放查看细线；没有可靠位置证据时仅显示文字说明。
      </p>
    </div>
  );
}
