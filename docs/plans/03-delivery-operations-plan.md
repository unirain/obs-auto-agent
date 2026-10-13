# 阅读 Agent 交付与运行维护实施计划

日期：2026-10-13。状态：待实施；本文不表示已配置凭据、创建云资源或完成集成验证。

依据：[spec](../specs/reading-agent-spec.md)、[intent](../../intent.md)。总体门槛与排序见[主计划](README.md)，持久化依赖见 [01](01-workspace-storage-plan.md)，运行时与质量依赖见 [02](02-agent-runtime-plan.md)，跨模块验收见 [04](04-integration-validation-plan.md)。本文的目录和接口名是实施约定建议，G0 冻结后再落代码；不新增产品范围。以下 `src/`、`schemas/`、`evals/`、`deploy/` 均相对 `agents/reading/`，`.github/` 与 `docs/` 相对仓库根目录。

## 交付结果与边界

实现可信资源上传、基于不可变产物的 GitHub PR 交付、四模式 Actions、独立 watchdog，以及可执行恢复手册。交付状态以真实 GitHub 结果为准；PR 必须由用户审阅合并，不自动重提关闭项目或覆盖人工修改。

preview 只能生成私有检查产物，不加载正式写入能力。验证上传和 PR 的 G3 使用独立测试仓库、资源前缀与 **production scope 测试 workspace**，它是单独的可信部署配置；不可修改 preview 的 scope、复制正式回执或把测试回执导入正式 workspace。正式 workspace 仍固定为 `obs-notes-hub/reading`，测试身份在 G0 单列并硬性绑定测试目的地。

## G0 跨模块契约

| 接口／对象 | 输入与结果 | 责任边界 |
| --- | --- | --- |
| `ExecutionTarget` | mode、scope、workspace、配置版本、允许的仓库／bucket／prefix | 可信入口创建并验证；模型、恢复文件和任意 dispatch 参数不能选择额外写入目的地 |
| `PolicyGate.check` | subject、capability、最新 ref → `PolicyCheck` | 由 02 提供；上传和每次 GitHub 写入前调用，最新限制优先于旧 context |
| `ResourcePublisher` | 本地资源清单、项目、容量预留 → 不可变资源回执 | 本计划实现；01 管理容量与回执持久化；02 接收 URL 后重新最终审校 |
| `SealedDelivery` | spec 完整 manifest、有效 workspace revision、文件和资源哈希 | 01 封存；Publisher 只读已提交快照，独立校验路径和哈希 |
| `Publisher.reconcile` | 项目全部历史交付 → GitHub 事实及待处理冲突 | 无模型，只读远端；策略撤销时仍可执行，结果由 01 保存 |
| `Publisher.publish` | 已对账交付、当前许可 → commit／PR 回执或不确定状态 | 每次写前重新检查；先持久化意图和预期 commit SHA，禁止盲目重试 |
| `RunRecord / SourceIncident` | mode、scope、结果、逐来源状态、事件 ID 与顺序位置 | 02 产生采集事实，01 与候选／游标原子提交，本计划只读消费 |
| `MonitorProjection` | 故障键、未处理事件、当前策略 → Issue 状态与处理位置 | 仅写实现仓库 Issue 元数据，不写 workspace，不把评论作为控制输入 |

G0 同时明确错误分型：可安全重试的读取、外部结果不确定、策略拒绝／不可读、内容需重新分类、容量不足、交付冲突；不以一个通用 retry 路径处理。`classify_only` 只属于选题运行时，绝不能通过 Publisher、图片上传或 watchdog 获得额外工具能力。

### 接口所有权与完成检查

- 01/S1 建脚手架、npm／package-lock、TypeScript strict、Vitest；本计划复用，不另建包管理体系。
- 01 定版公共身份、错误、schema envelope 与检查点；02 定版 Policy、Candidate、SourceIncident 和阶段输出。
- 本计划定版 Delivery、ResourceManifest／资源回执、RunRecord 报告与监控投影 DTO；RunRecord 中的来源字段复用 02 的类型，不复制一套健康语义。
- G0 以 fixtures 验证 Agent → Manager → Publisher → watchdog 的字段一致性，包含 scope、哈希、未知费用、来源事件顺序和不确定外部结果。
- 单元／契约测试用替身，集成测试通过显式环境绑定取得真实客户端；命令默认不访问正式写入资源。
- 所有工作包完成时交付代码、非秘密配置、测试命令和实际结果；缺资源的真实验证列为未执行，不能将工作包实现完成等同门槛通过。

