'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPoints } from '@tuheng/contracts';
import { action } from './Actions';
export interface ErrorRow {
  id: string;
  attemptId: string;
  title: string;
  chapter: string;
  knowledgeIds: string[];
  source: string;
  score: number | null;
  reviews: number;
}
export function ErrorBookList({
  entries,
  knowledge,
}: {
  entries: ErrorRow[];
  knowledge: { id: string; title: string }[];
}) {
  const [source, setSource] = useState(''),
    [chapter, setChapter] = useState(''),
    [knowledgeId, setKnowledge] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  const filtered = entries.filter(
    (e) =>
      (!source || e.source === source) &&
      (!chapter || e.chapter === chapter) &&
      (!knowledgeId || e.knowledgeIds.includes(knowledgeId)),
  );
  const chapters = [...new Set(filtered.map((e) => e.chapter))];
  async function archive(ids: string[]) {
    if (!window.confirm(`移出${ids.length}道错题？原始作答与成绩会继续保留。`)) return;
    setBusy(true);
    try {
      await action('errors-archive', { ids });
      setSelected([]);
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="filterbar">
        <select aria-label="错题来源" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全部来源</option>
          <option value="ASSIGNMENT">课程作业</option>
          <option value="SELFTEST">自主练习</option>
          <option value="REVIEW">错题回练</option>
        </select>
        <select aria-label="错题章节" value={chapter} onChange={(e) => setChapter(e.target.value)}>
          <option value="">全部章节</option>
          {[...new Set(entries.map((e) => e.chapter))].map((ch) => (
            <option key={ch}>{ch}</option>
          ))}
        </select>
        <select
          aria-label="错题知识点"
          value={knowledgeId}
          onChange={(e) => setKnowledge(e.target.value)}
        >
          <option value="">全部知识点</option>
          {knowledge.map((k) => (
            <option key={k.id} value={k.id}>
              {k.title}
            </option>
          ))}
        </select>
      </div>
      <div className="button-row" style={{ marginBottom: 16 }}>
        <label className="check">
          <input
            type="checkbox"
            checked={filtered.length > 0 && filtered.every((e) => selected.includes(e.id))}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...new Set([...selected, ...filtered.map((e) => e.id)])]
                  : selected.filter((id) => !filtered.some((e) => e.id === id)),
              )
            }
          />
          选择当前筛选结果
        </label>
        <button
          disabled={!selected.length || busy}
          className="button secondary"
          onClick={() => archive(selected)}
        >
          批量移出 {selected.length || ''}
        </button>
      </div>
      {chapters.map((ch) => (
        <details open key={ch} className="details-card">
          <summary>
            {ch} · {filtered.filter((e) => e.chapter === ch).length} 道
          </summary>
          <div>
            {filtered
              .filter((e) => e.chapter === ch)
              .map((e) => (
                <div className="error-entry" key={e.id}>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${e.title}`}
                    checked={selected.includes(e.id)}
                    onChange={(v) =>
                      setSelected(
                        v.target.checked
                          ? [...selected, e.id]
                          : selected.filter((id) => id !== e.id),
                      )
                    }
                  />
                  <div className="grow">
                    <h3>{e.title}</h3>
                    <p>
                      {e.source === 'ASSIGNMENT' ? '课程作业' : '私人练习'} · 原始得分{' '}
                      {formatPoints(e.score)} · 已回练 {e.reviews} 次
                    </p>
                  </div>
                  <div className="button-row">
                    <Link className="button ghost" href={`/student/results/${e.attemptId}`}>
                      原始解析
                    </Link>
                    <Link className="button secondary" href={`/student/errors/${e.id}`}>
                      重新作答
                    </Link>
                    <button
                      className="button ghost"
                      disabled={busy}
                      onClick={() => archive([e.id])}
                    >
                      移出
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </details>
      ))}
      {!filtered.length && (
        <div className="empty">
          <p>当前筛选下没有错题。</p>
        </div>
      )}
      {message && (
        <p role="alert" className="alert error">
          {message}
        </p>
      )}
    </>
  );
}
