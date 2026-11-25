import { z } from 'zod';
import { GEOMETRY_DOCUMENT_VERSION, GeometryDocument } from './geometry';

/** 使用正式契约派生字段规则，为新图纸补齐局部坐标系所需字段。 */
export function geometryDocumentJsonSchema() {
  const { sheet, auxiliarySystems, views, entities } = GeometryDocument.shape;
  const current = GeometryDocument.safeExtend({
    schemaVersion: z.literal(GEOMETRY_DOCUMENT_VERSION),
    coordinateSystem: z.literal('VIEW_LOCAL_WITH_SHEET_TRANSFORM'),
    sheet: sheet.unwrap(),
    auxiliarySystems: auxiliarySystems.unwrap(),
    views: views.describe('每个视图需要 transform，将视图局部坐标映射到统一图纸。'),
    entities: entities.describe('每个实体使用唯一 id。端点、圆心和边界等通过已存在的 ID 引用。'),
  });
  return {
    ...z.toJSONSchema(current, {
      target: 'draft-2020-12',
      reused: 'ref',
      override({ zodSchema, jsonSchema }) {
        // 旧版读入允许缺少 transform。V3 的文件规则可以直接声明此字段必填。
        if (zodSchema === views.element)
          jsonSchema.required = [...(jsonSchema.required ?? []), 'transform'];
      },
    }),
    title: '图衡 CAD 图纸 3.0',
    description:
      '单位为毫米，角度为度。保留已有图纸的视图、图层及对象 ID。跨对象引用、教学权限和几何有效性由图衡导入时验证。',
  };
}
