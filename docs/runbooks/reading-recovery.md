# Reading Agent 恢复与交付冲突

## 判定顺序

先恢复 validated consecutive immutable OSS chain。列举失败、403、哈希不符、序号缺口、未知 schema 或读超时都停止；不得按最后更新时间选 HEAD、跳序号或重新初始化。保存最后已确认快照和错误，检查原 fixed commit key 的读回结果。

Publisher 首先对账项目全部历史 delivery：机器标识、所有版本分支、expected commit、open/closed/merged PR 与完整 diff。读失败保留 publishing 和 uncertain_action。已存在 PR 即补事实：open 保持待审不重写；closed_unmerged 不当作入库、不自动重提；merged 从默认分支读取实际笔记建立索引，不用生成副本推断。

| 持久状态／外部事实 | 恢复动作 |
| --- | --- |
| PR 写成功、返回或 OSS 回执丢失 | 查稳定 delivery/project 标识，复用原 PR；不重研、不再建 PR |
| 只有 expected commit，无 branch | 核对 base、tree、expected SHA 与完整新增 diff；仍获准才创建缺失 branch |
| 只有正确机器人 branch、无 PR | 全历史无其他 PR、完整 diff 匹配、许可仍有效才续建 PR |
| branch SHA 不同、额外文件或人工修改 | delivery_conflict；人工处理，不强推、不覆盖、不删旧分支 |
| 当前默认分支同名文件或同来源已入库 | delivery_conflict／去重；禁止覆盖或重复 PR |
| GitHub 无法读取或远端写入不确定 | 保持 publishing；不建立替代 generation/delivery，不删除资源 |
| 已核实无 PR／无未决写入，材料核验超过 24 小时 | needs_resume；publish-only 不调模型。resume 重新核验来源 |
| 核验材料未变 | 保留正文与 generation，新的不可变 delivery 仅刷新核验时间，旧 superseded；完整匹配旧 branch 可复用 |
| 材料影响结论的变化 | 更新证据、增加 generation、重写重审；旧分支保留，不强推 |
| 当前策略暂停／不可读 | 只读对账并保存已发生事实；不补上传、对象、branch 或 PR |
| 分类失效 | 明确无远端未决结果后回运行时；执行许可允许才受限 classify_only |

刷新前需证明全部旧 delivery 无 PR、无未决写入；每项目只允许一个活跃交付，新发布前再次检查旧版本是否被人工建 PR。不要把“GitHub 查询失败”当“没有 PR”。一次流程中途暂停后不能补写余下步骤。解除限制沿用固定生成 context；不自动关闭／重写已存在 PR。

## 人工调用恢复

先停止原 writer，确认没有仍在运行的 SDK 进程，再用只读入口查看实际 revision、项目和调用。该入口不调用模型、不创建 workspace，也不读取 SDK 响应正文：

```sh
npm run reading -- inspect --deployment agents/reading/deploy/examples/production.json --mode scheduled
```

预览必须同时传 `--mode preview --preview-id <已有ID>`。`status` 展示实施任务；`inspect` 才是持久工作区的事实视图。

把下面非秘密审计请求保存到受保护的本机 JSON 文件，使用独占 writer 锁执行 `recover`。云端可使用 Reading Agent Recovery workflow，其与生成、发布、清理共享并发组，不接收模型或图床上传凭据。

```json
{
  "schema_version": 1,
  "recovery_id": "operator-review-001",
  "project_id": "实际项目ID",
  "expected_revision": "inspect返回的精确revision",
  "action": "unblock",
  "reason": "人工已核验阻塞原因",
  "evidence_reference": "非秘密审计记录位置"
}
```

```sh
npm run reading -- recover --deployment agents/reading/deploy/examples/production.json --mode scheduled --request-file /protected/recovery.json
```

宿主必须证明 `READING_SHARED_MUTEX_HELD=true`，不能在仍有 writer 的机器上仅设置变量冒充互斥。请求绑定当前 revision；变化则重新 inspect 和审阅，同一 recovery_id 相同请求可幂等读回。模型没有恢复工具。

