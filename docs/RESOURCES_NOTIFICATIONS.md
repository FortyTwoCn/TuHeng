# 私有资源、用户中心和通知

[返回文档目录](README.md)

## 用户中心

顶栏头像进入当前工作空间的 `/profile`。学生、教师、学校管理员和网站管理员分别使用 `/student/profile`、`/teacher/profile`、`/school/profile`、`/admin/profile`。手机顶部保留头像与通知铃铛，底部“更多”也提供入口。

基本资料展示学校维护的姓名、身份和登录 ID 或学号。头像可裁切、缩放、更换和移除。支持静态 JPEG、PNG、WebP，上传上限 5 MB、1600 万像素。服务端按校验后的格式重新编码，保存无附加元数据的原尺寸文件及 128、512 像素 WebP。成功后原子切换头像版本，旧页面上的并发修改会提示刷新。

在账号安全中绑定或更换邮箱、修改密码。换绑先验证当前密码，发送验证码后明确显示目标邮箱。编辑目标会作废该次验证码，新邮箱验证成功后才替换旧绑定。首次登录仍进入首次设置；学校管理员和教师必须验证邮箱，学生和网站管理员可以选择绑定。学生与管理会话的登录、头像读取和个人设置分别授权。

## S3 资源键

默认私有桶为 `tuheng-private`，通过 `S3_BUCKET` 指定。根目录与后缀如下，括号表示任选一项。

```text
private/
├─ platform/
│  ├─ users/<userId>/[avatars | staging | documents]/
│  └─ question-bank/questions/<questionId>/assets/
└─ schools/<schoolId>/
   ├─ question-bank/questions/<questionId>/assets/
   └─ users/<userId>/
      ├─ avatars/<versionId>/[original.<ext> | small.webp | large.webp]
      ├─ staging/<uploadBatchId>/<assetId>.<ext>
      ├─ documents/<documentId>/[original.<ext> | edits/<assetId>.<ext>]
      ├─ assignments/<assignmentId>/items/<assignmentItemId>/
      ├─ self-tests/<setId>/items/<selfTestItemId>/
      └─ error-book/<entryId>/

题库或各作答主体下：
  assets/originals/<assetId>.<ext>
  assets/edits/<parentAssetId>/<assetId>.<ext>

各作答主体下的评分图：
  attempts/<attemptId>/grading-runs/<runId>/processed/<parentAssetId>/<assetId>.png
```

学校题库由题目所属学校决定，包含平台管理员在该校创建的题目。用户目录统一使用稳定的学校、账号、业务和资产 ID。评分处理图的位置属于该次作答，授权所有者仍是源资产所有者，读取时同时检查作答权限和源图权限。几何 JSON、正式成绩和题目版本关系保存在 PostgreSQL。

自测的题干和参考图按题目 ID 归档，数据库维持个人可见性。自测作答和对应处理图则用自测集及题目 ID 归档。错题本可以引用已有图片，复习时上传的图片进入对应的错题目录。

### 上传、引用与归档

`POST /api/assets` 接收 multipart 的 `file` 与 JSON 字符串 `target`，以及明确的 `x-tuheng-realm`。例如学生上传某道作业的作答时，`target` 是 `{"kind":"ASSIGNMENT_ANSWER","itemId":"实际的 AssignmentItem.id"}`。新题目的目标可使用 `{"kind":"QUESTION","schoolId":"实际的 School.id"}`，参考图使用 `REFERENCE`。题目版本、作答及参考图都使用返回的稳定 `id`。同一题干和参考答案可以引用同一附件。

上传前先在数据库预留有期限的会话和对象键。保存题目、草稿或正式提交时，业务引用与归档任务同事务写入。Worker 复制并检查目标字节数和 SHA-256，再条件切换 key，旧暂存对象保留一小时供正在读取的请求使用。归档失败时继续读有效源，任务自动退避重试。同一资源在首次归档后保持原位置，版本复用和再次提交只增加引用。旋转、裁剪和评分处理图各自生成新资产。