并行顺序：G0 后 O1、O5 的参数校验、O6 的事件投影可并行；G1 后 O2 真实存储集成，O3 可先接封存 fixtures。O3 → O4 为顺序依赖；G2 后在隔离测试环境汇合 O2–O6，按 O7 留存 G3/G4 证据，最后执行 O8 的 G5 启用检查。

## O1 部署配置与依赖验证设计

- **依赖：** G0；01 的 OSS 接口和容量定义；02 的可信入口、策略能力枚举。
- **预期文件：** `agents/reading/schemas/deployment.schema.json`、`src/config/deployment.ts`、`deploy/examples/`、`docs/runbooks/reading-deployment.md`。文件仅保存非秘密配置、凭据引用名及用途。
- **工作：** 定义正式、preview、集成测试三个部署绑定；验证 workspace 身份与目标 repository、bucket、prefix 匹配，禁止通过输入 URL 或恢复 manifest 改变写入目的地。
- **工作：** 列出 workspace 管理、preview、容量只读清单、图床、Publisher、watchdog 六类能力。通过可信宿主按需注入，工具容器不继承密钥；preview 不含图床、目标仓库或告警 Issue 写权限。
- **spike：** 实测 GitHub App 安装范围、创建分支／commit／PR 及读取 closed／merged PR 所需权限和后续检查触发行为；验证最小 RAM 权限与列举、ACL、生命周期、版本控制读取。未取得账号前只写验证步骤及期望结果，不宣称 API 或权限组合已确认。
- **验收：** 错配生产目的地、匿名可读 workspace、不合格生命周期、版本控制曾开启、内网 endpoint 均 fail closed；凭据值不进入日志、报告、OSS 或 Git 配置快照。

## O2 可信图片上传与交付资源回执

- **依赖：** O1、G1；01 的容量预留／对账和不可变回执；02 的图形产物及最终审校契约。
- **预期文件：** `src/publish/resources.ts`、`src/publish/oss-images.ts`、`schemas/resource-receipt.schema.json`、`evals/delivery/resources.test.ts`。
- **工作：** 上传前核验当前执行许可、内容允许凭证、文件哈希／MIME／大小、共享容量。按 spec 的描述性命名加完整 SHA-256 生成稳定对象键，首次生成日期固定，重试复用键。
- **工作：** 持久化上传意图及容量预留后执行上传，确认对象内容和最终 URL 可访问，再返回对象键、版本 ID（若有）、哈希、大小、MIME、URL、项目归属。响应不明先读回对账，不重复计量或释放预留。
- **工作：** 无版本控制图床验证禁止覆盖；已开启／暂停图床使用唯一可信上传程序及哈希命名，验证相同键内容一致且没有其他上传流程写专用前缀。历史版本进入容量核算。
- **工作：** 回填最终 URL 后让 02 重新完成最终审校与校验；`validated` 绑定新正文和资源清单哈希，之后任何正文／引用变动均失效。封存时再次核对资源回执。
- **验收：** 同内容重复提交不产生第二份逻辑资源，内容变化得到新 URL；响应丢失、读回失败、容量无法核对、策略撤销分别进入明确状态。图片结果不明或仍被待审／已入库内容引用时禁止清理。
- **preview：** 使用 02 的本地资源适配器；本模块不实例化。图片 URL 访问、正式上传与 PR 检查记录 `not_exercised`。

## O3 Publisher 幂等提交与全历史对账

- **依赖：** O1、O2；01 的封存和检查点；02 的正式最终校验、来源核验及当前分类凭证。
- **预期文件：** `src/publish/{github,validate,reconcile,publisher}.ts`、`schemas/delivery.schema.json`、`evals/delivery/publisher.test.ts`。
- **工作：** 从有效已提交 revision 读取 manifest；验证 production scope、文件哈希、允许目录、MIME、符号链接、同名目标及最新默认分支重复来源。只复制获准 Markdown 与图源到独立 Git 目录，不执行产物代码。
- **工作：** 先查询本项目全部历史交付的分支、commit、open／closed／merged PR；使用稳定 `delivery_id` 机器标识和 `notes/<project-id>/g<generation-version>` 分支。查询失败保留 `publishing`，不把无法查询当不存在。
- **工作：** 在任何远端创建之前，构造确定的提交内容并由 01 持久化 `publishing` 意图、base commit、完整预期文件集／哈希与预期 commit SHA。GitHub 客户端的提交构造方式需 spike 验证可复现；不得先创建分支再补意图。
- **工作：** 当前许可通过才创建分支、提交／更新机器人分支、创建 PR；各动作前重读策略，不 force push。部分成功恢复时须核对 base、预期 commit SHA、文件哈希与完整 diff，完全匹配才能续建 PR；多余人工修改进入 `delivery_conflict`。
- **工作：** PR 模板包含来源、收录理由、知识增量、文件、证据缺口、配图降级、校验、费用及其未知状态和 delivery 标识。保存真实 commit 与 PR ID，不能由模型填写。
- **验收：** PR 成功但响应／OSS 回执丢失只补回执；关闭未合并保留 `closed_unmerged`，不重提；合并后读取默认分支实际笔记建立索引；待审 PR 不自动重写。

