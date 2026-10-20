'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { type Rubric, type Annotation, type GradingResult, formatPoints } from '@tuheng/contracts';
import { action } from './Actions';
export function ReviewEditor({
  attemptId,
  rubric,
  suggestion,
  latest,
  assetIds,
}: {
  attemptId: string;
  rubric: Rubric;
  suggestion?: GradingResult;
  latest?: {
    items: { criterionId: string; points: number; evidence: string }[];
    feedback: string;
    annotations: Annotation[];
  };
  assetIds: string[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(
      rubric.items.map((c) => {
        const old =
          latest?.items.find((i) => i.criterionId === c.id) ??
          suggestion?.items.find((i) => i.criterionId === c.id);
        return {
          criterionId: c.id,
          score: old?.points == null ? '' : String(old.points / 10),
          evidence: old?.evidence ?? '',
        };
      }),
    ),
    [annotations, setAnnotations] = useState<Annotation[]>(
      latest?.annotations ?? suggestion?.annotations ?? [],
    ),
    [feedback, setFeedback] = useState(latest?.feedback ?? suggestion?.guidance ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [point, setPoint] = useState({ x: 0.5, y: 0.5, text: '', assetId: assetIds[0] ?? '' }),
    [kind, setKind] = useState<'point' | 'rectangle' | 'line' | 'polyline' | 'text'>('point');
  return (
    <form
      className="review-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await action('review', {
            attemptId,
            items: items.map((i) => ({
              criterionId: i.criterionId,
              points: Math.round(Number(i.score) * 10),
              evidence: i.evidence,
            })),
            feedback,
            annotations,
            aiIncorrect: f.get('aiIncorrect') === 'on',
          });
          router.refresh();
          setError('');
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>教师复核</h2>
      <p className="muted">根据图纸证据逐项确认。未知项必须由教师判断后才能发布。</p>
      {rubric.items.map((c, index) => (
        <div className="score-edit" key={c.id}>
          <div className="panel-heading">
            <strong>{c.name}</strong>
            <label className="score-input">
              <input
                type="number"
                min="0"
                max={c.maxPoints / 10}
                step="0.1"
                required
                value={items[index].score}
                aria-label={c.name + '得分'}
                onChange={(e) =>
                  setItems(items.map((i, n) => (n === index ? { ...i, score: e.target.value } : i)))
                }
              />
              <span>/ {formatPoints(c.maxPoints)}</span>
            </label>
          </div>
          <p className="small muted">{c.correctness}</p>
          <label>
            判分证据与错误说明
            <textarea
              required
              value={items[index].evidence}
              onChange={(e) =>
                setItems(
                  items.map((i, n) => (n === index ? { ...i, evidence: e.target.value } : i)),
                )
              }
            />
          </label>
        </div>
      ))}
      <div className="score-total">
        复核总分
        <strong>
          {(items.reduce((s, i) => s + (Number(i.score) || 0) * 10, 0) / 10).toFixed(1)}{' '}
          <small>/ {formatPoints(rubric.maxPoints)}</small>
        </strong>
      </div>
      <label>
        给学生的指导
        <textarea value={feedback} required onChange={(e) => setFeedback(e.target.value)} />
      </label>
      <details className="annotation-editor">
        <summary>添加人工图纸批注</summary>
        <label>
          批注图纸
          <select
            value={point.assetId}
            onChange={(e) => setPoint({ ...point, assetId: e.target.value })}
          >
            {assetIds.map((id, i) => (
              <option value={id} key={id}>
                作答图 {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          类型
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {[
              ['point', '点'],
              ['rectangle', '矩形'],
              ['line', '线段'],
              ['polyline', '折线'],
              ['text', '文本'],
            ].map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            横坐标（0～1）
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={point.x}
              onChange={(e) => setPoint({ ...point, x: Number(e.target.value) })}
            />
          </label>
          <label>
            纵坐标（0～1）
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={point.y}
              onChange={(e) => setPoint({ ...point, y: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          说明
          <input
            value={point.text}
            onChange={(e) => setPoint({ ...point, text: e.target.value })}
          />
        </label>
        <p className="muted small">
          坐标对应原图；矩形和线段以此处为起点，向右下延伸图幅10%。折线增加一个中间点。
        </p>
        <button
          type="button"
          className="button secondary"
          disabled={!point.text || !point.assetId}
          onClick={() => {
            const base = {
              id: crypto.randomUUID(),
              assetId: point.assetId,
              assetVersion: 'original',
              errorId: null,
              category: 'GUIDE' as const,
              text: point.text,
            };
            const from = { x: point.x, y: point.y },
              to = { x: Math.min(1, point.x + 0.1), y: Math.min(1, point.y + 0.1) };
            const a: Annotation =
              kind === 'point' || kind === 'text'
                ? { ...base, kind, point: from }
                : kind === 'polyline'
                  ? { ...base, kind, points: [from, { x: to.x, y: from.y }, to] }
                  : { ...base, kind, from, to };
            setAnnotations([...annotations, a]);
          }}
        >
          添加批注
        </button>
      </details>
      <ul className="annotation-list">
        {annotations.map((a, i) => (
          <li key={a.id}>
            {a.text}
            <button
              type="button"
              onClick={() => setAnnotations(annotations.filter((_, n) => n !== i))}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
      <label className="check">
        <input type="checkbox" name="aiIncorrect" />
        记录 AI 判断有误
      </label>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <button className="button primary full" disabled={busy}>
        {busy ? '正在保存…' : '保存教师确认结果'}
      </button>
      <p className="small muted">保存后需单独点击发布；每次修改保留独立版本。</p>
    </form>
  );
}
