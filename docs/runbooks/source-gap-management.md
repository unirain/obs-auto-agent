# 核验来源覆盖证据与人工接受缺口

当前读取成功只解除读取故障，不代表历史文章已经补齐。接受缺口是用户明确决定保留缺失；程序将其记录为 `accepted_gap`，不会移动游标或记为 `recovered`。普通 Issue 评论不是控制输入。

先暂停其他 workspace 写入，使用与阅读任务相同的共享互斥。非本地写入只接受可信宿主提供的 `READING_SHARED_MUTEX_HELD`；不能手动把标记设为 true 来代替取得互斥。管理入口不构造模型、图床上传或 Publisher，也不会初始化不存在的 workspace。

只读查看现有缺口及当前 revision：

```sh
npm run reading -- inspect-source-gaps --deployment /protected/integration.json --mode scheduled
```

在受保护目录保存请求 JSON；从检查结果原样填写 workspace、scope、source、gap、revision 和 gap hash。每次处置用新的 `management_id`，填写实际理由和人工核对记录位置，不发送密钥或把请求文件提交 Git。

```json
{
  "schema_version": 1,
  "action": "accept_gap",
  "management_id": "human-gap-unique-id",
  "workspace_id": "obs-notes-hub/reading-integration",
  "execution_scope": "production",
  "source_id": "claude_resources",
  "gap_id": "填检查结果的完整 gap_id",
  "expected_revision": "填检查结果的 revision",
  "expected_gap_hash": "填检查结果的 SHA-256",
  "reason": "用户接受该区间缺失的实际理由",
  "evidence_reference": "人工检查记录位置",
  "acknowledge_missing_coverage": true
}
```

```sh
npm run reading -- manage-source-gap --deployment /protected/integration.json --mode scheduled --request-file /protected/accept-gap.json
```

actor 来自可信宿主身份。入口检查 scope、来源、原始缺口事件、区间 hash 和 revision；实际排队提交时再次比较 revision。状态、处置事件和审计在同一不可变提交里写入。提交回复丢失后可重放完全相同的请求：已提交的审计返回 `already_applied`，不会重复追加事件。修改理由、actor 或复用 ID 会被拒绝；revision 已变化时重新检查，不能直接改旧请求的 revision 掩盖漂移。

preview 管理使用现有 preview ID 与对应部署；本地适配器只允许 preview。管理请求不接收新 URL、project_id 或 submission_id。一个来源仍有其他未处置区间时，缺口 Issue 继续开放；全部区间被明确接受后，监控保留人工接受状态。

## 只读核验已提交的补采观察

`inspect-source-gaps` 同时返回已有当前来源结果的 `source_result_reference`，包含 record_key 与 canonical JSON 的 SHA-256。若为 null，当前 workspace 没有该已提交结果，不能凭抓取成功日志补造引用。以下命令只恢复现有 namespace 并核对证据，不查询模型、不采集来源、不创建写入或移动游标。

```json
{
  "schema_version": 1,
  "action": "verify_backfill",
  "verification_id": "history-check-unique-id",
  "workspace_id": "obs-notes-hub/reading-integration",
  "execution_scope": "production",
  "source_id": "claude_resources",
  "gap_id": "填 inspect 返回的完整 gap_id",
  "expected_revision": "填 inspect 返回的 revision",
  "expected_gap_hash": "填 inspect 返回的 gap hash",
  "evidence_refs": [{"record_key": "sources/claude_resources/result", "sha256": "填 source_result_reference 的 SHA-256"}]
}
```

```sh
npm run reading -- verify-source-backfill --deployment /protected/integration.json --mode scheduled --request-file /protected/verify-backfill.json
```

也可引用该来源的已提交 `runs/<run_id>` 报告，提供其 canonical JSON SHA-256。核验检查 source、scope、记录 hash、缺口区间和 exact revision，并逐条列出观察到的 coverage 与 `covers_gap`。后一字段仅表示该记录所报告的日期范围包围缺口，不证明历史文章全集已补齐。核验绑定当前 journal 已恢复的固定 revision；同一 journal 在读取中已观察到 revision 推进时拒绝核验。跨进程的新 HEAD 不会自动更新这个固定句柄，诊断输出不声称它仍是远端最新 HEAD；需要最新视图时在共享互斥下重新恢复/检查。该命令永不填补缺口，随后人工处置仍须取得 writer 互斥并通过新恢复的 exact revision 校验。

**当前两个来源都没有版本化的历史完整性契约。** 即使完整分页读取成功、coverage 包围缺口，结果仍为 `status: unverified`、`can_fill: false`、`source_history_completeness_unsupported`，缺口及 Issue 保持开放。这是诊断结果，不是补采成功；命令成功退出不代表缺口已处置。已存旧 `filled` 事实不会被重写，但不能以 `validated_fill: true` 或 SourceResult.coverage 创建新的 filled 事件。

有新的源端历史完整性契约时，应实现源特定 verifier、绑定真实历史页/快照版本与完整枚举证据，再接入原子 verified-fill 处置；不能在当前配置中凭布尔值开启该能力。无法证明补齐时，使用上方明确人工接受缺失入口，保留原因与审计为 `accepted_gap`，不称为 recovered 或 filled。真实来源、缺口与人工处置验收仍属于 G4。
