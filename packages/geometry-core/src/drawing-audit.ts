import type { GeometryDocument, Vec2 } from '@tuheng/contracts';
import {
  CONTOUR_JOIN_MM,
  CONTOUR_SEGMENT_LIMIT,
  contourLineRole,
  extractDrawingContours,
  isContourEntity,
  sampleContour,
  type ContourPath,
  type DrawingContour,
} from './drawing-contours';
import { orthographic } from './sheet';

export type DrawingView = GeometryDocument['views'][number];
export type SolidAxis = 'x' | 'y' | 'z';
export const projectionPlaneAxes = { V: ['x', 'z'], H: ['x', 'y'], W: ['y', 'z'] } as const;
export type ProjectionDirection = keyof typeof projectionPlaneAxes;
type Category = 'VIEWS' | 'LENGTH' | 'HEIGHT' | 'DEPTH' | 'CONTOUR' | 'OVERLAP' | 'LINE_STYLE';
export type DrawingAuditMarker = { viewId: string; position: Vec2; label?: string };
export type DrawingAuditCheck = {
  id: string;
  category: Category;
  severity: 'PASS' | 'WARN' | 'ERROR';
  title: string;
  detail: string;
  viewIds: string[];
  entityIds: string[];
  markers: DrawingAuditMarker[];
};
export type DrawingAuditReport = {
  status: 'PASS' | 'WARN' | 'FAIL';
  canReconstruct3D: boolean;
  toleranceMm: number;
  summary: string;
  checks: DrawingAuditCheck[];
};

type Bounds2 = { min: Vec2; max: Vec2 };
export type AuditedDrawingView = {
  view: DrawingView;
  direction?: ProjectionDirection;
  contours: DrawingContour[];
  boundary: ContourPath[];
  hidden: ContourPath[];
  centers: ContourPath[];
  bounds?: Bounds2;
};

function directionOf(view: DrawingView) {
  return (Object.keys(projectionPlaneAxes) as ProjectionDirection[]).find((direction) =>
    projectionPlaneAxes[direction].every((axis) => view.mapping.includes(axis)),
  );
}

export function toProjectionPlane(
  view: DrawingView,
  direction: ProjectionDirection,
  position: Vec2,
): Vec2 {
  const value = (axis: SolidAxis) =>
    view.mapping[0] === axis ? position.x * view.signs[0] : position.y * view.signs[1];
  const [u, v] = projectionPlaneAxes[direction];
  return { x: value(u), y: value(v) };
}

function fromProjectionPlane(
  view: DrawingView,
  direction: ProjectionDirection,
  position: Vec2,
): Vec2 {
  const [u] = projectionPlaneAxes[direction];
  return view.mapping[0] === u
    ? { x: position.x * view.signs[0], y: position.y * view.signs[1] }
    : { x: position.y * view.signs[0], y: position.x * view.signs[1] };
}

function boundsOf(paths: readonly ContourPath[]) {
  const min = { x: Infinity, y: Infinity },
    max = { x: -Infinity, y: -Infinity };
  for (const { points } of paths) {
    for (const { x, y } of points) {
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
    }
  }
  return Number.isFinite(min.x) ? { min, max } : undefined;
}

