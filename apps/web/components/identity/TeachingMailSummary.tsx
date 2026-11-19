'use client';
import { useEffect, useState } from 'react';
import { identityRequest } from './client';

const states = {
  PENDING: '等待投递',
  PROCESSING: '处理中',
  SUBMITTED_TO_SMTP: '已提交至 SMTP',
  FAILED: '确定失败',
  SKIPPED: '已跳过',
  UNCERTAIN: '发送结果不确定',
};
export function TeachingMailSummary() {
  const [counts, setCounts] = useState<Record<string, number>>();
  const [error, setError] = useState(false);
  async function load(signal?: AbortSignal) {
    try {
      const data = await identityRequest(
        '/api/settings/mail?view=teaching-delivery',
        undefined,
        'STAFF',
        signal,
      );
      if (!signal?.aborted) {
        setCounts(data);
        setError(false);
      }
    } catch {
      if (!signal?.aborted) setError(true);
    }
  }
  useEffect(() => {
    const request = new AbortController();
    const start = setTimeout(() => void load(request.signal), 0);
    return () => {
      clearTimeout(start);
      request.abort();
    };
  }, []);
  return (
    <section className="panel profile-panel" aria-labelledby="teaching-mail-title">
      <div className="profile-section-heading">
        <h2 id="teaching-mail-title">教学邮件投递</h2>
        <button type="button" className="button secondary" onClick={() => void load()}>
          刷新投递状态
        </button>
      </div>
      <p className="muted">
        SMTP 接受后，最终送达由收件方邮件系统决定。结果不确定的发送需核对服务器记录。
      </p>
      {error && (
        <p role="alert" className="field-error">
          暂时无法读取投递状态。
        </p>
      )}
      {counts && (
        <dl className="profile-facts">
          {Object.entries(states).map(([state, label]) => (
            <div key={state}>
              <dt>{label}</dt>
              <dd>{counts[state] ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
