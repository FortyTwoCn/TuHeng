import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ConstructionAnimationDocument,
  constructionAnimationJsonSchema,
  geometryDocumentJsonSchema,
} from '@tuheng/contracts';
import {
  createDocument,
  deleteEntities,
  deriveDefaultConstructionAnimation,
  DocumentHistory,
  evaluateConstructionAnimationState,
  exportGeometryBundle,
  loadGeometryDocument,
  normalizeConstructionAnimation,
  parseConstructionAnimationJson,
  serializeConstructionAnimationJson,
  serializeGeometryDocument,
  withConstructionAnimation,
} from '@tuheng/geometry-core';
import { boxDrawing } from '../drawing-projection-fixtures';

const exampleBase = 'docs/geometry-examples/construction/THREE-VIEW-CONSTRUCTION';
const read = (file: string) => readFileSync(file, 'utf8');
const example = () => loadGeometryDocument(read(exampleBase + '.json'));

describe('分步作图动画', () => {
  it('按笔顺生成作图、轮廓、草图、擦除及加深的可逆状态', () => {
    const doc = example(),
      animation = doc.constructionAnimation!;
    const at = (position: number) => evaluateConstructionAnimationState(doc, animation, position);
    expect(at(0).entities.get('v-center-1')).toMatchObject({
      role: 'ACTIVE_CONSTRUCT',
      isCenterline: true,
      order: 0,
    });
    expect(at(0).entities.get('v-outline-1')).toMatchObject({ role: 'HIDDEN' });
    const drawing = at(1);
    expect(drawing.entities.get('v-center-1')).toMatchObject({
      role: 'COMPLETED_DRAFT',
      isCenterline: true,
    });
    expect(drawing.entities.get('v-overrun-1')).toMatchObject({
      role: 'ACTIVE_CONSTRUCT',
      order: 0,
    });
    expect(drawing.temporaryGuides.get('front:left-edge')).toMatchObject({
      role: 'ACTIVE_CONSTRUCT',
      order: 1,
    });
    expect(drawing.focusPoints.get('front:A')).toMatchObject({
      role: 'ACTIVE_DRAW',
      kind: 'SPECIAL',
      order: 0,
    });
    expect(animation.steps[1].entityIds.map((id) => drawing.entities.get(id)?.order)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(at(4).entities.get('v-overrun-1')).toMatchObject({ role: 'ERASING' });
    expect(at(5).entities.get('v-overrun-1')).toMatchObject({ role: 'ERASED' });
    expect(at(5).temporaryGuides.get('front:left-edge')).toMatchObject({ role: 'HIDDEN' });
    expect(at(5).entities.get('v-center-1')).toMatchObject({
      role: 'DEEPENED',
      isCenterline: true,
    });
    expect(at(5).entities.get('h-opening')).toMatchObject({ role: 'DEEPENED' });
    expect(at(1)).toEqual(drawing);
  });

  it('允许相贯线标红延续至加深，同时保持原图和评分证据独立', () => {
    const doc = example(),
      animation = structuredClone(doc.constructionAnimation!);
    animation.steps[3].highlightRole = 'INTERSECTION_CURVE';
    const modified = withConstructionAnimation(doc, animation);
    expect(
      evaluateConstructionAnimationState(modified, animation, 5).entities.get('h-opening'),
    ).toMatchObject({ role: 'DEEPENED', highlightRole: 'INTERSECTION_CURVE' });
    expect(modified.entities).toEqual(doc.entities);
    const bundle = exportGeometryBundle(modified);
    expect(bundle.document.constructionAnimation).toBeUndefined();
    expect(bundle).toEqual(exportGeometryBundle(withConstructionAnimation(modified)));
  });

  it('独立文件、完整图纸和 UTF-8 BOM 往返，并可在当前版本中挂载与移除', () => {
    const doc = example(),
      animation = doc.constructionAnimation!;
    const standalone = read(exampleBase + '.animation.json');
    expect(serializeConstructionAnimationJson(animation)).toBe(standalone);
    expect(parseConstructionAnimationJson('\uFEFF' + standalone, doc)).toEqual(animation);
    expect(parseConstructionAnimationJson(serializeGeometryDocument(doc), doc)).toEqual(animation);
    const original = withConstructionAnimation(doc);
    const legacy = { ...boxDrawing(), schemaVersion: 'tuheng.geometry/2.2.0' as const };
    expect(
      withConstructionAnimation(legacy, deriveDefaultConstructionAnimation(legacy)).schemaVersion,
    ).toBe('tuheng.geometry/3.0.0');
    expect(original.constructionAnimation).toBeUndefined();
  });

  it.each([
    [
      '缺字段',
      '$.steps[1].narration 缺少必填字段',
      (a: ConstructionAnimationDocument) => {
        Reflect.deleteProperty(a.steps[1], 'narration');
      },
    ],
    [
      '类型',
      '$.steps[1].durationMs 应为数字',
      (a: ConstructionAnimationDocument) => {
        Reflect.set(a.steps[1], 'durationMs', 'long');
      },
    ],
    [
      '步骤重复',
      '$.steps[1].id ID',
      (a: ConstructionAnimationDocument) => {
        a.steps[1].id = a.steps[0].id;
      },
    ],
    [
      '阶段重复',
      '$.phases[1].id ID',
      (a: ConstructionAnimationDocument) => {
        a.phases[1].id = a.phases[0].id;
      },
    ],
    [
      '非法顺序',
      '$.phases[1].order 顺序',
      (a: ConstructionAnimationDocument) => {
        a.phases[1].order = 6;
      },
    ],
    [
      '缺阶段',
      '$.steps[1].phaseId 阶段',
      (a: ConstructionAnimationDocument) => {
        a.steps[1].phaseId = 'unknown';
      },
    ],
    [
      '缺实体',
      '$.steps[1].entityIds[0] 图纸实体',
      (a: ConstructionAnimationDocument) => {
        a.steps[1].entityIds[0] = 'ghost';
      },
    ],
    [
      '缺辅助线',
      '$.steps[1].constructionEntityIds[0] 图纸实体',
      (a: ConstructionAnimationDocument) => {
        a.steps[1].constructionEntityIds = ['ghost'];
      },
    ],
    [
      '缺擦除线',
      '$.steps[4].eraseEntityIds[0] 图纸实体',
      (a: ConstructionAnimationDocument) => {
        a.steps[4].eraseEntityIds = ['ghost'];
      },
    ],
    [
      '缺视图',
      '$.steps[1].temporaryGuides[0].viewId 图纸视图',
      (a: ConstructionAnimationDocument) => {
        a.steps[1].temporaryGuides![0].viewId = 'unknown';
      },
    ],
    [
      '图纸类型不同',
      '$.editorType 动画类型',
      (a: ConstructionAnimationDocument) => {
        a.editorType = 'VH_PROJECTION';
      },
    ],
  ] as const)('对%s返回准确路径', (_name, message, edit) => {
    const doc = example(),
      animation = structuredClone(doc.constructionAnimation!);
    edit(animation);
    expect(() => normalizeConstructionAnimation(animation, doc)).toThrow(message);
    expect(doc.constructionAnimation).toEqual(example().constructionAnimation);
  });

  it('完整图纸与动画提取均定位错误的嵌套字段', () => {
    const doc = example();
    doc.constructionAnimation!.steps[1].entityIds[0] = 'unknown';
    expect(() => loadGeometryDocument(JSON.stringify(doc))).toThrow(
      '$.constructionAnimation.steps[1].entityIds[0]',
    );
    expect(() => parseConstructionAnimationJson(JSON.stringify(doc), doc)).toThrow(
      '$.constructionAnimation.steps[1].entityIds[0]',
    );
    expect(() => parseConstructionAnimationJson('{', doc)).toThrow('$ JSON 语法无效');
  });

  it('默认推演为已有投影编排基准、作图线和可见轮廓，空图也可播放', () => {
    const box = boxDrawing();
    const expected = deriveDefaultConstructionAnimation(box);
    expect(normalizeConstructionAnimation(expected, box).steps.map(({ kind }) => kind)).toEqual([
      'CENTERLINE',
      'CONSTRUCT',
      'DRAW',
      'DEEPEN',
    ]);
    expect(expected.steps[1].temporaryGuides).toHaveLength(2);
    expect(deriveDefaultConstructionAnimation(createDocument('VH_PROJECTION')).steps[0].kind).toBe(
      'DEEPEN',
    );
  });

  it('正式删除整理动画引用，撤销恢复原图和教学笔顺', () => {
    const doc = example(),
      history = new DocumentHistory(doc);
    const next = deleteEntities(doc, ['v-outline-1'], 'teacher');
    history.commit(next);
    expect(next.constructionAnimation!.steps[1].entityIds).not.toContain('v-outline-1');
    expect(history.undo().constructionAnimation!.steps[1].entityIds[0]).toBe('v-outline-1');
  });

  it('发布的两个静态 Schema 与下载入口由同一契约派生', () => {
    expect(JSON.parse(read('docs/geometry-schemas/tuheng.geometry.schema.json'))).toEqual(
      geometryDocumentJsonSchema(),
    );
    expect(
      JSON.parse(read('docs/geometry-schemas/tuheng.construction-animation.schema.json')),
    ).toEqual(constructionAnimationJsonSchema());
  });
});
