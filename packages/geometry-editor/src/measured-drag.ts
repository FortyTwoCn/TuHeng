import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import { cadLineEndpoint, distance, localToSheet, point, previewCadGrip, previewTransform, sub, type CadGrip } from '@tuheng/geometry-core';
import type { Gesture } from './selection-gesture';
import type { LineFields } from './DynamicLineInput';

type Target = {kind:'endpoint'; nodeId:string} | {kind:'radius'; grip:CadGrip};
export type DragMeasurement = {
  target: Target; base: GeometryDocument; viewId:string; anchor:Vec2; tip:Vec2;
};
export function dragMeasurement(g:Gesture, preview:GeometryDocument, pointer:Vec2): DragMeasurement | undefined {
  if (g.grip?.key === 'radius') {
    const circle = preview.entities.find(e=>e.id===g.grip!.entityId);
    if (circle?.kind!=='circle' && circle?.kind!=='arc') return;
    const anchor = point(preview,circle.center);
    const tip = cadLineEndpoint(anchor,pointer,{length:String(circle.radius)});
    return {target:{kind:'radius',grip:g.grip},base:g.base,viewId:circle.viewId,anchor,tip};
  }
  if (g.hit?.kind!=='endpoint' || g.ids.length!==1) return;
  const nodeId=g.hit.id;
  const incident=preview.entities.filter(e=>e.kind==='segment' && (e.startPoint===nodeId || e.endPoint===nodeId));
  const owner=incident.find(e=>g.selection.includes(e.id))??incident[0];
  if (owner?.kind!=='segment') return;
  return {target:{kind:'endpoint',nodeId},base:g.base,viewId:owner.viewId,
    anchor:point(preview, owner.startPoint===nodeId?owner.endPoint:owner.startPoint),tip:point(preview,nodeId)};
}
export function exactDrag(drag:DragMeasurement,fields:LineFields,role:'teacher'|'student') {
  const {base,viewId,anchor,target}=drag;
  const tip = cadLineEndpoint(anchor,drag.tip,fields);
  if (target.kind==='radius') return {tip,document:previewCadGrip(base,target.grip,tip,role)};
  const delta = sub(localToSheet(base,viewId,tip), localToSheet(base,viewId,point(base,target.nodeId)));
  const document=previewTransform(base,[target.nodeId],delta,role);
  if (distance(point(document,target.nodeId),tip)>1e-7) throw Error('当前绑定与输入尺寸冲突');
  return {tip,document};
}
