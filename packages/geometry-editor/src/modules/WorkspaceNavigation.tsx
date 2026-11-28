import type { WorkspaceLayout, WorkspacePane } from './useWorkspaceLayout';

const panes: [WorkspacePane, string][] = [
  ['sheet', '图纸'],
  ['narration', '讲解'],
  ['timeline', '步骤条'],
  ['solid', '立体'],
  ['audit', '审核'],
  ['reference', '参考图'],
];

export function WorkspacePaneTabs({ layout }: { layout: WorkspaceLayout }) {
  const available = panes.filter(([id]) => layout.available[id]);
  if (available.length < 2) return null;
  return (
    <div className="geo-workspace-tabs" role="group" aria-label="工作区视图">
      {available.map(([id, label]) => (
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
  );
}

export function WorkspaceModuleToggles({ layout }: { layout: WorkspaceLayout }) {
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
  const available = toggles.filter(({ enabled }) => enabled);
  if (!available.length) return null;
  return (
    <div className="geo-workspace-module-toggles" role="group" aria-label="讲解模块">
      {available.map(({ key, title, open }) => (
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
  );
}
