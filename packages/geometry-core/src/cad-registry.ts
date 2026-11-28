import { roughnessAccessories, roughnessExtents, roughnessTextures } from './engineering-parameters';
import type { GeometryDocument, GeometryEntity, Vec2 } from '@tuheng/contracts';
import type { SnapCandidate } from './snapping';

export interface CadField {
  key: string;
  label: string;
  defaultValue: string;
  options?: string[];
}
type Group = '绘图' | '尺寸标注' | '高级标注' | '修改';
type SelectionMode = 'none' | 'objects' | 'boundaries' | 'corner' | 'radial' | 'region';
const field = (key: string, label: string, defaultValue = '', options?: string[]): CadField => ({
  key,
  label,
  defaultValue,
  options,
});
const radius = field('radius', '半径 mm');
const direction = field('direction', '弧方向', '逆时针', ['逆时针', '顺时针', '劣弧']);
const leader = field('leader', '引出方式', '自动', ['自动','直接放置']);
const size = field('size', '字高 / 符号高度 mm', '3.5');
const rotation = field('angle', '角度 °', '0');
const dimensionFields = [
  field('precision', '小数位数', '2'),
  size,
  field('arrowStyle', '箭头', '闭合', ['闭合', '开放']),
  field('textOverride', '显示文字（空白使用实测值）'),
  field('toleranceCode', '公差代号'),
  field('toleranceUpper', '上偏差'),
  field('toleranceLower', '下偏差'),
];

