import { useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { ReferenceDrawingModule } from './reference/ReferenceDrawingModule';
import { WorkspaceDivider, useWorkspaceSplit } from './WorkspaceDivider';
import { useWorkspaceFloatingWindow } from './useWorkspaceFloatingWindow';
import type { WorkspaceLayout, WorkspacePane } from './useWorkspaceLayout';

const panes: [WorkspacePane, string][] = [
  ['sheet', '图纸'],
  ['narration', '讲解'],
  ['timeline', '步骤条'],
  ['solid', '立体'],
  ['audit', '审核'],
  ['reference', '参考图'],
];

// 外围模块共用布局状态。窄屏把各工作面切为标签，主画布节点持续挂载。
export function EditorWorkspaceShell({
  layout,
  narration,
  timeline,
  audit,
  solid,
  reference,
  children,
}: {
  layout: WorkspaceLayout;
  narration?: ReactNode;
  timeline?: ReactNode;
  audit?: ReactNode;
  solid?: ReactNode;
  reference: Pick<
    ComponentProps<typeof ReferenceDrawingModule>,
    'entry' | 'loading' | 'error' | 'load' | 'copy' | 'copyDisabled' | 'close'
  >;
  children: ReactNode;
}) {
  const sheetSplit = useWorkspaceSplit(56, 36, 68);
  const referenceSplit = useWorkspaceSplit(30, 24, 47);
  const content = useRef<HTMLDivElement>(null);
  const floating = useWorkspaceFloatingWindow(content, layout.reference.placement === 'floating');
  const toggles = [
    { key: 'narration', title: '步骤讲解', enabled: layout.canNarrate, open: layout.showNarration },
    {
      key: 'timeline',
      title: '步骤条',
      enabled: layout.canShowTimeline && !layout.authoring,
      open: layout.showTimeline,
    },
    { key: 'solid', title: '立体图 3D', enabled: layout.canShowSolid, open: layout.showSolid },
  ] as const;
  const style = {
    '--geo-split': `${sheetSplit.value}fr`,
    '--geo-split-solid': `${100 - sheetSplit.value}fr`,
    '--geo-split-main': `${100 - referenceSplit.value}fr`,
    '--geo-split-reference': `${referenceSplit.value}fr`,
  } as CSSProperties;
  return (
    <div
      className="geo-workspace-shell"
      data-pane={layout.pane}
      data-reference-docked={layout.docked}
      style={style}
    >
      {panes.some(([id]) => id !== 'sheet' && layout.available[id]) && (
        <div className="geo-workspace-tabs geo-teaching-tabs" role="group" aria-label="工作区视图">
          {panes
            .filter(([id]) => layout.available[id])
            .map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={layout.pane === id}
                onClick={() => layout.setPane(id)}
              >
                {label}
              </button>
            ))}
        </div>
      )}
      {toggles.some(({ enabled }) => enabled) && (
        <div
          className="geo-workspace-module-toggles geo-teaching-tabs"
          role="group"
          aria-label="讲解模块"
        >
          {toggles
            .filter(({ enabled }) => enabled)
            .map(({ key, title, open }) => (
              <button
                type="button"
                key={key}
                aria-pressed={open}
                aria-label={(open ? '收起' : '展开') + title}
                onClick={() => layout.toggleModule(key)}
              >
                {title}
              </button>
            ))}
        </div>
      )}
      <div ref={content} className="geo-workspace-content">
        <div
          className="geo-teaching-layout"
          data-has-sidebar={!!(audit || narration)}
          data-has-solid={!!solid}
        >
          {(audit || narration) && <div className="geo-teaching-sidebar">{audit || narration}</div>}
          <div className="geo-teaching-sheet" data-has-timeline={!!timeline}>
            {children}
            {timeline}
          </div>
          {solid && (
            <>
              <WorkspaceDivider split={sheetSplit} label="调整二维与三维分屏宽度" />
              {solid}
            </>
          )}
        </div>
        {layout.docked && (
          <WorkspaceDivider split={referenceSplit} label="调整参考图纸分屏宽度" reverse />
        )}
        {layout.canReference && layout.reference.visibility !== 'closed' && (
          <ReferenceDrawingModule
            {...reference}
            {...floating}
            placement={layout.reference.placement}
            minimized={layout.reference.visibility === 'minimized'}
            place={layout.placeReference}
            minimize={layout.minimizeReference}
          />
        )}
        {layout.canReference && layout.reference.visibility === 'minimized' && (
          <button type="button" className="geo-reference-chip" onClick={layout.openReference}>
            参考图纸 · 点击展开
          </button>
        )}
      </div>
    </div>
  );
}
