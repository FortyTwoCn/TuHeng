# 画法几何与复杂组合体三维验收

## 示例

两份图纸按题图比例录入为可直接导入编辑器的毫米坐标。题图没有标注尺寸，示例的毫米数值以规范化图纸为准。

| 图纸 | 重建验收 |
| --- | --- |
| [3-19 两面投影](../../geometry-examples/reconstruction/3-19-VH-SPATIAL.json) | 还原 8 个空间点、6 条空间线段和 2 张面片。以 N 到 △CDE 所在平面的垂足作为空间点 1。单测验证解平面经过 N、垂直于 △CDE 并平行于 AB，同时核对 V/H 落点和源图元。 |
| [7-24 完整三视图](../../geometry-examples/reconstruction/7-24-THREE-VIEW-COMPLETE.json) | 组合体尺寸为 88 × 53 × 73 mm。求解检查 57 个实线和虚线图元，输出 6,604 个三角面。闭合流形检查和空间探针覆盖盲槽空腔、槽底材料、耳板实体、两个孔口及贯穿孔道、斜坡与圆角切除区。 |

仅保留 7-24 的主、俯视图时，模型说明会提示内部槽腔与厚度多解。圆角和孔壁沿自适应曲线离散成网格。同一台 Windows 机器上以 Node.js 26.13.0 连续调用 7 次完整图纸重建，计时包含审核和建网格，范围 368–503 ms，中位数 415 ms。

## 生产 Chromium 截图

截图来自已登录的独立作图页，浏览器为 Chrome 158.0.8127.37。Web 使用生产构建，测试请求连接隔离 PostgreSQL、Redis 和私有 S3 测试桶。

| 场景 | 截图 |
| --- | --- |
| 蓝色投影线、红色描画笔迹与定位点叠加在网格上 | [动画进行中](01-animation-on-grid.png) |
| 作图工具与讲解模块随工作区模式切换 | [作图](02-drafting-mode.png) · [讲解](03-teaching-mode.png) |
| 参考图纸停靠、独立浮窗、最小化 | [分屏](04-reference-docked.png) · [浮窗](05-reference-floating.png) · [最小化](06-reference-minimized.png) |
| 选中参考图线查看属性并复制到主画框 | [图元属性](07-reference-properties.png) · [复制结果](08-reference-copied.png) |
| 3-19 题干、解平面与 V/H 投影射线 | [画法几何空间预览](09-3-19-spatial.png) |
| 7-24 斜坡、盲槽及圆角耳板的横向孔道 | [实体](10-7-24-solid.png) · [半透明](11-7-24-translucent.png) |

设定 `CAD_RECONSTRUCTION_EVIDENCE=docs/evidence/cad-modular-3d` 可通过 `geometry-milestone3.spec.ts`、`geometry-milestone4.spec.ts`、`geometry-milestone5.spec.ts` 重取截图。启动隔离服务和生产 Web 的方法见[测试指南](../../TESTING.md)。

## 全量验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 42 个文件，444 项通过 |
| `npm run test:integration` | 12 个文件，73 项通过 |
| `npm run build` | 通过。首次构建完成编译后被 Next.js 的依赖安全提示中断，原命令重试通过。 |
| `npm run test:e2e` | 生产 Web 和测试 Worker 上共 194 项通过，耗时约 6.1 分钟。 |