- `unblock` 只解除人工调度标志，保留 context、pending query、修订、分类和无进展计数。有未决模型或远端写入时拒绝。
- `authorize_retry` 另需 `invocation_id`、原始 `input_hash` 和 `acknowledge_possible_duplicate_charge: true`。它保留旧调用 unknown 与未知费用，明确授权固定输入的一次替代流程；新调用再次 unknown/failed 会重新阻塞。分类仍服从两次上限。授权提交后再以新的 revision 执行 unblock。
- `confirm_not_started` 只接受已由可信宿主记录 `request_started=false` 和已知零用量的调用；缺回执不能作为未发出的证据。
- `record_result` 仅用于可信人工核验过的实际调用结果，需绑定 invocation/input、`status`、完整 query 汇总 `usage`，成功时还需 `structured_response`。旧记录归档，真实费用未知时仍用 null。模型阶段继续自行校验结果。此请求仅由受保护本机文件导入，不能把私有模型正文放进公开 workflow inputs。

这些命令不重置质量计数或默默替换生成输入。显式新生成版本管理和人工审阅反馈入口仍列在实施任务中；不要手改 blob、HEAD 或预算来绕过现有限制。

## 图片与容量

图片键为专用前缀 + project + 固定首次生成日期 + 描述命名 + 完整 SHA-256。上传前先提交 reservation/intent，再写；响应丢失按同键读回。未知读回或公开 URL 无法核验时保留预留；同键大小、MIME、哈希不符停止。确认回执后资源进入共享账本，重复同内容不重复计量。生成变化使用新键，旧 PR 与已入库图片维持原 URL。

清理仅用 S GC 的保护引用与宽限期规则：HEAD、活跃项目、待审、已合并、结果不明和预留资源均保护。提交记录永久保留。容量不足或无法统计时暂停新增、保留候选；不得分别向正式、preview、图床各分配 50 GB。控制事实的保留空间受同一总额度约束。

## 代码回滚

回滚受信任程序版本前检查当前 schema 兼容；恢复读取与只读对账必须支持已发生事实。不能回退 workspace HEAD 抹去模型消耗、外部 PR 或图片回执。更新日志记录原代码／新代码 commit、配置哈希、恢复前后 revision、受保护资源、外部事实和下一步，绝不记录 Secrets。

## 已实现的图片清理入口与保护边界

可信宿主 `maintenance` 的默认 image GC 使用独立身份：production 为 `READING_IMAGE_GC_CREDENTIALS`，integration 为 `TEST_IMAGE_GC_CREDENTIALS`。普通 uploader 明确没有删除权限，缺少专用身份或未验证图床绑定时返回 `complete:false`／原因，不能把回调存在当成已清理。preview 不构造图床客户端。

清理只考虑本系统已确认回执且项目已终止、解除引用并经过历史 manifest 保留期的对象；未知上传、待审/未决交付、活跃项目、未知模型调用、merged 图片、最近七天对象和无归属对象全部保护。读取 actual default branch 与全部 open PR 的 Markdown/图源引用；PR/default head 变化、任何读取或版本清单不完整均不删。每次删除前再读引用，提交 `image-gc-<hash>` 意图，并检查当前许可。按版本删除后读取相同版本确认消失，完整清单确认 key 的全部版本均消失后才释放对应容量预留。响应丢失恢复先对账，不双删或提前减计量。

enabled/suspended bucket 的旧 `null` version 必须使用显式 `versionId=null`；直接不带版本调用 DELETE 会创建删除标记，不能作为空间已回收证据。实际 RAM 删除范围、真实版本与失联恢复仍未完成隔离 live 验收。

## 操作记录的版本与策略证据

新建 DeliveryRecord、UploadIntent 的 `schema_version` 固定为 1。未知或未版本化记录拒绝读取；没有隐式填版本或空初始化。只有显式迁移到新的连续 checkpoint 才能升级格式，且保留原提交与外部事实。

每个远端发布动作和上传意图保存当前 PolicyCheck 引用与 Git ref/hash/时间；`legacy_unverified` 只用于无策略回执的测试适配器，不能宣称正式许可证据完整。来源材料中出现的 delivery/project 注释不成为控制输入；PR 身份只解析可信程序写出的 leading machine marker。
