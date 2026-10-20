import Link from 'next/link';
import { database } from '@tuheng/database';
import { assignmentDetails, type Actor } from '@tuheng/domain';
import { Panel, PageTitle, Badge } from '@tuheng/ui';
import { formatPoints } from '@tuheng/contracts';
import { ActionButton } from '../components/Actions';
import { SubmissionEditor } from '../components/SubmissionEditor';
import { DrawingViewer } from '../components/DrawingViewer';
import { date, Status } from './shared';
export async function AssignmentDetails({ a, id }: { a: Actor; id: string }) {
  const detail = await assignmentDetails(database, a, id);
  const { assignment, teacher, items } = detail;
  return (
    <>
      <PageTitle
        eyebrow="ASSIGNMENT DETAIL"
        title={assignment.title}
        description={`开始 ${date(assignment.startsAt)} · 截止 ${date(assignment.dueAt)} · 北京时间`}
        action={<Status status={assignment.status} />}
      />
      <Panel>
        <div className="metadata">
          <span>{items.length} 道题</span>
          <span>总分 {formatPoints(items.reduce((s, i) => s + i.question.maxPoints, 0))}</span>
          <span>{assignment.allowLate ? '允许迟交' : '不允许迟交'}</span>
          <span>最多提交 {assignment.maxAttempts} 次</span>
        </div>
        {teacher && assignment.status === 'DRAFT' && (
          <ActionButton
            name="assignment-publish"
            data={{ id }}
            confirm="发布后将固定题目和评分细则版本，是否发布？"
            className="button primary"
          >
            正式发布作业
          </ActionButton>
        )}
        {teacher && (
          <p className="small muted">版本已冻结。学生提交后，在批改复核工作台逐项确认。</p>
        )}
      </Panel>
      {await Promise.all(
        items.map(async (item, index) => {
          const assets = await database.list('storedAsset', { id: { in: item.question.assetIds } });
          const own = item.submissions.find((s) => s.userId === a.id);
          const draft = own
            ? await database.list('storedAsset', { id: { in: own.draftAssetIds } })
            : [];
          return (
            <Panel
              key={item.id}
              title={`${String(index + 1).padStart(2, '0')} · ${item.question.title}`}
              action={<Badge>{formatPoints(item.question.maxPoints)} 分</Badge>}
            >
              <p>{item.question.content}</p>
              <div className="metadata">
                <span>题目版本 v{item.question.version}</span>
                <span>{item.question.chapter}</span>
              </div>
              {assets.length > 0 && <DrawingViewer assets={assets} />}
              <details>
                <summary>查看评分细则</summary>
                <table className="score-table">
                  <tbody>
                    {item.question.rubric.items.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.name}
                          <p className="muted small">{c.correctness}</p>
                        </td>
                        <td>{formatPoints(c.maxPoints)} 分</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              {teacher ? (
                <>
                  <h3>学生提交</h3>
                  {item.attempts.length ? (
                    item.attempts.map((at) => (
                      <Link className="list-item" key={at.id} href={`/teacher/reviews/${at.id}`}>
                        <strong>
                          {at.ownerId.slice(0, 8)} · 作答 v{at.version}
                        </strong>
                        <span>{date(at.submittedAt)}</span>
                        <Badge tone={at.publishedDecisionId ? 'green' : 'amber'}>
                          {at.publishedDecisionId ? '成绩已发布' : '待复核'}
                        </Badge>
                      </Link>
                    ))
                  ) : (
                    <p className="muted">尚无学生提交。</p>
                  )}
                </>
              ) : (
                <>
                  {item.attempts.length > 0 && (
                    <div>
                      <h3>我的提交版本</h3>
                      {item.attempts.map((at) => (
                        <Link className="list-item" key={at.id} href={`/student/results/${at.id}`}>
                          <strong>作答 v{at.version}</strong>
                          <span>{date(at.submittedAt)}</span>
                          <Badge tone={at.publishedDecisionId ? 'green' : 'blue'}>
                            {at.publishedDecisionId ? '查看成绩' : '查看处理状态'}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                  {item.attempts.length < assignment.maxAttempts &&
                  (assignment.allowLate || new Date() <= assignment.dueAt) ? (
                    <SubmissionEditor itemId={item.id} initial={draft} />
                  ) : (
                    <div className="alert">当前不开放新提交。已有作答和成绩可以继续查看。</div>
                  )}
                </>
              )}
            </Panel>
          );
        }),
      )}
    </>
  );
}
