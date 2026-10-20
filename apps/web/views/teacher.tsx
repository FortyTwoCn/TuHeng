import { BatchPublish } from '../components/BatchPublish';
import { RosterImport } from '../components/AdminForms';
import Link from 'next/link';
import { database } from '@tuheng/database';
import * as domain from '@tuheng/domain';
import type { Actor } from '@tuheng/domain';
import { Panel, PageTitle, Empty, Badge } from '@tuheng/ui';
import { formatPoints } from '@tuheng/contracts';
import { ClipboardList, ArrowRight } from 'lucide-react';
import { Stat, Status, date } from './shared';
import { QuestionEditor } from '../components/QuestionEditor';
import { AssignmentEditor } from '../components/AssignmentEditor';
import { ActionButton, ExportButton } from '../components/Actions';
export async function TeacherDashboard({ a }: { a: Actor }) {
  const [classes, assignments, reviews] = await Promise.all([
    domain.visibleClasses(database, a),
    domain.listAssignments(database, a),
    domain.listReviews(database, a),
  ]);
  const appeals = await database.list('appeal', {
    attemptId: { in: reviews.map((r) => r.attempt.id) },
    status: 'OPEN',
  });
  const pending = reviews.filter((r) => !r.attempt.publishedDecisionId);
  return (
    <>
      <PageTitle
        eyebrow="TEACHING WORKSPACE"
        title={`${a.name}，教学工作台`}
        description="优先处理需要你判断的作答，让反馈及时回到学生手中。"
        action={
          <Link className="button primary" href="/teacher/assignments/new">
            ＋ 布置作业
          </Link>
        }
      />
      <div className="stats">
        <Stat title="负责教学班" value={classes.length} unit="个" foot="仅显示当前授权范围" />
        <Stat
          title="已发布作业"
          value={assignments.filter((a) => a.status === 'PUBLISHED').length}
          unit="份"
          foot="题目与细则版本已固定"
        />
        <Stat
          title="待复核作答"
          value={pending.length}
          unit="份"
          foot="包含 AI 建议及人工处理任务"
        />
        <Stat title="待处理申诉" value={appeals.length} unit="条" foot="维护每一次成绩更正记录" />
      </div>
      <div className="dashboard-grid">
        <div>
          <div className="hero-banner">
            <p className="eyebrow">HUMAN JUDGMENT · AI ASSISTANCE</p>
            <h2>把判断留给教师，把证据摆在眼前。</h2>
            <p>图纸、逐项建议与历史记录集中复核。你确认后，正式成绩才会向学生发布。</p>
          </div>
          <Panel title="待办 · 作答复核" action={<Link href="/teacher/reviews">全部复核 →</Link>}>
            {pending.length ? (
              pending.slice(0, 8).map((r) => (
                <Link
                  className="list-item"
                  href={`/teacher/reviews/${r.attempt.id}`}
                  key={r.attempt.id}
                >
                  <span className="list-icon">
                    <ClipboardList size={17} />
                  </span>
                  <span className="grow">
                    <strong>
                      {r.owner} · {r.question?.title}
                    </strong>
                    <p>
                      {date(r.attempt.submittedAt)} · 作答 v{r.attempt.version}
                    </p>
                  </span>
                  {r.run && <Status status={r.run.status} />}
                  <ArrowRight size={14} />
                </Link>
              ))
            ) : (
              <Empty
                title="当前没有待复核作答"
                description="学生提交后，将按实际处理状态出现在这里。"
              />
            )}
          </Panel>
        </div>
        <aside>
          <Panel title="我的教学班">
            {classes.map((c) => (
              <Link className="list-item" key={c.id} href={`/teacher/classes/${c.id}`}>
                <span className="grow">
                  <strong>{c.name}</strong>
                  <p>学生名单 · 完成记录</p>
                </span>
                <ArrowRight size={14} />
              </Link>
            ))}
          </Panel>
          <Panel title="最近教学操作">
            {(
              await database.list(
                'auditLog',
                { actorId: a.id },
                { orderBy: 'createdAt', desc: true, take: 6 },
              )
            ).map((log) => (
              <div className="list-item" key={log.id}>
                <div>
                  <strong>{log.action}</strong>
                  <p>{date(log.createdAt)}</p>
                </div>
              </div>
            ))}
          </Panel>
        </aside>
      </div>
    </>
  );
}
export async function QuestionsView({ a, segments }: { a: Actor; segments: string[] }) {
  const knowledge = await database.list('knowledgePoint');
  if (segments[1] === 'new')
    return (
      <>
        <PageTitle
          eyebrow="QUESTION LIBRARY"
          title="创建题目"
          description="先确认题意、参考答案与评分细则，再用于正式作业。"
        />
        <QuestionEditor knowledge={knowledge} />
      </>
    );
  const questions = await domain.listQuestions(database, a);
  if (segments[1]) {
    const q = questions.find((q) => q.id === segments[1]);
    domain.ensure(q, 'NOT_FOUND', 404);
    return (
      <>
        <PageTitle
          eyebrow="QUESTION VERSION"
          title="编辑题目 · 保存新版本"
          description={`当前版本 v${q.version}。已有作业仍引用原版本。`}
        />
        <QuestionEditor knowledge={knowledge} initial={q} questionId={q.questionId} />
      </>
    );
  }
  const latest = questions.filter(
    (q) => !questions.some((v) => v.questionId === q.questionId && v.version > q.version),
  );
  return (
    <>
      <PageTitle
        eyebrow="REUSABLE & VERSIONED"
        title="题库管理"
        description="以版本保存题目、答案与评分依据，让历史作答可追溯。"
        action={
          <Link className="button primary" href="/teacher/questions/new">
            ＋ 创建题目
          </Link>
        }
      />
      <Panel title={`个人题库 · ${latest.length} 道`}>
        {latest.length ? (
          <div className="table-scroll">
            <table className="score-table">
              <thead>
                <tr>
                  <th>题目 / 章节</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>满分</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <strong>{q.title}</strong>
                      <p className="small muted">{q.chapter}</p>
                    </td>
                    <td>v{q.version}</td>
                    <td>
                      <Badge tone={q.confirmed ? 'green' : 'amber'}>
                        {q.confirmed ? '教师已确认' : '待确认'}
                      </Badge>
                    </td>
                    <td>{formatPoints(q.maxPoints)}</td>
                    <td>
                      <Link className="button ghost" href={`/teacher/questions/${q.id}`}>
                        编辑新版本
                      </Link>
                      <ActionButton
                        name="question"
                        data={{ question: { ...q, title: `${q.title}（副本）` } }}
                      >
                        复制
                      </ActionButton>
                      <ActionButton
                        name="question-disable"
                        data={{ id: q.questionId }}
                        confirm="停用后不能加入新作业，历史作业保留。"
                        className="button ghost"
                      >
                        停用
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="创建第一道工程图学题目"
            description="上传题干与参考答案，设置可核验的评分细则。"
          />
        )}
      </Panel>
    </>
  );
}
export async function NewAssignment({ a }: { a: Actor }) {
  return (
    <>
      <PageTitle
        eyebrow="TEACHING · PUBLISH"
        title="创建课程作业"
        description="保存草稿后检查题目与发布对象，再正式发布。"
      />
      <AssignmentEditor
        classes={await domain.visibleClasses(database, a)}
        questions={await domain.listQuestions(database, a)}
      />
    </>
  );
}
export async function ReviewsView({ a }: { a: Actor }) {
  const reviews = await domain.listReviews(database, a);
  const decisions = await Promise.all(
    reviews.map(async (r) => {
      const decision = (
        await database.list(
          'gradeDecision',
          { attemptId: r.attempt.id },
          { orderBy: 'revision', desc: true, take: 1 },
        )
      )[0];
      return decision && !decision.publishedAt
        ? { id: decision.id, label: `${r.owner} · ${r.question?.title}` }
        : null;
    }),
  );
  return (
    <>
      <PageTitle
        eyebrow="GRADING & REVIEW"
        title="批改复核"
        description="对照原始图纸、AI 建议与评分细则，逐项确认正式结果。"
      />
      {a.roles.includes('TEACHER') && (
        <BatchPublish decisions={decisions.filter((d) => d !== null)} />
      )}
      <Panel title="学生作答">
        {reviews.length ? (
          reviews.map((r) => (
            <Link
              className="list-item"
              href={`/teacher/reviews/${r.attempt.id}`}
              key={r.attempt.id}
            >
              <span className="grow">
                <strong>
                  {r.owner} · {r.question?.title}
                </strong>
                <p>
                  {date(r.attempt.submittedAt)} · 版本 {r.attempt.version}
                </p>
              </span>
              {r.attempt.publishedDecisionId ? (
                <Badge tone="green">正式成绩已发布</Badge>
              ) : r.run ? (
                <Status status={r.run.status} />
              ) : (
                <Badge>等待处理</Badge>
              )}
              <ArrowRight size={15} />
            </Link>
          ))
        ) : (
          <Empty title="尚无学生作答" description="发布作业并收到提交后，即可开始复核。" />
        )}
      </Panel>
    </>
  );
}
export async function ClassesView({ a, segments }: { a: Actor; segments: string[] }) {
  const classes = await domain.visibleClasses(database, a);
  if (!segments[1])
    return (
      <>
        <PageTitle
          eyebrow="TEACHING CLASSES"
          title="教学班"
          description="名单与作答记录均限制在当前授课授权范围。"
        />
        {await Promise.all(
          classes.map(async (c) => (
            <Panel
              key={c.id}
              title={c.name}
              action={<Link href={`/teacher/classes/${c.id}`}>查看学生名单 →</Link>}
            >
              <p className="muted">
                已选学生 {(await database.list('enrollment', { classId: c.id })).length} 人
              </p>
            </Panel>
          )),
        )}
      </>
    );
  const c = classes.find((c) => c.id === segments[1]);
  domain.ensure(c, 'CLASS_FORBIDDEN', 403);
  const enrollments = await database.list('enrollment', { classId: c.id });
  const assignments = await domain.listAssignments(database, a);
  const items = await database.list('assignmentItem', {
    assignmentId: { in: assignments.filter((v) => v.classId === c.id).map((v) => v.id) },
  });
  return (
    <>
      <PageTitle
        eyebrow="CLASS ROSTER"
        title={c.name}
        description="查看实际提交与成绩记录。名单选课关系由管理员维护。"
        action={<ExportButton classId={c.id} />}
      />
      {a.roles.includes('TEACHER') && <RosterImport classId={c.id} />}
      <Panel title={`学生名单 · ${enrollments.length} 人`}>
        <div className="table-scroll">
          <table className="score-table">
            <thead>
              <tr>
                <th>学生</th>
                <th>账号</th>
                <th>已提交题数</th>
                <th>正式发布次数</th>
              </tr>
            </thead>
            <tbody>
              {await Promise.all(
                enrollments.map(async (e) => {
                  const u = await database.get('user', e.userId);
                  const submissions = await database.list('submission', {
                    userId: e.userId,
                    itemId: { in: items.map((i) => i.id) },
                  });
                  const attempts = await database.list('submissionAttempt', {
                    submissionId: { in: submissions.map((s) => s.id) },
                  });
                  return (
                    <tr key={e.id}>
                      <td>{u?.name}</td>
                      <td>{u?.email}</td>
                      <td>
                        {new Set(attempts.map((at) => at.submissionId)).size} / {items.length}
                      </td>
                      <td>{attempts.filter((at) => at.publishedDecisionId).length}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
export async function AnalyticsView({ a }: { a: Actor }) {
  const classes = await domain.visibleClasses(database, a);
  const reviews = await domain.listReviews(database, a);
  const published = reviews.filter((r) => r.attempt.publishedDecisionId);
  const decisions = await database.list('gradeDecision', {
    id: { in: published.map((r) => r.attempt.publishedDecisionId!) },
  });
  const avg = decisions.length
    ? decisions.reduce((s, d) => s + d.points, 0) / decisions.length / 10
    : null;
  const submissions = reviews.length;
  const assignments = await domain.listAssignments(database, a);
  const bins = [0, 0, 0, 0, 0];
  for (const d of decisions) {
    const q = reviews.find((r) => r.attempt.id === d.attemptId)?.question;
    if (q) bins[Math.min(4, Math.floor((d.points / q.maxPoints) * 5))]++;
  }
  return (
    <>
      <PageTitle
        eyebrow="EVIDENCE-BASED TEACHING"
        title="基础学情"
        description="统计仅使用授权班级实际作答与当前正式发布成绩。"
      />
      <div className="stats">
        <Stat title="授权教学班" value={classes.length} foot="按当前教学授权统计" />
        <Stat title="已收到作答" value={submissions} unit="份" foot="包含保留的提交版本" />
        <Stat
          title="正式成绩均分"
          value={avg === null ? '—' : avg.toFixed(1)}
          foot="不同满分题目需分别比较"
        />
        <Stat
          title="已发布成绩"
          value={decisions.length}
          unit="份"
          foot={`${assignments.length} 份作业记录`}
        />
      </div>
      <div className="two-col">
        <Panel title="成绩分布 · 得分率">
          {decisions.length ? (
            <>
              <div
                className="histogram"
                role="img"
                aria-label={bins.map((n, i) => `${i * 20}至${(i + 1) * 20}%：${n}份`).join('；')}
              >
                {bins.map((n, i) => (
                  <div
                    className="bar"
                    key={i}
                    style={{ height: `${(n / Math.max(...bins, 1)) * 130}px` }}
                  >
                    <span>{n}</span>
                    <small>
                      {i * 20}–{(i + 1) * 20}%
                    </small>
                  </div>
                ))}
              </div>
              <p className="muted small" style={{ marginTop: 40 }}>
                依据各题满分计算得分率；包括最新发布的更正成绩。
              </p>
            </>
          ) : (
            <Empty title="尚无正式成绩" description="教师复核发布后生成真实统计。" />
          )}
        </Panel>
        <Panel title="班级提交与导出">
          {await Promise.all(
            classes.map(async (c) => {
              const enrollment = await database.list('enrollment', { classId: c.id });
              const ass = assignments.filter((x) => x.classId === c.id && x.status === 'PUBLISHED');
              const its = await database.list('assignmentItem', {
                assignmentId: { in: ass.map((x) => x.id) },
              });
              const subs = await database.list('submission', {
                itemId: { in: its.map((x) => x.id) },
              });
              const at = await database.list('submissionAttempt', {
                submissionId: { in: subs.map((s) => s.id) },
              });
              const submitted = new Set(at.map((at) => at.submissionId)).size,
                expected = enrollment.length * its.length;
              return (
                <div className="list-item" key={c.id}>
                  <div className="grow">
                    <strong>{c.name}</strong>
                    <p>
                      {submitted} / {expected} 题次 · 提交率{' '}
                      {expected ? Math.round((submitted / expected) * 100) : 0}%
                    </p>
                  </div>
                  <ExportButton classId={c.id} />
                </div>
              );
            }),
          )}
        </Panel>
      </div>
    </>
  );
}