type AddCheck = (check: DrawingAuditCheck) => void;
function inspectView(
  doc: GeometryDocument,
  view: DrawingView,
  direction: ProjectionDirection | undefined,
  tolerance: number,
  add: AddCheck,
): AuditedDrawingView {
  const result: AuditedDrawingView = {
    view,
    direction,
    contours: [],
    boundary: [],
    hidden: [],
    centers: [],
  };
  const position = (p: Vec2) => (direction ? toProjectionPlane(view, direction, p) : p);
  const marker = (p: Vec2): DrawingAuditMarker => ({
    viewId: view.id,
    position: direction ? fromProjectionPlane(view, direction, p) : p,
  });
  const invalidPatterns: string[] = [];
  const nonFinite = [];
  let sampleCount = 0;
  for (const entity of doc.entities) {
    if (entity.viewId !== view.id || entity.scope === 'SHEET' || !isContourEntity(entity)) continue;
    const semanticRole = contourLineRole(entity);
    const pattern = entity.appearance?.pattern;
    if (
      (entity.lineStyle.endsWith('_HIDDEN') && pattern && pattern !== 'DASHED') ||
      (semanticRole === 'VISIBLE' && pattern === 'DASHED')
    )
      invalidPatterns.push(entity.id);
    if (semanticRole === 'GUIDE') continue;
    if (entity.kind === 'line' && semanticRole !== 'CENTER') {
      nonFinite.push(entity.id);
      continue;
    }
    const points =
      entity.kind === 'line'
        ? [
            entity.anchor,
            { x: entity.anchor.x + entity.direction.x, y: entity.anchor.y + entity.direction.y },
          ]
        : sampleContour(doc, entity);
    sampleCount += points.length;
    if (sampleCount > CONTOUR_SEGMENT_LIMIT * 2) throw Error('图元采样点过多，已达到审核计算上限');
    const path = { entity, points: points.map(position) };
    if (semanticRole === 'CENTER') result.centers.push(path);
    else if (semanticRole === 'HIDDEN') result.hidden.push(path);
    else result.boundary.push(path);
  }
  const check = (
    id: string,
    category: Category,
    severity: DrawingAuditCheck['severity'],
    title: string,
    detail: string,
    entityIds: string[] = [],
    markers: DrawingAuditMarker[] = [],
  ) =>
    add({
      id: `${view.id}-${id}`,
      category,
      severity,
      title: `${view.name} · ${title}`,
      detail,
      viewIds: [view.id],
      entityIds,
      markers,
    });
  check(
    'line-style',
    'LINE_STYLE',
    invalidPatterns.length ? 'WARN' : 'PASS',
    '线型规范',
    invalidPatterns.length
      ? '可见轮廓应使用实线，不可见轮廓应使用虚线。请核对高亮对象的线型。'
      : '可见轮廓使用实线，不可见轮廓使用虚线。中心线与辅助线单独识别。',
    invalidPatterns,
  );
  if (nonFinite.length)
    check(
      'infinite',
      'CONTOUR',
      'ERROR',
      '轮廓必须有限',
      '用有端点的几何边界替换无限直线。',
      nonFinite,
    );
  result.bounds = boundsOf(result.boundary);
  if (!result.bounds) return result;
  const { contours, problems } = extractDrawingContours(result.boundary, tolerance);
  result.contours = contours;
  for (const [index, problem] of problems.entries()) {
    const overlap = problem.detail.includes('重叠');
    check(
      `topology-${index}`,
      overlap ? 'OVERLAP' : 'CONTOUR',
      'ERROR',
      overlap ? '重叠图元' : '轮廓拓扑',
      problem.detail,
      problem.entityIds,
      problem.points.map(marker),
    );
  }
  check(
    'closed',
    'CONTOUR',
    !contours.length || problems.length ? 'ERROR' : 'PASS',
    '闭合轮廓',
    contours.length
      ? `识别 ${contours.filter((contour) => !contour.hole).length} 个外环、${contours.filter((contour) => contour.hole).length} 个内环。端点合并阈值 ${CONTOUR_JOIN_MM} mm。`
      : '找不到可用的闭合区域，请检查边界和端点。',
    result.boundary.map(({ entity }) => entity.id),
  );
  const { min, max } = result.bounds;
  const outside = result.hidden.flatMap(({ entity, points }) => {
    const point = points.find(
      ({ x, y }) =>
        x < min.x - tolerance ||
        x > max.x + tolerance ||
        y < min.y - tolerance ||
        y > max.y + tolerance,
    );
    return point ? [{ id: entity.id, point }] : [];
  });
  if (result.hidden.length)
    check(
      'hidden',
      'CONTOUR',
      outside.length ? 'WARN' : 'PASS',
      '不可见轮廓范围',
      outside.length
        ? `虚线超出外轮廓包围范围，允许偏差 ${tolerance} mm。`
        : '虚线位于外轮廓包围范围内。',
      outside.map(({ id }) => id),
      outside.map(({ point }) => marker(point)),
    );
  return result;
}