function define<const T extends string>(
  id: T,
  name: string,
  alias: string,
  group: Group,
  steps: string[],
  fields: CadField[] = [],
  selection: SelectionMode = 'none',
) {
  return {
    id,
    name,
    aliases: [alias, name],
    group,
    steps,
    fields,
    selection,
    acceptsSelection: selection !== 'none',
    permission: 'edit' as const,
  };
}
export const CAD_COMMANDS = [
  define('point', '点', 'po', '绘图', ['定位点']),
  define(
    'segment',
    '直线',
    'l',
    '绘图',
    ['选择起点', '选择下一端点或输入相对坐标'],
    [field('length', '长度 mm'), rotation],
  ),
  define('connect', '连接两点', 'join', '绘图', ['选择已有起点', '选择同一投影的已有终点']),
  define('line', '无限辅助线', 'xl', '绘图', ['选择通过点', '选择方向点']),
  define(
    'rectangle',
    '矩形',
    'rec',
    '绘图',
    ['选择第一角点', '选择对角点'],
    [field('width', '宽 mm'), field('height', '高 mm')],
  ),
  define('circle', '圆', 'c', '绘图', ['选择圆心', '选择圆周点或指定半径'], [radius]),
  define('arc', '圆心圆弧', 'a', '绘图', ['选择圆心', '选择起点', '选择终点'], [radius, direction]),
  define('arc3', '三点圆弧', 'a3', '绘图', ['选择起点', '选择弧上中间点', '选择终点']),
  define(
    'ellipse',
    '椭圆',
    'el',
    '绘图',
    ['选择中心', '选择一个轴的端点', '选择另一轴的端点'],
    [field('majorRadius', '长半轴 mm'), field('minorRadius', '短半轴 mm'), rotation],
  ),
  define('spline', '插值样条', 'spl', '绘图', ['依序选择经过点，两点可完成直线，三点起生成曲线']),
  define(
    'polygon',
    '正多边形',
    'pol',
    '绘图',
    ['选择中心', '选择半径与方向'],
    [
      field('sides', '边数'),
      field('mode', '圆与多边形', '内接于圆', ['内接于圆', '外切于圆']),
      radius,
      rotation,
    ],
  ),
  define(
    'text',
    '文字',
    't',
    '绘图',
    ['选择文字插入点'],
    [field('content', '文字内容'), size, rotation],
  ),
  define('direction', '方向符号', 'dir', '绘图', ['选择符号位置', '指定箭头方向与长度'],
    [field('label','向视字母','A'), size, field('angle','指定角度 °（可留空）')]),
  define('leftDirection', '左旋方向符号', 'ld', '绘图', ['选择符号位置'], [field('label','向视字母','A'),size, rotation]),
  define('rightDirection', '右旋方向符号', 'rd', '绘图', ['选择符号位置'], [field('label','向视字母','A'),size, rotation]),
  define(
    'linearDimension',
    '线性标注',
    'dli',
    '尺寸标注',
    ['选择第一测量点', '选择第二测量点', '定位尺寸线'],
    [field('linearAxis', '测量方向', '自动', ['自动', 'X', 'Y']), ...dimensionFields],
  ),
  define(
    'alignedDimension',
    '对齐标注',
    'dal',
    '尺寸标注',
    ['选择第一测量点', '选择第二测量点', '定位尺寸线'],
    dimensionFields,
  ),
  define(
    'angularDimension',
    '角度标注',
    'dan',
    '尺寸标注',
    ['点击第一条线或指定顶点', '点击第二条线或射线经过点', '选择第二射线上的点', '定位角度标注'],
    [field('angularMethod','测角方式','自动',['自动','两条线','三点']),...dimensionFields],
  ),
  define(
    'radiusDimension',
    '半径标注',
    'dra',
    '尺寸标注',
    ['定位半径标注'],
    dimensionFields,
    'radial',
  ),
  define(
    'diameterDimension',
    '直径标注',
    'ddi',
    '尺寸标注',
    ['定位直径标注'],
    dimensionFields,
    'radial',
  ),
  define(
    'datum',
    '基准符号',
    'dat',
    '高级标注',
    ['定位基准符号'],
    [field('content', '基准代号', 'A'), leader, size, rotation],
  ),
  define(
    'roughness',
    '表面粗糙度',
    'ra',
    '高级标注',
    ['定位粗糙度符号'],
    [
      field('mode', '加工要求', '基本', ['基本', '去除材料', '不去除材料']),
      field('content', '粗糙度参数', 'Ra 3.2'),
      field('accessory','附加符号','NONE',roughnessAccessories.map(([value])=>value)),
      field('texture','加工纹理','NONE',roughnessTextures.map(([value])=>value)),
      field('method','加工方法'),
      field('extent','范围','NONE',roughnessExtents.map(([value])=>value)),
      leader,
      size,
      rotation,
    ],
  ),
  define(
    'toleranceFrame',
    '形位公差',
    'gt',
    '高级标注',
    ['定位公差框格'],
    [
      field('characteristic', '几何特征', '∥'),
      field('tolerance', '公差值', '0.1'),
      field('datum', '基准', 'A'),
      leader,
      size,
      rotation,
    ],
  ),
  define(
    'toleranceText',
    '公差文本',
    'tol',
    '高级标注',
    ['定位公差文本'],
    [
      field('nominal', '公称尺寸', '10'),
      field('upper', '上偏差', '+0.1'),
      field('lower', '下偏差', '−0.1'),
      size,
      rotation,
    ],
  ),
  define('move', '移动', 'm', '修改', ['选择基点', '选择目标点'], [], 'objects'),
  define('erase', '删除', 'e', '修改', ['选择要删除的图元'], [], 'objects'),
  define('copy', '复制并定位', 'co', '修改', ['选择基点', '选择副本位置'], [], 'objects'),
  define(
    'rotate',
    '旋转',
    'ro',
    '修改',
    ['选择旋转中心', '指定旋转方向或输入角度'],
    [field('angle', '旋转角 °')],
    'objects',
  ),
  define(
    'mirror',
    '镜像',
    'mi',
    '修改',
    ['选择镜像轴第一点', '选择轴上第二点'],
    [field('source', '源对象', '保留', ['保留', '删除'])],
    'objects',
  ),
  define('trim', '修剪', 'tr', '修改', ['点选待修剪区段，或在空白处取两角框切'], [], 'boundaries'),
  define('extend', '延伸', 'ex', '修改', ['点击待延伸线段靠近目标的端点'], [], 'boundaries'),
  define(
    'chamfer',
    '倒角',
    'cha',
    '修改',
    ['选择第一条线保留的一侧', '选择第二条线保留的一侧'],
    [
      field('distanceA', '第一边距离 mm（留空用指针）'),
      field('distanceB', '第二边距离 mm（留空用指针）'),
      field('trim', '原边', '修剪', ['修剪', '保留']),
    ],
    'corner',
  ),
  define(
    'fillet',
    '倒圆角',
    'fil',
    '修改',
    ['选择第一条线保留的一侧', '选择第二条线保留的一侧'],
    [field('radius', '圆角半径 mm（留空用指针）'), field('trim', '原边', '修剪', ['修剪', '保留'])],
    'corner',
  ),
  define(
    'hatch',
    '剖面线',
    'h',
    '修改',
    ['选择外轮廓及内孔边界后确认'],
    [field('angle', '剖面线角度 °', '45'), field('spacing', '图纸间距 mm', '2')],
    'region',
  ),
  define(
    'compass',
    '圆规',
    'cp',
    '绘图',
    ['选择量取起点', '选择量取终点', '选择落针中心', '指定方向，右键盖短弧', '选择弧终止方向，或完成以盖短弧'],
    [field('opening', '开度 mm'), direction],
  ),
  define('clear', '清空可编辑图形', 'clear', '修改', ['确认清空当前可编辑图形']),
] as const;
export type CadCommandId = (typeof CAD_COMMANDS)[number]['id'];
export type CadCommandDefinition = (typeof CAD_COMMANDS)[number];
export function cadDefinition(command: string) {
  const found = CAD_COMMANDS.find(
    (c) => c.id === command || c.aliases.includes(command.trim().toLowerCase()),
  );
  if (!found) throw Error('未识别的 CAD 命令');
  return found;
}
export interface CadSession {
  id: string;
  commandId: CadCommandId;
  viewId: string;
  role: 'student' | 'teacher';
  baseDocument: GeometryDocument;
  prefix: string;
  points: Vec2[];
  pointIds: (string | undefined)[];
  rawPoints?: Vec2[];
  hiddenLayers?: readonly string[];
  hatchSpans?: Extract<GeometryEntity, {kind:'hatch'}>['spans'];
  pointSnaps?: (SnapCandidate | undefined)[];
  ids: string[];
  phase: 'setup' | 'selection' | 'points' | 'confirm';
  parameters: Record<string, string>;
  appearance?: GeometryEntity['appearance'];
}
