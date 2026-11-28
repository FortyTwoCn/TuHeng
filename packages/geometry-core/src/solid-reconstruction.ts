import type { GeometryDocument } from '@tuheng/contracts';
import {
  inspectDrawing,
  projectionPlaneAxes,
  type DrawingAuditReport,
  type ProjectionDirection,
} from './drawing-audit';
import { cellBoundaryPanels } from './solid-cell-boundary';
import { partitionSolid } from './solid-cell-partition';
import { solveCellVisibility } from './solid-cell-visibility';
import { meshSolidPanels, type SolidTriangle } from './solid-mesh';
import { solidPanels } from './solid-panels';
import { solidAxes, type SolidBounds, type SolidPoint } from './spatial-math';
import { reconstructSpatial3D, type ReconstructedSpatial3D } from './spatial-reconstruction';

export type ReconstructedSolid3D = {
  kind: 'SOLID';
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
  reconstructionMethod: 'ORTHOGONAL_CONTOUR_INTERSECTION' | 'PROJECTION_CELL_DECOMPOSITION';
  verification?: {
    cells: number;
    explainedEntities: number;
    sampledEdges: number;
    cylindricalCuts: number;
  };
  confidenceNote: string;
  warnings: string[];
};

type ReconstructionFailure = { ok: false; reason: string; audit: DrawingAuditReport };
export type SolidReconstructionResult =
  { ok: true; solid: ReconstructedSolid3D; audit: DrawingAuditReport } | ReconstructionFailure;
export type ReconstructedDrawing3D = ReconstructedSolid3D | ReconstructedSpatial3D;
export type DrawingReconstructionResult =
  { ok: true; scene: ReconstructedDrawing3D; audit: DrawingAuditReport } | ReconstructionFailure;

export function reconstructDrawing3D(doc: GeometryDocument): DrawingReconstructionResult {
  const { report: audit, views, spatial } = inspectDrawing(doc);
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
  const warnings = audit.checks
    .filter(({ severity }) => severity === 'WARN')
    .map(({ detail }) => detail);
  try {
    if (spatial) return { ok: true, audit, scene: reconstructSpatial3D(doc, spatial, warnings) };
    const usable = views.filter(({ direction, contours }) => direction && contours.length);
    const hasHidden = usable.some(({ hidden }) => hidden.length);
    const complex =
      hasHidden ||
      usable.some(({ boundary, contours }) => {
        const envelopeIds = new Set(
          contours.flatMap(({ edges }) => edges.map(({ entityId }) => entityId)),
        );
        return boundary.some(({ entity }) => !envelopeIds.has(entity.id));
      });
    const ambiguous = complex && usable.length === 2;
    if (ambiguous) warnings.push('两视图存在内部凹槽或厚度多解，建议补齐第三视图以约束三维实体。');
    let mesh: ReturnType<typeof meshSolidPanels> | undefined;
    let verification: ReconstructedSolid3D['verification'];
    if (complex) {
      try {
        const partition = partitionSolid(usable, audit.toleranceMm);
        const solved = solveCellVisibility(partition);
        if (solved.status !== 'SOLVED')
          throw Error(
            solved.status === 'LIMIT'
              ? '实线与虚线的一致性搜索已达到计算上限。'
              : '部分实线或虚线无法由同一个闭合实体解释，请核对边界与遮挡。',
          );
        mesh = meshSolidPanels(cellBoundaryPanels(partition, solved.cells));
        verification = {
          cells: partition.cells.length,
          explainedEntities: solved.measured,
          sampledEdges: solved.samples,
          cylindricalCuts: partition.bores.length,
        };
      } catch (error) {
        if (hasHidden && !ambiguous) throw error;
        warnings.push('内部线无法全部求解，当前预览采用闭合轮廓的正交交集。');
      }
    }
    if (!mesh) {
      const panels = solidPanels(usable);
      if (!panels.length)
        return { ok: false, audit, reason: '投影正交交集为空或缺少可封闭的实体边界。' };
      mesh = meshSolidPanels(panels);
    }
    const solidMesh = mesh;
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
        triangleIndices: solidMesh.faceSources.flatMap((source, i) =>
          source.viewId === item.view.id || Math.abs(solidMesh.normals[i][normalAxis]) >= 0.7
            ? [i]
            : [],
        ),
      };
    });
    const directions = sourceViewMapping.map(({ direction }) => direction).join('/');
    const confidenceNote = verification
      ? `在 ${verification.cells} 个候选空间单元上求解，${verification.explainedEntities} 个实线与虚线图元通过投影一致性检查。`
      : usable.length === 2
        ? `基于 ${directions} 双视图正交推演，第三方向的不可见结构可能存在多种解。`
        : '按三张正交投影封闭轮廓的公共体积推演。所得实体表示各投影共同约束的范围。';
    return {
      ok: true,
      audit,
      scene: {
        ...mesh,
        kind: 'SOLID',
        sourceViewMapping,
        reconstructionMethod: verification
          ? 'PROJECTION_CELL_DECOMPOSITION'
          : 'ORTHOGONAL_CONTOUR_INTERSECTION',
        verification,
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

/** Compatibility entry point for callers that only accept a solid mesh. */
export function reconstructSolid3D(doc: GeometryDocument): SolidReconstructionResult {
  const result = reconstructDrawing3D(doc);
  if (!result.ok) return result;
  return result.scene.kind === 'SOLID'
    ? { ok: true, solid: result.scene, audit: result.audit }
    : { ok: false, reason: '当前图纸适用于画法几何三维预览。', audit: result.audit };
}
