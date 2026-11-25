import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import { editable } from './document';
import { add, angle, distance, point, sub } from './math';

export type CadGrip = {
  entityId: string;
  key: 'radius' | 'start' | 'end' | 'major' | 'minor' | 'position' | 'rotate' | 'label' | 'leader' | 'arrow' | 'measureA' | 'measureB';
  position: Vec2;
  label: string;
};
function radial(center: Vec2, r: number, direction: number) {
  const a = (direction * Math.PI) / 180;
  return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
}
export function cadGrips(
  doc: GeometryDocument,
  e: GeometryEntity,
  role: 'student' | 'teacher',
): CadGrip[] {
  if (!editable(doc, e, role)) return [];
  const grip = (key: CadGrip['key'], position: Vec2, label: string): CadGrip => ({
    entityId: e.id,
    key,
    position,
    label,
  });
  if (e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse') {
    const c = point(doc, e.center);
    if (e.kind === 'circle') return [grip('radius', radial(c, e.radius, 0), '调整半径')];
    if (e.kind === 'ellipse')
      return [
        grip('major', radial(c, e.majorRadius, e.angle), '调整长轴及方向'),
        grip('minor', radial(c, e.minorRadius, e.angle + 90), '调整短轴'),
      ];
    return [
      grip('start', radial(c, e.radius, e.startAngle), '调整弧起点'),
      grip('end', radial(c, e.radius, e.startAngle + e.sweep), '调整弧终点'),
      grip('radius', radial(c, e.radius, e.startAngle + e.sweep / 2), '调整半径'),
    ];
  }
  if (e.kind === 'text' || e.kind === 'symbol' || e.kind === 'engineeringAnnotation') {
    const grips=[grip('position',e.position,'移动标记')];
    if (e.kind==='symbol' && e.symbolType==='DIRECTION')
      grips.push(grip('arrow',radial(e.position,e.arrowLength ?? e.size*2,e.angle),'移动箭端'));
    else grips.push(grip('rotate',radial(e.position,e.size*2,e.angle),'旋转标记'));
    if (e.kind==='symbol' && e.label)
      grips.push(grip('label',e.labelPosition ?? radial(e.position,e.size,e.angle+90),'移动向视字母'));
    if (e.kind==='engineeringAnnotation' && e.leader) grips.push(grip('leader',e.leader,'移动引线接触点'));
    return grips;
  }
  if (e.kind === 'dimension') {
    const grips=[grip('position',e.position,'移动标注位置')];
    if (e.dimensionType==='ALIGNED' || e.dimensionType==='LINEAR') {
      for (const [i,key] of ['measureA','measureB'].entries()) {
        const ref = doc.entities.find(v=>v.id===e.referenceIds[i]);
        if (ref?.kind==='point' && editable(doc,ref,role)) grips.push(grip(key as 'measureA' | 'measureB',ref.position,'移动测量点 '+(i+1)));
      }
    }
    return grips;
  }
  return [];
}
function signedAngle(from: number, to: number, sign: number) {
  const span = ((((to - from) * sign) % 360) + 360) % 360;
  if (span < 0.002) throw Error('圆弧角度太小');
  return span * sign;
}
export function previewCadGrip(
  base: GeometryDocument,
  grip: CadGrip,
  local: Vec2,
  role: 'student' | 'teacher',
) {
  const original = base.entities.find((entity) => entity.id === grip.entityId);
  if (!original || !editable(base, original, role)) throw Error('夹点所属对象只读');
  if (
    base.referenceRelations?.some((r) => r.targetId === original.id && r.mode === 'BINDING') ||
    base.constraints.some((r) => r.mode === 'BINDING' && r.entityIds[0] === original.id)
  )
    throw Error('请先解除此对象的绑定');
  const e = { ...original };
  if (e.kind==='dimension' && (grip.key==='measureA' || grip.key==='measureB')) {
    const id=e.referenceIds[grip.key==='measureA'?0:1];
    const node=base.entities.find(v=>v.id===id);
    if (node?.kind!=='point' || !editable(base,node,role) ||
      base.referenceRelations?.some(r=>r.targetId===id&&r.mode==='BINDING') ||
      base.constraints.some(r=>r.entityIds[0]===id&&r.mode==='BINDING'))
      throw Error('测量点只读或受绑定控制');
    return {...base, entities:base.entities.map(v=>v.id===id ? {...node, position:local, spatial:null} : v)};
  }
  if (e.kind==='symbol' && grip.key==='label') e.labelPosition=local;
  else if (e.kind==='symbol' && grip.key==='arrow') {
    const size=distance(e.position,local);
    if (size<1e-7) throw Error('箭杆长度不能为零');
    e.angle=angle(sub(local,e.position));
    e.arrowLength=size;
  } else if (e.kind==='engineeringAnnotation' && grip.key==='leader') e.leader=local;
  else if (e.kind === 'arc' || e.kind === 'circle' || e.kind === 'ellipse') {
    const c = point(base, e.center),
      length = distance(c, local),
      a = angle(sub(local, c));
    if (length < 1e-6) throw Error('轴长或半径必须大于零');
    if (e.kind === 'ellipse') {
      if (grip.key === 'major') {
        if (length < e.minorRadius) throw Error('长半轴不能短于短半轴');
        e.angle = a;
        e.majorRadius = length;
      } else {
        const minor = Math.abs(length * Math.sin(((a - e.angle) * Math.PI) / 180));
        if (minor < 1e-6 || minor > e.majorRadius) throw Error('短半轴须大于零且不超过长半轴');
        e.minorRadius = minor;
      }
    } else if (grip.key === 'radius') e.radius = length;
    else if (e.kind === 'arc') {
      if (grip.key === 'start') {
        e.sweep = signedAngle(a, e.startAngle + e.sweep, Math.sign(e.sweep));
        e.startAngle = a;
      } else e.sweep = signedAngle(e.startAngle, a, Math.sign(e.sweep));
    }
  } else if ('position' in e && grip.key === 'position') {
    if (e.kind==='symbol' && e.labelPosition) e.labelPosition=add(e.labelPosition,sub(local,e.position));
    e.position=local;
  }
  else if ('angle' in e && 'position' in e && grip.key === 'rotate')
    e.angle = angle(sub(local, e.position));
  else throw Error('无效夹点');
  return { ...base, entities: base.entities.map((old) => (old.id === e.id ? e : old)) };
}
