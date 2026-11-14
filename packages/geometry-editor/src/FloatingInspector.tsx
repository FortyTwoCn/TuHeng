import { useRef, useEffect, useState, type RefObject } from 'react';
import {
  autoUpdate,
  computePosition,
  offset,
  flip,
  shift,
  type VirtualElement,
} from '@floating-ui/dom';
import {
  targetFromKey,
  targetCapabilities,
  resolveReference,
  closestReference,
  renameProjectionAxis,
  angle,
  length,
  lineGeometry,
  previewTransform,
  transact,
  setLineStyle,
} from '@tuheng/geometry-core';
import type { GeometryEntity } from '@tuheng/contracts';
import { PropertyFields, entityNames } from './PropertyFields';
import { ConnectionTools } from './ConnectionTools';
import { commandRegistry } from './commands';
import type { EditorControls } from './types';
export function FloatingInspector({
  controls: p,
  svg,
  cameraKey,
}: {
  controls: EditorControls;
  svg: RefObject<SVGSVGElement | null>;
  cameraKey: string;
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
    const update = () => {
      if (frozen.current || expanded) return;
      void computePosition(virtual, el, {
        strategy: 'fixed',
        placement: 'bottom',
        middleware: [
          offset(12),
          flip({ boundary: canvas }),
          shift({ boundary: canvas, padding: 8 }),
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
  ) => (
    <button type="button" key={id} onClick={() => p.runCommand(id)}>
      {commandRegistry.find((c) => c.id === id)!.name}
    </button>
  );
  const eligible = p.selected.filter(
    (id) => targetCapabilities(doc, targetFromKey(id), p.role, p.readOnly).editable,
  );
  return (
    <div
      ref={node}
      role="dialog"
      aria-label="对象属性"
      className={`geo-floating-inspector ${expanded ? 'geo-properties-expanded' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onFocusCapture={(e) => {
        if (e.target instanceof HTMLInputElement) frozen.current = true;
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
        {entity?.kind === 'segment'
          ? `长度 ${length(lineGeometry(doc, entity).d).toFixed(2)} mm · ${angle(lineGeometry(doc, entity).d).toFixed(1)}°`
          : entity?.kind === 'point'
            ? `u ${entity.position.x.toFixed(2)} · v ${entity.position.y.toFixed(2)} mm`
            : entity?.kind === 'circle'
              ? `半径 ${entity.radius.toFixed(2)} mm`
              : '参考与属性'}
        {!cap.editable ? ' · 只读' : ''}
        <button
          type="button"
          onClick={() =>
            p.dispatch({ type: 'patch', patch: { panel: expanded ? null : 'properties' } })
          }
        >
          {expanded ? '收起详情' : '编辑属性'}
        </button>
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
                  方向 {angle(axis.tangent).toFixed(1)}° · 保留{' '}
                  {doc.views.find((v) => v.id === axis.retainedViewId)?.name} · 替换{' '}
                  {doc.views.find((v) => v.id === axis.replacedViewId)?.name} · 新面{' '}
                  {doc.views.find((v) => v.id === axis.newViewId)?.name} · 展开侧 {axis.side}
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
                value=""
                disabled={eligible.length !== p.selected.length}
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
                <option value="">
                  {new Set(
                    doc.entities.filter((e) => p.selected.includes(e.id)).map((e) => e.lineStyle),
                  ).size > 1
                    ? '多个值'
                    : '选择线型'}
                </option>
                <option value="ANSWER_VISIBLE">答案实线</option>
                <option value="ANSWER_HIDDEN">答案虚线</option>
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
        <div className="geo-context-actions">
          {eligible.length === p.selected.length && entity && (
            <button type="button" onClick={p.copySelection}>
              复制
            </button>
          )}
          {(entity || axis) && (
            <button
              type="button"
              disabled={
                !p.selected.every(
                  (id) => targetCapabilities(doc, targetFromKey(id), p.role, p.readOnly).deletable,
                )
              }
              onClick={p.deleteSelection}
            >
              删除
            </button>
          )}
        </div>
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
