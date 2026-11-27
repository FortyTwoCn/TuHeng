import {
  CONSTRUCTION_ANIMATION_VERSION,
  ConstructionAnimationDocument,
  GEOMETRY_DOCUMENT_VERSION,
  GeometryDocument,
  checkConstructionAnimationReferences,
  constructionReferenceFields,
  type ConstructionAnimationStep,
  type GeometryEntity,
} from '@tuheng/contracts';
import { formatJsonIssue, type JsonIssue } from './json-issues';
import { localToSheet, orthographic, upgradeGeometryDocument } from './sheet';

export const CONSTRUCTION_ANIMATION_MAX_BYTES = 8_000_000;

export function normalizeConstructionAnimation(input: unknown, doc: GeometryDocument) {
  const result = ConstructionAnimationDocument.safeParse(input);
  if (!result.success)
    throw Error(
      result.error.issues
        .map((issue) => {
          const field = issue.path.reduce<unknown>(
            (value, key) =>
              value && typeof value === 'object' ? Reflect.get(value, key) : undefined,
            input,
          );
          const message =
            field === undefined && issue.code === 'invalid_value' ? '缺少必填字段' : undefined;
          return formatJsonIssue(message ? { ...issue, code: 'custom', message } : issue);
        })
        .join('；'),
    );
  const issues: JsonIssue[] = [];
  checkConstructionAnimationReferences(result.data, doc, (path, message) =>
    issues.push({ code: 'custom', path, message }),
  );
  if (issues.length) throw Error(issues.map(formatJsonIssue).join('；'));
  return result.data;
}

export function parseConstructionAnimationJson(rawText: string, doc: GeometryDocument) {
  if (new TextEncoder().encode(rawText).length > CONSTRUCTION_ANIMATION_MAX_BYTES)
    throw Error('$ 动画文件超过 8MB');
  let input: unknown;
  try {
    input = JSON.parse(rawText.replace(/^\uFEFF/, ''));
  } catch {
    throw Error('$ JSON 语法无效，请检查引号、逗号和括号');
  }
  if (
    input &&
    typeof input === 'object' &&
    'schemaVersion' in input &&
    input.schemaVersion === GEOMETRY_DOCUMENT_VERSION
  ) {
    if ('editorType' in input && input.editorType !== doc.editorType)
      throw Error('$.editorType 来源图纸类型与当前图纸不一致');
    if (!('constructionAnimation' in input))
      throw Error('$.constructionAnimation 来源图纸未包含分步动画');
    try {
      return normalizeConstructionAnimation(input.constructionAnimation, doc);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw Error(error.message.replace(/(^|；)\$/g, '$1$.constructionAnimation'));
    }
  }
  return normalizeConstructionAnimation(input, doc);
}

export function serializeConstructionAnimationJson(animation: ConstructionAnimationDocument) {
  return JSON.stringify(ConstructionAnimationDocument.parse(animation), null, 2) + '\n';
}

export function withConstructionAnimation(
  doc: GeometryDocument,
  animation?: ConstructionAnimationDocument,
) {
  const next = upgradeGeometryDocument(doc);
  if (animation) {
    next.schemaVersion = GEOMETRY_DOCUMENT_VERSION;
    next.constructionAnimation = normalizeConstructionAnimation(animation, next);
  } else delete next.constructionAnimation;
  return GeometryDocument.parse(next);
}

/** Geometry edits can remove referenced objects. Imports are always validated without pruning. */
export function retainConstructionAnimationReferences(doc: GeometryDocument) {
  const animation = doc.constructionAnimation;
  if (!animation) return;
  const ids = new Set(doc.entities.map((entity) => entity.id));
  const views = new Set(doc.views.map((view) => view.id));
  for (const step of animation.steps) {
    for (const field of constructionReferenceFields)
      if (step[field]) step[field] = step[field].filter((id) => ids.has(id));
    if (step.temporaryGuides)
      step.temporaryGuides = step.temporaryGuides.filter(
        (guide) => !guide.viewId || views.has(guide.viewId),
      );
  }
}

export type ConstructionVisualRole =
  | 'HIDDEN'
  | 'ACTIVE_CONSTRUCT'
  | 'ACTIVE_DRAW'
  | 'COMPLETED_DRAFT'
  | 'ERASING'
  | 'ERASED'
  | 'DEEPENED';

export type ConstructionVisual = {
  role: ConstructionVisualRole;
  order: number;
  isGuide?: boolean;
  isCenterline?: boolean;
  highlightRole?: ConstructionAnimationStep['highlightRole'];
};

const isGuide = (entity: GeometryEntity) =>
  entity.lineStyle === 'CONSTRUCTION' ||
  entity.appearance?.pattern === 'GUIDE' ||
  entity.appearance?.pattern === 'PHANTOM';

