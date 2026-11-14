'use client';
import { useState } from 'react';
import type { GeometryDocument, GradingResult } from '@tuheng/contracts';
import { GeometryEditor } from '@tuheng/geometry-editor';
export function GeometryReview({
  document,
  annotations = [],
}: {
  document: GeometryDocument;
  annotations?: GradingResult['geometryAnnotations'];
}) {
  const [highlighted, setHighlighted] = useState<string[]>([]);
  return (
    <>
      <GeometryEditor value={document} readOnly role="teacher" highlightedEntityIds={highlighted} />
      {annotations.map((annotation, i) => (
        <button
          type="button"
          key={i}
          className="button secondary"
          onClick={() => setHighlighted(annotation.entityIds)}
        >
          {annotation.explanation}
        </button>
      ))}
    </>
  );
}
