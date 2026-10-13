# G0 共享契约证据审计

日期：2026-10-13（Asia/Shanghai）。依据实施 README 的 G0 定义、S1、A1 和 O1 的共享要求。本文不修改 canonical 任务状态；最终检查与 gate 状态由 Root 记录。

## 判断

README 将 G0 定义为“工程骨架可构建，schema 与状态转换有样例；scope、身份、错误类别、接口所有者明确”，通过后允许三个模块基于替身和回放并行开发。按这个基础门槛，现有代码与本地测试已有可核查证据。**87 个完整验收场景 pending 不构成否定 G0 的理由**：这些场景包含 G1–G5 的真实 OSS/RAM、SDK、GitHub、图床及人工质量要求。

“G0 基础门槛已具备本地证据”不等于“所有 S1/A1/O1 的完整实现与所有业务 DTO 均已冻结”。下表明确区分已证明的公共边界和仍需收尾的契约细节。模型调用、RAM 和远端写权限无需为本次 G0 审计提前取得。

审计初期发现旧 shared transition 表使用 queued/selecting/ready_for_delivery，而真实 controller 使用 discovered/selected/researched/drafted/validated。Root 授权本轮修复后，已增加真实状态集合、纯前后状态校验、scoped validator 的 previous_records/reason 上下文，并由 host manager 实际消费；此缺口不再作为当前未实现项。

## Requirement → 实现 → 证据

表中 `src/`、`evals/`、`schemas/` 相对 `agents/reading/`；其他路径相对仓库根。测试名称指明具体断言，命令可重复执行，不访问正式写入资源。