type Sample = { p: Vec2; id: string };
function compareProjections(
  doc: GeometryDocument,
  a: AuditedDrawingView,
  b: AuditedDrawingView,
  axis: SolidAxis,
  category: Category,
  title: string,
  tolerance: number,
): DrawingAuditCheck {
  const component = (s: AuditedDrawingView) =>
    projectionPlaneAxes[s.direction!][0] === axis ? 'x' : 'y';
  const span = (s: AuditedDrawingView) => {
    const c = component(s);
    return [s.bounds!.min[c], s.bounds!.max[c]] as const;
  };
  const boundsA = span(a),
    boundsB = span(b);
  const delta = Math.max(Math.abs(boundsA[0] - boundsB[0]), Math.abs(boundsA[1] - boundsB[1]));
  const details = (s: AuditedDrawingView): Sample[] => {
    const c = component(s);
    const [lo, hi] = span(s);
    const samples: Sample[] = [];
    const add = (p: Vec2, id: string) => {
      if (p[c] > lo + tolerance && p[c] < hi - tolerance) samples.push({ p, id });
    };
    for (const { entity, points } of [...s.boundary, ...s.hidden, ...s.centers]) {
      if (entity.kind === 'circle' || entity.kind === 'ellipse' || entity.kind === 'arc') {
        const center = doc.entities.find((item) => item.id === entity.center);
        if (center?.kind === 'point')
          add(toProjectionPlane(s.view, s.direction!, center.position), entity.id);
      } else if (
        entity.kind === 'segment' ||
        entity.kind === 'line' ||
        entity.kind === 'polyline'
      ) {
        for (const [i, p] of points.slice(1).entries())
          if (Math.abs(p[c] - points[i][c]) <= CONTOUR_JOIN_MM)
            add({ x: (p.x + points[i].x) / 2, y: (p.y + points[i].y) / 2 }, entity.id);
      }
    }
    return samples;
  };
  const markers: DrawingAuditMarker[] = [];
  const ids = new Set<string>();
  const mark = (s: AuditedDrawingView, sample: Sample) => {
    ids.add(sample.id);
    if (markers.length < 24)
      markers.push({
        viewId: s.view.id,
        position: fromProjectionPlane(s.view, s.direction!, sample.p),
        label: `${axis.toUpperCase()} ${sample.p[component(s)].toFixed(2)} mm`,
      });
  };
  const base = {
    id: `projection-${axis}`,
    category,
    title,
    viewIds: [a.view.id, b.view.id],
    markers,
  };
  if (delta > tolerance) {
    for (const [s, bounds, other] of [
      [a, boundsA, boundsB],
      [b, boundsB, boundsA],
    ] as const) {
      const c = component(s);
      for (const [index, value] of bounds.entries()) {
        if (Math.abs(value - other[index]) <= tolerance) continue;
        for (const { entity, points } of s.boundary) {
          const p = points.find((p) => Math.abs(p[c] - value) <= CONTOUR_JOIN_MM);
          if (p) mark(s, { p, id: entity.id });
        }
      }
    }
    return {
      ...base,
      severity: 'ERROR',
      entityIds: [...ids],
      detail: `${a.direction}/${b.direction} 的 ${axis.toUpperCase()} 包围范围最大错位 ${delta.toFixed(3)} mm，允许偏差 ${tolerance} mm。`,
    };
  }
  const featuresA = details(a),
    featuresB = details(b);
  if (featuresA.length && featuresB.length) {
    for (const [s, own, other, counterparts] of [
      [a, featuresA, b, featuresB],
      [b, featuresB, a, featuresA],
    ] as const) {
      const k = component(s),
        l = component(other);
      const sorted = [...counterparts].sort((a, b) => a.p[l] - b.p[l]);
      for (const sample of own) {
        const position = sample.p[k];
        let lo = 0,
          hi = sorted.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (sorted[mid].p[l] < position - tolerance) lo = mid + 1;
          else hi = mid;
        }
        if (lo === sorted.length || sorted[lo].p[l] > position + tolerance) mark(s, sample);
      }
    }
  }
  return {
    ...base,
    entityIds: [...ids],
    severity: ids.size ? 'WARN' : 'PASS',
    detail: ids.size
      ? `${a.direction}/${b.direction} 外轮廓范围对齐，部分内部边界或圆心在 ${tolerance} mm 内无对应特征，请核对遮挡和投影位置。`
      : `${a.direction}/${b.direction} 的 ${axis.toUpperCase()} 范围和可比较特征对齐，允许偏差 ${tolerance} mm。`,
  };
}