## O4 过期产物与策略撤销与恢复路由

- **依赖：** O3；02 的来源重新核验、内容分类凭证和 generation version 管理。
- **预期文件：** `src/publish/recovery.ts`、`evals/delivery/recovery.test.ts`、`docs/runbooks/reading-recovery.md`。
- **工作：** 先对账旧交付，再看默认二十四小时的 `sources_verified_at` 有效期。已有 PR 只补事实；GitHub 不可确认时保持 publishing，不新建版本、PR 或删除资源。
- **工作：** 确认所有旧交付无 PR 且无未决写入后，才允许回到来源核验。材料不变仅刷新不可变交付记录及核验时间，旧记录 superseded；影响结论的变化经 02 建新生成版本重审，保留旧分支。
- **工作：** 新交付前再次检查旧版本是否被人工创建 PR，确保每项目仅一个活跃交付。已关闭／已合并项目不走自动再生成。
- **工作：** 策略撤销或不可读时禁止新增上传、推送和 PR，仍只读核对已有结果并持久化事实；不得自动关闭现存 PR。语义策略或正文变化使分类凭证失效时，明确无远端未决结果后交回 02；执行许可通过才可 classify_only。
- **验收：** `publish-only` 遇过期材料或分类失效，报告需要 resume，不调用模型；一次发布流程中途暂停也不能补做余下写入。

## O5 四模式 GitHub Actions 与凭据隔离

- **依赖：** O1、G1；02 的 CLI 类型化入口。preview 工作流权限隔离是 G2 的组成部分，不能等 G2 通过才实现；正式发布接线等待 G2，O3/O4 可先用替身接入，G3 前替换为真实客户端。
- **预期文件：** `.github/workflows/reading-agent.yml`、`src/config/dispatch.ts`、`evals/operations/modes.test.ts`、`docs/runbooks/reading-operations.md`。
- **工作：** 定时固定 `scheduled + production`，无 input_urls；手动默认 preview。workflow JSON 数组字符串解析为类型化 URL 数组，不把用户输入拼入 shell。
- **工作：** 显式 `scheduled + input_urls` 接受新人工 URL，对账后由 02/01 完成人工身份、统一去重、候选及 submission 回执原子入队，再处理积压和信源发现。历史或首批信源外 URL 仍经过当前许可；不推进订阅游标。
- **工作：** `resume`、`publish-only` 仅接受已有 production 项目，拒绝新 URL 和 preview_id；preview 用自身 ID 续跑，只写自身控制状态。preview 成功后的正式处理须重新以 scheduled 提交原始 URL。
- **工作：** 所有正式／preview 写入与清理共用固定全仓库 writer concurrency 组，不包含分支或 run ID；不主动取消正在运行的 writer。容量管理器提供全局只读容量视图，scope 自己保存写入回执；禁止将并发等待队列当任务持久队列。
- **工作：** 每日逻辑键按 Asia/Shanghai 日期生成，run ID／attempt 仅审计。按 spec 保留主动收尾时间；超时或取消中止 SDK，恢复最后已提交快照，不声称 runner 退出后 Agent 继续运行。
- **工作：** 付费及写入入口只运行可信代码和配置，拒绝不受信任 PR／评论触发能力加载。配置先校验 scope 再选择凭据；通过容器环境 allowlist 验证密钥不可见。
- **验收：** 模式参数矩阵、JSON 恶意字符、重复 dispatch、跨 scope 恢复、取消／重跑、同日新人工 URL、正式与 preview 并发均通过；同日复跑不能因逻辑键相同漏掉新提交项。
- **日程：** spec 默认北京时间 08:17；部署时确认所用 Actions 调度语法及等效 UTC 配置，G5 前不启用正式定时。

