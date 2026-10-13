# Workspace 与 OSS 持久化实施计划

日期：2026-10-13。状态：待实施；当前仓库仅有需求与规格文档，下面的代码路径均为拟新增。

依据：[spec](../specs/reading-agent-spec.md)、[intent](../../intent.md)。实施门槛及总体顺序见[主计划](README.md)；阶段执行接口见[Agent 运行计划](02-agent-runtime-plan.md)，云端凭据、图床及交付见[交付与运营计划](03-delivery-operations-plan.md)，跨模块场景见[集成验收计划](04-integration-validation-plan.md)。

本计划保证“只有有效提交链上的状态可以恢复，并且恢复不会重复授权外部动作”。不调用真实模型、不创建云资源、不写正式笔记仓库；实现期间的真实环境验证使用事先配置的隔离资源。50 GB、保留期限及预警值沿用 spec 的默认口径，不追加篇数、待审数量或模型金额上限。

## 职责与共同契约

Workspace Manager 独占本地控制状态写入与 OSS 检查点提交。业务模块提交类型化变更；模型仅能写当前项目允许的产物目录。OSS 适配器不判断选题、策略语义或 PR 是否已合并。

| 交接项 | 本计划交付 | 对接方责任 |
| --- | --- | --- |
| `WorkspaceHandle` | 本地根目录、scope、revision、context 引用、项目范围、资源视图；无凭据 | 执行器只暴露范围内文件；入口从可信参数决定 scope |
| `CheckpointChange` | 带预期 revision 的类型化事件联合、统一提交确认和冲突结果 | 采集、策略、阶段、Publisher 定义各事件业务字段与合法转换 |
| `CommittedSnapshot` | 已确认 commit 键/哈希、revision、manifest 哈希和 scope | Publisher、监控仅从该版本读取，不能读未提交文件作事实 |
| `Invocation` | prepared、消息/usage 增量、终态持久化与重复应用保护 | SDK 适配器提供实际消息、取消与重试信息；未知请求进入人工处理 |
| `StorageCapacityView` | 受管前缀只读汇总、未决预留、时间戳和核验状态 | 工作流共用互斥组；图床适配器提供对象版本及引用保护信息 |
| `DeliveryManifest` / `PreviewManifest` | 封存不可变文件与校验记录，scope 二次检查 | 审校/校验器提供结果；Publisher 重新校验并核对远端事实 |

G0 先冻结字段、错误类型、UTC 时间与北京时间聚合规则；序号以十进制字符串或 `bigint` 内部运算、字符串持久化，避免二十位序号经过 JavaScript `number` 丢失精度。存储接口的失败分为明确不存在、已存在冲突、权限/配置错误、数据损坏、暂态失败及结果未知，禁止统一降级为空 workspace。

拟定 `CheckpointChange` 事件包括 `collection_committed`、`manual_submission_committed`、`policy_checked`、`invocation_prepared`、`invocation_observed`、`invocation_finished`、`stage_completed`、`batch_yielded`、`storage_reserved`、`storage_reconciled`、`delivery_sealed`、`delivery_recorded` 和 `run_recorded`。名称在 G0 固定；业务事件与其引用文件必须在同一 manifest 提交，不能由调用方分别保存。

## 工作包与依赖

依赖顺序：S1 → S2 → S3/S4；S4 后并行推进 S5、S6、S7；S8 汇总。S3 的真实 OSS 验证和 S4 的协议测试共同构成 G1，不能仅凭替身通过进入付费运行。S5/S6 是 G2 前置，S7 在任何真实预览上传前至少完成容量核算与预留；完整 GC、图床版本核算在相应 G3/G4 集成验收中验证。

### S1 TypeScript 基础与持久记录契约 G0

