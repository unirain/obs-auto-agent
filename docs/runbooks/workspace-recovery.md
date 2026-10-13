# Workspace 恢复与未知结果对账

实现入口：`agents/reading/src/workspace/manager.ts`、`invocations.ts`。检查点返回 `committed`、`conflict`、`unknown` 三种结果，后两者都禁止新付费调用及远端写入。所有写入口须使用同一 Actions concurrency 组。

## 只读检查

1. 停止新增写入，固定可信 scope、workspace identity 和原 prefix。不得以 preview 身份启动 production 的 resume/publish-only。
2. 使用 `restore(id)`，不传 `allow_initialize`。适配器先确认 bucket 私有、从未启用版本控制、生命周期安全及原生公网 HTTPS endpoint。
3. 完整分页列举 commits，验证零号起连续序号、父哈希、身份及 scope。HEAD manifest 和每个正文 blob 都以 SHA-256 校验，ETag 不作完整性依据。
4. `restoreRevision(id, revision)` 只接受有效链中存在的历史版本，且历史 handle 不可提交。历史正文已合规清理时，明确失败，不换用最新内容。
5. 对缺口、403、超时、无 bucket、损坏 manifest 或缺失 blob，保存脱敏错误类别并停止。不能删除 commit、跳序号、覆盖 HEAD 或重新初始化。

## 未知调用

`recoveredInvocations(handle)` 将只有 prepared/running 的回执视作 unknown，保留已有 SDK 消息和已知 usage。执行器遇到这三种原状态都禁止自动重起 query。SDK cumulative summary 取最后一份总量，message ID 重放不重复记账；未知费用保留 null。

人工核对供应方账单、保存的脱敏消息与输出后，使用明确的受信控制入口记录事实。没有供应方可查结果时，保持人工处理状态；不能将未知视为不存在、零消耗或明确可重试失败。不得直接编辑已提交 JSON 或 OSS 对象。

## 未知 OSS 提交

固定目标 `commits/<n+1>.json` 读回：相同字节补成功；不同字节停止并恢复胜出链；明确 NoSuchKey 才可用原键与原字节重新禁止覆盖创建。当前进程没有可靠字节意图时，重新只读恢复，不能猜测旧检查点已完成。

blob/manifest 成功但 commit 未发布，恢复仍看到旧完整版本。孤立对象进入容量统计与七天宽限，不视作阶段完成。

## 未知交付

先按 delivery_id 核对实际 GitHub PR/分支。已有 PR 只补本地事实；只有远端明确不存在且当前策略仍许可时才续建。人工修改的分支不得覆盖。发布意图之后全局暂停，只允许读取事实和提交控制回执。

## 验证与证据

本地故障：`npm test -- agents/reading/evals/storage/workspace.test.ts`。
真实 OSS：为现有隔离资源设置 `OSS_LIVE_TEST_ALLOWED=isolated-existing-bucket`、`OSS_TEST_BUCKET`、地域与 endpoint、主机侧凭据入口，再执行 `npx tsx agents/reading/evals/storage/oss-probe.ts`。凭据文件内容、原始 SDK 异常与签名 URL 不得输出或提交。

`agents/reading/evals/storage/fixtures/oss-live-evidence.json` 区分真实服务结果和未验证项。目前生产/预览/监控/GC 的独立 RAM 权限与传输级响应丢失仍未完成，G1 尚未通过。没有凭据或资源时不能把 skip 当 live pass。

## 真实付费执行门槛

默认 SDK 适配器在开始 query 前读取 `READING_G1_EVIDENCE_PATH`，核对来自可信部署的 `READING_G1_EVIDENCE_SHA256`。报告需要 schema 1、G1 complete、隔离资源声明、固定 SDK 版本及 `storage/gates.ts` 中列出的全部真实断言，包括独立 RAM 身份拒绝与传输级响应丢失。现有 partial OSS 探针报告不满足此门槛，不能通过改配置中的 verified 布尔值代替真实证据。

本地 factory (`app/bootstrap.ts`) 只允许 preview 与显式回放 ModelAdapter；持久记录、来源工具权限及下一轮行为仍真实执行，本地回放不证明付费 SDK、云端 RAM、图床或 GitHub 行为。

## 按需恢复与读取

`ImmutableWorkspaceManager` 的 `lazy_restore` 先校验完整提交链及 HEAD manifest，完整列举 blob 元数据验证全部引用的存在和大小，下载并校验控制状态及活跃项目正文。已结束或待审项目的非控制文件暂不物化；`readFile(handle, path)` 只接受该提交的文件清单成员，并在读取时以 SHA-256 核验正文。Inactive 正文的完整哈希校验在实际访问时完成，不能把元数据检查称为正文已验证。

本地缓存按 workspace 身份和内容哈希隔离，不承担远端持久化事实。启动重新核验远端控制/活跃正文；同一运行的检查点可复用已校验缓存并用硬链接避免复制全部旧文件。受信 skill 与此缓存分离，仍从固定 Git commit 物化。

## 持久化用量视图

`workspace/usage.ts` 的 `buildUsageLedger(handles)` 只读取已提交 Invocation 与 `invocation_meta`，按 workspace、scope、项目、轮次、北京时间日期和 capability 汇总。相同 invocation 的一致 receipt/invocations 别名只计一次；不一致别名拒绝聚合。不同 workspace 或 scope 的相同 ID 分开计量。

SDK message ID 重放按规范化 JSON 比较；整个 query 的累计 summary 不再叠加任何 step。终态未知时总费用保持 null，已知费用和 tokens 保留为下界。`known_cost_usd` 是可观察的估算下界，不能冒充供应方最终账单。查询汇总较早观测倒退时标记不完整，不丢掉旧值。

日期默认归于 invocation 开始时刻的北京时间日期，字段 `day_basis` 明示此口径；缺开始时刻、轮次或项目归属的历史回执进入 `unattributed`。指定轮次或项目存在无法归属的回执时，`usageForRun`／`usageForProject` 报告归属不完整和未知总费用，不能把缺资料视为零。格式修复、应用重试目的只能来自可信 metadata，缺失时为 unspecified。

持久化基础 journal 的 prepare 会原子写入开始时间、run_id、scope metadata；恢复后观察或终态写入不会将旧调用归到新一轮。应用 journal 应复用 `aggregateUsage`，报告和 PR 分别使用 `usageForRun` 与 `usageForProject`。

回归：`npm test -- agents/reading/evals/storage/usage-ledger.test.ts` 验证真实文件对象存储重启、跨 scope 分离、相同消息重放、未知消耗与缺 metadata。
