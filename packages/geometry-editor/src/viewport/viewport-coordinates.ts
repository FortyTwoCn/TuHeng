import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { sheetToLocal } from '@tuheng/geometry-core';

export function pointerOnSheet(pointer: { clientX: number; clientY: number }, inverse?: DOMMatrix) {
  if (!inverse) return { x: 0, y: 0 };
  const p = new DOMPoint(pointer.clientX, pointer.clientY).matrixTransform(inverse);
  return { x: p.x, y: -p.y };
}

export function coordinateReadout(doc: GeometryDocument, frameId: string, sheet: Vec2) {
  const position = sheetToLocal(doc, frameId, sheet);
  const view = doc.views.find((v) => v.id === frameId);
  const baseVH =
    doc.editorType === 'VH_PROJECTION' &&
    view &&
    !doc.auxiliarySystems?.some((axis) => axis.newViewId === frameId);
  const coords = baseVH
    ? `X ${(position.x * view.signs[0]).toFixed(4)} · ${view.mapping[1].toUpperCase()} ${(position.y * view.signs[1]).toFixed(4)}`
    : `u ${position.x.toFixed(4)} · v ${position.y.toFixed(4)}`;
  return `${view?.name ?? frameId} · ${coords} mm`;
}

export function pinchMidpoint(a: Vec2, b: Vec2) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
