'use client';
import { useEffect, useState } from 'react';
import type { AudienceSelection } from '@tuheng/contracts';
import { identityRequest } from './client';
type Node = { id: string; name: string; total: number; selected: number; loginId?: string };
type Browse = {
  count: number;
  eligibleCount: number;
  excluded: number;
  rosterVersion: number;
  people: { id: string; name: string; studentNumber: string; selected: boolean }[];
  total: number;
  teacherTotal: number;
  classTotal: number;
  teachers: Node[];
  classes: Node[];
  unassigned: number;
};
function Choice({
  label,
  selected,
  total,
  onChange,
}: {
  label: string;
  selected: number;
  total: number;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="audience-choice">
      <input
        type="checkbox"
        checked={total > 0 && selected === total}
        ref={(node) => {
          if (node) node.indeterminate = selected > 0 && selected < total;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}{' '}
        <small>
          {selected}/{total}
        </small>
      </span>
    </label>
  );
}
export function AudiencePicker({
  value,
  onChange,
  onPreview,
}: {
  value: AudienceSelection;
  onChange: (selection: AudienceSelection) => void;
  onPreview?: (preview: { count: number; rosterVersion: number }) => void;
}) {
  const [browse, setBrowse] = useState<Browse>(),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [teacherPage, setTeacherPage] = useState(0),
    [classPage, setClassPage] = useState(0),
    [treeQuery, setTreeQuery] = useState(''),
    [teacherId, setTeacherId] = useState(''),
    [classId, setClassId] = useState(''),
    [selectedOnly, setSelectedOnly] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved] = useState(value);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      identityRequest(
        '/api/audience',
        {
          operation: 'BROWSE',
          selection: value,
          query,
          page,
          teacherPage,
          classPage,
          treeQuery,
          teacherId: teacherId || undefined,
          classId: classId || undefined,
          selectedOnly,
        },
        'STAFF',
      )
        .then((r) => {
          if (current) {
            setBrowse(r);
            setError('');
            onPreview?.({ count: r.count, rosterVersion: r.rosterVersion });
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    value,
    query,
    page,
    teacherPage,
    classPage,
    treeQuery,
    teacherId,
    classId,
    selectedOnly,
    onPreview,
  ]);
  async function toggle(
    target: 'ALL' | 'TEACHER' | 'CLASS' | 'STUDENT',
    targetId: string | undefined,
    checked: boolean,
  ) {
    setBusy(true);
    try {
      const r = await identityRequest(
        '/api/audience',
        { operation: 'TOGGLE', selection: value, target, targetId, checked },
        'STAFF',
      );
      onChange(r.selection);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="audience-picker" disabled={busy}>
      <legend>作业接收人</legend>
      <p>按学生账号去重；取消某人会在所有班级分支同步排除。发布时冻结名单。</p>
      <Choice
        label="全部授权对象（包含未加载页）"
        selected={browse?.count ?? 0}
        total={browse?.eligibleCount ?? 0}
        onChange={(checked) => toggle('ALL', undefined, checked)}
      />
      <div className="identity-inline">
        <button type="button" onClick={() => toggle('ALL', undefined, false)}>
          清空选择
        </button>
        <button type="button" onClick={() => onChange(saved)}>
          恢复打开时的选择
        </button>
        <button
          type="button"
          aria-pressed={selectedOnly}
          onClick={() => {
            setSelectedOnly((v) => !v);
            setPage(0);
          }}
        >
          仅看已选
        </button>
      </div>
      <label>
        搜索姓名 / 学号 / 班级
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <div className="audience-columns">
        <div>
          <label>
            搜索教师或班级
            <input
              value={treeQuery}
              onChange={(e) => {
                setTreeQuery(e.target.value);
                setTeacherPage(0);
                setClassPage(0);
              }}
            />
          </label>
          <details open>
            <summary>按教师浏览</summary>
            {browse?.teachers.map((t) => (
              <div className="audience-node" key={t.id}>
                <button
                  type="button"
                  aria-label={'展开教师 ' + t.name}
                  aria-expanded={teacherId === t.id}
                  onClick={() => {
                    setTeacherId(teacherId === t.id ? '' : t.id);
                    setClassId('');
                    setClassPage(0);
                    setPage(0);
                  }}
                >
                  {teacherId === t.id ? '−' : '+'}
                </button>
                <Choice
                  label={t.name + (t.loginId ? ' · ' + t.loginId : '')}
                  selected={t.selected}
                  total={t.total}
                  onChange={(checked) => toggle('TEACHER', t.id, checked)}
                />
              </div>
            ))}
            <div className="identity-inline">
              <button
                type="button"
                disabled={!teacherPage}
                onClick={() => setTeacherPage(teacherPage - 1)}
              >
                上一页教师
              </button>
              <button
                type="button"
                disabled={(teacherPage + 1) * 20 >= (browse?.teacherTotal ?? 0)}
                onClick={() => setTeacherPage(teacherPage + 1)}
              >
                下一页教师
              </button>
            </div>
          </details>
          <details open>
            <summary>按班级浏览</summary>
            <button
              type="button"
              onClick={() => {
                setTeacherId('');
                setClassId('');
                setPage(0);
              }}
            >
              查看全部授权学生
            </button>
            {browse?.classes.map((c) => (
              <div className="audience-node" key={c.id}>
                <button
                  type="button"
                  aria-label={'展开班级 ' + c.name}
                  aria-expanded={classId === c.id}
                  onClick={() => {
                    setClassId(classId === c.id ? '' : c.id);
                    setPage(0);
                  }}
                >
                  {classId === c.id ? '−' : '+'}
                </button>
                <Choice
                  label={c.name}
                  selected={c.selected}
                  total={c.total}
                  onChange={(checked) => toggle('CLASS', c.id, checked)}
                />
              </div>
            ))}
            <div className="identity-inline">
              <button
                type="button"
                disabled={!classPage}
                onClick={() => setClassPage(classPage - 1)}
              >
                上一页班级
              </button>
              <button
                type="button"
                disabled={(classPage + 1) * 20 >= (browse?.classTotal ?? 0)}
                onClick={() => setClassPage(classPage + 1)}
              >
                下一页班级
              </button>
            </div>
            {!!browse?.unassigned && (
              <button
                type="button"
                onClick={() => {
                  setTeacherId('');
                  setClassId('UNASSIGNED');
                  setPage(0);
                }}
              >
                未分班（{browse.unassigned}）
              </button>
            )}
          </details>
        </div>
        <div>
          <p>
            {browse?.total ?? 0} 个匹配学生 · 第 {page + 1} 页
          </p>
          <button
            type="button"
            onClick={() => {
              const ids = browse?.people.map((p) => p.id) ?? [];
              onChange({
                ...value,
                include: {
                  ...value.include,
                  studentIds: [...new Set([...value.include.studentIds, ...ids])],
                },
                exclude: { studentIds: value.exclude.studentIds.filter((id) => !ids.includes(id)) },
              });
            }}
          >
            仅选当前页
          </button>
          {browse?.people.map((p) => (
            <Choice
              key={p.id}
              label={p.name + ' · ' + p.studentNumber}
              total={1}
              selected={p.selected ? 1 : 0}
              onChange={(checked) => toggle('STUDENT', p.id, checked)}
            />
          ))}
          <div className="identity-inline">
            <button type="button" disabled={!page} onClick={() => setPage((v) => v - 1)}>
              上一页学生
            </button>
            <button
              type="button"
              disabled={!browse || (page + 1) * 30 >= browse.total}
              onClick={() => setPage((v) => v + 1)}
            >
              下一页学生
            </button>
          </div>
        </div>
      </div>
      <div className="audience-summary" role="status">
        已选 {browse?.count ?? 0} 人 · 显式排除 {browse?.excluded ?? 0} 人
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
