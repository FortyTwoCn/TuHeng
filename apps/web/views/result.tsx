import Link from 'next/link';
import { database } from '@tuheng/database';
import { viewAttempt, type Actor } from '@tuheng/domain';
import { Annotation, formatPoints } from '@tuheng/contracts';
import { Panel, PageTitle, Badge } from '@tuheng/ui';
import { DrawingViewer } from '../components/DrawingViewer';
import { ReviewEditor } from '../components/ReviewEditor';
import { ActionButton, TextAction } from '../components/Actions';
import { SuggestionReport, ScoreTable, date, Status } from './shared';
export async function ResultView({ a, id }: { a: Actor; id: string }) {
  const d = await viewAttempt(database, a, id);
  const suggestion = d.suggestions.find((s) => s.runId === d.runs[0]?.id);
  const decision = d.decisions.filter((x) => x !== null)[0];
  const annotations = decision
    ? Annotation.array().parse(decision.annotations)
    : (suggestion?.result.annotations ?? []);
  const processed = (suggestion?.processedAssets ?? []) as {
    originalId: string;
    processedId: string;
  }[];
  const latest = decision
    ? {
        items: decision.items as { criterionId: string; points: number; evidence: string }[],
        feedback: decision.feedback,
        annotations,
      }
    : undefined;
  return (
    <>
      <PageTitle
        eyebrow={d.teacher ? 'TEACHER REVIEW' : 'SUBMISSION & FEEDBACK'}
        title={d.question.title}
        description={`作答 v${d.attempt.version} · ${date(d.attempt.submittedAt)} · ${d.attempt.source === 'ASSIGNMENT' ? '课程作业' : '私人练习'}`}
        action={
          <Badge tone={d.attempt.publishedDecisionId ? 'green' : 'amber'}>
            {d.attempt.publishedDecisionId ? '正式成绩已发布' : '等待教师复核'}
          </Badge>
        }
      />
      <div className={d.teacher ? 'review-layout' : 'dashboard-grid'}>
        <div className="review-main">
          <Panel title="作答图纸">
            <DrawingViewer assets={d.assets} annotations={annotations} processed={processed} />
          </Panel>
          {suggestion && (
            <Panel>
              <SuggestionReport result={suggestion.result} />
            </Panel>
          )}
          {!suggestion && (
            <Panel title="批改进度">
              {d.runs.map((r) => (
                <div className="list-item" key={r.id}>
                  <Status status={r.status} />
                  <span className="code-ref">{r.id}</span>
                  {r.errorCode && <span className="muted small">{r.errorCode}</span>}
                </div>
              ))}
              <div className="alert">
                {d.runs[0]?.status === 'BLOCKED_CONFIG'
                  ? '视觉模型尚未配置，未生成 AI 分数。教师可直接人工批改。'
                  : '任务状态来自后台实际记录。教师确认并发布后可查看正式成绩。'}
              </div>
              <Link
                className="button secondary"
                href={`/${d.teacher ? 'teacher/reviews' : 'student/results'}/${id}`}
              >
                刷新处理状态
              </Link>
            </Panel>
          )}
          {d.question.reference.assetIds.length > 0 && (
            <Panel title="参考答案">
              <p>{d.question.reference.content}</p>
              <DrawingViewer
                assets={await database.list('storedAsset', {
                  id: { in: d.question.reference.assetIds },
                })}
              />
            </Panel>
          )}
          <Panel title="申诉与处理记录">
            {d.appeals.map((ap) => (
              <div className="list-item" key={ap.id}>
                <div className="grow">
                  <Status status={ap.status} />
                  <p>{ap.reason}</p>
                  {ap.response && <p>教师处理：{ap.response}</p>}
                  {d.teacher && ap.status === 'OPEN' && (
                    <TextAction
                      name="appeal-resolve"
                      field="response"
                      data={{ id: ap.id }}
                      label="保存处理意见"
                      placeholder="说明维持成绩或更正的理由；更正成绩需另存并发布新版本。"
                    />
                  )}
                </div>
              </div>
            ))}
            {!d.teacher && d.attempt.ownerId === a.id && d.attempt.publishedDecisionId && (
              <TextAction
                name="appeal"
                field="reason"
                data={{ attemptId: id }}
                label="提交申诉"
                placeholder="请说明具体评分项、作图证据和申诉理由。"
              />
            )}
            {!d.appeals.length && !d.attempt.publishedDecisionId && (
              <p className="muted">正式成绩发布后开放申诉。</p>
            )}
          </Panel>
        </div>
        <aside>
          {d.teacher ? (
            <Panel>
              <ReviewEditor
                attemptId={id}
                rubric={d.question.rubric}
                suggestion={suggestion?.result}
                latest={latest}
                assetIds={d.assets.map((a) => a.id)}
              />
            </Panel>
          ) : decision ? (
            <Panel title="教师正式成绩">
              <div className="result-score">
                {formatPoints(decision.points)}{' '}
                <small>/ {formatPoints(d.question.maxPoints)}</small>
              </div>
              <Badge tone="green">已复核 · 版本 {decision.revision}</Badge>
              <ScoreTable
                items={
                  decision.items as { criterionId: string; points: number; evidence: string }[]
                }
              />
              <h3>教师指导</h3>
              <p>{decision.feedback}</p>
              <p className="small muted">发布于 {date(decision.publishedAt!)}</p>
            </Panel>
          ) : (
            <Panel title="反馈说明">
              <div className="status-step current">
                <i />
                作答已安全保存
              </div>
              <div className="status-step">
                <i />
                <span>AI 生成建议或转人工处理</span>
              </div>
              <div className="status-step">
                <i />
                <span>教师确认并发布正式成绩</span>
              </div>
            </Panel>
          )}
          {d.teacher && (
            <Panel title="复核与发布记录">
              {d.decisions
                .filter((x) => x !== null)
                .map((dec) => (
                  <div key={dec.id} className="list-item">
                    <div className="grow">
                      <strong>
                        复核版本 {dec.revision} · {formatPoints(dec.points)} 分
                      </strong>
                      <p>
                        {date(dec.createdAt)} · {dec.publishedAt ? '已发布' : '已确认，待发布'}
                      </p>
                      {!dec.publishedAt && dec.id === decision?.id && (
                        <ActionButton
                          name="grade-publish"
                          data={{ id: dec.id }}
                          className="button primary"
                          confirm="将此教师确认版本发布为正式成绩？"
                        >
                          发布正式成绩
                        </ActionButton>
                      )}
                    </div>
                  </div>
                ))}
            </Panel>
          )}
          {!d.teacher && (
            <Panel title="巩固练习">
              <p className="muted small">将这次作答收录到错题本，稍后重新练习。</p>
              <ActionButton name="error-collect" data={{ attemptId: id }}>
                收录到错题本
              </ActionButton>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
