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

## 尚未逐项证明的契约尾项

这些是明确可定位的 S1/A1/O1 收尾，不应改写为“因为没有 live 凭据所以 G0 不可能通过”。也不能将其中尚未验证部分写成已经自动由 Manager 覆盖。

1. **A RuntimeProject schema 的 state 同源性**：目前实际 HostRecord validator 已消费 READING_PROJECT_STATES 并拒绝未知 state，真实转换也统一检查。`RuntimeProjectSchema.state` 自身仍为 nonempty string；独立调用 parseRuntimeProject 尚未自动获得相同 enum。Root/A 可进一步复用共享 state 字段消除这个差异。当前 host 恢复保护已生效。
2. **StageTask、PolicyCheck、RunReport、SourceHealth 的完整运行时 schema**：StageTask 等仍有 TypeScript 定义和实际构造／消费校验，尚无一组独立 exact schema 正/反例覆盖其全部字段。Host scoped validator 覆盖 contexts/projects，S 覆盖 invocation/reservation；不是任意 namespace 都已经完整业务解析。RunReport 的版本/input_commit/policy refs 与规范完整数据契约还需逐字段对照。
3. **UTC 的非法输入样例**：写入函数产生 UTC，归集拒绝缺时区时刻；部分 A parsers 仅检查时间为非空 string，当前 fixture 包含 `retrieved_at:'now'` 等。缺少“每个持久时间字段都拒绝无时区/非法时刻”的共享负例。UTC producer 正常路径与 UTC parser 完整性是不同证据。
4. **注册扩展与所有 public schema 的自动防漂移覆盖**：S 的 unknown-schema、注册恢复和 canonical JSON 已测试；O public JSON schema 有正/反例。没有同一自动比较套件覆盖每个手写 type、export schema 与所有并行模块 fixture，也没有专门测试 duplicate transition/schema 注册保护的全部情况。Typecheck 与当前共享消费可证明现用组合，但不能声称普遍同源代码生成。
5. **四模块统一 fixture 的含义**：现有证据是实际 A→S 项目/调用、S→O 发布回执、A/S→O watchdog 投影的配对组合与统一编译。`storage/recovery-scenarios/flow.test.ts` 是通用协议合成流程，其中简化 candidates/projects/PR 值不是完整真实领域 DTO。不能把它说成一次 fixture 已覆盖每个 Agent→Manager→Publisher→watchdog 字段。若冻结标准要求同一个完整共享 fixture，应补这种组合 fixture；它仍不需要 live 服务。

## 本次证据边界与状态交接

共享转换修复后的本地检查：`npm run typecheck`、storage 14 files/75 tests、`npm test` 62 files/374 tests、`npm run build` 通过（22:08–22:10 Asia/Shanghai 检查点）。后续并行变化以 Root 的最终全量检查和 implementation fingerprint 为准。

原 `evals/results/local-verification.json` 还记录 60 files/360 tests、Linux Node 24 CI 通过；它是那个实现指纹的证据，不应直接称为本轮新增代码的最新 CI。审计只引用既有／本地结果，没有运行 paid model、创建云资源或新增 live pass。

结论建议：README 定义的 G0 基础能力可记录为已有本地验证；若 canonical “G0 complete” 的口径要求本节全部 S1/A1/O1 冻结尾项也关闭，则应保留这些明确待办。不要以 87 端到端场景 pending、RAM 未准备或五篇真实 preview 未完成来否定已经获得的 G0 契约证据。