## O6 独立 watchdog 与可恢复的 Issue 去重

- **依赖：** O1、O5；01 的只读提交链／事件读取；02 的完整 `source_results`、持久事件和运行报告。
- **预期文件：** `.github/workflows/reading-watchdog.yml`、`src/monitor/{run-health,source-health,issues,main}.ts`、`schemas/monitor-metadata.schema.json`、`evals/operations/monitor.test.ts`。
- **工作：** 使用独立 concurrency，读取 Actions 历史、只读 OSS 报告及最新策略；只持有实现仓库 Issues 写权限，无模型、图床、目标仓库或 workspace 写权限。
- **工作：** 默认北京时间 10:47／22:47 检查；从显式启用时间起算，超过三十六小时无 scheduled 启动、已结束计划运行失败／取消／报告缺失即告警。未超时运行不因报告尚未生成告警，publish-only 成功不抵消漏跑。
- **工作：** 按 `workspace + source_id + reason_code` 稳定键创建／重开 Issue；读取所有未处理持久事件，不能仅看最新 outcome。Issue 机器元数据保存故障状态与最后事件位置，状态未变不重复评论，原因变化和恢复才更新。
- **工作：** Issue 创建或更新结果不明时先按标识读回，确认展示了对应事件才推进处理位置；离线积压事件合并通知，发生并恢复于两次监控之间的故障也需留记录。具体查询／分页和元数据修改冲突以客户端 spike 验证。
- **工作：** 来源恢复要求实际抓取、解析、完成分页并持久化结果；空列表可算成功，其他来源成功、disabled、not_attempted、全局暂停和 publish-only 不算。策略抑制保留故障历史；解除全局暂停重算预期周期，不能伪造恢复。
- **工作：** coverage_gap 独立键与未解决区间集合，不随读取恢复关闭；仅补采验证或可信管理入口写入用户接受缺口事件后处置，后者为 accepted_gap。普通 Issue 评论不执行控制命令。
- **工作：** 容量暂停、需要人工核对、监控自身读取失败按原因报告；API 失败不显示健康。preview 事件仅留预览报告。事件持久化失败应由读取工作流失败引出运行级告警。
- **验收：** 单来源失败但 Actions 成功仍告警；同因多轮不刷屏；间隔内故障恢复不遗漏；Issue 响应丢失不重复创建；策略读取失败不当作暂停。平台整体无法调度不在本机制保证范围。

## O7 真实集成与故障注入与上线证据

**依赖：** O1–O6；01/02 对应门槛。预期文件：`evals/integration/delivery-operations/`、`docs/runbooks/reading-acceptance.md`。每次验证记录受信任代码 commit、配置哈希、scope、测试资源、注入点、预期／实际结果及清理回执；凭据与私有原文不进入公开证据。

| 故障／验收场景 | 必须观察到的结果 | 门槛 |
| --- | --- | --- |
| preview 伪造 production manifest 或传发布参数 | scope 校验拒绝；凭据层也无法写正式资源、目标仓库或 Issue | G2 |
| 同一人工 URL 重复提交、回执响应丢失、随后订阅发现同文 | 复用正式候选／项目，合并 provenance，不重研、不改订阅游标 | G3 |
| 图片上传成功后失联，或已写对象哈希不符 | 稳定键对账；哈希不符停止；容量不双计；不盲删 | G3 |
| branch／commit／PR 每一写入边界崩溃、PR 响应丢失 | 恢复先查全历史，只完成明确缺失且仍获准的动作 | G3 |
| branch 有人工额外修改、默认分支同名／来源已入库 | delivery_conflict，不 force push、不覆盖、不新建重复 PR | G3 |
| publishing 后暂停、语义规则更新、策略服务读取失败 | 只读补回执；无新上传和 PR；无未决结果才允许路由重新分类 | G3 |
| 超过二十四小时且 PR 已存在／GitHub 不可读／确认从未发布 | 分别补事实、保留 publishing、转来源核验，不能一律重生成 | G3 |
| 完整 commit 存在但无 PR；closed 或 merged PR | 匹配才续建；closed 不重提；merged 索引真实默认分支 | G3 |
| 两个写入 job、preview 与正式、取消重跑 | writer 串行；OSS 提交冲突仍能阻止陈旧发布；不丢已入队内容 | G3 |
| A 来源持续失败、B 持续产出；两次监控间 A 恢复 | A 去重告警并记录发生／恢复，B 不掩盖 A | G4 |
| 读取恢复但覆盖缺口仍在；来源停用后重启 | gap 保留；抑制不等于恢复；重启后用实际成功判定 | G4 |
| Issue 写成功但响应丢失、watchdog 离线后重启 | 查询并复用标识，恢复事件处理位置，不丢事件或刷屏 | G4 |
| 阅读漏跑、报告缺失、长任务未结束、策略暂停／恢复 | 正确区分告警、等待与抑制；监控自身失败可见 | G4 |
| 正式加 preview 加图床历史版本接近容量上限 | 使用同一 50 GB 视图；未知或不足暂停新增写，不丢候选 | G4 |