export function evaluateConstructionAnimationState(
  doc: GeometryDocument,
  animation: ConstructionAnimationDocument,
  stepIndex: number,
) {
  const entities = new Map(
    doc.entities.map(
      (entity) =>
        [
          entity.id,
          {
            role: 'HIDDEN',
            order: -1,
            isGuide: isGuide(entity),
            isCenterline: entity.appearance?.pattern === 'CENTER',
          } satisfies ConstructionVisual,
        ] as [string, ConstructionVisual],
    ),
  );
  const guides = new Map<
    string,
    NonNullable<ConstructionAnimationStep['temporaryGuides']>[number] & ConstructionVisual
  >();
  const focusPoints = new Map<
    string,
    NonNullable<ConstructionAnimationStep['focusPoints']>[number] & ConstructionVisual
  >();
  let deepened = false;
  for (const [index, step] of animation.steps.entries()) {
    const active = index === stepIndex;
    if (index <= stepIndex) {
      if (step.kind === 'DEEPEN') deepened = true;
      let constructOrder = 0;
      const apply = (
        id: string,
        role: ConstructionVisualRole,
        order: number,
        centerline = false,
      ) => {
        const visual = entities.get(id);
        if (!visual || visual.role === 'ERASED') return;
        visual.role = active ? role : 'COMPLETED_DRAFT';
        visual.order = order;
        if (centerline) visual.isCenterline = true;
        if (role === 'ACTIVE_DRAW' && step.highlightRole) visual.highlightRole = step.highlightRole;
      };
      const assisting = new Set(step.constructionEntityIds);
      for (const id of assisting) {
        apply(id, 'ACTIVE_CONSTRUCT', constructOrder++);
        const visual = entities.get(id);
        if (visual) visual.isGuide = true;
      }
      step.entityIds.forEach((id, order) => {
        if (assisting.has(id)) return;
        const construct = step.kind === 'CENTERLINE' || step.kind === 'CONSTRUCT';
        apply(
          id,
          construct ? 'ACTIVE_CONSTRUCT' : 'ACTIVE_DRAW',
          construct ? constructOrder++ : order,
          step.kind === 'CENTERLINE',
        );
      });
      step.eraseEntityIds?.forEach((id, order) => {
        const visual = entities.get(id);
        if (visual && visual.role !== 'ERASED')
          Object.assign(visual, { role: active ? 'ERASING' : 'ERASED', order });
      });
      step.temporaryGuides?.forEach((guide, order) =>
        guides.set(`${step.id}:${guide.id}`, {
          ...guide,
          isGuide: true,
          order: constructOrder + order,
          role: active ? 'ACTIVE_CONSTRUCT' : 'COMPLETED_DRAFT',
        }),
      );
      step.focusPoints?.forEach((focus, order) =>
        focusPoints.set(`${step.id}:${focus.id}`, {
          ...focus,
          order,
          role: active ? 'ACTIVE_DRAW' : 'COMPLETED_DRAFT',
        }),
      );
    } else {
      step.temporaryGuides?.forEach((guide) =>
        guides.set(`${step.id}:${guide.id}`, {
          ...guide,
          isGuide: true,
          order: -1,
          role: 'HIDDEN',
        }),
      );
      step.focusPoints?.forEach((focus) =>
        focusPoints.set(`${step.id}:${focus.id}`, { ...focus, order: -1, role: 'HIDDEN' }),
      );
    }
  }
  if (deepened) {
    doc.entities.forEach(({ id }, order) => {
      const visual = entities.get(id)!;
      if (visual.role === 'ERASED' || visual.role === 'ERASING') return;
      visual.role = visual.isGuide && !visual.isCenterline ? 'HIDDEN' : 'DEEPENED';
      if (visual.role === 'DEEPENED' && visual.order < 0) visual.order = order;
    });
    for (const visual of [...guides.values(), ...focusPoints.values()]) visual.role = 'HIDDEN';
  }
  return { entities, temporaryGuides: guides, focusPoints, deepened };
}