/** Reuse the very same inspected contours for reconstruction. Positions are in drawing mm. */
export function inspectDrawing(doc: GeometryDocument): {
  report: DrawingAuditReport;
  views: AuditedDrawingView[];
} {
  const toleranceMm = doc.settings.tolerance;
  const checks: DrawingAuditCheck[] = [];
  const isOrthographic = orthographic(doc);
  const auxiliary = new Set(doc.auxiliarySystems?.map((system) => system.newViewId));
  const views = doc.views
    .filter((view) => !auxiliary.has(view.id))
    .map((view) => {
      const direction = isOrthographic ? directionOf(view) : undefined;
      try {
        return inspectView(doc, view, direction, toleranceMm, (check) => checks.push(check));
      } catch (error) {
        checks.push({
          id: `${view.id}-complexity`,
          category: 'CONTOUR',
          severity: 'ERROR',
          title: `${view.name} · 无法审核轮廓`,
          detail: error instanceof Error ? error.message : '无法解析轮廓',
          viewIds: [view.id],
          entityIds: [],
          markers: [],
        });
        return { view, direction, contours: [], boundary: [], hidden: [], centers: [] };
      }
    });
  const required: ProjectionDirection[] =
    doc.editorType === 'VH_PROJECTION' ? ['V', 'H'] : ['V', 'H', 'W'];
  const byDirection = new Map(
    views.filter((view) => view.direction && view.bounds).map((view) => [view.direction!, view]),
  );
  const missing = required.filter((direction) => !byDirection.has(direction));
  const enough = isOrthographic
    ? byDirection.size >= 2 && (doc.editorType !== 'VH_PROJECTION' || !missing.length)
    : views.some(({ bounds }) => bounds);
  checks.unshift({
    id: 'required-views',
    category: 'VIEWS',
    title: '必要视图',
    severity: !enough ? 'ERROR' : isOrthographic && missing.length ? 'WARN' : 'PASS',
    detail: !enough
      ? isOrthographic
        ? `缺少必要的投影轮廓（${missing.join('、')}），请补齐可用视图。`
        : '请先绘制轴测轮廓。'
      : isOrthographic && missing.length
        ? `缺少 ${missing.join('、')} 轮廓，三维结果基于其余两面推演。`
        : isOrthographic
          ? '必要的基础投影包含可见轮廓。'
          : '轴测图可检查闭合、重叠与线型。',
    viewIds: views.filter(({ bounds }) => !bounds).map(({ view }) => view.id),
    entityIds: [],
    markers: [],
  });
  for (const [first, second, axis, category, title] of [
    ['V', 'H', 'x', 'LENGTH', '长对正'],
    ['V', 'W', 'z', 'HEIGHT', '高平齐'],
    ['H', 'W', 'y', 'DEPTH', '宽相等'],
  ] as const) {
    const a = byDirection.get(first),
      b = byDirection.get(second);
    if (a && b) checks.push(compareProjections(doc, a, b, axis, category, title, toleranceMm));
  }
  const errors = checks.filter(({ severity }) => severity === 'ERROR').length;
  const warnings = checks.filter(({ severity }) => severity === 'WARN').length;
  const status = errors ? 'FAIL' : warnings ? 'WARN' : 'PASS';
  return {
    views,
    report: {
      status,
      canReconstruct3D: isOrthographic && enough && !errors,
      toleranceMm,
      checks,
      summary: errors
        ? `有 ${errors} 项问题需要修正。`
        : warnings
          ? `通过基础检查，有 ${warnings} 项需核对。`
          : '已通过适用的制图检查。',
    },
  };
}

export function auditDrawing(doc: GeometryDocument): DrawingAuditReport {
  return inspectDrawing(doc).report;
}