| G0 / 共享要求 | 实现文件与接口 | 已有测试与可重复命令 | 证据范围 |
| --- | --- | --- | --- |
| 一套 ESM、npm lock、strict TS、Vitest，工程可构建 | `package.json`、`package-lock.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`；CI 固定 Linux/Node 24.10.0 | `npm run typecheck`、`npm test`、`npm run build`；`.github/workflows/ci.yml`；`evals/results/local-verification.json` 记录 Linux CI 结果 | 工程与类型互通；不证明真实 SDK query 或服务权限 |
| 明确公共 ID/scope/错误与接口所有者 | `src/contracts/index.ts` 的 ExecutionScope、AgentError、ObjectStore、WorkspaceHandle、CheckpointChange、CommittedSnapshot、InvocationRecord；README“共享接口与所有者”，AGENTS 模块边界 | `npm test -- agents/reading/evals/storage/workspace.test.ts agents/reading/evals/operations/modes.test.ts`：正式/预览身份错配、非法 preview 晋升、相同序号竞争、committed/conflict/unknown | 公共命名与本地拒绝语义已冻结；Scope 与 runtime Scope 为结构一致的 literal union |
| 精确版本、nullable、SHA-256、确定性 JSON 与序号不丢精度 | `src/contracts/schema.ts` TypeBox/TypeCompiler；workspace/checkpoint/invocation/storage/reservation/artifact-seal schemas；`canonicalJson/sha256`；20 位字符串序号 + bigint | `npm test -- agents/reading/evals/storage/schema.test.ts agents/reading/evals/storage/audit-contracts.test.ts agents/reading/evals/storage/reservation-envelope.test.ts`：合法 envelope、未知版本、额外字段、错误哈希、非法 JSON、invocation ID 及费用状态 | 基础控制 envelope 精确解析，无隐式迁移；金额 unknown 不等于 0 |
| schema 注册与 Manager 统一边界，未知 schema 拒绝 | `registerSchema/validateSchema`、`registerRecordValidator`；`ImmutableWorkspaceManager.record_validator`；初始化、checkpoint、raw state files、restore、restoreRevision 统一调用 | `npm test -- agents/reading/evals/storage/scoped-record-validator.test.ts`：instance 隔离、完整 merged records、null 删除、raw control 同校验、未知历史版本、初始化前校验；`audit-contracts.test.ts`：注册 schema 的冷恢复拒绝 | 对已安装 validator 的 namespace 已证明；没有把任意 JSON record 宣称为已验证业务 DTO |
| scoped 项目/context DTO，拒未知控制字段且 context 不串项目 | `src/stages/records.ts` 的 ContextBundle/MaterialSnapshot/RuntimeProject schemas 与 parsers；`src/app/records.ts` 的 HostProject 和 pruned DTO；两个 bootstrap manager 安装 validateHostRecords | `npm test -- agents/reading/evals/runtime/records.test.ts agents/reading/evals/integration/project-storage.test.ts agents/reading/evals/storage/bootstrap.test.ts`：unknown schema/type/context、正文哈希、源引用跨项目、未知 Host 字段、scope/identity、缺 context、真实 FileStore 冷恢复及 source sidecar | 已证明实际 host 恢复边界；保留项目 DTO 单独解析，不伪装成完整 RuntimeProject |
| 真正的项目状态、前后记录与合法阶段/批次/新生成 | `READING_PROJECT_STATES`、`validateReadingProjectTransition`；Manager hook 第 4 参数 `{previous_records,reason}`；host validator 使用它；`validateGenerationAuditPreservation` | `npm test -- agents/reading/evals/storage/reading-transitions.test.ts`：完整合法阶段链、跳过研究/写作/审校拒绝、未知状态、preview 发布拒绝、已提交 batch_yield 才重置分批计数、generation+1、changed-input/context 证据、semantic settlement 历史、持久旧费用 | 项目控制事实已经经过实际 Manager scoped hook；领域 evidence/远端 GitHub facts 仍由各 owner 校验 |
| A1 模型输出与受信控制事实分离 | `src/stages/contracts.ts` Candidate/Submission/Classification/Selection/Research/Stage/Review schemas，`writing.ts` WritingSchema；StageTask 类型；driver/StageExecutor 从实际输入绑定哈希与能力 | `npm test -- agents/reading/evals/runtime/records.test.ts agents/reading/evals/runtime/driver.test.ts agents/reading/evals/policy/gate.test.ts`：模型 command/伪造字段拒绝、受限分类、证据与结构化结果、固定输入恢复 | model DTO 不直接授予 PR、OSS 或政策版本权力；是否真实模型能稳定产出是 G2 |
| 四模式与可信目的地，不由 URL/manifest 改写 target | `src/config/dispatch.ts`、`deployment.ts`：ExecutionTarget、production/preview/integration 独立 binding、credentialReferences | `npm test -- agents/reading/evals/operations/modes.test.ts agents/reading/evals/contracts/cli.test.ts`：默认 preview、新 URL 在 resume 拒绝、preview 不持正式能力、集成 production-scope 的独立目的地、误配/private/version/endpoint 状态 fail closed | 目标和凭据引用配置已证明；配置声明不能代替实际权限 probe |
| 同一 PolicyGate 服务覆盖所有能力 | `src/policy/gate.ts` PolicySubject/PolicyCheck/ClassificationCredential；Root permission adapter；ResourcePublisher/Publisher 只消费当前回执 | `npm test -- agents/reading/evals/policy/gate.test.ts agents/reading/evals/delivery/policy-receipts.test.ts`：不可读/持久失败不授权、来源/域名限制、每次远端写前回执持久化且重启可查、void 回执保留 legacy_unverified | 服务和字段互通已证明，不将旧 context 当当前许可 |
| Invocation 屏障、未知结果与 usage 字段一致 | shared InvocationRecord/Usage；S journal、ApplicationInvocationJournal、StageExecutor 使用同 DTO | `npm test -- agents/reading/evals/integration/journal.test.ts agents/reading/evals/runtime/executor.test.ts agents/reading/evals/storage/usage-ledger.test.ts`：prepared 先于模型、持久失败无模型、unknown 不重付费、summary/step 去重、scope/project/北京时间/轮归属 | 本地回放和真实 FileStore 协议；供应方账单/取消仍属 G2 |
| 产物引用是 committed path/hash；大文件仍完整 | ManifestFile whole SHA/size + optional chunks；`manifestBlobs/readManifestFile`；body_reference exact v1；ArtifactSeal 和 O SealedDelivery 分别负责存储封存与交付 | `npm test -- agents/reading/evals/storage/chunks.test.ts agents/reading/evals/storage/workspace.test.ts agents/reading/evals/integration/project-storage.test.ts agents/reading/evals/delivery/publisher.test.ts`：缺/坏块拒绝、历史只读、seal 完整集合和 hash、O 拒 preview/改文件/非法路径 | ArtifactSeal 与 SealedDelivery 名称和职责不同，不应混同为两个不兼容的同名 DTO |
| O Resource/Delivery/Monitor DTO 与公共 schema 一致 | `src/publish/types.ts`、resources.ts、validate.ts；Delivery/Resource schema；`monitor/source-health.ts` 复用 A SourceEvent；MonitorMetadata schema | `npm test -- agents/reading/evals/operations/schemas.test.ts agents/reading/evals/delivery/policy-receipts.test.ts agents/reading/evals/operations/watchdog-reader.test.ts`：public schema 正/反例、未知 operation version 拒绝、持久回执、只读 committed projection、不读原始证据 | O 类型与 JSON 表示有本地配对证据；运行态 DTO 的所有深层字段仍有下文冻结尾项 |
| 全仓库 writer mutex、preview capacity 边界、model 不持秘密 | `WRITER_CONCURRENCY_GROUP='reading-workspace-writer'`；agent/recovery/maintenance workflows 共用；watchdog 为独立只读投影；shared 50 GB broker+reservation | `npm test -- agents/reading/evals/operations/workflows.test.ts agents/reading/evals/storage/broker.test.ts agents/reading/evals/runtime/executor.test.ts`：同组不 cancel writer、秘密前先验证、preview/恢复/维护不持额外权力、SDK env 不继承 OSS/GitHub、独立 readonly broker 无账号文件 fallback | mutex 与能力配置的**定义和静态接线**已证明；云端实际互斥/不同 RAM 身份拒绝属于 G1/O1 live |
| UTC 写入 / 北京时间展示与归集 | Date.toISOString writers；`beijingDay`、`shanghaiDate`、dailyLogicalKey；nullable 来源发布时间 | `npm test -- agents/reading/evals/storage/usage-ledger.test.ts agents/reading/evals/operations/modes.test.ts agents/reading/evals/collect/intake.test.ts`：北京时间跨天、不以展示日期改变 submission 身份、published_at 可空、恢复 run attribution | 正常 producer 口径已证明；所有叶 DTO 的 UTC 严格解析仍未逐字段冻结 |

