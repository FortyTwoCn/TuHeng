import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Axis3D,
  Circle,
  CircleDot,
  Copy,
  Crosshair,
  Diameter,
  Dot,
  DraftingCompass,
  Eraser,
  FlipHorizontal,
  Frame,
  Hand,
  Hash,
  Layers2,
  MousePointer2,
  Move,
  MoveDiagonal,
  MoveHorizontal,
  PenLine,
  Pentagon,
  Radius,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Ruler,
  ScanLine,
  Scissors,
  Slash,
  Spline,
  SquareDashed,
  Tangent,
  TriangleRight,
  Type,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';
import type { GeometryDocument } from '@tuheng/contracts';
import type { KeyboardEvent } from 'react';
import { CAD_COMMANDS, type PenStrokeStyle } from '@tuheng/geometry-core';
import { commandRegistry, commandUnavailable, type CommandId } from './commands';
import { EditorPopover } from './EditorPopover';
import type { CadId } from './useCadCommand';

type RailId = CommandId | CadId;
export interface RailControls {
  active: string;
  editorType: GeometryDocument['editorType'];
  readOnly: boolean;
  run: (id: CommandId) => void;
  start: (id: CadId) => void;
  selectionMode: 'replace' | 'add' | 'remove';
  setSelectionMode: (mode: RailControls['selectionMode']) => void;
  penStyle: PenStrokeStyle;
  setPenStyle: (value: PenStrokeStyle) => void;
}

// Use the actual boundary shape for tools whose drawing differs by a single geometric detail.
const arcIcon = createLucideIcon('CadArc', [
  ['path', { key: 'contour', d: 'M3 20A16 16 0 0 1 19 4' }],
]);
const ellipseIcon = createLucideIcon('CadEllipse', [
  [
    'ellipse',
    { key: 'contour', cx: '12', cy: '12', rx: '9', ry: '5.5', transform: 'rotate(-24 12 12)' },
  ],
]);
const chamferIcon = createLucideIcon('CadChamfer', [
  ['path', { key: 'contour', d: 'M3 19V10L9 4H21' }],
]);
const filletIcon = createLucideIcon('CadFillet', [
  ['path', { key: 'contour', d: 'M3 19V13A9 9 0 0 1 12 4H21' }],
]);
const hatchIcon = createLucideIcon('CadHatch', [
  ['path', { key: 'contour', d: 'M3 5H21V19H3ZM3 11L9 5M4 19L18 5M13 19L21 11' }],
]);
const icons: Record<RailId, LucideIcon> = {
  select: MousePointer2,
  pan: Hand,
  box: SquareDashed,
  point: Dot,
  segment: Slash,
  line: MoveDiagonal,
  rectangle: RectangleHorizontal,
  circle: Circle,
  arc: arcIcon,
  arc3: Tangent,
  ellipse: ellipseIcon,
  spline: Spline,
  polygon: Pentagon,
  text: Type,
  direction: ArrowRight,
  leftDirection: RotateCcw,
  rightDirection: RotateCw,
  pen: PenLine,
  compass: DraftingCompass,
  linearDimension: MoveHorizontal,
  alignedDimension: Ruler,
  angularDimension: TriangleRight,
  radiusDimension: Radius,
  diameterDimension: Diameter,
  datum: Frame,
  roughness: Tangent,
  toleranceFrame: RectangleHorizontal,
  toleranceText: Type,
  move: Move,
  copy: Copy,
  rotate: RotateCw,
  mirror: FlipHorizontal,
  trim: Scissors,
  extend: ArrowUpRight,
  chamfer: chamferIcon,
  fillet: filletIcon,
  hatch: hatchIcon,
  erase: Eraser,
  clear: Eraser,
  connect: CircleDot,
  projection: Layers2,
  'construct-parallel': ScanLine,
  'construct-perpendicular': Axis3D,
  'relation-parallel': ScanLine,
  'relation-perpendicular': Axis3D,
  'new-axis': Crosshair,
};
const shortNames: Partial<Record<RailId, string>> = {
  segment: '直线',
  arc3: '三点弧',
  spline: '样条',
  polygon: '多边形',
  line: '辅助线',
  linearDimension: '线性',
  alignedDimension: '对齐',
  angularDimension: '角度',
  radiusDimension: '半径',
  diameterDimension: '直径',
  copy: '复制',
  fillet: '圆角',
  toleranceFrame: '形位公差',
  datum: '基准',
  roughness: '粗糙度',
  clear: '清空',
  box: '框选',
};
const names = new Map<string, string>(CAD_COMMANDS.map((c) => [c.id, c.name]));
for (const c of commandRegistry) names.set(c.id, c.name);
names.set('segment', '直线');

