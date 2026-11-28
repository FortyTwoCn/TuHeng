import type { ComponentProps } from 'react';
import type { GeometryDocument } from '@tuheng/contracts';
import { orthographic, targetCapabilities, targetFromKey } from '@tuheng/geometry-core';
import { Viewport } from './Viewport';
import { DrawingRail, ModifyRail } from './workspace-rails';
import { EditorWorkspaceShell } from './modules/EditorWorkspaceShell';
import { AnimationNarrationModule } from './modules/animation/AnimationNarrationModule';
import { AnimationTimelineModule } from './modules/animation/AnimationTimelineModule';
import { DrawingAuditModule } from './modules/audit/DrawingAuditModule';
import { SolidPreviewModule } from './modules/solid3d/SolidPreviewModule';
import type { useEditorCommands } from './useEditorCommands';
import type { WorkspaceLayout } from './modules/useWorkspaceLayout';
import type { useWorkspaceFeatures } from './modules/useWorkspaceFeatures';

export function EditorWorkspaceBody({
  viewport,
  commands,
  layout,
  features,
  readOnly,
  loadReference,
  copyReference,
}: {
  viewport: ComponentProps<typeof Viewport>;
  commands: ReturnType<typeof useEditorCommands>;
  layout: WorkspaceLayout;
  features: ReturnType<typeof useWorkspaceFeatures>;
  readOnly: boolean;
  loadReference: () => void;
  copyReference: (doc: GeometryDocument, ids: string[]) => void;
}) {
  const { animation, audit, solid, reference } = features;
  const { document, role, selected } = viewport;
  const { railProps, deleteSelection, startCad } = commands;
  const toolsVisible = layout.mode === 'drafting' || layout.authoring;
  return (
    <div
      className="geo-workspace-body"
      data-hide-rails={!toolsVisible}
      data-workspace-pane={layout.pane}
    >
      {toolsVisible && <DrawingRail {...railProps} />}
      <div className="geo-views">
        <EditorWorkspaceShell
          layout={layout}
          narration={
            layout.showNarration && (
              <AnimationNarrationModule
                animation={animation.animation}
                authored={!!document.constructionAnimation}
                mode={layout.authoring ? 'author' : 'play'}
                switchMode={features.switchAnimationMode}
                playback={animation.playback}
                files={animation.files}
                readOnly={readOnly}
                selected={selected.filter((id) => targetFromKey(id).kind === 'entity')}
                save={animation.save}
                generate={animation.generate}
                reset={animation.reset}
              />
            )
          }
          timeline={
            layout.showTimeline && (
              <AnimationTimelineModule
                animation={animation.animation}
                index={animation.playback.index}
                jump={animation.playback.jump}
              />
            )
          }
          audit={
            layout.showAudit &&
            audit.report && (
              <DrawingAuditModule
                report={audit.report}
                selected={audit.selected}
                select={(id) => {
                  audit.select(id);
                  layout.setPane('sheet');
                }}
                generate={layout.solidEnabled ? features.generateSolid : undefined}
              />
            )
          }
          solid={
            layout.showSolid && (
              <SolidPreviewModule
                solid={solid.solid}
                build={solid.build}
                generate={features.generateSolid}
                available={!!audit.report?.canReconstruct3D}
                review={layout.canAudit ? () => layout.openAudit(true) : undefined}
                reason={
                  orthographic(document)
                    ? '请补齐有效的正交投影视图后生成三维模型。'
                    : '三维重建需要至少两张正交投影视图。'
                }
                link={solid.link}
                setLink={solid.setLink}
                linkedIds={solid.linked3D}
                linkedFace={solid.linkedFace}
                select={solid.selectFace}
                hover={solid.setFaceHover}
              />
            )
          }
          reference={{
            ...reference,
            load: loadReference,
            copy: copyReference,
            copyDisabled: readOnly
              ? '主画框为只读图纸'
              : layout.editingLocked
                ? '请切回作图模式后复制'
                : undefined,
            close: () => {
              reference.clear();
              layout.closeReference();
            },
          }}
        >
          <Viewport {...viewport} />
        </EditorWorkspaceShell>
      </div>
      {toolsVisible && (
        <ModifyRail
          {...railProps}
          erase={() => (selected.length ? deleteSelection() : startCad('erase'))}
          canErase={
            !readOnly &&
            selected.every(
              (id) => targetCapabilities(document, targetFromKey(id), role, readOnly).deletable,
            )
          }
        />
      )}
    </div>
  );
}
