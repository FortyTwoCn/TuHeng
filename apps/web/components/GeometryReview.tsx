'use client';
import { useState } from 'react';
import type { GeometryDocument, GradingResult } from '@tuheng/contracts';
import { GeometryEditor } from '@tuheng/geometry-editor';
export function GeometryReview({
  document,
  annotations = [],
  geometryHighlights = [],
}: {
  document: GeometryDocument;
  annotations?: GradingResult['geometryAnnotations'];
  geometryHighlights?: string[][];
}) {
  const [highlighted, setHighlighted] = useState<string[]>([]);
  return (
    <>
      <GeometryEditor
        value={document}
        readOnly
        documentName="作答快照"
        role="teacher"
        highlightedEntityIds={highlighted}
      />
      {annotations.map((annotation, i) => (
        <button
          type="button"
          key={i}
          className="button secondary"
          onClick={() => setHighlighted(geometryHighlights[i] ?? annotation.entityIds)}
        >
          {annotation.explanation}
        </button>
      ))}
    </>
  );
}