- 建立最小 Node.js/TypeScript 工程，采用 npm + `package-lock.json`、TypeScript strict 与 Vitest 作为计划中的基础选型；准备类型检查、单元测试及配置解析入口。Node.js/SDK 具体版本通过兼容性验证后固定，schema 库在首个实现提交确定，不引入数据库或对象存储挂载。
- 新增 `agents/reading/schemas/{workspace,checkpoint,invocation,storage}.schema.json`、`src/contracts/`、`src/workspace/types.ts`、`src/config/`，为业务模块 schema 提供统一注册和解析方式；采集/阶段/PolicyCheck schema 由运行模块定义，Delivery/ResourceManifest/监控 DTO 由交付模块定义。Manager 统一验证，不重复维护互相偏离的手写类型与运行时校验。
- 定义 schema 版本、哈希算法、确定性序列化、不可变 ID、manifest 文件角色、可空字段及 `artifact_ref` 形式；拒绝未知 schema 版本，迁移采用显式工具而非启动时猜测。
- 约定提交结果必须区分 `committed`、`conflict`、`unknown`，只有 `committed` 可以触发后续付费或外部写入。日志、异常及测试快照禁止包含凭据。
- 完成标准：各团队共用同一组合法/非法 JSON fixture；跨 scope、旧 revision、缺失引用和不合法阶段事件均被拒绝；确认同一字节内容产生稳定哈希。

### S2 可注入故障的本地对象存储替身

- 新增 `src/storage/types.ts`、`evals/storage/fake-store.ts`、`evals/storage/fixtures/`；接口涵盖不可覆盖创建、读、完整分页列举、元数据、配置读取及受控删除。
- 替身必须模拟“写成功但响应丢失”、分页中断、明确 404 与 403/超时、读回内容损坏、相同序号竞争及删除响应丢失；不能只用内存 Map 验证正常读写。
- 对每次写入记录对象键、内容哈希、调用结果；将 fake model / fake Publisher 放在提交屏障之后，断言持久化失败后外部调用数不再增加。
- 完成标准：单进程重启、临时目录销毁后仍可仅依赖持久对象恢复；故障脚本可复现，故障不被测试重试吞掉。该结果只证明本地协议，不证明 OSS 行为。

### S3 OSS 适配器与真实存储契约 spike G1

- 新增 `src/storage/oss.ts`、`src/storage/preflight.ts`、`evals/storage/oss-contract.test.ts`；选择并固定 OSS 原生 Node.js SDK，禁止以 S3 接口或 ETag 替代 spec 中的协议。
- 首先验证 SDK 实际发送 `x-oss-forbid-overwrite: true`、409 及服务端错误分类、分页 continuation、读取版本控制/ACL/生命周期所需权限、网络超时及取消行为；保存脱敏证据和版本。
- 启动及发布前确认 bucket 版本控制从未开启、非匿名可读、非公共 CDN 入口；生命周期不得删除提交记录或仍被引用对象。缺少检查权限视为无法验证并停止，不能默认安全。
- 在指定的隔离私有 bucket 验证两个客户端争写同一键只有一个成功；首次创建与冲突读回匹配；通过可控网络故障模拟成功后丢响应；多页列举全部恢复。
- 配置已开启/已暂停版本控制的拒绝行为先用配置替身验证；若已有合适的隔离测试资源，再做真实只读检查。不得为此修改现有 bucket 配置，也不得把公共图床当故障桶。
- 完成标准：真实测试报告列明 bucket 特性、region、公网 HTTPS endpoint、SDK 版本、测试结果和未验证项；真实互斥或响应丢失核对失败则 G1 不通过。

### S4 初始化与提交链与恢复核心 G1

