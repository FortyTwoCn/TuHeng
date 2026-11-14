import type { GeometryDocument, GeometryEntity, Vec3 } from '@tuheng/contracts';
import { transact } from './document';
export function relatedPlane(
  doc: GeometryDocument,
  referenceId: string,
  relation: 'PARALLEL' | 'PERPENDICULAR',
  offset: number,
  axis: Vec3,
  role: 'teacher' | 'student',
) {
  const reference = doc.entities.find((e) => e.id === referenceId);
  if (reference?.kind !== 'plane') throw new Error('请选择参考投影面');
  const n = reference.normal;
  let normal = n,
    orientation = reference.orientation;
  if (relation === 'PERPENDICULAR') {
    const cross = {
      x: n.y * axis.z - n.z * axis.y,
      y: n.z * axis.x - n.x * axis.z,
      z: n.x * axis.y - n.y * axis.x,
    };
    const size = Math.hypot(cross.x, cross.y, cross.z);
    if (size < 1e-8) throw new Error('方向轴不能平行于参考面的法向');
    normal = { x: cross.x / size, y: cross.y / size, z: cross.z / size };
    orientation = n;
  }
  const entity: GeometryEntity = {
    id: crypto.randomUUID(),
    kind: 'plane',
    viewId: reference.viewId,
    layerId: doc.layers.find(
      (l) => l.role === (role === 'teacher' ? 'PROBLEM_STEM' : 'CONSTRUCTION'),
    )!.id,
    lineStyle: role === 'teacher' ? 'PROBLEM_VISIBLE' : 'CONSTRUCTION',
    origin: {
      x: reference.origin.x + n.x * offset,
      y: reference.origin.y + n.y * offset,
      z: reference.origin.z + n.z * offset,
    },
    normal,
    orientation,
    referencePlaneId: reference.id,
    relation,
  };
  return transact(doc, (d) => d.entities.push(entity), role);
}
