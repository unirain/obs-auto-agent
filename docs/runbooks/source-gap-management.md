# 人工接受来源覆盖缺口

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

当前命令只支持接受缺失。不存在可用 `validated_fill: true` 宣称补采完成的命令。真实补采须另有持久覆盖证据和验证入口；该路径仍未完成，不能以本地纯函数测试替代。
