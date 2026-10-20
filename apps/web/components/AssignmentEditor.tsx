'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { action } from './Actions';
export function AssignmentEditor({
  classes,
  questions,
}: {
  classes: { id: string; name: string }[];
  questions: {
    id: string;
    title: string;
    version: number;
    maxPoints: number;
    confirmed: boolean;
  }[];
}) {
  const router = useRouter(),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          const r = await action('assignment', {
            title: f.get('title'),
            classId: f.get('classId'),
            questionVersionIds: selected,
            startsAt: new Date(String(f.get('startsAt'))).toISOString(),
            dueAt: new Date(String(f.get('dueAt'))).toISOString(),
            allowLate: f.get('allowLate') === 'on',
            maxAttempts: Number(f.get('maxAttempts')),
            releaseAnswers: f.get('releaseAnswers') === 'on',
          });
          router.push(`/teacher/assignments/${r.id}`);
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <section className="panel">
        <h2>布置新作业</h2>
        <div className="form-grid">
          <label>
            作业标题
            <input name="title" required placeholder="第一章 · 点的投影作业" />
          </label>
          <label>
            教学班
            <select name="classId" aria-label="教学班" required>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            开始时间（当前设备时区）
            <input type="datetime-local" name="startsAt" required />
          </label>
          <label>
            截止时间（当前设备时区）
            <input type="datetime-local" name="dueAt" required />
          </label>
          <label>
            最多提交次数
            <input type="number" min="1" max="10" defaultValue="1" name="maxAttempts" required />
          </label>
        </div>
        <div className="check-row">
          <label>
            <input type="checkbox" name="allowLate" />
            允许迟交
          </label>
          <label>
            <input type="checkbox" name="releaseAnswers" />
            成绩发布后开放参考答案
          </label>
        </div>
      </section>
      <section className="panel">
        <h2>从已确认题库选择</h2>
        {questions
          .filter((q) => q.confirmed)
          .map((q) => (
            <label className="question-choice" key={q.id}>
              <input
                type="checkbox"
                checked={selected.includes(q.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, q.id] : selected.filter((id) => id !== q.id),
                  )
                }
              />
              <span>
                {q.title}
                <small>版本 {q.version}</small>
              </span>
              <strong>{(q.maxPoints / 10).toFixed(1)} 分</strong>
            </label>
          ))}
        <p>
          已选 {selected.length} 题 · 总分{' '}
          {(
            questions.filter((q) => selected.includes(q.id)).reduce((s, q) => s + q.maxPoints, 0) /
            10
          ).toFixed(1)}{' '}
          分
        </p>
      </section>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy || !selected.length}>
        保存作业草稿
      </button>
    </form>
  );
}
