import {
  GEOMETRY_DOCUMENT_MAX_ENTITIES,
  GEOMETRY_DOCUMENT_VERSION,
  GeometryDocument,
  type EditorType,
} from '@tuheng/contracts';
import { clearEditable } from './document';
import { dxfInsert, readDxfBlocks } from './dxf-blocks';
import { materializeDxf, type DxfBatch } from './dxf-document';
import { groupDxfEntities, readDxfShapes, type DxfEntityRecord } from './dxf-entities';
import {
  DXF_MAX_ENTITIES,
  dxfAppData,
  dxfAppValue,
  dxfAxisLayer,
  dxfName,
  dxfNumber,
  dxfRecords,
  dxfUnitScale,
  parseDxfSections,
  UnsupportedDxfEntity,
  type DxfTags,
} from './dxf-format';
import { readDxfStyles } from './dxf-styles';
import { createDocument } from './projections';
import { upgradeGeometryDocument } from './sheet';

export interface DxfImportOptions {
  document?: GeometryDocument;
  editorType?: EditorType;
  role?: 'teacher' | 'student';
  mode?: 'merge' | 'replace';
  placement?: 'preserve' | 'center';
}

export interface DxfImportWarning {
  type: string;
  count: number;
  message: string;
}

export interface DxfImportReport {
  document: GeometryDocument;
  importedCount: number;
  createdEntityCount: number;
  ignoredCount: number;
  skippedAxisCount: number;
  warnings: DxfImportWarning[];
}

/** 先解析完整文件，再构造新文档。所有图元写到调用方有权编辑的图层。 */
export function importDxfToDocument(text: string, options: DxfImportOptions = {}): DxfImportReport {
  const source = options.document ?? createDocument(options.editorType ?? 'VHW_PROJECTION');
  const role = options.role ?? 'student';
  const sections = parseDxfSections(text);
  const unitScale = dxfUnitScale(sections.get('HEADER') ?? []);
  const styleFor = readDxfStyles(sections.get('TABLES') ?? []);
  const model = sections.get('ENTITIES')!;
  if (model.length && model[0][0] !== 0) throw Error('DXF 的实体段缺少实体类型');
  const records = groupDxfEntities(dxfRecords(model));
  const batches: DxfBatch[] = [];
  const warnings = new Map<string, DxfImportWarning>();
  let ignoredCount = 0,
    skippedAxisCount = 0,
    shapeCount = 0;
  let blocks: ReturnType<typeof readDxfBlocks> | undefined,
    expandedCount = 0;
  function warn(type: string, message: string) {
    const key = type + '/' + message;
    const previous = warnings.get(key);
    warnings.set(key, { type, count: (previous?.count ?? 0) + 1, message });
  }
  function ignore(type: string, message: string) {
    ignoredCount++;
    warn(type, message);
  }
  function read(
    record: DxfEntityRecord,
    sourceIndex: number,
    parent?: Pick<ReturnType<typeof dxfInsert>, 'factor' | 'transform'> & {
      tags: DxfTags;
      layer: string;
    },
  ) {
    const { type, tags } = record;
    const declaredLayer = dxfName(tags, 8) ?? '0';
    const layer = declaredLayer === '0' && parent ? parent.layer : declaredLayer;
    if (layer === dxfAxisLayer) {
      skippedAxisCount++;
      return;
    }
    if (dxfNumber(tags, 67, 0) === 1) {
      ignore(type, '已跳过布局纸空间对象');
      return;
    }
    const metadata = dxfAppData(tags);
    try {
      if (type === 'INSERT' && !parent) {
        blocks ??= readDxfBlocks(sections.get('BLOCKS') ?? []);
        const { block, factor, transform } = dxfInsert(blocks, tags);
        if (!block.entities.length) ignore(type, '块内没有可读图元');
        for (const child of block.entities) {
          expandedCount += 1 + (child.vertices?.length ?? 0);
          if (expandedCount > DXF_MAX_ENTITIES) throw Error('展开后的块内图元超过 20,000');
          read(child, sourceIndex, { factor, transform, tags, layer });
        }
        return;
      }
      const native = readDxfShapes(record, metadata);
      const shapes = parent ? native.map(parent.transform) : native;
      if (!shapes.length) {
        ignore(type, '无可导入的几何');
        return;
      }
      shapeCount += shapes.length;
      if (shapeCount > GEOMETRY_DOCUMENT_MAX_ENTITIES) throw Error('转换图元数量超过图纸上限 2000');
      const width =
        type === 'LWPOLYLINE' ? dxfNumber(tags, 43, 0) * unitScale * (parent?.factor ?? 1) : 0;
      batches.push({
        type,
        sourceIndex,
        shapes,
        style: styleFor(tags, metadata, layer, role, width, parent),
        frameHint: parent ? undefined : dxfAppValue(metadata, 'FRAME'),
      });
      if (type === 'HATCH') warn(type, '已提取剖面边界');
    } catch (error) {
      if (!(error instanceof UnsupportedDxfEntity))
        throw Error(`DXF ${type} 解析失败，${error instanceof Error ? error.message : '图元无效'}`);
      ignore(type, error.message);
    }
  }
  records.forEach((record, index) => read(record, index));
  let document = source,
    importedCount = 0,
    createdEntityCount = 0;
  if (batches.length) {
    const current = upgradeGeometryDocument(source);
    const base =
      options.mode === 'replace'
        ? clearEditable(current, role, { preserveSurvivors: true })
        : current;
    const { added, imported } = materializeDxf(
      base,
      batches,
      unitScale,
      options.placement === 'center',
      GEOMETRY_DOCUMENT_MAX_ENTITIES - base.entities.length,
      warn,
    );
    for (const batch of batches) if (!imported.has(batch)) ignore(batch.type, '无可导入的几何');
    if (added.length) {
      document = GeometryDocument.parse({
        ...base,
        schemaVersion: GEOMETRY_DOCUMENT_VERSION,
        entities: [...base.entities, ...added],
      });
      importedCount = new Set([...imported].map((batch) => batch.sourceIndex)).size;
      createdEntityCount = added.length;
    }
  }
  return {
    document,
    importedCount,
    createdEntityCount,
    ignoredCount,
    skippedAxisCount,
    warnings: [...warnings.values()],
  };
}
