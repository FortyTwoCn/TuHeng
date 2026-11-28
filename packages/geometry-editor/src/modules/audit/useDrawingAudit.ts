import { useMemo, useState } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { auditDrawing } from '@tuheng/geometry-core';

export function useDrawingAudit(
  doc: GeometryDocument,
  revision: string,
  open: boolean,
  needed: boolean,
) {
  const [issue, setIssue] = useState<{ revision: string; id: string }>();
  const report = useMemo(() => (needed ? auditDrawing(doc) : undefined), [doc, needed]);
  return {
    report,
    selected:
      open && issue?.revision === revision
        ? report?.checks.find(({ id }) => id === issue.id)
        : undefined,
    select: (id: string) => setIssue({ revision, id }),
  };
}