- 新增 `src/workspace/{restore,commit,checkpoint,manifest,paths}.ts`；先完整列举并验证从零开始的连续提交链，再确定 HEAD，不使用可覆盖 `HEAD.json`。
- 仅在 bucket 可访问、完整列举为空、零号对象明确不存在、入口允许初始化时创建初始版本；冲突须读取胜出提交，不覆盖或跳号。
- 检查点顺序固定为冻结项目写入 → 校验变更/文件 → 上传缺少的 blob → 上传不可变 manifest → 创建固定下一序号 commit → 读回核对 → 返回成功。blob 已存在也核对哈希和大小。
- 提交意图须可复用完全相同的目标键和字节；响应未知按该键读回。内容相同补成功，内容不同停止并重新恢复；只有明确不存在才可再次创建，不能把本地旧账本合并进胜出版本。
- 恢复验证身份、scope、schema、父引用与 SHA-256；拒绝非法提交对象、链缺口、绝对路径、路径穿越、符号链接、超大文件和缺失 HEAD 引用对象。
- 首批恢复控制状态及活跃项目，其余按需拉取；按包含清单同步，排除缓存、认证文件、`.git/`、`.env`、依赖目录和 `scratch/`。只读 skill 从可信 Git 固定 commit 物化，不能用 OSS 产物提供执行代码。
- 历史提交全部验证，恢复仅要求 HEAD 和保留版本的 manifest/blob 完整，允许已合规清理的历史正文不存在。监控获得固定已验证版本，不跟随读取期间的新提交漂移。
- 完成标准：在每一个上传/发布步骤前后强制退出，恢复只能看到旧完整快照或新完整快照；不存在候选已丢而游标前进、调用未记而模型启动的中间状态。

### S5 Scope与文件视图与产物封存 G2 和 G3

- 新增 `src/workspace/{scope,handle,seal}.ts`、`src/preview/manifest.ts`；正式和预览使用独立提交链、根目录、blob 前缀及控制状态，禁止共享可删除 blob。
- scope 由可信入口绑定，恢复身份与调用 scope 必须一致；`resume`/`publish-only` 接到 preview 身份立即拒绝，预览续跑只接受原 preview scope。
- Handle 不携带 OSS/GitHub 凭据；提供项目限定的文件能力与类型化变更入口，不将宿主完整 workspace 直接暴露给模型。执行器沙箱挂载由运行计划实现，此处提供必须验证的范围和失败类型。
- `sealPreviewIfReviewPassed` 只生成私有预览 manifest，保留相对图片引用及 `not_exercised` 发布检查；`sealDelivery` 在 preview 内无条件拒绝。
- 正式封存绑定最终文件哈希、资源清单、审校和程序检查、生成版本；任何文件变化使原校验失效。封存确认必须发生在对应检查点已提交之后。
- 完成标准：伪造 `ready_for_delivery`、替换 scope、篡改 manifest、跨项目写文件、在 OSS 注入 skill 均不能取得正式发布能力；凭据级拒绝由交付计划共同验证，不能只靠 TypeScript 类型。

### S6 Invocation 与累计计数的持久化基础 G2

- 新增 `src/workspace/{invocations,usage,counters}.ts`；一次 SDK query 对应一个 `invocation_id`，格式修复和明确可重试的 query 也须各有 prepared 意图。
- 持久化 scope、subject、能力、输入/context/policy 哈希、模型/SDK 版本及运行限制；返回已提交 revision 后 SDK 才能调用。策略许可由 policy 模块提供，此层检查引用和输入绑定，不自行判断语义。
- 按 SDK message ID 幂等应用可观察结果；明确每步 usage 与 query 汇总的选取规则，避免重复相加。`cost_status: unknown` 保留未知，不能写成零或阻止其他正常项目。
- query 终态持久化与阶段推进分开校验；如果终态或产物持久化失败，通知控制循环中止 SDK/工具。仅 prepared 或最终结果不明的恢复为 unknown，不自动新起 query。
- 保存 batch ID、分类次数、工具/材料累计量、修订与无进展次数；只有提交让出事件才允许开始下一批。崩溃、跨天和手动恢复不重置限制。
- 完成标准：消息重放、终态重复、query 汇总与分步结果同时出现仍只计一次；故障后旧调用不自动付费重跑，其他无依赖项目可继续。真实 SDK 内部重试/取消/账单观测由运行计划完成验证。

### S7 共享容量核算与资源预留与 GC G2 到 G4

