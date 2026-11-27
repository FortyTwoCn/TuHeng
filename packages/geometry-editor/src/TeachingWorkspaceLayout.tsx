import { useState, type CSSProperties, type ReactNode } from 'react';
import { ConstructionPanelWorkspace, ConstructionTimeline } from './ConstructionPanelWorkspace';
import { DrawingAuditPanel } from './DrawingAuditPanel';
import { SolidPreview } from './SolidPreview';
import type { useTeachingWorkspace } from './useTeachingWorkspace';

export function TeachingWorkspaceLayout({
  workspace,
  readOnly,
  selected,
  hasAnimation,
  children,
}: {
  workspace: ReturnType<typeof useTeachingWorkspace>;
  readOnly: boolean;
  selected: string[];
  hasAnimation: boolean;
  children: ReactNode;
}) {
  const [split, setSplit] = useState(56);
  const { animation, animationMode, isPlayback, formMode, audit, solid, showSolid, playback } =
    workspace;
  const hasSidebar = !!audit || !!animationMode;
  const enabled = hasSidebar || showSolid;
  return (
    <div
      className={enabled ? 'geo-teaching-layout' : 'geo-teaching-inactive'}
      data-has-sidebar={hasSidebar}
      data-has-solid={showSolid}
      data-mobile-pane={workspace.mobilePane}
      style={
        { '--geo-split': split + 'fr', '--geo-split-solid': 100 - split + 'fr' } as CSSProperties
      }
    >
      {hasSidebar && (
        <div className="geo-teaching-sidebar">
          {audit ? (
            <DrawingAuditPanel
              report={audit}
              selected={workspace.selectedIssue}
              select={workspace.selectIssue}
              generate={workspace.generateSolid}
            />
          ) : (
            <ConstructionPanelWorkspace
              animation={animation}
              authored={hasAnimation}
              mode={formMode ? 'author' : 'play'}
              switchMode={workspace.changeAnimationMode}
              playback={playback}
              files={workspace.files}
              readOnly={readOnly}
              selected={selected}
              save={workspace.save}
              generate={workspace.generate}
              reset={workspace.reset}
            />
          )}
        </div>
      )}
      {showSolid && (
        <div className="geo-view-switch geo-teaching-tabs" role="group" aria-label="二维与三维视图">
          <button
            type="button"
            aria-pressed={workspace.mobilePane === 'sheet'}
            onClick={() => workspace.setMobilePane('sheet')}
          >
            图纸
          </button>
          <button
            type="button"
            aria-pressed={workspace.mobilePane === 'solid'}
            onClick={() => workspace.setMobilePane('solid')}
          >
            立体
          </button>
        </div>
      )}
      <div className="geo-teaching-sheet">
        {children}
        {isPlayback && (
          <ConstructionTimeline animation={animation} index={playback.index} jump={playback.jump} />
        )}
      </div>
      {showSolid && (
        <>
          <div
            className="geo-solid-split"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="调整二维与三维分屏宽度"
            aria-valuemin={36}
            aria-valuemax={68}
            aria-valuenow={split}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const sheet = event.currentTarget.previousElementSibling?.getBoundingClientRect();
              const solid = event.currentTarget.nextElementSibling?.getBoundingClientRect();
              if (sheet && solid)
                setSplit(
                  Math.round(
                    Math.min(
                      68,
                      Math.max(
                        36,
                        ((event.clientX - sheet.left) * 100) / (solid.right - sheet.left),
                      ),
                    ),
                  ),
                );
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              setSplit((value) =>
                Math.min(68, Math.max(36, value + (event.key === 'ArrowLeft' ? -2 : 2))),
              );
            }}
          />
          <SolidPreview
            solid={solid}
            build={workspace.build}
            generate={workspace.generateSolid}
            link={workspace.link}
            setLink={workspace.setLink}
            linkedIds={workspace.linked3D}
            linkedFace={workspace.linkedFace}
            select={workspace.selectFace}
            hover={workspace.setFaceHover}
          />
        </>
      )}
    </div>
  );
}
