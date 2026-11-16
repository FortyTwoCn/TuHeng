'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { identityRequest } from './client';
export function Notifications() {
  const [rows, setRows] = useState<
    { id: string; assignmentId: string; kind: string; title: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    void identityRequest('/api/notifications', undefined, 'STUDENT')
      .then((r) => {
        if (active) setRows(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>作业通知</h2>
      {rows.map((r) => (
        <div className="list-item" key={r.id}>
          <span>
            {r.kind === 'ASSIGNMENT_REMOVED' ? '已从接收人名单移除：' : '收到作业：'}
            {r.kind === 'ASSIGNMENT_REMOVED' ? (
              r.title
            ) : (
              <Link href={'/student/assignments/' + r.assignmentId}>{r.title}</Link>
            )}
          </span>
          <button
            type="button"
            onClick={async () => {
              await identityRequest('/api/notifications', { id: r.id }, 'STUDENT');
              setRows(rows.filter((x) => x.id !== r.id));
            }}
          >
            标记已读
          </button>
        </div>
      ))}
    </section>
  );
}
