'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { QuestionInput } from '@tuheng/contracts';
import { Uploader, type UploadedAsset } from './Uploader';
import { action } from './Actions';
const kinds = [
  ['POINT_PROJECTION', '点的投影'],
  ['LINE_PROJECTION', '直线的投影'],
  ['PLANE_PROJECTION', '平面投影'],
  ['PROJECTION_RELATION', '投影关系判断'],
  ['THREE_VIEWS', '基础三视图'],
  ['GEOMETRIC_CONSTRUCTION', '简单几何作图'],
  ['OTHER', '其他（人工复核）'],
];
export function QuestionEditor({
  knowledge,
  selftest = false,
  folders = [],
  initial,
  questionId,
}: {
  knowledge: { id: string; title: string }[];
  selftest?: boolean;
  folders?: { id: string; title: string }[];
  initial?: QuestionInput;
  questionId?: string;
}) {
  const router = useRouter();
  const [assets, setAssets] = useState<UploadedAsset[]>(
      initial?.assetIds.map((id) => ({ id, name: '已保存题干', mime: 'image/png' })) ?? [],
    ),
    [references, setReferences] = useState<UploadedAsset[]>(
      initial?.reference.assetIds.map((id) => ({
        id,
        name: '已保存参考答案',
        mime: 'image/png',
      })) ?? [],
    ),
    [selected, setSelected] = useState<string[]>(initial?.knowledgeIds ?? []),
    [criteria, setCriteria] = useState(
      initial?.rubric.items.map((c) => ({ ...c, score: String(c.maxPoints / 10) })) ?? [
        {
          id: 'geometry',
          name: '投影关系与作图正确性',
          maxPoints: 80,
          score: '8',
          knowledgeIds: [],
          correctness: '投影对应关系正确，已知条件与几何约束满足',
          partialCredit: '关键步骤正确可按比例得分',
          deductions: '按独立几何错误扣分；同一根因不重复扣分',
          deductionCap: null,
        },
        {
          id: 'drawing',
          name: '图线表达与作图规范',
          maxPoints: 20,
          score: '2',
          knowledgeIds: [],
          correctness: '辅助线、虚线和实线表达规范',
          partialCredit: '局部图线不规范酌情扣分',
          deductions: '仅对有明确证据的图线错误扣分',
          deductionCap: null,
        },
      ],
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        try {
          const items = criteria.map((c) => ({
            ...c,
            maxPoints: Math.round(Number(c.score) * 10),
            knowledgeIds: c.knowledgeIds.length
              ? c.knowledgeIds
              : selected.length === 1
                ? selected
                : [],
          }));
          const question = {
            title: String(f.get('title')),
            content: String(f.get('content')),
            type: String(f.get('type')),
            chapter: String(f.get('chapter')),
            knowledgeIds: selected,
            assetIds: assets.map((a) => a.id),
            reference: {
              version: `ref-${Date.now()}`,
              content: String(f.get('reference')),
              assetIds: references.map((a) => a.id),
              verified: !selftest && f.get('verified') === 'on',
              source: selftest ? 'STUDENT' : 'TEACHER',
            },
            rubric: {
              version: `rubric-${Date.now()}`,
              maxPoints: items.reduce((s, i) => s + i.maxPoints, 0),
              items,
            },
            confirmed: !selftest && f.get('confirmed') === 'on',
          };
          if (selftest) {
            await action('selftest', {
              title: question.title,
              folderId: f.get('folderId') || null,
              mode: f.get('mode'),
              question,
            });
            router.push('/student/selftests');
          } else {
            await action('question', { question, questionId });
            router.push('/teacher/questions');
          }
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <section className="panel">
        <h2>{selftest ? '创建个人题集' : '题目基本信息'}</h2>
        <div className="form-grid">
          <label className="span-2">
            题目名称
            <input
              name="title"
              required
              defaultValue={initial?.title}
              placeholder="例如：已知点 A 的两面投影，求第三投影"
            />
          </label>
          <label>
            题型
            <select name="type" defaultValue={initial?.type}>
              {kinds.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            章节
            <input
              name="chapter"
              defaultValue={initial?.chapter ?? '第一章 · 点线面的投影'}
              required
            />
          </label>
          <label className="span-2">
            题目要求
            <textarea
              name="content"
              required
              defaultValue={initial?.content}
              placeholder="明确已知条件、需完成的作图和几何关系"
            />
          </label>
        </div>
        <p className="label">关联知识点</p>
        <div className="check-row">
          {knowledge.map((k) => (
            <label key={k.id}>
              <input
                type="checkbox"
                checked={selected.includes(k.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, k.id] : selected.filter((id) => id !== k.id),
                  )
                }
              />
              {k.title}
            </label>
          ))}
        </div>
        <Uploader
          value={assets}
          onChange={setAssets}
          purpose="QUESTION"
          label="上传题干图或 PDF 资料"
        />
      </section>
      {selftest && (
        <section className="panel">
          <h2>题集归属与材料关系</h2>
          <label>
            文件夹
            <select name="folderId">
              <option value="">未分组</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            材料关系
            <select name="mode">
              <option value="SEPARATE">题目和参考答案分别上传</option>
              <option value="COMBINED">题目和答案在同一文件</option>
              <option value="QUESTION_ONLY">只有题目（参考答案尚未验证）</option>
            </select>
          </label>
          <div className="alert">
            首版每个题集保存一道手动确认的题目。只有题目时请描述可核验的预期关系；系统不会把未经验证的参考答案当作正式依据。PDF
            暂不自动拆题。
          </div>
        </section>
      )}
      <section className="panel">
        <h2>参考答案</h2>
        <label>
          参考作图与关键步骤
          <textarea
            name="reference"
            defaultValue={initial?.reference.content}
            required
            placeholder="请写明投影关系、关键作图步骤和允许的等价解法"
          />
        </label>
        <Uploader
          value={references}
          onChange={setReferences}
          purpose="REFERENCE"
          label="上传参考答案"
        />
        {!selftest && (
          <label className="check">
            <input
              type="checkbox"
              name="verified"
              defaultChecked={initial?.reference.verified}
              required
            />
            我已检查参考答案与等价正确解法，确认可作为判分依据
          </label>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>评分细则</h2>
          <strong>
            满分 {criteria.reduce((s, c) => s + (Number(c.score) || 0), 0).toFixed(1)} 分
          </strong>
        </div>
        {criteria.map((c, index) => (
          <div className="criterion-editor" key={c.id}>
            <div className="form-grid">
              <label>
                评分项名称
                <input
                  value={c.name}
                  required
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((v, i) => (i === index ? { ...v, name: e.target.value } : v)),
                    )
                  }
                />
              </label>
              <label>
                满分
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  required
                  value={c.score}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((v, i) => (i === index ? { ...v, score: e.target.value } : v)),
                    )
                  }
                />
              </label>
              <label>
                正确判定依据
                <textarea
                  required
                  value={c.correctness}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((v, i) =>
                        i === index ? { ...v, correctness: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                部分得分说明
                <textarea
                  value={c.partialCredit}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((v, i) =>
                        i === index ? { ...v, partialCredit: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                扣分条件
                <textarea
                  value={c.deductions}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((v, i) =>
                        i === index ? { ...v, deductions: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                可选扣分上限（分）
                <input
                  type="number"
                  min="0"
                  max={Number(c.score) || 100}
                  step="0.1"
                  value={c.deductionCap === null ? '' : c.deductionCap / 10}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((v, i) =>
                        i === index
                          ? {
                              ...v,
                              deductionCap:
                                e.target.value === ''
                                  ? null
                                  : Math.round(Number(e.target.value) * 10),
                            }
                          : v,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <fieldset className="criterion-knowledge">
              <legend>本评分项对应知识点（仅依据本项证据汇总）</legend>
              <div className="check-row">
                {knowledge
                  .filter((k) => selected.includes(k.id))
                  .map((k) => (
                    <label key={k.id}>
                      <input
                        type="checkbox"
                        checked={c.knowledgeIds.includes(k.id)}
                        onChange={(e) =>
                          setCriteria(
                            criteria.map((v, i) =>
                              i === index
                                ? {
                                    ...v,
                                    knowledgeIds: e.target.checked
                                      ? [...v.knowledgeIds, k.id]
                                      : v.knowledgeIds.filter((id) => id !== k.id),
                                  }
                                : v,
                            ),
                          )
                        }
                      />
                      {k.title}
                    </label>
                  ))}
              </div>
              <p className="muted small">
                只选一个知识点时，未单独绑定的评分项默认关联它；多个知识点请逐项绑定。
              </p>
            </fieldset>
            <button
              type="button"
              className="link-button"
              disabled={criteria.length === 1}
              onClick={() => setCriteria(criteria.filter((_, i) => i !== index))}
            >
              移除此项
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            setCriteria([
              ...criteria,
              {
                id: crypto.randomUUID(),
                name: '新增评分项',
                maxPoints: 10,
                score: '1',
                knowledgeIds: [],
                correctness: '',
                partialCredit: '',
                deductions: '',
                deductionCap: null,
              },
            ])
          }
        >
          ＋ 添加评分项
        </button>
        {!selftest && (
          <label className="check">
            <input type="checkbox" name="confirmed" defaultChecked={initial?.confirmed} required />
            我已确认题意、参考答案和评分细则（保存为新版本）
          </label>
        )}
      </section>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? '正在保存…' : selftest ? '保存私人题集' : '保存并确认题目版本'}
      </button>
    </form>
  );
}
