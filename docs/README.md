# 图衡文档

本文档集描述当前仓库的可用功能、操作流程和维护方法。旧任务书、分阶段实施记录和重复验收报告已整合，历史过程可通过 Git 查看。涉及历史数据的兼容规则仍保留在现行指南中。

## 使用与部署

| 需要做什么                                           | 文档                                                     |
| ---------------------------------------------------- | -------------------------------------------------------- |
| 安装并启动项目                                       | [项目 README](../README.md)、[运行与排障](OPERATIONS.md) |
| 建校、管理多位校管、建课程和学期、导入成员、发布作业 | [业务操作指南](WORKFLOWS.md)                             |
| 确认四类账号能做什么                                 | [权限矩阵](PERMISSIONS.md)                               |
| 配置模型、邮件与备案号，处理评分任务                 | [后台配置](AI_CONFIGURATION.md)                          |
| 管理头像和个人邮件，查通知或发布公告，核对资源目录 | [私有资源、用户中心和通知](RESOURCES_NOTIFICATIONS.md) |
| 使用两面投影、交换 DXF、播放动画、审核和查看立体图 | [几何编辑器操作](GEOMETRY_EDITOR_INTERACTION.md) |

## 开发与维护

| 主题                                    | 文档                                          |
| --------------------------------------- | --------------------------------------------- |
| 包职责、路由和调用链                    | [系统架构](ARCHITECTURE.md)                   |
| 组织关系、版本、迁移与回退              | [数据与迁移](DATABASE.md)                     |
| 编辑器状态、坐标、命令和业务接入        | [编辑器架构](GEOMETRY_EDITOR_ARCHITECTURE.md) |
| GeometryDocument 版本、引用和 JSON 示例 | [几何契约](GEOMETRY_EDITOR_SCHEMA.md)         |
| 为既有图纸生成可校验的独立动画 JSON | [分步动画契约](GEOMETRY_EDITOR_ANIMATION_SCHEMA.md) |
| CAD 命令、离线参考审查、设备验收与性能 | [功能矩阵](CAD_EDITOR_PARITY.md) · [最新验收](CAD_REFERENCE_ALIGNMENT.md) · [性能报告](CAD_CORE_PERFORMANCE.md) |
| AI 建议、几何证据与教师正式成绩的边界   | [评分架构](GRADING_ARCHITECTURE.md)           |
| 隔离测试环境、验证命令及未测条件        | [测试指南](TESTING.md)                        |

## 示例和界面证据

- [四类旧版几何文档](geometry-examples/)是兼容性测试输入，不能因版本较旧而删除。
- [贯通孔三视图与独立动画](geometry-examples/construction/)用于练习投影传递、笔顺、擦除和三维预览。[Chromium 截图与里程碑验收](evidence/cad-animation/README.md)
- [3-19 两面投影](geometry-examples/reconstruction/3-19-VH-SPATIAL.json)和 [7-24 完整三视图](geometry-examples/reconstruction/7-24-THREE-VIEW-COMPLETE.json)可直接导入编辑器，分别预览空间点线面与带盲槽、耳板及贯穿孔的组合体。[双引擎和工作区 Chromium 验收](evidence/cad-modular-3d/README.md)
- 讲解工作区的亮色、暗色、三维预览及手机界面由生产 Chromium 截取。[讲解模式双主题验收](evidence/cad-teaching-ui/README.md)
- [统一图纸与换面轴](geometry-examples/v2/)、[参考关系与合点](geometry-examples/ux-v2/)、[曲线](geometry-examples/curves/)、[电子笔方向校正](geometry-examples/pen-direction/)可用于核对导出数据；笔迹样本与验证统计文件的用途见几何契约。
- [教学管理当前截图](images/organization-ui-20261119/)展示实际开发页面；其中 `before-*` 为改动前记录，`reference.png` 为生成的设计参考，不能当作运行结果。
- [学校详情与身份验证截图](images/school-details-20261119/)展示本次桌面、平板和手机实际页面；`reauth-edge-before.png` 记录修复前重复的密码显示按钮，其余为修复后的页面。
- [用户中心、通知和公告截图](RESOURCES_NOTIFICATIONS.md#实际界面与上传样本)及私有资源实际上传样本来自隔离环境。
- [编辑器属性卡截图](images/teaching-organization-20261118/)及其他日期目录为当时的验证证据，不保证每张图片都代表当前页面。实际测试覆盖以 [TESTING](TESTING.md) 为准。

维护文档时同时检查页面名称、脚本、配置键和相对链接。不要在文档或截图中写入实际密码、主密钥、模型凭据或真实学生名册。