资源状态为 `WRITING`、`STAGED`、`ARCHIVING`、`ARCHIVED` 或 `DELETING`。暂存会话默认 24 小时；用户移除未保存文件时可取消该次上传。清理前检查会话、归档任务、版本、草稿、提交、评分、批注、头像和父子关系。S3 读写位于业务事务外，重启 Worker 后从数据库恢复任务。

## 站内通知和邮件

| 通知事件 | 接收范围 |
| --- | --- |
| 作业已发布、名单加入或移除 | 发布时的接收人快照及后续明确的名单变化。 |
| 作业即将截止 | 仍在作业快照中且有必做题未提交的学生。 |
| 题目正式成绩发布、更新 | 对应作答的学生。 |
| 提交申诉 | 当前真正有该作答复核权的教师。 |
| 申诉已有处理结果 | 提出申诉的学生。 |
| 公告发布 | 确认发布时冻结的人员。 |

各身份都可点铃铛查看最近记录和全局未读数，在 `/{area}/notifications` 筛选全部、未读或分类。可逐条、批量或按当时的游标标为已读。点开面板只读取通知。访问业务详情时继续检查资源权限，权限变化的通知会显示不可访问状态。

站内通知默认启用。教学邮件总开关默认关，打开后可单独选择作业、截止、成绩、申诉和公告。邮件只对开启之后的事件排队，使用投递前核对的已验证地址和偏好。验证码、找回密码和必要账号安全邮件仍走独立安全流程。

### 催交规则

Worker 每分钟分页扫描已到开始时间、将在 24 小时内截止且尚未截止的已发布作业。加入名单至少 30 分钟、学校和账号有效才进入判断。草稿算未交，部分提交显示剩余题数。每道题只要已有有效 `SubmissionAttempt` 就算已交，评分是否排队、失败或待复核不影响判断。允许迟交仍按正常截止时间提醒。

去重键包含作业 ID 和截止时间，收件人按数据库唯一约束分别去重。投递前重新核对最新截止、名单和提交状态，略过已经失效的任务。

### 公告

教师在“公告管理”选择授权班级内的学生与授课教师。校管范围锁定本校。网站管理员选择学校，或显式选择全平台。个人选择和排除可以与班级或全部人员组合，服务端去重并校验权限。先保存草稿或预览，确认人数后发布。发布后为只读，换班不会变更已经发布的收件人。

### Worker 与邮件配置

现有 `npm run worker` 同时处理归档、期限扫描和后台邮件。使用系统设置中的 SMTP 版本、TLS、出站限制和密钥。教学发送最多使用共享每分钟配额的一半，保留验证码容量。SMTP 未配置或发生可重试错误时，站内通知照常生成。状态可从“系统设置 → 邮件服务 → 教学邮件投递”查看。

邮件链接根据 `NEXTAUTH_URL` 生成，生产使用公开 HTTPS 站点地址。等待、处理中、已提交至 SMTP、确定失败、已跳过和发送结果不确定分别记录。SMTP 接受后的送达由收件方处理。连接在提交阶段中断、或 Worker 在提交后丢失结果时标记为不确定，供运维核查。每条投递有稳定 Message-ID。

开发数据切换见[运行指南](OPERATIONS.md)，数据模型见[数据库指南](DATABASE.md)。

## 实际界面与上传样本

- 用户中心与头像裁切。[桌面](images/resources-notifications-20261119/profile-1440.png) · [平板](images/resources-notifications-20261119/profile-768.png) · [手机](images/resources-notifications-20261119/profile-390.png) · [裁切预览](images/resources-notifications-20261119/avatar-crop-mobile.png)
- 通知从顶栏进入，支持查看最近通知和完整历史。[手机顶栏](images/resources-notifications-20261119/mobile-header.png) · [最近通知](images/resources-notifications-20261119/notifications-mobile.png) · [通知中心](images/resources-notifications-20261119/notification-center-mobile.png)
- 公告编辑和收件选择。[桌面](images/resources-notifications-20261119/announcement-editor-desktop.png) · [手机](images/resources-notifications-20261119/announcement-editor-mobile.png)
- 题库上传归档与评分图的键、校验和及所有权样本。[实际上传记录](images/resources-notifications-20261119/s3-upload.json) · [验收结果](TESTING.md#私有资源用户中心与通知的验证记录)
