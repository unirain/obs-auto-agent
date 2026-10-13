# 交付与运行维护：需求到证据审计

审计日期：2026-10-13（Asia/Shanghai）。本文件是补充审计，不替代 `docs/tasks/implementation.md`。实现、替身验证、真实 API、用户质量确认分开判断。**当前无法证明任何 G1–G5 整体通过；87 个场景仍无完整分层通过证据。**

## 25 个包的当前证据边界

| 包 | 实际代码/证据入口（路径相对 agents/reading） | 判断 |
| --- | --- | --- |
| S1 | contracts/schema.ts、package-lock.json | 基础类型/构建已有本地证据；本次改动仍需总集成复验 |
| S2 | storage/filesystem.ts、evals/storage/workspace.test.ts | 持久替身故障，不证明 RAM |
| S3 | storage/oss.ts、storage/fixtures/oss-live-evidence.json | 真实原生 OSS 核心已验证；独立 RAM 拒绝/真实运输丢失未验证 |
| S4 | workspace/manager.ts、storage/recovery-scenarios/flow.test.ts | 连续链/竞写/恢复有本地及部分 OSS 证据 |
| S5 | workspace/paths.ts、workspace/seal.ts | scope/白名单/封存有本地证据；真实身份隔离未验证 |
| S6 | workspace/invocations.ts、workspace/usage.ts | 调用账本/usage 本地测试；付费 SDK unknown 恢复未验证 |
| S7 | storage/broker.ts、capacity.ts、workspace/gc.ts | 容量/GC 本地；真实全部受管 scope/版本/删除角色未验证 |
| S8 | app/maintenance.ts、runbooks/workspace-recovery.md | 恢复入口存在；真实演练未验证 |
| A1 | stages/contracts.ts、app/controller.ts | 领域契约及四阶段；Root 新入口集成需复验 |
| A2 | policy/gate.ts、stages/eligibility.ts | 最新许可/分类/旧结果归档本地；真实付费受限分类未验证 |
| A3 | collect/sources.ts、collect/intake.ts | 两来源首屏实际读取；历史分页/停机补采/付费选题未证明 |
| A4 | context/index.ts、schedule.ts | 相关正例/固定上下文/公平调度本地；真实质量未证明 |
| A5 | runtime/sdk.ts、stages/executor.ts | SDK declarations/回放/子进程隔离本地；真实 provider query 未验证 |
| A6 | tools/web-reader.ts、tools/materials.ts | 读取及 JS 回退正在补齐；真实研究证据质量未验证 |
| A7 | tools/skills.ts、runtime/evidence/linux-tools-20261013.json | Linux static fixture/render 隔离已实测；cloud-adapted skill/SDK激活/用户质量未验 |
| A8 | app/controller.ts、preview/report.ts | 预览恢复本地；真实五类预览未验 |
| A9 | quality/candidates.unlabeled.json、quality/evaluation.ts | 候选仍未标注；留出集与用户质量确认未完成 |
| O1 | config/deployment.ts、deploy/examples、deploy/ram | 三绑定/密钥引用/endpoint 已本地校验；最小 RAM/App 安装权限未实测 |
| O2 | publish/resources.ts、oss-images.ts | 不可变键/读回/策略回执/中文描述命名本地；真实图床URL/版本未验 |
| O3 | publish/publisher.ts、github.ts、metrics.ts | PR故障恢复/全历史/待审外来重复/实际HEAD指标有替身证据；真实 SHA/App/PR 未验 |
| O4 | publish/recovery.ts、refreshVerified、app/controller.ts | 过期先对账/刷新/改版本路由本地；Root 集成与真实撤销尚待复验 |
| O5 | .github/workflows/reading-agent.yml、config/dispatch.ts | 静态 scope/并发/secret 扩散检查；云端取消并发/信任入口未实测 |
| O6 | monitor/main.ts、run-events.ts、issues.ts、app/watchdog.ts | 完整事件/重跑/暂停时钟/自故障/去重本地；真实 Actions/Issue 权限响应丢失未验 |
| O7 | evals/integration/delivery-operations/*.live.test.ts | 显式 isolated opt-in probes 未执行；不能以跳过计通过 |
| O8 | runbooks/reading-*.md、test-environment-setup.md | 手册存在；用户默认值确认/正式 smoke/首轮 cron 未执行 |

## G0–G5

| Gate | 可证明 | 仍缺 |
| --- | --- | --- |
| G0 | strict typecheck/build、DTO/schema fixtures、模型/资源/Publisher替身调用 | 本轮全部变动的总集成复验、记录版本/权限检查ref跨模块关联 |
| G1 | 真实 private obs-agent 原生禁止覆盖、多页列举、两客户端竞写、匿名403、链恢复 | 分开的 RAM role 实际允许/拒绝，commit删除拒绝，真实运输级失联；controlled post-response fault不是运输失联 |
| G2 | Linux 无网络/无宿主文件/无控制器密钥、static图像渲染；SDK本地回放 | cloud-adapted固定skill commit、真实SDK/DeepSeek调用和工具完整链、至少五类型真实preview、用户图文确认 |
| G3 | 本地外部边界故障和下一实例继续、不覆盖人工分支、期满先对账 | 独立测试repo/App、公共图片域名与版本、真实PR/图片/OSS回执及每边界注入 |
| G4 | 来源首屏读取、逐来源/coverage_gap事件替身、容量/版本/GC替身 | 真分页/停机覆盖、实际Issue与Actions故障、全范围容量身份、标注集/冻结留出和用户质量 |
| G5 | production cron关闭、预览密钥独立、准备/恢复手册 | 设计默认值用户核对、生产权限、受控正式手动链、监控演练、首轮定时 |

## 本轮实质修补

- 图片 GC 原先只有可注入 callback。新增 `collectImageGarbage`、`OSSImageGCStore`、`imageGCFromTrustedHost`：只清理本系统已确认归属、项目结束并解除引用且历史保留期过后的资源；保护 active/merged/pending/unknown，读默认分支与全部 open PR 文字资源，引用或版本清单不完整则不删。删除意图先提交；按具体版本读回确认后才释放容量。enabled/suspended 的旧 null version 使用显式 versionId=null，避免生成删除标记而伪称回收。独立 GC role 不复用 uploader。
- 已确认资源回执重试也实际读回 hash/MIME/公开 URL；被合法 GC 清理后只能重新许可与预留，再重建相同内容键。
- Actions 监控改为完整历史/每次 rerun attempt；两个巡检之间发生并恢复的失败、取消、缺报告和漏跑保留事件。closed control Issue 记录 observed pause/resume，36 小时基线重算，来源故障不因暂停结束伪造恢复。监控读取失败成为自身故障，不能显示健康。
- PR 指标使用真实 PR 身份去重及实际 merged HEAD 文件；无法证明是否改稿、用户审阅耗时或费用时保留 unknown/null，不推断偏好。Root负责把这些视图接入最终运行报告。
- 每次上传/远端写入的 PolicyEvidence 在意图中提交并关联到 action。legacy void callback 明确 legacy_unverified，不能作完整策略证据。DeliveryRecord/UploadIntent 加 schema_version:1，未知/未版本化不得忽略或初始化。
- 图片名保留文章/配图可读内容，安全支持中文；不以 project-id+短哈希冒充描述。外来 pending PR 的来源/目标文件碰撞也禁止新发布。PR机器身份只解析 leading trusted marker，外部引用文本不能注入控制标识。

## 87 个验收场景逐条证据索引

以下路径仅定位可检查断言/有限实际证据，**不是宣称整个场景通过**。每行当前仍需 canonical coverage 中的完整 result/evidence，涉及真实服务、权限、质量的层级均未被替身覆盖。路径相对 agents/reading/evals。

| ID | 场景 | 已定位的局部证据 | 完整结论 |
| --- | --- | --- | --- |
| C001 | 合格文章有论文和代码 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C002 | 文章只有营销描述 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C003 | LangChain 或 Claude 入口出现产品发布公告 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C004 | 技术教程提到产品名，但主体解释机制与取舍 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C005 | 新候选没有标签，正文同时介绍新产品与技术机制 | runtime/executor.test.ts、policy/gate.test.ts、runtime/driver.test.ts | unproven |
| C006 | 内容未知但来源被停用、域名被拒绝或项目暂停 | delivery/policy-receipts.test.ts、delivery/publisher.test.ts、policy/gate.test.ts | unproven |
| C007 | 受限分类判为技术实践／产品发布／仍未决 | runtime/executor.test.ts、policy/gate.test.ts、runtime/driver.test.ts | unproven |
| C008 | 分类过程中尝试跟读论文、绘图、写笔记或发布 | runtime/executor.test.ts、policy/gate.test.ts、runtime/driver.test.ts | unproven |
| C009 | 语义规则更新令旧分类失效 | runtime/executor.test.ts、policy/gate.test.ts、runtime/driver.test.ts | unproven |
| C010 | 首次正式提交首批信源之外、早于七天窗口的公开 URL | collect/intake.test.ts、collect/sources.test.ts、integration/controller.test.ts | unproven |
| C011 | 两次正式提交同一 URL，或提交回执响应丢失后重试 | collect/intake.test.ts、collect/sources.test.ts、integration/controller.test.ts | unproven |
| C012 | 同一 URL 经人工和订阅发现，或跳转后确认同一文章 | collect/intake.test.ts、collect/sources.test.ts、integration/controller.test.ts | unproven |
| C013 | 人工提交命中禁用来源或全局暂停 | collect/intake.test.ts、collect/sources.test.ts、integration/controller.test.ts | unproven |
| C014 | 预览成功后使用 scheduled + input_urls 正式提交 | collect/intake.test.ts、collect/sources.test.ts、integration/controller.test.ts | unproven |
| C015 | Claude 目录条目指向允许的外部官方正文域名 | collect/sources.test.ts、runtime/evidence/source-native-20261013.json | unproven |
| C016 | 列表只有活动或无文字视频，或正文日期未知 | collect/sources.test.ts、runtime/evidence/source-native-20261013.json | unproven |
| C017 | 首次窗口内超过五十个条目 | collect/sources.test.ts、runtime/evidence/source-native-20261013.json | unproven |
| C018 | 同轮已有三篇产出或已有十个待审 PR | delivery/publisher.test.ts、delivery/github-read.test.ts、delivery/metrics.test.ts | unproven |
| C019 | 加载质量正例 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C020 | 历史正例来自本轮排除的内容或来源类型 | collect/sources.test.ts、runtime/evidence/source-native-20261013.json | unproven |
| C021 | 摘要不完整但全文有价值 | collect/sources.test.ts、runtime/evidence/source-native-20261013.json | unproven |
| C022 | 多站转载同一文章 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C023 | 同主题文章有不同实验或相反结论 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C024 | 核心论文读取失败 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C025 | 单个信源失败 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C026 | 一个来源连续失败，另一个持续创建 PR，Actions 成功退出 | operations/monitor.test.ts、operations/watchdog-reader.test.ts | unproven |
| C027 | 同一来源同一原因多轮失败，之后实际读取恢复 | operations/monitor.test.ts、operations/watchdog-reader.test.ts | unproven |
| C028 | 故障在两次监控之间发生并恢复 | operations/monitor.test.ts、operations/watchdog-reader.test.ts | unproven |
| C029 | 当前来源读取恢复但历史 coverage_gap 未补齐 | operations/monitor.test.ts、operations/watchdog-reader.test.ts | unproven |
| C030 | 停用来源、全局暂停、publish-only 或其他来源成功 | operations/monitor.test.ts、operations/watchdog-reader.test.ts | unproven |
| C031 | 发现候选后进程崩溃 | storage/workspace.test.ts、integration/controller.test.ts、collect/intake.test.ts | unproven |
| C032 | SDK query 内包含多步模型请求 | runtime/executor.test.ts、storage/usage-ledger.test.ts、integration/recovery.test.ts | unproven |
| C033 | SDK query 结果不明或仅存启动意图 | runtime/executor.test.ts、storage/usage-ledger.test.ts、integration/recovery.test.ts | unproven |
| C034 | 未配置模型金额上限或价格未知 | runtime/executor.test.ts、storage/usage-ledger.test.ts、integration/recovery.test.ts | unproven |
| C035 | 四十次工具调用后仍有必需工作，或补充材料超过八份 | runtime/driver.test.ts、runtime/material-progress.test.ts | unproven |
| C036 | 跨天恢复持续无进展或已用完两轮修订的项目 | runtime/driver.test.ts、runtime/material-progress.test.ts | unproven |
| C037 | 剩余五分钟但 SDK 仍在执行 | runtime/executor.test.ts、storage/usage-ledger.test.ts、integration/recovery.test.ts | unproven |
| C038 | PR 创建成功但响应丢失 | delivery/publisher.test.ts、delivery/github-read.test.ts、delivery/metrics.test.ts | unproven |
| C039 | PR 已待审多日 | delivery/publisher.test.ts、delivery/github-read.test.ts、delivery/metrics.test.ts | unproven |
| C040 | 用户关闭未合并 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C041 | 用户手工修改 PR 分支 | delivery/publisher.test.ts、delivery/github-read.test.ts、delivery/metrics.test.ts | unproven |
| C042 | 用户合并 PR | delivery/publisher.test.ts、delivery/github-read.test.ts、delivery/metrics.test.ts | unproven |
| C043 | 首次运行且提交链为空、零号对象不存在 | storage/workspace.test.ts、storage/recovery-scenarios/flow.test.ts | unproven |
| C044 | 读取 OSS 超时、403 或 manifest 损坏 | storage/workspace.test.ts、storage/recovery-scenarios/flow.test.ts | unproven |
| C045 | 产物已上传但提交记录尚未发布时退出 | storage/workspace.test.ts、integration/controller.test.ts、collect/intake.test.ts | unproven |
| C046 | 提交记录创建成功但响应丢失 | storage/workspace.test.ts、integration/controller.test.ts、collect/intake.test.ts | unproven |
| C047 | 两个客户端争写同一提交序号 | storage/workspace.test.ts、integration/controller.test.ts、collect/intake.test.ts | unproven |
| C048 | workspace bucket 版本控制已开启或已暂停 | delivery/policy-receipts.test.ts、delivery/publisher.test.ts、policy/gate.test.ts | unproven |
| C049 | 提交前缀列举中断、提交链有缺口或哈希不符 | storage/workspace.test.ts、storage/recovery-scenarios/flow.test.ts | unproven |
| C050 | workspace bucket 不存在或匿名可读 | delivery/svg.test.ts、operations/workflows.test.ts、storage/bootstrap.test.ts | unproven |
| C051 | GC 清理超过保留期的历史数据 | delivery/image-gc.test.ts、delivery/image-gc-bootstrap.test.ts、storage/maintenance.test.ts、storage/broker.test.ts | unproven |
| C052 | Actions 超时或被取消 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C053 | 工具容器在绘图中退出 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C054 | 同时触发两个 Actions | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C055 | PR 已创建但回执失败 | delivery/publisher.test.ts、delivery/github-read.test.ts、delivery/metrics.test.ts | unproven |
| C056 | 回执丢失超过二十四小时且 PR 已存在 | delivery/recovery.test.ts、integration/controller.test.ts | unproven |
| C057 | 超过二十四小时且 GitHub 结果无法确认 | delivery/recovery.test.ts、integration/controller.test.ts | unproven |
| C058 | 仅有机器人分支／commit，尚无 PR | delivery/publisher.test.ts、delivery/github-read.test.ts、delivery/metrics.test.ts | unproven |
| C059 | 未发布结果过期，来源未变／发生变化 | delivery/recovery.test.ts、integration/controller.test.ts | unproven |
| C060 | 下载不完整或文件哈希不符 | delivery/svg.test.ts、delivery/publisher.test.ts、storage/workspace.test.ts | unproven |
| C061 | manifest 指向工作流文件或非法路径 | delivery/svg.test.ts、delivery/publisher.test.ts、storage/workspace.test.ts | unproven |
| C062 | skill、样例等生成配置更新但旧项目尚未完成 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C063 | 用户新增排除主题或停用来源，旧项目正在积压 | operations/monitor.test.ts、operations/watchdog-reader.test.ts | unproven |
| C064 | 本轮已启动后用户撤销许可 | delivery/policy-receipts.test.ts、delivery/publisher.test.ts、policy/gate.test.ts | unproven |
| C065 | 已持久化 publishing 意图后用户全局暂停 | delivery/policy-receipts.test.ts、delivery/publisher.test.ts、policy/gate.test.ts | unproven |
| C066 | 最新策略读取失败或受限分类后语义排除仍未决 | runtime/executor.test.ts、policy/gate.test.ts、runtime/driver.test.ts | unproven |
| C067 | 新限制命中已创建 PR 或之后解除限制 | delivery/policy-receipts.test.ts、delivery/publisher.test.ts、policy/gate.test.ts | unproven |
| C068 | 默认手动触发单 URL 试运行 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C069 | 预览把某 URL 判为 skip 或已完成，随后正式处理同 URL | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C070 | preview 产物声明 ready_for_delivery，或传入正式发布参数 | runtime/tools.test.ts、delivery/resources.test.ts、runtime/evidence/linux-tools-20261013.json | unproven |
| C071 | 对 preview_id 调用正式 resume／publish-only | operations/modes.test.ts、operations/schemas.test.ts、contracts/cli.test.ts | unproven |
| C072 | 预览图文审校通过 | runtime/tools.test.ts、delivery/resources.test.ts、runtime/evidence/linux-tools-20261013.json | unproven |
| C073 | 正式与预览同时请求存储 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C074 | OSS 快照包含伪造 skill 或可执行配置 | delivery/svg.test.ts、operations/workflows.test.ts、storage/bootstrap.test.ts | unproven |
| C075 | 清理时旧 blob 仍被 HEAD 或待审版本引用 | delivery/image-gc.test.ts、delivery/image-gc-bootstrap.test.ts、storage/maintenance.test.ts、storage/broker.test.ts | unproven |
| C076 | OSS workspace 与新图床资源合计接近容量上限 | delivery/image-gc.test.ts、delivery/image-gc-bootstrap.test.ts、storage/maintenance.test.ts、storage/broker.test.ts | unproven |
| C077 | 容量不足且所有对象仍被保护 | delivery/image-gc.test.ts、delivery/image-gc-bootstrap.test.ts、storage/maintenance.test.ts、storage/broker.test.ts | unproven |
| C078 | 上传成功但容量回执丢失 | delivery/image-gc.test.ts、delivery/image-gc-bootstrap.test.ts、storage/maintenance.test.ts、storage/broker.test.ts | unproven |
| C079 | 已发布图片在重生成中发生变化 | delivery/image-gc.test.ts、delivery/image-gc-bootstrap.test.ts、storage/maintenance.test.ts、storage/broker.test.ts | unproven |
| C080 | 凭据、浏览器登录信息或缓存出现在工作目录 | delivery/svg.test.ts、operations/workflows.test.ts、storage/bootstrap.test.ts | unproven |
| C081 | 原文带恶意指令 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C082 | 生成目录包含符号链接或 workflow 文件 | delivery/svg.test.ts、operations/workflows.test.ts、storage/bootstrap.test.ts | unproven |
| C083 | 图片无法渲染或无法视觉检查 | runtime/tools.test.ts、delivery/resources.test.ts、runtime/evidence/linux-tools-20261013.json | unproven |
| C084 | 模型连续修订仍有事实错误 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C085 | 当天没有合格文章 | runtime/driver.test.ts、context/context.test.ts、quality/evaluation.test.ts；真实质量未证明 | unproven |
| C086 | 阅读调度未触发而监控工作流正常 | operations/run-events.test.ts、operations/actions-metrics.test.ts | unproven |
| C087 | 故障恢复或 GitHub 平台整体不可用 | operations/monitor.test.ts、operations/watchdog-reader.test.ts | unproven |

## 证据解释与剩余问题

- `evals/results/local-verification.json` 的 187 例及 fingerprint 是较早基线，不覆盖本轮新代码。需协调器重新生成当前实现 fingerprint/result；文件存在不能证明当前代码通过。
- `storage/fixtures/oss-live-evidence.json` 明确 G1 incomplete；不等同 RAM/transport 层完整通过。`runtime/evidence/linux-tools-20261013.json` 标记 cloud_skill_adapted=false、SDK激活未执行、用户视觉质量待确认。
- Root正在接默认 image GC、实际PolicyCheck/Stage invocation ref、人工调用核对与解阻、指标报告；在真实调用点和集成测试验明之前，不把独立函数存在算完成。
- 无真实 O operation state 需要隐式迁移；遇到无 schema 的旧本地状态必须显式迁移或使用新的独立测试 workspace，不能用静默填版本掩盖格式变化。
- Review反馈 API 只接受 trusted_management、实际已确认 PR 和显式人工时长。未从用户获得反馈就保持空/unknown，不能用模型评分替代。
- 尚未真实执行图床 GC；专用身份、明确被保护的真实 PR/默认分支对象、真实 DELETE 响应丢失与下一进程读回均仍需隔离验证。
- 原生 OSS HTTP计量、Actions job elapsed 与供应方实际账单不同。adapter_calls 不当作服务请求数，job elapsed 不当作计费分钟；账单费用仍 unknown。

## 本轮检查

`npm test -- agents/reading/evals/delivery agents/reading/evals/operations`：2026-10-13 20:10 Asia/Shanghai，18 文件 / 97 例通过；`npm run typecheck`、`npm run build` 通过。`npm run coverage:spec`：87 mapped、0 complete、87 pending。最终总集成证据由协调器更新 canonical tasks/log；未运行 live probes，不创建云资源、不改变 RAM/bucket 设置、不启用 cron。

## 20:44 精确来源与 GC 控制行复核

`github.ts` 已移除普通正文 `includes(primary URL)` 去重：`primary-source.ts` 只解析开头 frontmatter 的 `source`/`source_url` 或单独明确的原文/Primary source directive，排除参考链接、代码块、缩进代码、blockquote 和 HTML comment。URL 使用统一 `normalizeUrl` 完整值比较；`/post` 不等同 `/post-2`，业务 query 不删，supplemental sources 不加入主来源集合。只有可信宿主提供的 `primary_source_aliases` 能关联真实跳转/已验证 canonical。21 个 parser/实际适配器替身案例通过。

图片保护读取前拒绝未版本化、未知 schema 及 schema 1 中未知未来 state 的 project/invocation/reservation/upload/delivery/GC 控制行；不把它们当已结束或无引用。12 个故障场景证明在 inventory/delete 前停止。共享 StorageReservation 已由 S 加 schema_version:1，Root 正式 producer 同步；不隐式填旧版本。

本轮最终命令：2026-10-13 20:44 Asia/Shanghai，`npm test -- agents/reading/evals/delivery agents/reading/evals/operations` 19 文件 / 131 例通过，`npm run typecheck`、`npm run build` 通过。尚未执行本轮任何 live API/资源删除；这些仍是本地程序证据。

## 21:18 显式新版本与人工反馈准备接口

`publish/regeneration.ts` 的 `checkGenerationReadiness` 是纯只读准备：调用真实 adapter 的 repository/default authority、完整 project ref/PR snapshot，并逐条 inspect 所有可信历史 seals/records。未包含全部历史集合、缺 actual complete observation、任何 open/closed/merged PR、未决外部写入、差异冲突、未登记旧枝或检查前后引用变化均拒绝；错误不能成为“没有 PR”。证据含仓库/default/refheads/UTC 时间和 canonical audit hash，只保留笔记内容 hash，不把完整私有笔记塞进管理回执。匹配原 expected commit 且无 PR 的旧分支可以保留；未来 Publisher 仍必须检查历史。

`publish/feedback.ts` 的 `prepareHumanReviewFeedback` 校验可信 actor、一致 workspace/project/delivery、真实 PR ID/仓库/URL/当前 HEAD 和状态，再返回 feedback、更新 delivery 及 feedback audit 的原子 records bundle。准备过程不提交 checkpoint；Root 将它与 management request receipt 一次提交。旧 standalone `recordHumanReviewFeedback` 已标记 deprecated，不能用于分两次写入的 Root 管理请求。人工分钟/原因只记录用户显式提供的信息，不改偏好。

本轮 12 个换版本检查、11 个反馈准备和 native readonly snapshot 替身回归通过，覆盖多历史、读取响应丢失、旧 PR 后建再检、unknown/state、atomic bundle 失败无部分反馈、human HEAD 变化；不是 live App 权限验证。21:18 本地 O 目录 21 文件 / 155 测试、typecheck/build 通过；87 场景仍须各层实际证据。
