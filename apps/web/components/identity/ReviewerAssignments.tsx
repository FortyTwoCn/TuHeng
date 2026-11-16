'use client';
import { useEffect, useState } from 'react';
import type { ReviewerAssignment } from '@tuheng/contracts';
import { AudiencePicker } from './AudiencePicker';
import { identityRequest } from './client';

export function TeacherPicker({
  schoolId,
  value,
  onChange,
  single = false,
}: {
  schoolId: string;
  value: string[];
  onChange: (value: string[]) => void;
  single?: boolean;
}) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<{
      items: { id: string; name: string; loginId: string }[];
      total: number;
    }>({ items: [], total: 0 }),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void identityRequest(
        `/api/organization/accounts?schoolId=${encodeURIComponent(schoolId)}&kind=TEACHER&q=${encodeURIComponent(query)}&page=${page}`,
      )
        .then((r) => {
          if (active) setRows(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [schoolId, query, page]);
  return (
    <fieldset>
      <legend>{single ? '此范围的复核教师' : '默认复核教师'}</legend>
      <label>
        搜索复核教师
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <p>已选择 {value.length} 位教师</p>
      {rows.items.map((t) => (
        <label className="audience-choice" key={t.id}>
          <input
            type={single ? 'radio' : 'checkbox'}
            checked={value.includes(t.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? single
                    ? [t.id]
                    : [...new Set([...value, t.id])]
                  : value.filter((id) => id !== t.id),
              )
            }
          />
          {t.name} · {t.loginId}
        </label>
      ))}
      <div className="identity-inline">
        <button type="button" disabled={!page} onClick={() => setPage(page - 1)}>
          上一页教师
        </button>
        <button
          type="button"
          disabled={(page + 1) * 20 >= rows.total}
          onClick={() => setPage(page + 1)}
        >
          下一页教师
        </button>
        <button type="button" onClick={() => onChange([])}>
          清空复核教师
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
export function ReviewerAssignments({
  schoolId,
  value,
  onChange,
}: {
  schoolId: string;
  value: ReviewerAssignment[];
  onChange: (v: ReviewerAssignment[]) => void;
}) {
  return (
    <details className="identity-panel">
      <summary>按班级或个人分配复核范围（{value.length} 条）</summary>
      <p>
        匹配专项范围的学生只由该范围选定教师复核；未匹配的学生使用默认复核教师。范围必须包含在本次作业名单中。
      </p>
      {value.map((rule, index) => (
        <section key={index} className="identity-panel">
          <TeacherPicker
            schoolId={schoolId}
            single
            value={rule.teacherId ? [rule.teacherId] : []}
            onChange={(ids) =>
              onChange(value.map((r, i) => (i === index ? { ...r, teacherId: ids[0] ?? '' } : r)))
            }
          />
          <AudiencePicker
            value={rule.selection}
            onChange={(selection) =>
              onChange(value.map((r, i) => (i === index ? { ...r, selection } : r)))
            }
          />
          <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            删除此复核范围
          </button>
        </section>
      ))}
      <button
        type="button"
        disabled={value.length >= 50}
        onClick={() =>
          onChange([
            ...value,
            {
              teacherId: '',
              selection: {
                version: 1,
                schoolId,
                include: { allEligibleInScope: false, classIds: [], studentIds: [] },
                exclude: { studentIds: [] },
              },
            },
          ])
        }
      >
        添加专项复核范围
      </button>
    </details>
  );
}
