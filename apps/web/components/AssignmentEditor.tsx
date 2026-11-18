'use client';
import { ReviewerAssignments, TeacherPicker } from './identity/ReviewerAssignments';
import { AudiencePicker } from './identity/AudiencePicker';
import { identityRequest } from './identity/client';
import type { AudienceSelection, AccountKind, ReviewerAssignment } from '@tuheng/contracts';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { action } from './Actions';
export function AssignmentEditor({
  classes,
  initialSchool,
  questions,
  identity,
}: {
  identity: { id: string; kind: AccountKind; schoolId?: string | null };
  classes: { id: string; name: string }[];
  initialSchool?: string;
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
  const [schools, setSchools] = useState<{ id: string; name: string; code: string }[]>([]),
    [schoolQuery, setSchoolQuery] = useState('');
  const [audience, setAudience] = useState<AudienceSelection>({
    version: 1,
    schoolId: identity.schoolId ?? initialSchool ?? '',
    include: {
      allEligibleInScope: false,
      classIds: classes.length === 1 ? [classes[0].id] : [],
      studentIds: [],
    },
    exclude: { studentIds: [] },
  });
  const area =
    identity.kind === 'TEACHER' ? 'teacher' : identity.kind === 'SCHOOL_ADMIN' ? 'school' : 'admin';
  const listPath = '/' + area + '/assignments';
  const schoolQueryParam =
    identity.kind === 'SITE_ADMIN' && audience.schoolId
      ? '?schoolId=' + encodeURIComponent(audience.schoolId)
      : '';
  const [preview, setPreview] = useState<{ count: number; rosterVersion: number }>(),
    [reviewerAssignments, setReviewerAssignments] = useState<ReviewerAssignment[]>([]),
    [reviewerIds, setReviewerIds] = useState<string[]>(
      identity.kind === 'TEACHER' ? [identity.id] : [],
    );
  useEffect(() => {
    if (identity.kind !== 'SITE_ADMIN') return;
    const controller = new AbortController();
    identityRequest(
      '/api/organization/schools?q=' + encodeURIComponent(schoolQuery),
      undefined,
      'STAFF',
      controller.signal,
    )
      .then((r) => {
        if (!controller.signal.aborted) setSchools(r.items);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [identity.kind, schoolQuery]);
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
            audience,
            rosterVersion: preview?.rosterVersion,
            reviewerIds,
            reviewerAssignments,
            questionVersionIds: selected,
            startsAt: new Date(String(f.get('startsAt'))).toISOString(),
            dueAt: new Date(String(f.get('dueAt'))).toISOString(),
            allowLate: f.get('allowLate') === 'on',
            maxAttempts: Number(f.get('maxAttempts')),
            releaseAnswers: f.get('releaseAnswers') === 'on',
          });
          router.push(listPath + '/' + r.id + schoolQueryParam);
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
          {identity.kind === 'SITE_ADMIN' && (
            <>
              <label>
                搜索学校
                <input value={schoolQuery} onChange={(e) => setSchoolQuery(e.target.value)} />
              </label>
              <label>
                操作学校
                <select
                  value={audience.schoolId}
                  required
                  onChange={(e) => {
                    setAudience({
                      version: 1,
                      schoolId: e.target.value,
                      include: { allEligibleInScope: false, classIds: [], studentIds: [] },
                      exclude: { studentIds: [] },
                    });
                    setPreview(undefined);
                    setReviewerIds([]);
                    setReviewerAssignments([]);
                  }}
                >
                  <option value="">请选择学校</option>
                  {audience.schoolId && !schools.some((s) => s.id === audience.schoolId) && (
                    <option value={audience.schoolId}>当前所选学校</option>
                  )}
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.code}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
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
      {audience.schoolId && (
        <AudiencePicker
          key={audience.schoolId}
          value={audience}
          onChange={setAudience}
          onPreview={setPreview}
        />
      )}
      {identity.kind !== 'TEACHER' && audience.schoolId && (
        <section className="panel">
          <h2>指定复核教师</h2>
          <p>所选教师仅获得本作业接收人的复核权限；管理账号不能发布正式成绩。</p>
          <TeacherPicker
            schoolId={audience.schoolId}
            value={reviewerIds}
            onChange={setReviewerIds}
          />
          <ReviewerAssignments
            schoolId={audience.schoolId}
            value={reviewerAssignments}
            onChange={setReviewerAssignments}
          />
        </section>
      )}
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
      <button
        className="button primary"
        disabled={busy || !selected.length || !preview?.count || !reviewerIds.length}
      >
        保存作业草稿
      </button>
      <Link className="button" href={listPath + schoolQueryParam}>
        返回作业列表
      </Link>
    </form>
  );
}
