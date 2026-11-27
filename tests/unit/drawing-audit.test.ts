import { describe, expect, it } from 'vitest';
import { auditDrawing, createDocument } from '@tuheng/geometry-core';
import { boxDrawing, outline, projectedCircle, rectangle } from '../drawing-projection-fixtures';

describe('工程图格式审核', () => {
  it.each(['THREE_VIEW', 'VHW_PROJECTION', 'VH_PROJECTION'] as const)(
    '统一比较 %s 的投影轴',
    (type) => {
      const audit = auditDrawing(boxDrawing(type));
      expect(audit.status).toBe('PASS');
      expect(audit.canReconstruct3D).toBe(true);
      expect(
        audit.checks
          .filter((check) => check.id.startsWith('projection-'))
          .map((check) => check.title),
      ).toEqual(type === 'VH_PROJECTION' ? ['长对正'] : ['长对正', '高平齐', '宽相等']);
    },
  );

  it.each([
    ['view-1', 'x', 'LENGTH'],
    ['view-2', 'y', 'HEIGHT'],
    ['view-2', 'x', 'DEPTH'],
  ] as const)('定位 %s %s 方向投影错位', (viewId, axis, category) => {
    const doc = boxDrawing();
    for (const e of doc.entities)
      if (e.kind === 'point' && e.viewId === viewId) e.position[axis] += 2;
    const audit = auditDrawing(doc);
    expect(audit.status).toBe('FAIL');
    expect(audit.canReconstruct3D).toBe(false);
    expect(audit.checks.find((check) => check.category === category)).toMatchObject({
      severity: 'ERROR',
      entityIds: expect.arrayContaining([expect.any(String)]),
      markers: expect.arrayContaining([expect.objectContaining({ viewId })]),
      detail: expect.stringContaining('2.000 mm'),
    });
  });

  it('包围盒对齐时仍定位内部特征差异及圆心', () => {
    const doc = boxDrawing();
    projectedCircle(doc, 0, 'front-center', [6, 4], 2);
    outline(
      doc,
      1,
      'top-seam',
      [
        [9, 0],
        [9, 14],
      ],
      false,
    );
    expect(auditDrawing(doc).checks.find((check) => check.category === 'LENGTH')).toMatchObject({
      severity: 'WARN',
      entityIds: ['front-center', 'top-seam-1'],
    });
  });

  it('给出细小断口、重复边、虚线范围及显示线型诊断', () => {
    const doc = createDocument('ISOMETRIC');
    outline(
      doc,
      0,
      'outline',
      [
        [0, 0],
        [20, 0],
        [20, 12],
        [0, 12],
        [0, 0.02],
      ],
      false,
    );
    outline(
      doc,
      0,
      'duplicate',
      [
        [2, 0],
        [15, 0],
      ],
      false,
    );
    outline(
      doc,
      0,
      'hidden',
      [
        [2, 2],
        [22, 2],
      ],
      false,
      {
        layerId: 'answer',
        lineStyle: 'ANSWER_HIDDEN',
        appearance: { pattern: 'SOLID' },
      },
    );
    const audit = auditDrawing(doc);
    expect(audit.canReconstruct3D).toBe(false);
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining('0.0200 mm'),
          markers: expect.any(Array),
        }),
        expect.objectContaining({ category: 'OVERLAP', severity: 'ERROR' }),
        expect.objectContaining({
          category: 'LINE_STYLE',
          severity: 'WARN',
          entityIds: ['hidden-1'],
        }),
        expect.objectContaining({
          title: expect.stringContaining('不可见轮廓范围'),
          severity: 'WARN',
        }),
      ]),
    );
  });

  it('轴测图完成闭合审核；缺少一张正交视图时给出双视图提醒', () => {
    const iso = createDocument('OBLIQUE_DIMETRIC');
    outline(iso, 0, 'iso', rectangle(0, 0, 12, 8));
    expect(auditDrawing(iso)).toMatchObject({ status: 'PASS', canReconstruct3D: false });
    const three = boxDrawing();
    three.entities = three.entities.filter((entity) => entity.viewId !== 'view-2');
    expect(auditDrawing(three)).toMatchObject({ status: 'WARN', canReconstruct3D: true });
  });
});