- 新增 `src/storage/{inventory,capacity,reservations}.ts`、`src/workspace/gc.ts`；容量为所有正式/预览 workspace 加受管图床新增资源合计 50,000,000,000 bytes。
- 枚举全部受管存活对象，包含 manifest、commit、孤立 blob、预览产物及图床历史对象版本；同 bucket/key/version 去重，跨前缀实际副本分别计量。图床 inventory 和图片引用提供器由交付模块接入。
- 由可信只读容量管理器读取全局清单并返回汇总视图；preview 写身份仅访问自身前缀，不能为取得容量而获得正式证据读取或正式账本写权限。视图与本次受管写入在同一仓库互斥组内使用，外部写入者不在支持范围。
- 写前保存稳定对象键、预计字节、scope 和未决预留；控制性 checkpoint/manifest/commit 的新增字节也纳入预检。S7 首先 spike 预留检查点自身成本的确定性计算/保守预留，解决自引用和重复预留问题后才接真实上传。
- 上传响应未知保持预留并读回稳定键；对象确认存在后从预留转实际占用，避免双计；明确未写入才释放。容量清单不完整、图床历史版本无法列举时暂停新增上传。
- 实现 45 GB 预警、49 GB 停止新增采集快照/生成、最后 1 GB 控制记录保留区；任何写入不得超过 50 GB。若连控制记录都无法保存，停止并向 Actions 报错。
- GC 在同一互斥组先发布解除引用快照，再计算保留 manifest 的引用闭包；保护 HEAD、活跃/未决项目、待交付/待审 PR 版本与未决调用。commit 永不删除。
- 历史 manifest 默认保留三十天，孤立对象宽限七天；删除超过宽限且未引用 blob，删除确认后才能减账。图床还须由交付方核对默认分支与待审 PR 引用，未知则保留，已合并笔记引用长期保护。
- 完成标准：跨 scope 上传、预留回执丢失、版本化图床、清理中断及删除丢响应均正确计量；无安全可清理空间时只暂缓，不删除候选或破坏既有图片。

### S8 集成夹具与恢复手册与门槛证据

- 新增 `evals/storage/recovery-scenarios/`、`docs/runbooks/workspace-recovery.md`、`docs/runbooks/storage-capacity.md`；手册描述检查事实、只读对账、显式解除人工阻塞及重新提交步骤，禁止修改旧提交链。
- 提供所有业务模块可复用的 fake storage、fixture、故障插入点，以及真实 OSS 合约测试入口；从“采集原子入队→调用意图→产物→封存→外部回执”串起无模型/无正式写入的合成流程。
- 与运行模块验证“持久化失败立即中止”；与交付模块验证“远端成功但本地回执失败仅对账”；与监控模块验证只读快照、容量错误和未知调用可被报告。
- 完成标准：G1 有真实 OSS 证据；G2 有 preview 隔离与真实 SDK 配合证据；G3 有隔离仓库/图床回执故障证据；G4 有共享容量与 GC 集成证据。报告严格标记模拟、真实验证、尚未验证，不以代码覆盖率代替结果。

## 必须覆盖的故障矩阵

