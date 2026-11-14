import type { Tool } from './types';
const tools: [Tool, string][] = [
  ['select', '选择'],
  ['point', '点'],
  ['segment', '实线'],
  ['hidden', '虚线'],
  ['connect', '连接两点'],
  ['line', '辅助线'],
  ['parallel', '平行辅助线'],
  ['perpendicular', '垂直辅助线'],
  ['parallel-hidden', '平行虚线'],
  ['perpendicular-hidden', '垂直虚线'],
  ['circle', '圆'],
  ['arc', '圆弧'],
  ['projection', '投影关联'],
  ['box', '框选'],
  ['pan', '平移'],
  ['pen', '电子笔'],
];

export function ToolPicker({
  tool,
  setTool,
  select,
  report,
}: {
  tool: Tool;
  setTool: (tool: Tool) => void;
  select: (ids: string[]) => void;
  report: (s: string) => void;
}) {
  const primary = new Set<Tool>([
    'select',
    'point',
    'segment',
    'hidden',
    'circle',
    'arc',
    'pen',
    'pan',
  ]);
  const buttons = (items: typeof tools) =>
    items.map(([id, title]) => (
      <button
        type="button"
        key={id}
        aria-pressed={tool === id}
        onClick={() => {
          setTool(id);
          if (id === 'projection') select([]);
          report(
            `${title}工具${id === 'circle' ? '，依次选择圆心和圆周点' : id === 'arc' ? '，依次选择圆心、起点、终点' : id === 'pen' ? '，手指默认平移' : id === 'projection' ? '，依次选择不同视图中的对应点或线段' : ''}`,
          );
        }}
      >
        {title}
      </button>
    ));
  return (
    <>
      <div className="geo-toolbar" role="toolbar" aria-label="常用几何工具">
        {buttons(tools.filter(([id]) => primary.has(id)))}
      </div>
      <details className="geo-more-tools">
        <summary>辅助与关联工具</summary>
        <div className="geo-toolbar" role="toolbar" aria-label="辅助几何工具">
          {buttons(tools.filter(([id]) => !primary.has(id)))}
        </div>
      </details>
    </>
  );
}
