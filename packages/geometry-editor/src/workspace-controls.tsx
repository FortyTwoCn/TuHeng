import { useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Check,
  CornerDownLeft,
  CornerUpLeft,
  Crosshair,
  FileJson,
  FileText,
  Eraser,
  Focus,
  FolderOpen,
  Grid2X2,
  Grid3X3,
  Image,
  Magnet,
  Maximize2,
  Minimize2,
  Moon,
  MoveUpRight,
  Package,
  Redo2,
  Ruler,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Square,
  Sun,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { CAD_COMMANDS, cadPrompt, type ObjectSnapType } from '@tuheng/geometry-core';
import { ObjectSnapChoices } from './CadPreferences';
import { EditorPopover } from './EditorPopover';
import type { CadController, CadId } from './useCadCommand';
export { DrawingRail, ModifyRail, type RailControls } from './workspace-rails';

interface TopbarProps {
  title: string;
  styleControls: ReactNode;
  sheetControl: ReactNode;
  expanded: boolean;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  standalone: boolean;
  startCad: (id: CadId) => void;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  operations: { label: string; applied: boolean }[];
  jumpHistory: (direction: 'undo' | 'redo', count: number) => void;
  undo: () => void;
  redo: () => void;
  fit: () => void;
  toggleExpanded: () => void;
  openSettings: () => void;
  fileActions: Record<
    'importJson' | 'json' | 'svg' | 'png' | 'viewPng' | 'zip' | 'narrative' | 'inspect',
    () => void
  >;
}
function Action({
  label,
  icon: Icon,
  onClick,
  disabled,
  className = '',
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`cad-action ${className}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
export function WorkspaceTopbar(p: TopbarProps) {
  return (
    <header className="cad-topbar" aria-label="图纸与绘图设置">
      <div className="cad-sheet-control">
        <DraftIcon />
        {p.sheetControl ?? <strong>{p.title}</strong>}
      </div>
      <div className="cad-history-actions" aria-label="历史">
        <Action label="撤销" icon={Undo2} disabled={p.readOnly || !p.canUndo} onClick={p.undo} />
        <Action label="恢复" icon={Redo2} disabled={p.readOnly || !p.canRedo} onClick={p.redo} />
        {!p.readOnly && (p.canUndo || p.canRedo) && <EditorPopover
          label="撤销与恢复历史"
          buttonClass="cad-action cad-history-more"
          panelClass="cad-history-menu"
          trigger={<CornerUpLeft size={15} aria-hidden="true" />}
        >
          {p.operations.filter(item => item.applied).reverse().map((item, index) =>
            <button key={'undo-' + index} type="button" onClick={() => p.jumpHistory('undo', index+1)}>
              撤销 {index+1} 步 · {item.label}
            </button>)}
          {p.operations.filter(item => !item.applied).map((item, index) =>
            <button key={'redo-' + index} type="button" onClick={() => p.jumpHistory('redo', index+1)}>
              恢复 {index+1} 步 · {item.label}
            </button>)}
        </EditorPopover>}
        <Action
          label="清空可编辑图形"
          icon={Eraser}
          disabled={p.readOnly}
          onClick={() => p.startCad('clear')}
        />
      </div>
      <div className="cad-top-styles" aria-label="当前绘图样式">
        {p.styleControls}
      </div>
      <div className="cad-view-actions">
        <Action label="完整展开图" icon={Focus} onClick={p.fit} />
        <EditorPopover
          label="文件"
          buttonClass="cad-action cad-file-trigger"
          trigger={
            <>
              <FolderOpen size={17} />
              <span>文件</span>
            </>
          }
        >
          <Action
            label="打开 JSON 或图纸包 ZIP"
            icon={Upload}
            onClick={p.fileActions.importJson}
            disabled={p.readOnly}
          />
          <Action label="导出 JSON" icon={FileJson} onClick={p.fileActions.json} />
          <Action label="导出展开图 SVG" icon={ScanLine} onClick={p.fileActions.svg} />
          <Action label="下载预览 PNG" icon={Image} onClick={p.fileActions.png} />
          <Action label="下载当前视图 PNG" icon={Image} onClick={p.fileActions.viewPng} />
          <Action label="下载图纸包 ZIP" icon={Package} onClick={p.fileActions.zip} />
          <Action label="导出关系描述" icon={FileText} onClick={p.fileActions.narrative} />
          <Action label="查看文档" icon={FileJson} onClick={p.fileActions.inspect} />
        </EditorPopover>
        <Action label={p.fullscreen ? '退出全屏' : '全屏'}
          icon={p.fullscreen ? Minimize2 : Maximize2} onClick={p.toggleFullscreen} />
        {!p.standalone && (
          <Action
            label={p.expanded ? '退出展开' : '展开编辑'}
            icon={p.expanded ? Minimize2 : Maximize2}
            onClick={p.toggleExpanded}
          />
        )}
      </div>
    </header>
  );
}
function DraftIcon() {
  return (
    <span className="cad-sheet-mark" aria-hidden="true">
      <Ruler size={19} strokeWidth={2} />
    </span>
  );
}
interface StatusProps {
  cad: CadController;
  viewName: string;
  toolName: string;
  message: string;
  entityCount: number;
  selectionCount: number;
  snapping: boolean;
  toggleSnap: () => void;
  objectTypes: readonly ObjectSnapType[];
  changeObjectTypes: (types: ObjectSnapType[]) => void;
  orthogonal: boolean;
  toggleOrthogonal: () => void;
  grid: boolean;
  toggleGrid: () => void;
  gridSnap: boolean;
  toggleGridSnap: () => void;
  tracking: boolean;
  toggleTracking: () => void;
  openSettings: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  cursorStatusRef: RefObject<HTMLOutputElement | null>;
}
function Toggle({
  label,
  caption,
  icon: Icon,
  pressed,
  onClick,
  shortcut,
}: {
  label: string;
  caption: string;
  icon: LucideIcon;
  pressed: boolean;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className="cad-mode-toggle"
      aria-pressed={pressed}
      aria-label={label}
      title={shortcut ? `${label}（${shortcut}）` : label}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{caption}</span>
    </button>
  );
}
function Parameters({ cad, viewName }: { cad: CadController; viewName: string }) {
  const [input, setInput] = useState('');
  const session = cad.session;
  const command = CAD_COMMANDS.find((c) => c.id === session?.commandId);
  if (!session || !command) return null;
  const submitCoordinate = () => {
    if (!input.trim()) return;
    cad.send({ type: 'input', value: input });
    setInput('');
  };
  return (
    <EditorPopover
      label="精确输入与参数"
      buttonClass="cad-action cad-parameter-trigger"
      panelClass="cad-parameter-menu"
      trigger={
        <>
          <SlidersHorizontal size={16} />
          <span>参数</span>
        </>
      }
    >
      <h4>{command.name}参数</h4>
      <div className="cad-coordinate-form">
        <label>
          {viewName} 局部坐标 · mm
          <input
            autoComplete="off"
            aria-label="精确输入"
            placeholder="100,50 / @20,0 / @30<45"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              e.stopPropagation();
              if (!e.nativeEvent.isComposing) submitCoordinate();
            }}
          />
        </label>
        <button type="button" data-keep-open disabled={!input.trim()} onClick={submitCoordinate}>
          <CornerDownLeft size={14} /> 输入
        </button>
        <div className="cad-symbol-keys" aria-label="坐标符号">
          {['@', ',', '<', '-', '.'].map((symbol) => (
            <button
              type="button"
              key={symbol}
              data-keep-open
              onClick={() => setInput((v) => v + symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>
      {command.fields.length > 0 && (
        <div className="cad-parameters">
          {command.fields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.options ? (
                <select
                  value={session.parameters[field.key] ?? field.defaultValue}
                  onChange={(e) =>
                    cad.send({ type: 'parameters', values: { [field.key]: e.target.value } })
                  }
                >
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={session.parameters[field.key] ?? field.defaultValue}
                  onChange={(e) =>
                    cad.send({ type: 'parameters', values: { [field.key]: e.target.value } })
                  }
                />
              )}
            </label>
          ))}
        </div>
      )}
    </EditorPopover>
  );
}
export function WorkspaceStatus({ cursorStatusRef, ...p }: StatusProps) {
  const snapMenu = useRef<HTMLButtonElement>(null);
  const session = p.cad.session;
  const label = CAD_COMMANDS.find((c) => c.id === session?.commandId)?.name ?? p.toolName;
  return (
    <footer className="cad-statusbar">
      <div
        className="cad-command-state"
        role={session ? 'region' : undefined}
        aria-label={session ? 'CAD 命令' : undefined}
      >
        <strong>{label}</strong>
        <span className="cad-step-message" role="status">
          {p.message || (session ? cadPrompt(session) : '')}
        </span>
        {session && (
          <div className="cad-steps">
            <Parameters key={session.commandId} cad={p.cad} viewName={p.viewName} />
            <Action
              label="退一步"
              icon={CornerUpLeft}
              onClick={() => p.cad.send({ type: 'back' })}
            />
            <Action label="取消" icon={X} onClick={() => p.cad.send({ type: 'cancel' })} />
            <Action
              label="完成"
              icon={Check}
              className="cad-accept"
              onClick={() => p.cad.send({ type: 'confirm' })}
            />
          </div>
        )}
      </div>
      <div className="cad-status-modes">
        <div className="cad-coordinate-readout">
          <Crosshair size={14} aria-hidden="true" />
          <span>{p.viewName}</span>
          <output ref={cursorStatusRef} aria-label="图纸坐标" aria-live="off">
            —, — mm
          </output>
          <small>{p.selectionCount ? '已选 ' + p.selectionCount : p.entityCount + ' 个对象'}</small>
        </div>
        <div className="cad-mode-list" role="group" aria-label="绘图辅助">
          <Toggle
            label="显示网格"
            caption="网格"
            icon={Grid2X2}
            pressed={p.grid}
            onClick={p.toggleGrid}
          />
          <Toggle
            label="网格捕捉"
            caption="网格捕捉"
            icon={Grid3X3}
            pressed={p.gridSnap}
            onClick={p.toggleGridSnap}
          />
          <div
            className="cad-snap-split"
            onContextMenu={(e) => {
              e.preventDefault();
              if (snapMenu.current?.getAttribute('aria-expanded') !== 'true')
                snapMenu.current?.click();
            }}
          >
            <Toggle
              label="对象捕捉"
              caption="对象捕捉"
              icon={Magnet}
              pressed={p.snapping}
              onClick={p.toggleSnap}
              shortcut="F3"
            />
            <EditorPopover
              label="对象捕捉类型"
              trigger={<></>}
              buttonClass="cad-mode-toggle cad-snap-more"
              panelClass="cad-snap-menu"
              triggerRef={snapMenu}
            >
              <ObjectSnapChoices selected={p.objectTypes} change={p.changeObjectTypes} />
            </EditorPopover>
          </div>
          <Toggle
            label="对象捕捉追踪"
            caption="追踪"
            icon={MoveUpRight}
            pressed={p.tracking}
            onClick={p.toggleTracking}
            shortcut="F11"
          />
          <Toggle
            label="正交"
            caption="正交"
            icon={Square}
            pressed={p.orthogonal}
            onClick={p.toggleOrthogonal}
            shortcut="F8"
          />
          <Action label="视图/设置" icon={Settings2} onClick={p.openSettings} />
          <Action
            label={p.theme === 'dark' ? '切换浅色画布' : '切换深色画布'}
            icon={p.theme === 'dark' ? Sun : Moon}
            onClick={p.toggleTheme}
          />
        </div>
      </div>
    </footer>
  );
}
