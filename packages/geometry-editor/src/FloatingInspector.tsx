import { useRef, useEffect, useState, type RefObject } from 'react';
import {
  autoUpdate,
  computePosition,
  offset,
  flip,
  shift,
  size,
  type VirtualElement,
} from '@floating-ui/dom';
import {
  copySelectionEntities,
  deletionSet,
  targetFromKey,
  targetCapabilities,
  resolveReference,
  closestReference,
  renameProjectionAxis,
  angle,
  formatCadAngle,
  length,
  lineGeometry,
  previewTransform,
  transact,
  setLineStyle,
  availableLineStyles,
} from '@tuheng/geometry-core';
import type { GeometryEntity } from '@tuheng/contracts';
import { PropertyFields, entityNames, styleLabels } from './PropertyFields';
import { ConnectionTools } from './ConnectionTools';
import { commandRegistry, contextCommandAvailable } from './commands';
import type { EditorControls } from './types';
export function FloatingInspector({
  controls: p,
  svg,
  cameraKey,
  beginEdit,
}: {
  controls: EditorControls;
  svg: RefObject<SVGSVGElement | null>;
  cameraKey: string;
  beginEdit: () => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    frozen = useRef(false),
    [name, setName] = useState(''),
    [delta, setDelta] = useState({ x: '0', y: '0' });
  const doc = p.document,
    key = p.selected[0],
    ref = key ? targetFromKey(key) : undefined;
  const entity = doc.entities.find((e) => e.id === key),
    axis =
      ref?.kind === 'projectionAxis'
        ? doc.auxiliarySystems?.find((a) => a.id === ref.systemId)
        : undefined;
  const expanded = p.session.panel === 'properties';
  const [axisBase, setAxisBase] = useState('');
  if (axisBase !== `${axis?.id}:${axis?.name}`) {
    setAxisBase(`${axis?.id}:${axis?.name}`);
    setName(axis?.name ?? '');
  }
  useEffect(() => {
    const el = node.current,
      canvas = svg.current;
    if (!el || !canvas || !key || (!key.includes(':') && !doc.entities.some((e) => e.id === key)))
      return;
    const virtual: VirtualElement = {
      contextElement: canvas,
      getBoundingClientRect: () => {
        const shape = canvas.querySelector(`[data-entity-id="${CSS.escape(key)}"]`);
        if (shape) {
          const r = shape.getBoundingClientRect();
          return new DOMRect(r.x, r.y, r.width, r.height);
        }
        const r = resolveReference(doc, targetFromKey(key)),
          m = canvas.getScreenCTM()!,
          b = canvas.viewBox.baseVal;
        const point = closestReference({ x: b.x + b.width / 2, y: -b.y - b.height / 2 }, r),
          q = new DOMPoint(point.x, -point.y).matrixTransform(m);
        return new DOMRect(q.x, q.y, 1, 1);
      },
    };
    if (expanded) {
      const pane = el.querySelector<HTMLElement>('.geo-card-details');
      if (!pane) return;
      let frame: number | undefined;
      const revealField = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const field = document.activeElement;
          if (
            !(field instanceof HTMLElement) ||
            !field.matches('input,select,textarea') ||
            !pane.contains(field)
          )
            return;
          const bounds = pane.getBoundingClientRect();
          const actions = pane.querySelector('.geo-form-actions')?.getBoundingClientRect();
          const bottom = Math.min(bounds.bottom, actions?.top ?? bounds.bottom) - 4;
          const rect = field.getBoundingClientRect();
          if (rect.bottom > bottom) pane.scrollTop += rect.bottom - bottom;
          else if (rect.top < bounds.top + 4) pane.scrollTop += rect.top - bounds.top - 4;
        });
      };
      const resize = new ResizeObserver(revealField);
      resize.observe(pane);
      window.visualViewport?.addEventListener('resize', revealField);
      el.addEventListener('focusin', revealField);
      return () => {
        resize.disconnect();
        if (frame !== undefined) cancelAnimationFrame(frame);
        window.visualViewport?.removeEventListener('resize', revealField);
        el.removeEventListener('focusin', revealField);
      };
    }
    const update = () => {
      if (frozen.current) return;
      void computePosition(virtual, el, {
        strategy: 'fixed',
        placement: 'bottom',
        middleware: [
          offset(12),
          size({
            boundary: canvas,
            padding: 8,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(160, Math.min(availableHeight, 320, innerHeight * 0.45, canvas.getBoundingClientRect().height - 16))}px`;
            },
          }),
          flip({ boundary: canvas, fallbackPlacements: ['top', 'left', 'right'] }),
          shift({ boundary: canvas, padding: 8, crossAxis: true }),
        ],
      }).then(({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` }));
    };
    const cleanup = autoUpdate(virtual, el, update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      cleanup();
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [doc, key, svg, cameraKey, expanded]);
  if (!ref || (ref.kind === 'entity' && !entity)) return null;
  const cap = targetCapabilities(doc, ref, p.role, p.readOnly),
    many = p.selected.length > 1;
  const run = (op: () => typeof doc) => {
    try {
      p.commit(op());
    } catch (e) {
      p.report((e as Error).message);
    }
  };
  const command = (
    id:
      | 'construct-parallel'
      | 'construct-perpendicular'
      | 'relation-parallel'
      | 'relation-perpendicular',
  ) => {
    const entry = commandRegistry.find((c) => c.id === id)!;
    return contextCommandAvailable(entry, doc, p.selected, p.role, p.readOnly) ? (
      <button type="button" key={id} onClick={() => p.runCommand(id)}>
        {entry.name}
      </button>
    ) : null;
  };
  const eligible = p.selected.filter(
    (id) => targetCapabilities(doc, targetFromKey(id), p.role, p.readOnly).editable,
  );
  const styles = availableLineStyles(doc, p.selected, p.role),
    selectedStyles = new Set(
      doc.entities.filter((e) => p.selected.includes(e.id)).map((e) => e.lineStyle),
    );
  function blocked(check: () => unknown) {
    try {
      check();
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  }
  const copyReason = p.readOnly
    ? '当前文档只读'
    : blocked(() => copySelectionEntities(doc, p.selected, p.role));
  const deleteReason = p.selected.some(
    (id) => !targetCapabilities(doc, targetFromKey(id), p.role, p.readOnly).deletable,
  )
    ? '所选对象只读或有依赖'
    : blocked(() =>
        deletionSet(
          doc,
          p.selected.filter((id) => targetFromKey(id).kind === 'entity'),
          p.role,
        ),
      );
  const canCopy = !copyReason,
    canDelete = !deleteReason;
  return (
    <div
      ref={node}
      role="dialog"
      aria-label="对象属性"
      className={`geo-floating-inspector ${expanded ? 'geo-properties-expanded' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onFocusCapture={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
          frozen.current = true;
          if (!e.target.disabled) beginEdit();
        }
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) frozen.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (expanded) p.dispatch({ type: 'patch', patch: { panel: null } });
          else p.select([]);
        }
      }}
    >
      <div className="geo-card-heading">
        <strong>
          {many
            ? `已选 ${p.selected.length} 个对象`
            : entity
              ? entityNames[entity.kind]
              : resolveReference(doc, ref).name}
        </strong>
        <button
          type="button"
          disabled={!canCopy}
          title={copyReason || '在文档内复制'}
          onClick={p.copySelection}
        >
          复制
        </button>
        <button
          type="button"
          disabled={!canDelete}
          title={deleteReason || '删除所选对象'}
          onClick={p.deleteSelection}
        >
          删除
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() =>
            p.dispatch({ type: 'patch', patch: { panel: expanded ? null : 'properties' } })
          }
        >
          {expanded ? '收起详情' : '编辑属性'}
        </button>
        <button
          type="button"
          aria-label="关闭对象属性"
          onClick={() => {
            p.dispatch({ type: 'patch', patch: { panel: null } });
            p.select([]);
          }}
        >
          ×
        </button>
      </div>
      <div className="geo-compact-summary">
        {many
          ? selectedStyles.size === 1
            ? styleLabels[[...selectedStyles][0]]
            : '多个值'
          : entity?.kind === 'segment'
            ? `长度 ${length(lineGeometry(doc, entity).d).toFixed(2)} mm · ${formatCadAngle(angle(lineGeometry(doc, entity).d), 1)}°`
            : entity?.kind === 'point'
              ? `u ${entity.position.x.toFixed(2)} · v ${entity.position.y.toFixed(2)} mm`
              : entity?.kind === 'circle'
                ? `半径 ${entity.radius.toFixed(2)} mm`
                : entity?.kind === 'arc'
                  ? `半径 ${entity.radius.toFixed(2)} mm · 扫角 ${formatCadAngle(entity.sweep, 1)}°`
                  : entity?.kind === 'ellipse'
                    ? `半轴 ${entity.majorRadius.toFixed(2)} / ${entity.minorRadius.toFixed(2)} mm`
                    : entity?.kind === 'text'
                      ? entity.content
                      : '参考与属性'}
        {!cap.editable ? ' · 只读' : ''}
      </div>
      <div className="geo-card-details">
        {!many && entity && (
          <PropertyFields
            document={doc}
            selected={p.selected}
            role={p.role}
            readOnly={p.readOnly}
            commit={p.commit}
            report={p.report}
          />
        )}
        {!many && !entity && (
          <>
            <p>可选中和作为作图参考{!cap.editable ? ' · 只读' : ''}</p>
            {axis ? (
              <>
                <p>
                  {
                    { FREE: '普通投影轴', PARALLEL: '平行投影轴', PERPENDICULAR: '垂直投影轴' }[
                      axis.method
                    ]
                  }{' '}
                  · 方向 {formatCadAngle(angle(axis.tangent), 1)}° · 保留{' '}
                  {doc.views.find((v) => v.id === axis.retainedViewId)?.name} · 替换{' '}
                  {doc.views.find((v) => v.id === axis.replacedViewId)?.name} · 新面{' '}
                  {doc.views.find((v) => v.id === axis.newViewId)?.name} · 沿轴正向的
                  {axis.side === 1 ? '左侧展开' : '右侧展开'}
                </p>
                <label>
                  轴名称
                  <input
                    value={name}
                    disabled={!cap.editable}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={!cap.editable}
                  onClick={() =>
                    run(() =>
                      renameProjectionAxis(
                        doc,
                        axis.id,
                        name,
                        doc.views.find((v) => v.id === axis.newViewId)!.name,
                        p.role,
                      ),
                    )
                  }
                >
                  确认轴名称
                </button>
                <p>轴定义影响投影系，当前只支持重命名；需重设时先处理依赖再创建。</p>
              </>
            ) : (
              <p>系统基准，不允许拖移或删除。</p>
            )}
          </>
        )}
        {many && (
          <>
            <p>图纸位移（mm），共享节点只移动一次</p>
            <div className="geo-fields">
              <label>
                ΔU
                <input
                  value={delta.x}
                  onChange={(e) => setDelta((d) => ({ ...d, x: e.target.value }))}
                />
              </label>
              <label>
                ΔT
                <input
                  value={delta.y}
                  onChange={(e) => setDelta((d) => ({ ...d, y: e.target.value }))}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={eligible.length !== p.selected.length}
              onClick={() =>
                run(() => {
                  if (
                    !delta.x.trim() ||
                    !delta.y.trim() ||
                    !Number.isFinite(Number(delta.x)) ||
                    !Number.isFinite(Number(delta.y))
                  )
                    throw Error('请输入有效位移');
                  return transact(
                    previewTransform(
                      doc,
                      p.selected,
                      { x: Number(delta.x), y: Number(delta.y) },
                      p.role,
                    ),
                    () => {},
                    p.role,
                  );
                })
              }
            >
              确认移动
            </button>
            <label>
              共同线型
              <select
                aria-label="共同线型"
                value={selectedStyles.size === 1 ? [...selectedStyles][0] : ''}
                disabled={!styles.length || p.readOnly}
                onChange={(e) =>
                  run(() =>
                    p.selected.reduce(
                      (d, id) =>
                        setLineStyle(d, id, e.target.value as GeometryEntity['lineStyle'], p.role),
                      doc,
                    ),
                  )
                }
              >
                {selectedStyles.size !== 1 && <option value="">多个值</option>}
                {styles.map((s) => (
                  <option key={s} value={s}>
                    {styleLabels[s]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {cap.referenceable &&
          !p.readOnly &&
          (!entity || ['line', 'segment'].includes(entity.kind)) && (
            <div className="geo-context-actions">
              {command('construct-parallel')}
              {command('construct-perpendicular')}
            </div>
          )}
        {many && !p.readOnly && (
          <div className="geo-context-actions">
            {command('relation-parallel')}
            {command('relation-perpendicular')}
          </div>
        )}
        {!entity &&
          ref.kind !== 'origin' &&
          !p.readOnly &&
          doc.editorType !== 'ISOMETRIC' &&
          doc.editorType !== 'OBLIQUE_DIMETRIC' && (
            <button type="button" onClick={() => p.runCommand('new-axis')}>
              新增投影轴
            </button>
          )}
        {(deleteReason || copyReason) && <p>{deleteReason || copyReason}</p>}
        {entity && !p.readOnly && (
          <ConnectionTools
            doc={doc}
            selected={p.selected}
            role={p.role}
            commit={p.commit}
            report={p.report}
          />
        )}
      </div>
    </div>
  );
}