| 注入位置或条件 | 必须观察的结果 | 验证层 |
| --- | --- | --- |
| 空链、零号不存在、允许初始化 | 只产生一个零号提交；竞争方读回 | 替身 + 真实 OSS |
| 空列举但零号存在；403/超时/无 bucket | 恢复失败，不初始化 | 替身；OSS 错误分类实测 |
| blob/manifest 上传后进程退出 | 仍恢复旧 HEAD，孤立数据计容量 | 替身 + 真实 OSS |
| commit 成功后响应丢失 | 固定键读回同一意图，不跳序号 | 替身 + 真实 OSS |
| 两客户端创建同一序号 | 只有一方成功，另一方不继续外部动作 | 替身 + 真实 OSS |
| 列举分页失败、非法键、链缺口、哈希错误 | 停止恢复，不能选“最大版本” | 替身 + 真实分页 |
| 版本控制已开启/暂停、ACL 或生命周期不安全 | 停止启动/发布，不修改 bucket | 替身 + 已有隔离资源只读验证 |
| manifest 路径穿越、软链、伪造 skill | 无越界文件和可执行配置恢复 | 本地真实文件系统 |
| prepared 后中断、消息重复、终态保存失败 | unknown/去重准确；无自动重复 query | 替身 + SDK 适配集成 |
| preview 改 scope 或正式 resume 指向 preview | 程序拒绝；凭据也无法写正式资源 | 本地 + 真实 RAM 拒绝验证 |
| 上传成功但容量回执丢失 | 占用/预留只计一次，不提前释放 | 替身 + 隔离资源 |
| 旧 blob 被 HEAD 引用、未决 PR 引用图片 | GC 保留；commit 永不删除 | 替身 + 隔离 GC |
| 接近 49/50 GB、核算中断 | 暂停新增并报告，不突破上限 | 合成尺寸 fixture，无需实际填满桶 |
| 删除成功但响应丢失、GC 进程退出 | 再列举核对后减账，可重复清理 | 替身 + 隔离 GC |

## 外部依赖与不可提前宣称通过的事项

- G1 需要指定私有 OSS 测试 bucket、地域、公网 endpoint、前缀与 RAM 身份；从未开启版本控制、私有性和生命周期检查权限必须可验证。当前文档没有实际配置，本计划不创建或变更资源。
- 工作流为全部正式、预览、恢复、发布和清理入口提供统一写入互斥；存储竞争防线不能弥补跨仓库写入或失去互斥的容量预留。
- RAM 最小权限需要真实允许/拒绝测试：提交前缀不可删除、preview 不可写 production、监控只读、GC 仅删除可清理前缀。云端凭据配置由交付计划负责。
- 图床的 bucket/版本控制/受管前缀及引用查询接口尚未核验；G2 在获得可信全局容量视图前不得把图床未知占用当作零，G3 才验证测试图片与 PR 集成。
- Git 固定 skill commit、SDK 可观测消息与 usage 结构、取消后的结果判定由运行计划提供；原 context 不可获得时暂停对应项目，不换用最新版本顶替。
- 重点技术未知为 SDK 禁止覆盖头传递、完整分页与配置读取、容量预留自身成本及隔离凭据下的全局汇总；分别通过 S3/S7 spike 留下结论。不存在“本地通过即可视为生产可靠”的替代门槛。

## 可合并实施批次与评审材料

每个工作包可分多次提交，但跨模块调用前必须先落共享契约，避免用临时 JSON 绕过持久化边界。

| 批次 | 范围 | 评审时应能直接检查的材料 | 下一步条件 |
| --- | --- | --- | --- |
| A | S1 + S2 | 工程脚本、schema fixtures、对象存储接口、故障替身 | G0 契约冻结，可并行写业务模块 |
| B | S3 + S4 | 完整提交/恢复实现、真实 OSS 合约报告 | G1 通过，允许接入后续真实预览 |
| C | S5 + S6 + S7 的核算/预留 | scope 测试、调用屏障、消息去重、共享容量视图 | G2 存储前置完成，仍需运行模块验收 |
| D | S7 的 GC/图床版本核算 + S8 | 保护引用清单、清理故障报告、恢复手册 | 支撑 G3/G4，正式启用仍走 G5 |

真实测试报告放入实现期生成的验证记录，不把 bucket 名、账号 ID、环境变量或签名 URL 写进提交的 fixture。可提交脱敏后的契约摘要、SDK 版本、场景结果和报告哈希。

任一门槛失败时保留已有代码、测试产物与最后有效 HEAD，并记录阻塞项；不得靠缩减恢复校验、跳过容量核算或自动重试未知付费请求来让验收变绿。

本计划完成的定义是各接口与故障行为均有可重跑证据。用户是否接受真实文章质量、是否启用正式定时任务属于主计划 G5 的决策，不由存储模块自行宣布。
