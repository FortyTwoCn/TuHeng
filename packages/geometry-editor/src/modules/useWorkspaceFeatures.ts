import { useMemo } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { useAnimationWorkspace } from './animation/useAnimationWorkspace';
import { useDrawingAudit } from './audit/useDrawingAudit';
import { useSolidPreview } from './solid3d/useSolidPreview';
import { useReferenceDrawing } from './reference/useReferenceDrawing';
import type { WorkspaceLayout } from './useWorkspaceLayout';

export function useWorkspaceFeatures({
  doc,
  layout,
  readOnly,
  selected,
  commit,
  report,
  resetCommand,
  referenceDocument,
  referenceTitle,
}: {
  doc: GeometryDocument;
  layout: WorkspaceLayout;
  readOnly: boolean;
  selected: string[];
  commit: (doc: GeometryDocument, label: string) => GeometryDocument | undefined;
  report: (message: string) => void;
  resetCommand: () => void;
  referenceDocument?: GeometryDocument | null;
  referenceTitle?: string;
}) {
  const revision = useMemo(
    () => JSON.stringify({ ...doc, constructionAnimation: undefined }),
    [doc],
  );
  const animation = useAnimationWorkspace({
    doc,
    enabled: layout.playback,
    readOnly,
    commit,
    report,
    opened() {
      resetCommand();
      if (layout.mode !== 'teaching') layout.changeMode('teaching');
      layout.setAuthoring(false);
      layout.showNarrationPane();
    },
  });
  const audit = useDrawingAudit(
    doc,
    revision,
    layout.showAudit,
    layout.showAudit || layout.showSolid,
  );
  const solid = useSolidPreview(doc, revision, layout.showSolid, selected);
  const reference = useReferenceDrawing(referenceDocument, referenceTitle);

  return {
    animation,
    audit,
    solid,
    reference,
    resetTeachingInteraction() {
      resetCommand();
      animation.playback.stop();
      animation.playback.jump(animation.playback.index);
    },
    switchAnimationMode(mode: 'play' | 'author') {
      if (mode === 'author' && readOnly) return;
      resetCommand();
      animation.playback.stop();
      animation.playback.jump(animation.playback.index);
      layout.setAuthoring(mode === 'author');
    },
    generateSolid() {
      if (!layout.solidEnabled || !audit.report?.canReconstruct3D) return;
      if (layout.mode !== 'teaching') {
        resetCommand();
        layout.changeMode('teaching');
        animation.playback.stop();
        animation.playback.jump(animation.animation.steps.length - 1);
      }
      layout.showSolidPane();
      solid.generate();
    },
    resetAfterLoad() {
      animation.resetAfterLoad();
      solid.setEntityHover(undefined);
    },
  };
}
