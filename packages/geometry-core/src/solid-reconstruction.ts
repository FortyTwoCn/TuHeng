import type { GeometryDocument } from '@tuheng/contracts';
import {
  inspectDrawing,
  projectionPlaneAxes,
  type DrawingAuditReport,
  type ProjectionDirection,
} from './drawing-audit';
import { meshSolidPanels, type SolidTriangle } from './solid-mesh';
import { solidAxes, solidPanels, type SolidBounds, type SolidPoint } from './solid-panels';

export type ReconstructedSolid3D = {
  vertices: SolidPoint[];
  triangles: SolidTriangle[];
  normals: SolidPoint[];
  edges: [SolidPoint, SolidPoint][];
  bounds: SolidBounds;
  volumeMm3: number;
  faceSources: { viewId: string; entityId: string }[];
  sourceViewMapping: {
    direction: ProjectionDirection;
    viewId: string;
    axes: (typeof projectionPlaneAxes)[ProjectionDirection];
    entityIds: string[];
    triangleIndices: number[];
  }[];
  reconstructionMethod: 'ORTHOGONAL_CONTOUR_INTERSECTION';
  confidenceNote: string;
  warnings: string[];
};

export type SolidReconstructionResult =
  | { ok: true; solid: ReconstructedSolid3D; audit: DrawingAuditReport }
  | { ok: false; reason: string; audit: DrawingAuditReport };

export function reconstructSolid3D(doc: GeometryDocument): SolidReconstructionResult {
  const { report: audit, views } = inspectDrawing(doc);
  if (!audit.canReconstruct3D) {
    const blockers = audit.checks.filter(({ severity }) => severity === 'ERROR');
    return {
      ok: false,
      audit,
      reason: blockers.length
        ? blockers
            .slice(0, 3)
            .map(({ title, detail }) => `${title}，${detail}`)
            .join('；')
        : '需要至少两张正交投影才能重建三维实体。',
    };
  }
  const usable = views.filter(({ direction, contours }) => direction && contours.length);
  try {
    const panels = solidPanels(usable);
    if (!panels.length)
      return { ok: false, audit, reason: '投影正交交集为空或缺少可封闭的实体边界。' };
    const mesh = meshSolidPanels(panels);
    const sourceViewMapping = usable.map((item) => {
      const direction = item.direction!;
      const axes = projectionPlaneAxes[direction];
      const normalAxis =
        direction === 'V' ? solidAxes.y : direction === 'H' ? solidAxes.z : solidAxes.x;
      return {
        direction,
        viewId: item.view.id,
        axes,
        entityIds: [...item.boundary, ...item.hidden, ...item.centers].map(
          ({ entity }) => entity.id,
        ),
        triangleIndices: mesh.faceSources.flatMap((source, i) =>
          source.viewId === item.view.id || Math.abs(mesh.normals[i][normalAxis]) >= 0.7 ? [i] : [],
        ),
      };
    });
    const directions = sourceViewMapping.map(({ direction }) => direction).join('/');
    const confidenceNote =
      usable.length === 2
        ? `基于 ${directions} 双视图正交推演，第三方向的不可见结构可能存在多种解。`
        : '按三张正交投影封闭轮廓的公共体积推演。所得实体表示各投影共同约束的范围。';
    const warnings = audit.checks
      .filter(({ severity }) => severity === 'WARN')
      .map(({ detail }) => detail);
    if (usable.some(({ hidden }) => hidden.length))
      warnings.push('虚线用于投影对应检查。仅靠虚线或单侧投影无法确定的内部结构需要人工核对。');
    return {
      ok: true,
      audit,
      solid: {
        ...mesh,
        sourceViewMapping,
        reconstructionMethod: 'ORTHOGONAL_CONTOUR_INTERSECTION',
        confidenceNote,
        warnings,
      },
    };
  } catch (error) {
    return {
      ok: false,
      audit,
      reason: error instanceof Error ? error.message : '无法解析投影交集。',
    };
  }
}
