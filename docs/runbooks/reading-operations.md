# Reading Agent 运行、暂停与启用

## 命令与模式

`npm run reading -- validate-dispatch --deployment <trusted-json>` 仅解析配置与环境参数，不加载 Secrets。`npm run reading -- run --from-actions --deployment <trusted-json>` 在可信宿主执行。参数经类型化解析，不将 URL 拼入 shell。Actions 输入环境：

```text
READING_MODE=preview|scheduled|resume|publish-only
READING_TRIGGER=manual|schedule
READING_INPUT_URLS_JSON=["https://public.example/article"]
READING_PROJECT_ID=<existing-production-project-or-empty>
READING_PREVIEW_ID=<existing-preview-id-or-empty>
READING_SUBMISSION_ID=<stable-manual-submission-id-or-empty>
```

| 模式 | 新 URL | 恢复身份 | 能力 |
| --- | --- | --- | --- |
| preview（手动默认） | JSON 数组 | 可传 preview_id | 独立私有产物；正式检查 not_exercised |
| scheduled（production 或隔离 integration） | 手动可传数组；cron 禁止 | 正式候选及积压 | 正式入队、采集、读取及授权发布 |
| resume | 禁止 | 必须已有正式 project_id | 继续已保存项目；不重置计数 |
| publish-only | 禁止 | 必须已有正式 project_id | 只读对账、仍有效且获准时发布；过期／分类失效返回 needs_resume，不调用模型 |

预览成功后必须重新 scheduled 提交原始 URL；不得复制预览回执、将 preview_id 当 project_id、把 preview scope 改成 production。人工来源不推进订阅游标；相同 URL 持久去重，同日逻辑键不阻止新的人工 submission。

## 调度与互斥

正式 cron 默认北京时间 08:17（UTC `17 0 * * *`），当前 `reading-agent.yml` 中此项注释，默认关闭。独立 watchdog 北京时间 10:47／22:47（UTC `47 2,14 * * *`），从显式 `enabled_at` 开始计算漏跑，超过 36 小时无 scheduled 启动告警。没有启用时间不推断系统已上线。

所有 preview、production、integration writer 与清理使用固定全仓库 concurrency `reading-workspace-writer`，`cancel-in-progress: false`。watchdog 使用独立 `reading-watchdog-issues`。OSS 同序号禁止覆盖依旧是最终并发防护；Actions 等待队列不能替代持久候选队列。运行只接受默认分支可信代码；PR 和评论不触发付费或写入工作流。60 分钟 job 在最后五分钟收尾／中止 SDK，取消后进程停止，只能恢复最后成功提交的快照。

生成前的 G1 证据来自 `reading-preview`／`reading-integration`／`reading-production` GitHub Environment 的两个非秘密 Variables：`READING_G1_EVIDENCE_PATH` 与 `READING_G1_EVIDENCE_SHA256`。路径须为默认分支检入的 `agents/reading/evals/.../*.json` 相对路径，不能包含 `.`／`..` 路径段或符号链接；hash 为该已审验文件原始字节的 SHA-256。应先提交完整真实隔离验收证据并人工核对，再配置这些变量。当前 `storage/fixtures/oss-live-evidence.json` 仍 incomplete，不能配置为通过证据。

workflow 在注入模型／写凭据之前核对文件已跟踪、内容与可信 checkout HEAD 一致，并调用 `storage/gates.ts` 检查所有 G1 真实断言。读取模型输出、OSS 下载文件或仅修改 verified 标志均不能代替这一步；即使下载文件 hash 匹配，未被当前 HEAD 检入也会拒绝。host query admission 再用同一 Variables 校验。未配置或证据不完整时，生成任务停止是预期状态。

`publish-only` 跳过 G1 生成门槛和工具镜像构建，并不注入模型或图床上传密钥；仍保留当前 workspace、目标 GitHub App、只读容量及 notes 读取能力用于交付对账。恢复出需要重分类／来源重验的项目时，应返回 needs_resume，再显式运行 resume，不能在 publish-only 内调用模型。