G3 的测试 App、测试仓库、OSS 前缀均不得指向真实正式目的地；测试仍使用完整发布能力和用户审阅语义。G3 成功不能替代 G4 的选题质量校准与用户确认。

## O8 启用与停机及恢复手册

- **依赖：** G3、G4 通过；02 至少五篇不同类型真实文章 preview 的用户确认与留出集校准；01 真实 OSS 和权限证据。
- **预期文件：** 完成上述三个 runbook 的执行步骤、命令参数约束、状态判断和恢复后的验证项；附非秘密部署清单及启用记录模板。
- **G5 核对：** 首批两信源、供应方凭据、observe_only、全局 50 GB、私有 OSS、图床唯一写入前缀、目标 GitHub App、watchdog Issues 权限均就绪；核对每日时间、七天初始窗口、容量口径／预警值、正例日期依据和三十六小时阈值这些设计默认值。
- **G5 启用：** 固定已通过验收的代码／工具版本，记录配置及启用时间；先确保监控可读报告并完成告警演练，再显式手动执行 production 的 scheduled + input_urls。核对候选、事件、回执、费用与 PR 后才开启正式 cron；观察第一轮定时结果，不以产出篇数作健康标准。
- **暂停：** 通过可信配置更新全局／项目暂停；下一能力边界停止新增付费与发布，运行中调用按 02 刷新／中止契约处理。watchdog 保留运行但标策略抑制；不能靠取消 cron 清除来源故障。
- **恢复：** 先确认 OSS HEAD 可恢复、共享容量可核对、最新策略可读，再只读对账外部结果。模型调用不确定交人工核对；PR 不确定查 GitHub；上传不确定按对象键读回；不清空状态或直接重跑付费阶段。
- **冲突／过期：** 用户分支修改和目标文件冲突须人工处理，不提供自动强推；未发布材料过期用 resume 重新核验。重新获准项目沿用原 context，仅按 spec 的条件重分类或建新生成版本。
- **清理／回滚：** 使用 01 的受保护引用与宽限期规则；不删除提交记录、结果不明资源或已入库图片。代码回滚先验证 schema 兼容，不能直接把 workspace HEAD 回退导致已发生的 PR／费用事实丢失。
- **不进入实现：** 本轮只形成计划；实际部署和资源创建属于后续执行阶段，不能把填写模板算作已上线。

## 外部条件与可并行推进的工作

| 尚需取得／验证 | 阻塞 | 仍可完成 |
| --- | --- | --- |
| 真实私有 OSS 测试 bucket、region、公网 endpoint、RAM 身份 | G1 与真实持久化、容量／权限集成 | G0、配置 schema、存储替身下全部状态机／故障测试 |
| 模型供应方与可用凭据、固定 skill／笔记只读访问 | G2 真实内容与五篇 preview 质量确认 | Publisher、模式解析、watchdog、输入／产物 fixture 与 runbook |
| 图床测试资源、版本控制状态、专用前缀唯一上传约束 | G3 真实上传、URL 可访问及版本容量核对 | ResourcePublisher 替身、回执协议、preview 本地图片审校 |
| 独立测试仓库及 GitHub App 安装、测试 Issues 权限 | G3 PR 和 G4 告警真实验证 | GitHub 替身、确定性 commit spike 设计、恢复矩阵、工作流静态校验 |
| 用户标注／深度与配图反馈、设计默认值核对 | G4/G5 正式定时生成 | 完成实现和隔离集成，保存可检查样本及指标，不擅设质量阈值 |

未拿到外部资源时应把相应验收标为“未执行”，保留完成项与可复现的验证入口；不以本地替身通过或 preview 通过宣称真实发布、权限隔离和告警已验收。
