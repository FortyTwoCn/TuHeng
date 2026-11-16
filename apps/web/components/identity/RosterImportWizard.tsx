'use client';
import { useEffect, useState } from 'react';
import { identityRequest } from './client';
import { CredentialDelivery } from './CredentialDelivery';
type Mapping = {
  version: number;
  teachers: Record<string, { teacherId?: string; createName?: string; confirmed: boolean }>;
  rowGroups: Record<string, string>;
  classes: Record<string, string>;
};
type Preview = {
  id: string;
  fingerprint: string;
  status: string;
  mapping: Mapping;
  rosterVersion: number;
  errors?: { row: number; column: string; reason: string }[];
  errorCode?: string;
  result?: { completed: number; total: number; credentialBatchId?: string };
  analysis?: {
    errors: { row: number; column: string; reason: string }[];
    counts: {
      newTeachers: number;
      newClasses: number;
      newStudents: number;
      reusedStudents: number;
      skipped: number;
      total: number;
    };
    teachers: { id: string; name: string; loginId: string }[];
    classes: { id: string; name: string; teacherIds: string[] }[];
    plan: {
      row: {
        row: number;
        teacher?: string;
        className: string;
        studentNumber: string;
        name: string;
      };
      group: string;
      classKey: string;
      teacherId?: string;
      classId?: string;
      skip: boolean;
    }[];
  };
};
export function RosterImportWizard({
  schoolId,
  teacher = false,
  offerings,
}: {
  schoolId: string;
  teacher?: boolean;
  offerings: { id: string; term: string; course: { title: string } }[];
}) {
  const columnNames = teacher
    ? ['班级', '学号', '学生姓名']
    : ['教师名', '班级', '学号', '学生姓名'];
  const [customColumns, setCustomColumns] = useState(false),
    [columns, setColumns] = useState<Record<string, number>>({});
  const [offering, setOffering] = useState(''),
    [preview, setPreview] = useState<Preview>(),
    [mapping, setMapping] = useState<Mapping>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  useEffect(() => {
    if (!preview?.id || !['QUEUED', 'RUNNING'].includes(preview.status)) return;
    const timer = setInterval(() => {
      identityRequest('/api/roster/status?id=' + preview.id)
        .then(setPreview)
        .catch((e) => setMessage(e.message));
    }, 2000);
    return () => clearInterval(timer);
  }, [preview?.id, preview?.status]);
  async function apply(path: string, data: object) {
    setBusy(true);
    setMessage('');
    try {
      const r = await identityRequest('/api/roster/' + path, data, 'STAFF');
      setPreview(r);
      setMapping(r.mapping);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const groups = [...new Set(preview?.analysis?.plan.map((p) => p.group) ?? [])],
    classKeys = [...new Set(preview?.analysis?.plan.map((p) => p.classKey) ?? [])];
  return (
    <section className="identity-panel">
      <h2>{teacher ? '教师三列' : '学校四列'} Excel 导入</h2>
      <ol className="identity-steps">
        <li>下载模板，选择当前课程与学期。</li>
        <li>上传 .xlsx 文件，学号必须保持文本格式。</li>
        <li>检查冲突，确认教师与班级映射。</li>
        <li>执行导入，分别交付初始凭据。</li>
      </ol>
      <a className="button secondary" href="/api/roster/template">
        下载 Excel 模板
      </a>
      <label>
        课程 / 学期
        <select value={offering} onChange={(e) => setOffering(e.target.value)}>
          <option value="">请选择</option>
          {offerings.map((o) => (
            <option value={o.id} key={o.id}>
              {o.course.title} · {o.term}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>列映射（使用非标准列顺序时）</summary>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={customColumns}
            onChange={(e) => setCustomColumns(e.target.checked)}
          />
          手动指定列位置
        </label>
        {customColumns &&
          columnNames.map((name, i) => (
            <label key={name}>
              {name}所在列（A=1）
              <input
                type="number"
                min={1}
                max={8}
                value={columns[name] ?? i + 1}
                onChange={(e) => setColumns((c) => ({ ...c, [name]: Number(e.target.value) }))}
              />
            </label>
          ))}
        <p>第一行为列名，第二行开始读取数据。改变映射后重新上传预检。</p>
      </details>
      <label>
        上传 XLSX（最多 5 MB、5000 行）
        <input
          type="file"
          accept=".xlsx"
          disabled={busy || !offering}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            setMessage('');
            try {
              const params = new URLSearchParams({
                schoolId,
                offeringId: offering,
                filename: f.name,
              });
              if (customColumns)
                params.set(
                  'columns',
                  JSON.stringify(
                    Object.fromEntries(columnNames.map((h, i) => [h, columns[h] ?? i + 1])),
                  ),
                );
              const response = await fetch('/api/roster/preview?' + params, {
                method: 'POST',
                headers: {
                  'Content-Type':
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                },
                body: f,
              });
              const r = await response.json();
              if (!response.ok) throw new Error(r.error);
              setPreview(r.data);
              setMapping(r.data.mapping);
              setPage(0);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <p role="status">{message}</p>
      {preview?.errors?.map((e, i) => (
        <p key={i} role="alert">
          第 {e.row} 行 · {e.column}：{e.reason}
        </p>
      ))}
      {preview?.analysis && mapping && (
        <>
          <p>
            预计新增教师 {preview.analysis.counts.newTeachers}、班级{' '}
            {preview.analysis.counts.newClasses}、学生 {preview.analysis.counts.newStudents}
            ；复用学生 {preview.analysis.counts.reusedStudents}；跳过重复行{' '}
            {preview.analysis.counts.skipped}。
          </p>
          {!teacher && (
            <details open>
              <summary>教师分组确认</summary>
              {groups.map((g) => (
                <div key={g} className="identity-panel">
                  <strong>{g}</strong>
                  <label>
                    对应教师
                    <select
                      value={mapping.teachers[g]?.teacherId ?? 'NEW'}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m!,
                          teachers: {
                            ...m!.teachers,
                            [g]: {
                              ...(m!.teachers[g] ?? { createName: g, confirmed: false }),
                              teacherId: e.target.value === 'NEW' ? undefined : e.target.value,
                            },
                          },
                        }))
                      }
                    >
                      <option value="NEW">新建教师（姓名可修改）</option>
                      {preview.analysis!.teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.loginId}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!mapping.teachers[g]?.teacherId && (
                    <label>
                      新教师姓名
                      <input
                        value={mapping.teachers[g]?.createName ?? g}
                        onChange={(e) =>
                          setMapping((m) => ({
                            ...m!,
                            teachers: {
                              ...m!.teachers,
                              [g]: {
                                ...m!.teachers[g],
                                createName: e.target.value,
                                confirmed: m!.teachers[g]?.confirmed ?? false,
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={mapping.teachers[g]?.confirmed ?? false}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m!,
                          teachers: {
                            ...m!.teachers,
                            [g]: { createName: g, ...m!.teachers[g], confirmed: e.target.checked },
                          },
                        }))
                      }
                    />
                    确认该组对应同一位教师
                  </label>
                </div>
              ))}
            </details>
          )}
          <details>
            <summary>班级映射（同名班级需明确选择）</summary>
            {classKeys.map((k) => (
              <label key={k}>
                {JSON.parse(k)[1]}
                <select
                  value={mapping.classes[k] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m!, classes: { ...m!.classes, [k]: e.target.value } }))
                  }
                >
                  <option value="">使用唯一且获授权的同名班级</option>
                  <option value="NEW">明确新建班级</option>
                  {preview.analysis!.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </details>
          <div className="identity-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th>教师组（可拆分重名）</th>
                  <th>班级</th>
                  <th>学号</th>
                  <th>姓名</th>
                </tr>
              </thead>
              <tbody>
                {preview.analysis.plan.slice(page * 30, (page + 1) * 30).map((p) => (
                  <tr key={p.row.row}>
                    <td>{p.row.row}</td>
                    <td>
                      {teacher ? (
                        '本人'
                      ) : (
                        <input
                          aria-label={'第 ' + p.row.row + ' 行教师组'}
                          value={mapping.rowGroups[String(p.row.row)] ?? p.group}
                          onChange={(e) =>
                            setMapping((m) => ({
                              ...m!,
                              rowGroups: { ...m!.rowGroups, [String(p.row.row)]: e.target.value },
                            }))
                          }
                        />
                      )}
                    </td>
                    <td>{p.row.className}</td>
                    <td>{p.row.studentNumber}</td>
                    <td>{p.row.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="identity-inline">
            <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>第 {page + 1} 页</span>
            <button
              disabled={(page + 1) * 30 >= preview.analysis.plan.length}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              apply('map', {
                id: preview.id,
                mapping: { ...mapping, version: preview.mapping.version + 1 },
              })
            }
          >
            保存映射并重新预检
          </button>
          {preview.analysis.errors.slice(0, 50).map((e, i) => (
            <p className="field-error" key={i}>
              第 {e.row} 行 · {e.column}：{e.reason}
            </p>
          ))}
          <button
            className="button"
            disabled={
              busy ||
              preview.analysis.errors.length > 0 ||
              JSON.stringify(mapping) !== JSON.stringify(preview.mapping)
            }
            onClick={() =>
              apply('commit', {
                importBatchId: preview.id,
                fingerprint: preview.fingerprint,
                mappingVersion: preview.mapping.version,
                rosterVersion: preview.rosterVersion,
              })
            }
          >
            确认执行导入
          </button>
        </>
      )}
      {preview?.result && (
        <>
          <p role="status">
            状态：{preview.status} · 已处理 {preview.result.completed}/{preview.result.total} 行。
            {preview.status === 'QUEUED' ? '等待 Worker 执行。' : ''}
          </p>
          {preview.errorCode && (
            <>
              <p role="alert">{preview.errorCode}；已完成的行不会重复建号，需修复冲突后恢复。</p>
              <button disabled={busy} onClick={() => apply('retry', { id: preview.id })}>
                修复后继续执行
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    JSON.stringify(
                      { batchId: preview.id, status: preview.status, result: preview.result },
                      null,
                      2,
                    ),
                  ],
                  { type: 'application/json' },
                ),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = '导入结果报告.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            下载结果报告
          </button>
          {preview.result.credentialBatchId && (
            <CredentialDelivery schoolId={schoolId} batchId={preview.result.credentialBatchId} />
          )}
        </>
      )}
    </section>
  );
}