## 本轮已关闭的五项契约尾项

1. **同源状态集合**：RuntimeProject schema 与 TypeScript state 都复用 READING_PROJECT_STATES；独立 parser 与实际 host 恢复都拒绝未知状态。
2. **完整 DTO**：StageTask、PolicyCheck、SourceHealth/SourceEvent、SourceCursor/Progress/Result、RunReport 有 exact schema 和实际生产／使用／恢复入口。阶段 scope、project、capability、state、deadline 在 policy/preflight/paid intent 之前验证；运行报告保留 input_commit、实际或 unknown 的版本、持久策略回执及完整 11 字段 UsageTotals。实际运行时 schema 不能被 TypeScript 声明替代。
3. **UTC**：共享 UtcInstantSchema/assertUtcInstant/isUtcInstant 拒绝 date-only、offset、无时区、非法 Gregorian 日期和尾部换行，接受合法秒及 1–3 位小数的 Z 时刻，不转换旧记录。A/S/O/Root 持久时间入口已消费，note_date 等日期字段保留其单独含义。正反例包含价格／状态冷恢复前拒绝与无新增外部写入。
4. **注册与防漂移**：38 份公开 JSON schema 来自共享导出表；TypeCompiler/Ajv 都能编译，统一测试核对文件集合、唯一名字和逐字节定义。重复 schema/transition 注册及 UTC 拒绝有独立负例。显式 `npx tsx agents/reading/evals/generate-schemas.ts --check` 检查，不在运行时重写文档。
5. **统一完整 fixture**：`evals/integration/shared-domain-flow.test.ts` 使用完整领域 DTO 与真实 FileObjectStore/scoped Manager/Journal，显式 ModelAdapter 回放五种调用、真实内容校验及封存核验、内存 GitHub/Image/Issue adapters。同一流水线经历研究回执冷恢复和 PR 响应丢失；下一轮复用既有请求及 PR，不增加模型、图片、PR 或 Issue 写入。只读监控不读取原文对象，仍通知持续来源故障。它证明本地模块契约互通，不证明真实服务或内容质量。

本轮最终验证：69 files / 394 tests、typecheck/build、38 schema 防漂移、87 场景映射与 diff 检查通过；3 live tests skipped。README 定义的 G0 契约门槛已具备完整本地证据；G1–G5 及工作包中各自的 live/human 条件不因此通过。

## 本次证据边界与状态交接

最终检查：69 files / 394 tests、typecheck/build、38 schema documents 检查、87-case mapping 和 diff 检查通过。前三轨各自的 freeze 输出是较早的局部证据；最终实现指纹与命令结果以 `evals/results/local-verification.json` 为准。

本轮没有运行 paid model、创建云资源或新增 live pass。G0 complete 仅指 README 的共享契约与本地组合门槛。G1–G5、真实 SDK/OSS/RAM/GitHub/图床、文章与人类质量要求仍未达到，完整目标没有完成。
