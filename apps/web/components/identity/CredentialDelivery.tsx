'use client';
import { useEffect, useState } from 'react';
import { identityRequest } from './client';
import { Reauthentication } from './Reauthentication';
export function CredentialDelivery({
  schoolId,
  batchId,
  siteAdmin = false,
}: {
  schoolId: string;
  batchId?: string;
  siteAdmin?: boolean;
}) {
  const [batches, setBatches] = useState<
      { id: string; expiresAt: string; createdAt: string; _count: { items: number } }[]
    >([]),
    [proof, setProof] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (schoolId)
      identityRequest('/api/organization/deliveries?schoolId=' + encodeURIComponent(schoolId))
        .then(setBatches)
        .catch((e) => setMessage(e.message));
  }, [schoolId, batchId]);
  async function download(id: string, kind: 'TEACHER' | 'STUDENT' | 'SCHOOL_ADMIN') {
    setBusy(true);
    setMessage('');
    try {
      const ticket = await identityRequest(
        '/api/credentials',
        { operation: 'prepare', batchId: id, kind, proof },
        'STAFF',
      );
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tuheng-realm': 'STAFF' },
        body: JSON.stringify({ token: ticket.token }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(
          body.error === 'NO_AVAILABLE_INITIAL_CREDENTIALS'
            ? '本类账号没有仍可交付的初始凭据（可能已改密、过期或未创建）。'
            : body.error,
        );
      }
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download =
        kind === 'STUDENT'
          ? '学生初始凭据.xlsx'
          : kind === 'TEACHER'
            ? '教师初始凭据.xlsx'
            : '学校管理初始凭据.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已下载。文件含敏感初始凭据，请安全交付；服务端过期无法撤回本地副本。');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="identity-panel">
      <h2>初始凭据交付</h2>
      <p>
        导出窗口 24 小时；临时密码 7
        天有效。用户改密或再次重置后，旧凭据立即失效。普通名单不包含密码。
      </p>
      <Reauthentication onProof={setProof} />
      <p role="status">{message}</p>
      {!batches.length && <p>暂无凭据交付批次。</p>}
      {batches.map((b) => (
        <article key={b.id} className="identity-panel">
          <p>
            {new Date(b.createdAt).toLocaleString()} · {b._count.items} 个账号
          </p>
          <p>导出截止：{new Date(b.expiresAt).toLocaleString()}</p>
          <div className="identity-inline">
            <button
              disabled={!proof || busy || new Date(b.expiresAt) <= new Date()}
              onClick={() => download(b.id, 'TEACHER')}
            >
              下载教师初始凭据
            </button>
            <button
              disabled={!proof || busy || new Date(b.expiresAt) <= new Date()}
              onClick={() => download(b.id, 'STUDENT')}
            >
              下载学生初始凭据
            </button>
            {siteAdmin && (
              <button disabled={!proof || busy} onClick={() => download(b.id, 'SCHOOL_ADMIN')}>
                学校管理账号交付
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
