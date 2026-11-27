# 分步作图、格式审核与三维预览验收

使用 Playwright 驱动生产构建上的 Chromium 158.0.8127.37，登录独立作图页并加载合成三视图。示例为 56 × 38 × 40 mm 的长方体，俯视图含直径 18 mm 的贯通孔。另将 H 视图沿 X 偏移 7 mm 验证阻断与画布定位。[示例图纸](../../geometry-examples/construction/THREE-VIEW-CONSTRUCTION.json) · [独立动画](../../geometry-examples/construction/THREE-VIEW-CONSTRUCTION.animation.json) · [浏览器用例](../../../tests/e2e/geometry-milestone3.spec.ts)

| 截图 | 验证内容 |
| --- | --- |
| [01 基准与中心线](01-centerlines.png) | 蓝色点画中心线，橙色孔心 O。 |
| [02 投影与主轮廓](02-projection-and-strokes.png) | 蓝线扫出后定位 A、B，红色轮廓按笔顺描画，前序中心线变灰。 |
| [03 擦除](03-erasing.png) | 越界区段呈虚点线。 |
| [04 加深](04-deepened.png) | 加深可见轮廓，保留虚线孔壁和点画中心线。 |
| [05 错位审核](05-audit-misalignment.png) | 长对正错位与对应端部定位，重建入口禁用。 |
| [06 双窗教学](06-animation-and-solid.png) | 二维成图与三维半透明模型，贯通孔可见。 |
| [07 手机立体](07-mobile-solid.png) · [08 手机图纸](08-mobile-animation.png) | 在 390 × 844 CSS 像素视口验证切换。 |

浏览器在指定时刻暂停 SVG 路径动画并采样实际像素，确认蓝线沿同一路径依次覆盖近端和远端。另验证了独立 JSON 导出、清除、导入恢复、精确字段错误、编排选集保存、审核高亮、立体旋转、缩放和双向联动。手机截图来自浏览器视口。

## 内核计算耗时

Windows / Node.js 26.13.1 上各运行 25 次，计时包含审核、投影裁剪和网格提取。浏览器通过 Worker 使用同一计算入口。

| 形体 | 三角面 | 中位数 | P95 |
| --- | ---: | ---: | ---: |
| 长方体 | 12 | 0.68 ms | 0.93 ms |
| 空心圆筒 | 912 | 13.89 ms | 26.02 ms |
| 三视图贯通孔示例 | 548 | 6.61 ms | 10.83 ms |

单元测试另外比较 L/T 台阶、斜面交集、半圆轮廓、VH 双视图和空交集。网格检查覆盖包围盒、体积、三角法线、边的双向邻接及贯通孔的轴向连通。[重建测试](../../../tests/unit/solid-reconstruction.test.ts)

## 整站回归

2026-11-28 在 Windows、Node.js 26.13.1 和隔离 PostgreSQL、Redis、私有 S3 兼容桶中执行。浏览器回归使用生产 Web 与隔离 Worker，SMTP 用例连接本地协议替身。

| 命令 | 最终结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 40 个文件，433 项通过 |
| `npm run test:integration` | 12 个文件，73 项通过 |
| `npm run build` | 构建首次出现 Next.js 安全升级提示，按相同命令重试后通过 |
| `npm run test:e2e` | 生产构建上 189 项全部通过，耗时 6.7 分钟 |

完整回归覆盖学期和资源读写、VH 两面投影与 DXF 交换，以及本次制图教学功能。作业浏览器用例提交带动画的正式快照，在学生答卷和教师复核中播放，并检查减少动态效果时的时长。评分集成测试同时验证正式答卷留存动画、评分证据只带几何，以及正式成绩仍由教师确认。
