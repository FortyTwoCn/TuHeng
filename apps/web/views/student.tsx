import { ErrorBookList } from '../components/ErrorBookList';
import Link from 'next/link';
import { database } from '@tuheng/database';
import * as domain from '@tuheng/domain';
import type { Actor } from '@tuheng/domain';
import { Panel, PageTitle, Empty, Badge } from '@tuheng/ui';
import { ArrowRight, BookOpen, Compass } from 'lucide-react';
import { AssignmentCard, Stat, NoAssignments, date } from './shared';
import { QuestionEditor } from '../components/QuestionEditor';
import { SubmissionEditor } from '../components/SubmissionEditor';
import { TextAction } from '../components/Actions';
export async function StudentDashboard({ a }: { a: Actor }) {
  const [assignments, classes, attempts, errors, mastery] = await Promise.all([
    domain.listAssignments(database, a),
    domain.visibleClasses(database, a),
    database.list('submissionAttempt', { ownerId: a.id }),
    domain.listErrors(database, a),
    domain.mastery(database, a),
  ]);
  const formal = attempts.filter((at) => at.source === 'ASSIGNMENT'),
    published = formal.filter((at) => at.publishedDecisionId);
  const pending = assignments.filter((as) => as.dueAt > new Date());
  return (
    <>
      <PageTitle
        eyebrow="MY LEARNING SPACE"
        title={`${a.name}，开始今天的作图。`}
        description="在每一次练习中，建立更清晰的空间理解。"
        action={
          <Link className="button primary" href="/student/selftests/new">
            ＋ 开始自主练习
          </Link>
        }
      />
      <div className="stats">
        <Stat
          title="课程作业"
          value={assignments.length}
          unit="份"
          foot={`${classes.length} 个已选教学班`}
        />
        <Stat title="已提交作答" value={formal.length} unit="次" foot="每次提交独立保留版本" />
        <Stat title="已发布批改" value={published.length} unit="次" foot="由教师复核并正式发布" />
        <Stat title="待巩固错题" value={errors.length} unit="道" foot="从错误中积累新的理解" />
      </div>
      <div className="dashboard-grid">
        <div>
          <div className="hero-banner">
            <p className="eyebrow">DRAW · UNDERSTAND · IMPROVE</p>
            <h2>让空间关系，落在每一根图线上。</h2>
            <p>完成作业后，查看逐项反馈。带着具体问题再画一次，让每次修改都有依据。</p>
          </div>
          <div className="panel-heading">
            <h2>
              近期作业 <Badge>{pending.length} 份进行中</Badge>
            </h2>
            <Link href="/student/assignments">全部作业 →</Link>
          </div>
          {assignments.length ? (
            assignments
              .slice(0, 3)
              .map((ass) => (
                <AssignmentCard
                  key={ass.id}
                  assignment={ass}
                  area="student"
                  className={classes.find((c) => c.id === ass.classId)?.name ?? ''}
                />
              ))
          ) : (
            <NoAssignments />
          )}
        </div>
        <aside className="dashboard-aside">
          <Panel title="知识点表现">
            <p className="small muted">仅汇总正式发布成绩中的对应证据。</p>
            {mastery.map((k) => (
              <div className="knowledge-item" key={k.id}>
                <div>
                  <span>{k.title}</span>
                  <small>
                    {k.possible ? `${Math.round((k.earned / k.possible) * 100)}%` : '证据不足'}
                  </small>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${k.possible ? (k.earned / k.possible) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </Panel>
          <Panel title="你的学习工具">
            <Link className="list-item" href="/student/selftests">
              <span className="list-icon">
                <BookOpen size={18} />
              </span>
              <span className="grow">
                <strong>自测本</strong>
                <p>创建个人题集，按自己的节奏练习</p>
              </span>
              <ArrowRight size={14} />
            </Link>
            <Link className="list-item" href="/student/errors">
              <span className="list-icon">
                <Compass size={18} />
              </span>
              <span className="grow">
                <strong>错题本</strong>
                <p>回顾证据，再做一次</p>
              </span>
              <ArrowRight size={14} />
            </Link>
          </Panel>
        </aside>
      </div>
    </>
  );
}
export async function AssignmentList({
  a,
  area,
  search,
}: {
  a: Actor;
  area: 'student' | 'teacher';
  search: Record<string, string | undefined>;
}) {
  const [all, classes] = await Promise.all([
    domain.listAssignments(database, a),
    domain.visibleClasses(database, a),
  ]);
  const assignments = all.filter(
    (as) =>
      (!search.classId || as.classId === search.classId) &&
      (!search.status || as.status === search.status) &&
      (!search.q || as.title.includes(search.q)),
  );
  return (
    <>
      <PageTitle
        eyebrow={area === 'student' ? 'ASSIGNMENTS' : 'TEACHING · ASSIGNMENTS'}
        title="作业管理"
        description="查看题目、提交状态与批改反馈，保留每一次学习记录。"
        action={
          area === 'teacher' ? (
            <Link className="button primary" href="/teacher/assignments/new">
              ＋ 布置作业
            </Link>
          ) : undefined
        }
      />
      <form className="filterbar">
        <input aria-label="搜索作业" name="q" placeholder="搜索作业名称" defaultValue={search.q} />
        <select aria-label="按教学班筛选" name="classId" defaultValue={search.classId}>
          <option value="">全部课程 / 教学班</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="status" aria-label="按状态筛选" defaultValue={search.status}>
          <option value="">全部状态</option>
          <option value="PUBLISHED">已发布</option>
          {area === 'teacher' && <option value="DRAFT">草稿</option>}
        </select>
        <button className="button secondary">筛选</button>
      </form>
      {assignments.length ? (
        await Promise.all(
          assignments.map(async (ass) => {
            const items = await database.list('assignmentItem', { assignmentId: ass.id });
            const submissions = await database.list('submission', {
              userId: a.id,
              itemId: { in: items.map((i) => i.id) },
            });
            const attempts = await database.list('submissionAttempt', {
              submissionId: { in: submissions.map((s) => s.id) },
            });
            return (
              <AssignmentCard
                key={ass.id}
                assignment={ass}
                area={area}
                className={classes.find((c) => c.id === ass.classId)?.name ?? ''}
                count={items.length}
                completed={new Set(attempts.map((at) => at.submissionId)).size}
              />
            );
          }),
        )
      ) : (
        <NoAssignments />
      )}
    </>
  );
}
export async function SelfTests({ a, segments }: { a: Actor; segments: string[] }) {
  const folders = await database.list('selfTestFolder', { ownerId: a.id });
  if (segments[1] === 'new')
    return (
      <>
        <PageTitle
          eyebrow="SELF PRACTICE"
          title="创建私人题集"
          description="题目与作答仅自己可见，复用统一批改流程。"
        />
        <QuestionEditor
          selftest
          knowledge={await database.list('knowledgePoint')}
          folders={folders}
        />
      </>
    );
  const sets = await domain.listSelfTests(database, a);
  if (segments[1]) {
    const set = sets.find((s) => s.id === segments[1]);
    domain.ensure(set, 'NOT_FOUND', 404);
    const item = set.items[0];
    const q = await database.get('questionVersion', item.questionVersionId);
    domain.ensure(q, 'NOT_FOUND');
    const attempts = await database.list(
      'submissionAttempt',
      { ownerId: a.id, selfTestItemId: item.id },
      { orderBy: 'submittedAt', desc: true },
    );
    return (
      <>
        <PageTitle
          eyebrow="PERSONAL PRACTICE"
          title={set.title}
          description="每次练习保留历史。自测建议不影响正式作业成绩。"
        />
        <Panel title={q.title}>
          <p>{q.content}</p>
          <Badge tone="amber">
            {q.reference.verified ? '参考答案已验证' : '参考答案未经教师验证'}
          </Badge>
          {q.assetIds.map((id) => (
            <a className="button secondary" href={`/api/assets/${id}`} key={id} target="_blank">
              查看题目材料
            </a>
          ))}
          <SubmissionEditor selfTestItemId={item.id} />
        </Panel>
        <Panel title="练习记录">
          {attempts.length ? (
            attempts.map((at) => (
              <Link className="list-item" key={at.id} href={`/student/results/${at.id}`}>
                <strong>{date(at.submittedAt)}</strong>
                <span className="muted">查看批改状态与建议 →</span>
              </Link>
            ))
          ) : (
            <Empty title="还没有练习记录" description="上传第一份作答，开始练习。" />
          )}
        </Panel>
      </>
    );
  }
  return (
    <>
      <PageTitle
        eyebrow="PRACTICE AT YOUR OWN PACE"
        title="自测本"
        description="把自己的题目整理好，让练习成为习惯。"
        action={
          <Link className="button primary" href="/student/selftests/new">
            ＋ 创建题集
          </Link>
        }
      />
      <div className="two-col">
        <Panel title="个人文件夹">
          <div className="folder-chips">
            {folders.map((f) => (
              <span key={f.id}>{f.title}</span>
            ))}
          </div>
          <TextAction
            name="folder"
            field="title"
            data={{}}
            label="创建文件夹"
            placeholder="新文件夹名称"
          />
        </Panel>
        <Panel title="题集与练习">
          {sets.length ? (
            sets.map((s) => (
              <Link key={s.id} className="list-item" href={`/student/selftests/${s.id}`}>
                <span className="list-icon">
                  <BookOpen size={18} />
                </span>
                <span className="grow">
                  <strong>{s.title}</strong>
                  <p>
                    {folders.find((f) => f.id === s.folderId)?.title ?? '未分组'} · {s.items.length}{' '}
                    题
                  </p>
                </span>
                <ArrowRight size={15} />
              </Link>
            ))
          ) : (
            <Empty title="建立第一份题集" description="上传题目与参考材料，开始私人练习。" />
          )}
        </Panel>
      </div>
    </>
  );
}
export async function ErrorBook({ a, segments }: { a: Actor; segments: string[] }) {
  const entries = await domain.listErrors(database, a);
  if (segments[1]) {
    const entry = await database.get('errorBookEntry', segments[1]);
    domain.ensure(entry?.ownerId === a.id, 'NOT_FOUND', 404);
    const q = await database.get('questionVersion', entry.questionVersionId);
    domain.ensure(q, 'NOT_FOUND');
    return (
      <>
        <PageTitle
          eyebrow="REVIEW & REBUILD"
          title={q.title}
          description="重新作答会创建新的练习记录，不修改原成绩。"
        />
        <Panel>
          <p>{q.content}</p>
          {q.assetIds.map((id) => (
            <a key={id} className="button secondary" href={`/api/assets/${id}`} target="_blank">
              查看原题
            </a>
          ))}
          <SubmissionEditor reviewEntryId={entry.id} />
        </Panel>
        <Link href={`/student/results/${entry.attemptId}`}>查看原始作答与错误解析 →</Link>
      </>
    );
  }
  const errorRows = await Promise.all(
    entries.map(async (e) => {
      let score: number | null = null;
      if (e.attempt?.publishedDecisionId)
        score =
          (await database.get('gradeDecision', e.attempt.publishedDecisionId))?.points ?? null;
      else if (e.attempt?.source !== 'ASSIGNMENT') {
        const run = (
          await database.list(
            'gradingRun',
            { attemptId: e.attemptId, status: 'SUCCEEDED' },
            { orderBy: 'createdAt', desc: true, take: 1 },
          )
        )[0];
        if (run) {
          const suggestion = (await database.list('gradingSuggestion', { runId: run.id }))[0];
          score =
            (suggestion?.result as { totalPoints: number | null } | undefined)?.totalPoints ?? null;
        }
      }
      return {
        id: e.id,
        attemptId: e.attemptId,
        title: e.question?.title ?? '题目',
        chapter: e.question?.chapter ?? '未分类',
        knowledgeIds: e.question?.knowledgeIds ?? [],
        source: e.attempt?.source ?? 'SELFTEST',
        score,
        reviews: e.reviews.length,
      };
    }),
  );
  return (
    <>
      <PageTitle
        eyebrow="LEARN FROM EVERY LINE"
        title="错题本"
        description="保留原始作答与得分，带着具体反馈再次练习。"
      />
      {entries.length ? (
        <ErrorBookList entries={errorRows} knowledge={await database.list('knowledgePoint')} />
      ) : (
        <Panel>
          <Empty
            title="暂时没有待巩固的错题"
            description="成绩发布后有扣分的题目会归集到这里，也可以手动收录。"
          />
        </Panel>
      )}
    </>
  );
}