## Watchdog 事实

`npm run reading -- watchdog --deployment <trusted-json>` 使用只读 OSS 和实现仓库 Issues 身份。来源事件必须来自候选与游标同一个提交；读取完整持久事件序列。Issue 以 `workspace|source_id|reason_code` 哈希标识，body 机器元数据保存 last_position；不写 workspace。创建／更新／评论响应不明时先分页查询已有机器标识，禁止重复 Issue 或重复事件评论。

来源恢复只接受真实抓取、解析、全部分页完成且持久化成功；停用、未尝试、其他来源正常、preview、publish-only 不能关闭故障。coverage_gap 使用独立键，读取恢复不关闭；验证补采或可信接受事件才关闭。普通 Issue 评论不执行控制命令。未知容量、需要人工核对、报告缺失、失败和取消为独立原因。读取 API 错误令 watchdog 失败，不能显示健康；GitHub 平台整体不可调度属于同平台监控的限制。

## 暂停与恢复

修改实现仓库最新默认分支的可信策略文件设置全局／项目暂停。每次 query、来源读、上传和 GitHub 写前重新检查；运行中的 SDK 检测新限制后中止并记 unknown。仅取消 cron 不能替代策略暂停或清除来源事件。watchdog 继续保存抑制事实，解除暂停后重新计算预期周期，来源仍需实际读取才能恢复。

恢复顺序：真实 OSS 提交链可读且完整 → 全局 50 GB 清单可核对 → 最新策略可读 → 对账外部未知结果 → 继续可获准的下一阶段。未知模型结果先人工核对，不能重做付费 query；PR 按标识、分支及 expected SHA 全历史查询；资源按稳定完整哈希键读回。不要清空 workspace、回退 HEAD、删除提交记录或用旧规则许可继续。

## G5 启用记录

启用前 G0–G4 的实际证据、至少五类真实文章 preview 用户反馈、冻结留出集校准、两信源、固定 skill commit、模型凭据、图床唯一 writer、私有 OSS、App 和监控权限均完成。确认设计默认值：08:17 每日、首次七天、50 GB 十进制合计、45/49 GB 阈值、近期正例日期依据和 36 小时漏跑。

记录受信任 code commit、lockfile/镜像版本、配置 SHA-256、启用时间、测试及清理回执。先演练 watchdog，再手动 production scheduled + input_urls，核对候选、source events、费用、图片与 PR；然后配置 cron_enabled、enabled_at、g5_evidence 并启用注释的正式 schedule。记录第一轮定时真实结果，零产出可以健康，不以篇数或待审数量作为门槛。当前全部真实环境证据和用户质量确认未具备，因此不能填写“已启用”。

## 监控历史、重跑与暂停基线

watchdog 读取每个 Actions run 的历史 attempts，报告按 `run_id-attempt` 匹配。历史取消、失败或缺报告随后成功，即使发生于两次巡检之间，也会合并保留发生与恢复记录；不只读取最新成功结论。queued 和 publish-only 不抵消实际 scheduled 启动缺口。发生时间来自 Actions 事实，未知 attempt 元数据或读取异常不报告健康。

首次观察全局暂停时，监控建立一个关闭状态的 `__policy__/pause_clock` 控制 Issue，记录 observed pause/resume。解除暂停后重新计算三十六小时预期周期；来源故障仍必须真实采集恢复。该控制 Issue 不是来源恢复证明，也不是模型控制入口。监控自身无法读策略/Actions/OSS 时，API 可用的情况下维护去重 `__monitor__/read_failed`；同平台整体 API 或调度故障仍无法保证通知。

Actions metrics 记录具体 attempt 的实际 job 开始/结束区间；进行中、缺时间或 API 不可读时保持 partial/unknown，不能把它们或 job elapsed 推断为实际计费分钟、账单金额。PR metrics 只由确认的 GitHub 状态及实际 merged HEAD 字节确定合并/改稿/拒绝，人工审阅分钟必须由用户显式提供，自动审校不替代人工数据。
