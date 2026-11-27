import { dxfAppId, dxfAxisLayer, dxfPointTags, type DxfPair } from './dxf-format';
import {
  dxfAnnotationSuffix,
  dxfLayerNames,
  dxfLinePatterns,
  dxfReferenceLayer,
} from './dxf-styles';

/** 文件句柄和所有者仅用于 DXF 结构，不暴露图衡实体 ID。 */
export class DxfWriter {
  private readonly pairs: DxfPair[] = [];
  private nextHandle = 16;
  private modelSpace = '';

  private handle() {
    return (this.nextHandle++).toString(16).toUpperCase();
  }
  private write(pairs: DxfPair[]) {
    for (const pair of pairs) this.pairs.push(pair);
  }
  private section(name: string) {
    this.write([
      [0, 'SECTION'],
      [2, name],
    ]);
  }
  private endSection() {
    this.write([[0, 'ENDSEC']]);
  }

  private table(name: string, rows: DxfPair[][]) {
    const owner = this.handle();
    this.write([
      [0, 'TABLE'],
      [2, name],
      [5, owner],
      [330, '0'],
      [100, 'AcDbSymbolTable'],
      [70, rows.length],
    ]);
    for (const row of rows)
      this.write([
        row[0],
        [5, this.handle()],
        [330, owner],
        [100, 'AcDbSymbolTableRecord'],
        ...row.slice(1),
      ]);
    this.write([[0, 'ENDTAB']]);
  }

  constructor() {
    this.section('TABLES');
    const types = [
      { name: 'BYBLOCK', dashes: [] },
      { name: 'BYLAYER', dashes: [] },
      ...Object.values(dxfLinePatterns),
    ];
    this.table(
      'LTYPE',
      types.map(({ name, dashes }) => [
        [0, 'LTYPE'],
        [100, 'AcDbLinetypeTableRecord'],
        [2, name],
        [70, 0],
        [3, name],
        [72, 65],
        [73, dashes.length],
        [40, dashes.reduce((n, dash) => n + Math.abs(dash), 0)],
        ...dashes.flatMap((dash): DxfPair[] => [
          [49, dash],
          [74, 0],
        ]),
      ]),
    );
    const layerColors: [string, number][] = [
      ['0', 7],
      [dxfAxisLayer, 8],
      [dxfReferenceLayer, 8],
      [dxfLayerNames.PROBLEM_STEM, 5],
      [dxfLayerNames.STUDENT_ANSWER, 7],
      [dxfLayerNames.CONSTRUCTION, 8],
    ];
    layerColors.push(
      ...layerColors
        .slice(3)
        .map(([name, color]): [string, number] => [name + dxfAnnotationSuffix, color]),
    );
    this.table(
      'LAYER',
      layerColors.map(([name, color]) => [
        [0, 'LAYER'],
        [100, 'AcDbLayerTableRecord'],
        [2, name],
        [70, 0],
        [62, color],
        [6, 'CONTINUOUS'],
        [370, -3],
      ]),
    );
    this.table('STYLE', [
      [
        [0, 'STYLE'],
        [100, 'AcDbTextStyleTableRecord'],
        [2, 'STANDARD'],
        [70, 0],
        [40, 0],
        [41, 1],
        [50, 0],
        [71, 0],
        [42, 2.5],
        [3, 'arial.ttf'],
        [4, ''],
      ],
    ]);
    this.table('APPID', [
      [
        [0, 'APPID'],
        [100, 'AcDbRegAppTableRecord'],
        [2, 'ACAD'],
        [70, 0],
      ],
      [
        [0, 'APPID'],
        [100, 'AcDbRegAppTableRecord'],
        [2, dxfAppId],
        [70, 0],
      ],
    ]);
    const spaces = ['*Model_Space', '*Paper_Space'].map((name) => ({
      name,
      handle: this.handle(),
    }));
    const blockTable = this.handle();
    this.write([
      [0, 'TABLE'],
      [2, 'BLOCK_RECORD'],
      [5, blockTable],
      [330, '0'],
      [100, 'AcDbSymbolTable'],
      [70, spaces.length],
    ]);
    for (const { name, handle } of spaces)
      this.write([
        [0, 'BLOCK_RECORD'],
        [5, handle],
        [330, blockTable],
        [100, 'AcDbSymbolTableRecord'],
        [100, 'AcDbBlockTableRecord'],
        [2, name],
        [70, 0],
        [280, 1],
        [281, 0],
      ]);
    this.write([[0, 'ENDTAB']]);
    this.endSection();
    this.modelSpace = spaces[0].handle;
    this.section('BLOCKS');
    for (const { name, handle } of spaces) {
      this.write([
        [0, 'BLOCK'],
        [5, this.handle()],
        [330, handle],
        [100, 'AcDbEntity'],
        [8, '0'],
        [100, 'AcDbBlockBegin'],
        [2, name],
        [70, 0],
        ...dxfPointTags(10, { x: 0, y: 0 }, 0),
        [3, name],
        [1, ''],
        [0, 'ENDBLK'],
        [5, this.handle()],
        [330, handle],
        [100, 'AcDbEntity'],
        [8, '0'],
        [100, 'AcDbBlockEnd'],
      ]);
    }
    this.endSection();
    this.section('ENTITIES');
  }

  entity(type: string, layer: string, style: DxfPair[], body: DxfPair[], metadata: DxfPair[] = []) {
    this.write([
      [0, type],
      [5, this.handle()],
      [330, this.modelSpace],
      [100, 'AcDbEntity'],
      [8, layer],
    ]);
    this.write(style);
    this.write(body);
    if (metadata.length) this.write([[1001, dxfAppId], ...metadata]);
  }

  finish() {
    this.endSection();
    this.write([[0, 'EOF']]);
    // R2007 文本 DXF 支持 UTF-8；毫米、线宽和 TrueColor 可由 CAD 直接识别。
    const header: DxfPair[] = [
      [0, 'SECTION'],
      [2, 'HEADER'],
      [9, '$ACADVER'],
      [1, 'AC1021'],
      [9, '$DWGCODEPAGE'],
      [3, 'ANSI_1252'],
      [9, '$INSUNITS'],
      [70, 4],
      [9, '$MEASUREMENT'],
      [70, 1],
      [9, '$LWDISPLAY'],
      [290, 1],
      [9, '$HANDSEED'],
      [5, this.handle()],
      [0, 'ENDSEC'],
    ];
    const lines = (pairs: DxfPair[]) =>
      pairs.map(([code, value]) => `${code}\r\n${value}\r\n`).join('');
    return lines(header) + lines(this.pairs);
  }
}