export function deriveDefaultConstructionAnimation(
  doc: GeometryDocument,
): ConstructionAnimationDocument {
  const phases = [
    { id: 'datum', order: 0, title: '中心线与定位线' },
    { id: 'outline', order: 1, title: '主要形体轮廓' },
    { id: 'details', order: 2, title: '不可见轮廓与标注' },
    { id: 'finish', order: 3, title: '检查与加深' },
  ];
  const groups = new Map<string, string[]>();
  for (const entity of doc.entities) {
    if (entity.kind === 'point' && !entity.labelVisible) continue;
    const group =
      entity.appearance?.pattern === 'CENTER'
        ? 'center'
        : isGuide(entity)
          ? 'guides'
          : ['dimension', 'hatch', 'text', 'engineeringAnnotation', 'symbol'].includes(entity.kind)
            ? 'annotations'
            : entity.lineStyle.endsWith('_HIDDEN')
              ? 'hidden'
              : entity.lineStyle.startsWith('PROBLEM_')
                ? 'stem'
                : 'visible';
    const ids = groups.get(group) ?? [];
    ids.push(entity.id);
    groups.set(group, ids);
  }
  const { datum, projection } = derivedGuides(doc);
  const steps: ConstructionAnimationStep[] = [];
  const add = (
    id: string,
    phaseId: string,
    kind: ConstructionAnimationStep['kind'],
    title: string,
    narration: string,
    temporaryGuides?: ConstructionAnimationStep['temporaryGuides'],
  ) => {
    const entityIds = groups.get(id) ?? [];
    if (entityIds.length || temporaryGuides?.length || kind === 'DEEPEN')
      steps.push({
        id,
        order: steps.length,
        phaseId,
        title,
        narration,
        kind,
        entityIds,
        temporaryGuides,
      });
  };
  add(
    'center',
    'datum',
    'CENTERLINE',
    '确定中心与基准',
    '先确定对称轴、孔中心和各视图的定位基准。',
    datum,
  );
  add(
    'stem',
    'datum',
    'DRAW',
    '核对已知轮廓',
    '辨认题干给出的轮廓，以它们为依据确定待补对象的位置。',
  );
  add(
    'guides',
    'outline',
    'CONSTRUCT',
    '作投影与对正辅助线',
    '按长对正、高平齐、宽相等传递位置。需要时通过 45° 辅助线传递深度。',
    projection,
  );
  add(
    'visible',
    'outline',
    'DRAW',
    '描画可见轮廓',
    '按笔顺连出可见棱边及曲线。核对各视图中的对应位置。',
  );
  add('hidden', 'details', 'DRAW', '补画不可见轮廓', '检查被遮挡的边和孔壁，确定虚线的起止位置。');
  add('annotations', 'details', 'DRAW', '补齐剖面与标注', '检查剖面线方向、尺寸位置和文字标注。');
  add(
    'deepen',
    'finish',
    'DEEPEN',
    '检查线型并加深',
    '检查投影对应和闭合关系，去除多余辅助线。按可见、不可见和中心线的规定线型整理成图。',
  );
  const used = new Set(steps.map(({ phaseId }) => phaseId));
  return {
    schemaVersion: CONSTRUCTION_ANIMATION_VERSION,
    editorType: doc.editorType,
    title: doc.metadata.title.trim().slice(0, 105) || '分步作图',
    description: '根据图纸中已有的线型与对象自动编排。',
    phases: phases.filter(({ id }) => used.has(id)).map((phase, order) => ({ ...phase, order })),
    steps,
  };
}

function derivedGuides(doc: GeometryDocument) {
  type Guide = NonNullable<ConstructionAnimationStep['temporaryGuides']>[number];
  const datum: Guide[] = [],
    projection: Guide[] = [];
  if (!orthographic(doc)) return { datum, projection };
  const front = doc.views.find((view) => view.mapping.join() === 'x,z');
  const plan = doc.views.find((view) => view.mapping.join() === 'x,y');
  if (!front || !plan) return { datum, projection };
  const nodes = (view: typeof front) =>
    doc.entities.flatMap((entity) =>
      entity.kind === 'point' &&
      entity.viewId === view.id &&
      entity.scope !== 'SHEET' &&
      !isGuide(entity)
        ? [localToSheet(doc, view.id, entity.position)]
        : [],
    );
  const upright = nodes(front),
    flat = nodes(plan);
  const inRange = (p: { x: number; y: number }) => Math.abs(p.x) <= 10000 && Math.abs(p.y) <= 10000;
  if (upright.length && flat.length) {
    const allX = [...upright, ...flat].map(({ x }) => x);
    const left = Math.max(-10000, Math.min(...allX) - 5),
      right = Math.min(10000, Math.max(...allX) + 5);
    if (right - left > 1e-6)
      datum.push({
        id: 'reference-x',
        kind: 'ALIGNMENT',
        from: { x: left, y: 0 },
        to: { x: right, y: 0 },
        label: 'X 基准',
      });
    const byHorizontal = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      a.x - b.x || Math.abs(b.y) - Math.abs(a.y);
    const upper = upright.sort(byHorizontal),
      lower = flat.sort(byHorizontal);
    const matches: Guide[] = [];
    let j = 0;
    for (const from of upper) {
      while (j < lower.length && lower[j].x < from.x - doc.settings.tolerance) j++;
      const to = lower[j];
      if (
        !to ||
        Math.abs(from.x - to.x) > doc.settings.tolerance ||
        Math.abs(from.y - to.y) <= 1e-6 ||
        !inRange(from) ||
        !inRange(to) ||
        Math.abs((matches.at(-1)?.from.x ?? Infinity) - from.x) <= doc.settings.tolerance
      )
        continue;
      matches.push({
        id: `x-project-${matches.length}`,
        viewId: plan.id,
        kind: 'PROJECTION',
        from,
        to,
      });
    }
    if (matches.length > 1) projection.push(matches[0], matches.at(-1)!);
    else projection.push(...matches);
  }
  return { datum, projection };
}