function ToolButton({
  id,
  controls,
  fullName = false,
}: {
  id: RailId;
  controls: RailControls;
  fullName?: boolean;
}) {
  const definition = commandRegistry.find((c) => c.id === id);
  const reason = definition
    ? commandUnavailable(definition, controls.readOnly, controls.editorType)
    : controls.readOnly
      ? '当前图纸只读'
      : undefined;
  const Icon = icons[id];
  const name = names.get(id)!;
  return (
    <button
      type="button"
      className="cad-tool"
      data-command={id}
      data-cad-id={id}
      disabled={!!reason}
      title={reason ?? name}
      aria-label={name}
      aria-pressed={controls.active === id}
      onClick={() => (definition ? controls.run(definition.id) : controls.start(id as CadId))}
    >
      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
      <span>{fullName ? name : (shortNames[id] ?? name)}</span>
    </button>
  );
}

function ToolList({
  ids,
  controls,
  fullName,
}: {
  ids: readonly RailId[];
  controls: RailControls;
  fullName?: boolean;
}) {
  return (
    <div className="cad-tool-grid">
      {ids.map((id) => (
        <ToolButton key={id} id={id} controls={controls} fullName={fullName} />
      ))}
    </div>
  );
}

const sketch: RailId[] = [
  'segment',
  'rectangle',
  'arc',
  'circle',
  'ellipse',
  'spline',
  'polygon',
  'point',
  'text',
  'direction',
  'pen',
];
const dimensions: RailId[] = [
  'linearDimension',
  'alignedDimension',
  'angularDimension',
  'radiusDimension',
  'diameterDimension',
];
const construction: RailId[] = [
  'line',
  'construct-parallel',
  'construct-perpendicular',
  'new-axis',
];
const symbols: RailId[] = [
  'datum',
  'roughness',
  'toleranceFrame',
  'toleranceText',
];
const transforms: RailId[] = ['move', 'copy', 'rotate', 'mirror'];
const editing: RailId[] = ['trim', 'extend', 'chamfer', 'fillet', 'hatch'];
const relations: RailId[] = [
  'connect',
  'relation-parallel',
  'relation-perpendicular',
  'projection',
];
function PenChoices({ controls }: { controls: RailControls }) {
  const styles = [
    ['visible', '实线笔迹'],
    ['hidden', '虚线笔迹'],
    ['construction', '辅助线笔迹'],
  ] as const;
  return (
    <div className="cad-choice-list">
      {styles.map(([style, label]) => (
        <button
          key={style}
          type="button"
          disabled={controls.readOnly}
          data-command={'pen-' + style}
          aria-pressed={controls.penStyle === style && controls.active === 'pen'}
          onClick={() => {
            controls.setPenStyle(style);
            controls.run('pen');
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function SelectionChoices({ controls }: { controls: RailControls }) {
  const modes = [
    ['replace', '替换选集'],
    ['add', '加选'],
    ['remove', '减选'],
  ] as const;
  return (
    <div className="cad-choice-list">
      {modes.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          data-command={'selection-' + mode}
          aria-pressed={controls.selectionMode === mode}
          onClick={() => {
            controls.setSelectionMode(mode);
            controls.run('select');
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function ToolGroup({
  label,
  ids,
  controls,
  icon: Icon,
}: {
  label: string;
  ids: RailId[];
  controls: RailControls;
  icon: LucideIcon;
}) {
  return (
    <EditorPopover
      label={label}
      trigger={
        <>
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
        </>
      }
      buttonClass="cad-rail-more"
    >
      <ToolList ids={ids} controls={controls} fullName />
    </EditorPopover>
  );
}
function navigateRail(e: KeyboardEvent<HTMLElement>) {
  if (
    e.defaultPrevented ||
    !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) ||
    !(e.target instanceof HTMLButtonElement) ||
    !e.currentTarget.contains(e.target)
  )
    return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const index = buttons.indexOf(e.target);
  if (index < 0) return;
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? buttons.length - 1
        : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  e.preventDefault();
  buttons[next].focus();
}

function FamilyTool({ label, ids, controls }: { label:string; ids:CadId[]; controls:RailControls }) {
  const [chosen,setChosen]=useState(ids[0]);
  return <div className="cad-family-tool">
    <ToolButton id={chosen} controls={controls} />
    <EditorPopover label={label} trigger={<span>{label}</span>} buttonClass="cad-rail-more cad-family-more">
      <ToolList ids={ids} controls={{...controls,start:id=>{setChosen(id);controls.start(id);}}} fullName/>
    </EditorPopover>
  </div>;
}

export function DrawingRail(controls: RailControls) {
  return (
    <aside
      className="cad-rail cad-drawing-rail"
      aria-label="绘图与标注工具"
      onKeyDown={navigateRail}
    >
      <div className="cad-rail-desktop">
        <h3>选择</h3>
        <ToolList ids={['select']} controls={controls} />
        <EditorPopover
          label="选择方式"
          trigger={
            <>
              <MousePointer2 size={16} aria-hidden="true" />
              <span>选集</span>
            </>
          }
          buttonClass="cad-rail-more"
        >
          <ToolList ids={['pan', 'box']} controls={controls} fullName />
          <SelectionChoices controls={controls} />
        </EditorPopover>
        <h3>绘图</h3>
        <div className="cad-tool-grid">
          {sketch.map(id=>id==='arc'
            ? <FamilyTool key={id} label="圆弧工具" ids={['arc','arc3']} controls={controls}/>
            : id==='direction'
              ? <FamilyTool key={id} label="向视符号" ids={['direction','leftDirection','rightDirection']} controls={controls}/>
              : <ToolButton key={id} id={id} controls={controls}/>)}
        </div>
        <ToolGroup label="构造" icon={DraftingCompass} ids={construction} controls={controls} />
        <EditorPopover
          label="电子笔线型"
          trigger={
            <>
              <PenLine size={16} aria-hidden="true" />
              <span>笔迹线型</span>
            </>
          }
          buttonClass="cad-rail-more"
        >
          <PenChoices controls={controls} />
        </EditorPopover>
        <h3>标注</h3>
        <ToolList ids={dimensions} controls={controls} />
        <ToolGroup label="工程符号" icon={Hash} ids={symbols} controls={controls} />
      </div>
    </aside>
  );
}
export function ModifyRail(props: RailControls & { erase: () => void; canErase: boolean }) {
  const remove = (
    <button
      type="button"
      className="cad-tool cad-tool-erase"
      aria-label="删除选中对象"
      data-command="erase"
      aria-pressed={props.active === 'erase'}
      title="删除选中对象"
      disabled={props.readOnly || !props.canErase}
      onClick={props.erase}
    >
      <Eraser size={18} aria-hidden="true" />
      <span>删除</span>
    </button>
  );
  return (
    <aside className="cad-rail cad-modify-rail" aria-label="修改工具" onKeyDown={navigateRail}>
      <div className="cad-rail-desktop">
        <h3>变换</h3>
        <ToolList ids={transforms} controls={props} />
        <h3>编辑</h3>
        <div className="cad-tool-grid">
          {editing.map((id) => (
            <ToolButton key={id} id={id} controls={props} />
          ))}
          {remove}
          <ToolButton id="compass" controls={props} />
        </div>
        <ToolGroup label="关系" icon={Layers2} ids={relations} controls={props} />
      </div>
    </aside>
  );
}
