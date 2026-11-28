# 讲解工作区双主题验收

2026-11-28 在 Windows 上使用生产构建与 Google Chrome 158.0.8127.37（Chromium）。桌面视口为 1440 × 900，手机视口为 390 × 844，使用 Chromium 触控模拟。

内置 imagegen 先据现有编辑器截图生成了双主题设计板，仅供布局、色板与控件层次参照。下表均为编辑器实际运行截图。[设计参考板](../../images/teaching-ui-20261128/reference.png) · [生图提示词](../../images/teaching-ui-20261128/reference-prompt.txt)

| 截图 | 场景 |
| --- | --- |
| [01 亮色讲解](01-teaching-light.png) | 贯通孔三视图的第二步，原网格、正在描绘的轮廓、讲解栏、时间轴与 3D 空态。 |
| [02 暗色讲解](02-teaching-dark.png) | 同一播放帧切换至暗色，对照投影线、焦点、轮廓和图例。 |
| [03 亮色实体](03-7-24-light-solid.png) · [04 亮色半透明](04-7-24-light-translucent.png) | 7-24 组合体，三视图与轴测双栏。 |
| [05 暗色实体](05-7-24-dark-solid.png) · [06 暗色半透明](06-7-24-dark-translucent.png) | 同一 7-24 镜头，观察可见棱边、盲槽、耳板和贯穿孔。 |
| [07 暗色画法几何](07-3-19-dark-spatial.png) | 3-19 两面投影、V/H 投影面、X-O 轴、空间点、解平面与投影射线。 |
| [08 暗色参考图纸](08-dark-reference-properties.png) | 嵌套参考图纸分屏、线段选集和只读属性。 |
| [09 暗色手机讲解](09-mobile-dark.png) | 390 × 844 讲解栏与可点按的工作区标签。 |

浏览器用例实际操作状态栏的明暗按钮。断言涵盖亮暗往返的计算样式、加深轮廓与焦点文字对比度、七种图例样例与 SVG 颜色、三维背景及实体像素、参考图纸分屏与浮窗、手机工作区宽度和时间轴横向滚动。截图 01 与 02 固定到真实 SVG 动画的同一播放时刻。[Playwright 用例](../../../tests/e2e/geometry-milestone6.spec.ts)

按照隔离环境的生产 Web 启动流程，将 `CAD_TEACHING_EVIDENCE` 设为 `docs/evidence/cad-teaching-ui` 后运行上述用例可重取截图。[测试指南](../../TESTING.md)

## 回归结果

| 命令 | 实测结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 42 个文件，444 项通过 |
| `npm run test:integration` | 12 个文件，73 项通过 |
| `npm run build` | 通过，使用相同配置重试 |
| `npm run test:e2e` | 生产构建下 198 项全部通过，耗时 6.7 分钟 |

CAD 专项单独执行 12 项，全部通过。整站回归曾遇到隔离 S3 卷容量不足和 SMTP 测试端口被占用。提高测试存储容量并确认上传、回读和端口可用后，在新隔离数据库完成全量重跑。本轮启动的 Web、Worker 和配套测试服务均已停止。

Next.js 16.4.2 在首次生产命令结束时提示安全更新。按同一命令重试成功。[Next.js 安全公告](https://nextjs.org/blog/november-2026-security-release)
