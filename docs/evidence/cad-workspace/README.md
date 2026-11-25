# CAD 工作区实测截图

学生测试账号登录后进入 `/geometry`，浏览器用鼠标确定第一点并输入 24 mm，连续确定三段，再点击线身打开对象工具卡。测试下载图纸 JSON，检查首段长度和相邻线段共享端点。

| 浏览器视口（CSS px） | 初始空图 | 第一段预览 | 已确认三段、预览下一段 | 选中线段 |
|---|---|---|---|---|
| 1440 × 900 | [空图](1440x900-empty.png) | [长度输入](1440x900-length.png) | [连续作图](1440x900-continuous.png) | [对象属性](1440x900-selected.png) |
| 1280 × 800 | [空图](1280x800-empty.png) | [长度输入](1280x800-length.png) | [连续作图](1280x800-continuous.png) | [对象属性](1280x800-selected.png) |
| 1024 × 768 | [空图](1024x768-empty.png) | [长度输入](1024x768-length.png) | [连续作图](1024x768-continuous.png) | [对象属性](1024x768-selected.png) |
| 768 × 1024 | [空图](768x1024-empty.png) | [长度输入](768x1024-length.png) | [连续作图](768x1024-continuous.png) | [对象属性](768x1024-selected.png) |
| 390 × 844 | [空图](390x844-empty.png) | [长度输入](390x844-length.png) | [连续作图](390x844-continuous.png) | [对象属性](390x844-selected.png) |

学生作答页面的专注模式按真实作业记录显示题意、草稿和提交状态。测试在手机抽屉中查看评分细则、保存，刷新后正式提交，并用教师账号查看同一份作答。 [桌面工作区](assignment-desktop.png) · [手机题目抽屉](assignment-phone.png)

截图来自 Playwright 驱动的 Chromium。手机和平板截图记录对应的浏览器视口，未覆盖实体设备的系统键盘与电子笔。相关测试见 [独立作图](../../../tests/e2e/cad-host.spec.ts) 和 [教学流程](../../../tests/e2e/geometry.spec.ts)。

## 画线时的关系预览

以下截图来自登录后的正式独立作图页，视口为 1280 × 800。均在确定起点、移动到候选位置后、提交线段前截取。浏览器用例另行检查精确长度、切点和提交后的节点坐标。[平行预览](guide-parallel.png) · [垂直预览](guide-perpendicular.png) · [相切预览](guide-tangent.png) · [对应浏览器操作](../../../tests/e2e/drafting-relations.spec.ts)

## 参考操作对齐

以下截图来自 Playwright 驱动的图衡 CAD 组件，使用合成图纸。浏览器用例检查了确认后的节点坐标、连续修剪历史、带公差的真实角度以及剖面图纸包往返。 [双基点追踪](tracking-crossing.png) · [矩形框切](batch-trim-preview.png) · [半圆剖面](partial-hatch.png) · [两线标注补角](supplementary-angle.png) · [对应浏览器用例](../../../tests/e2e/cad-reference-alignment.spec.ts)
