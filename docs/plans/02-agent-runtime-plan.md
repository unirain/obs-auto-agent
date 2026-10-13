# 阅读 Agent 执行与质量实施计划

状态：待实施；创建于 2026-10-13。依据：[spec](../specs/reading-agent-spec.md)、[intent](../../intent.md)。总体顺序及上线门槛见 [主计划](README.md)；存储依赖见 [存储计划](01-workspace-storage-plan.md)，上传、交付与监控依赖见 [交付运营计划](03-delivery-operations-plan.md)，联合验收见 [集成验证计划](04-integration-validation-plan.md)。本文只规划，不表示完成 SDK、skill 或真实文章验证。

## 范围和完成条件

本轨交付受程序控制的四阶段阅读执行器、人工 URL 与两项信源采集、最新策略检查、知识索引、证据模型、Linux skill 适配、预览和离线评估。Publisher、OSS 协议和正式资源上传由其他轨负责；本轨提供经过验证的内容与类型化事件。

- 保持 `cost_policy: observe_only`，不设置模型金额上限、篇数上限或待审 PR 上限。
- 以持久化子任务恢复，不承诺 SDK query 内的底层请求恰好一次；不确定调用阻止该项目自动重复付费。
- 可在 G0 后并行编写代码、容器与 fixtures；真实付费执行须在 G1 私有 OSS 和权限验证通过后进行。
- G2 完成至少五篇不同类型真实文章的 preview 与恢复测试；G3 对接测试上传／PR；G4 完成来源、离线质量校准及监控输入；G5 前由用户确认样本表现。
- 此轨不自动改变写作规范、偏好或范围；skill 适配须作为目标笔记库中的受版本控制变更交付。

## G0 共享接口与所有权

G0 基础脚手架由存储轨 S1 负责；npm + package-lock、TypeScript strict、Vitest 是实施默认选择。本轨复用统一构建与测试入口。所有名称是待实现的契约，先用 fixture 冻结字段和错误语义，再并行开发。JSON Schema 为运行时数据边界，TypeScript 类型从同一来源生成或校验，避免两份定义漂移。未知 `schema_version` 停止恢复；严格拒绝未声明的控制字段。

| 接口／对象 | 本轨责任 | 其他轨责任 |
| --- | --- | --- |
| `Candidate`、`ManualSubmission`、`Selection`、`ResearchPacket`、`StageResult` | 定义领域字段与不变量，产出变更建议 | Manager 原子提交、哈希引用与 revision 冲突拒绝 |
| `StageTask`、`NoteJob`、`WorkspaceHandle` | 消费固定 context、受限输入及资源视图 | Manager 提供 scope、revision、context_id、可用资源，不提供凭据 |
| `PolicyGate.check(subject, capability, checkpoint)` | 读取当前可信配置，返回并记录 `PolicyCheck` | 上传／Publisher 在写入前调用同一服务，不自行复制策略判断 |
| `InvocationJournal.prepare/observe/finish/markUnknown` | SDK 事件映射、query 编排、消息去重与 usage 归集 | 存储轨定义 journal 基础及回执 schema，Manager 提交回执，提交失败要求终止执行 |
| `CheckpointChange` | 提交采集页、入队回执、证据、阶段结果及调用事件 | 只有可信控制器能写账本；Agent 不直接修改 `state/` |
| `ResourcePlan`、`ResourceManifest`、`ReviewReport`、`ClaimsMap` | 定义资源计划、本地图像及审校映射，检查回填后的最终文件 | 交付轨定义 ResourceManifest，上传并确认 URL；Manager 封存；Publisher 独立复验 |
| `SourceResult`、`SourceIncident`、`RunRecord` | 报告真实读取结果、缺口、积压与成本 | 监控维护 Issue，分别处理读取恢复与覆盖缺口 |

`StageResult` 只描述阶段决策及有哈希的产物引用。模型不能填写真实 PR 号、供应方回执、可信政策版本或直接授权状态跃迁。模型结构化输出与控制器补充的事实字段分离，程序从实际输入和工具回执绑定哈希、次数及版本。

正式最终审校必须针对上传并回填 URL 后的文件；本轨允许先做草稿审校，但其结果不能冒充最终 `validated`。预览最终审校针对相对图片路径，仅可产出 `preview_ready`。

## A1 领域 schema与阶段入口与模式校验

依赖：G0 与存储轨的 `WorkspaceHandle`／`CheckpointChange` 初稿；可先使用内存替身。

预期文件：`agents/reading/schemas/{candidate,submission,selection,research,stage,policy,review}.schema.json`，`src/stages/contracts.ts`、`src/run.ts`、`src/config/`，`evals/fixtures/contracts/`。

- 将四种运行模式解析为判别联合类型，默认手动 preview；`scheduled` 接收 URL 数组，`resume`／`publish-only` 拒绝新 URL，且只接受已有 production 项目；预览续跑必须仍为 preview。
- 为 `StageTask` 定义阶段、subject、固定 context、输入哈希、检查点、capability、deadline 和不可变 scope；来源时间可为空，存储时间统一 UTC，笔记日期使用 Asia/Shanghai。
- 固定 `selected → researching → researched → drafted → validated` 前置条件，区分 `skip`、`defer`、`batch_yield` 和人工阻塞；状态变更交给 Manager 验证。
- CLI／workflow JSON 输入只能进入类型化接口，不拼接 shell；文件名首次生成时固定，恢复不随日期改名。

通过标准：非法 schema、跨 scope 恢复、模型虚构控制字段、非法跃迁被拒绝；同一 fixture 可由替身和真实 Manager 共同消费。不要以自由文本“完成”推进项目。

## A2 最新策略和受限分类

依赖：A1；正式写入方必须复用此接口。预期文件：`src/policy/{load,gate,classification,refresh}.ts`、`prompts/selection.md`、`evals/fixtures/policy/`。

- 将固定生成 context 与最新用户限制分离；策略从可信默认分支读取，生成偏好、skill 和样例按项目固定；新策略读取失败时禁止新 query、来源读取、上传及发布。
- 执行许可检查全局／项目暂停、来源及全部 provenance、域名、重定向、scope 和资源；未知语义类型只授予 `classify_only`，不直接要求人工审批。
- `classify_only` 仅可读主文、候选元数据及相关笔记摘要；禁用补充论文、仓库调查、绘图、正式笔记和上传工具。
- 分类凭证绑定候选、正文版本及 `semantic_policy_hash`；同一绑定最多两次分类 query。格式修复是否计入两次分类 query 的计数口径须在 G0 明确为一个统一规则并补 fixture；保持 spec 的两次分类与一次格式修复限制，不能由不同调用入口各自重置。
- `allowed` 才进入知识价值判断；明确排除记 `skip`，主文访问失败按访问原因暂缓，两次后仍未决转 `policy_review_required`。
- 语义策略或正文变化使旧凭证失效；非语义更新不重置次数。研究出现冲突证据时重新检查；运行中的 query 由策略刷新发现撤销后主动中止，保留不确定回执。
- 策略刷新周期作为运行配置并在实现 spike 确认：各能力调用前必查，长 query 期间定期查，不能把有限刷新延迟描述为即时撤销。publishing 项目先只读对账，不用重分类覆盖未决远端状态。

通过标准：混合内容自动分类，停用来源／域名不能经人工入口绕过；正文变化、策略变化、读取失败及运行中撤销均有故障测试。上传与交付轨用相同 policy fixture 验证拒绝行为。

## A3 人工 URL与信源适配器和统一身份

依赖：A1、A2、存储轨原子检查点。预期文件：`src/collect/{manual,identity,normalize,langchain,claude-resources,cursor}.ts`、`sources.yaml`、`evals/fixtures/collect/`。

- 先完成无模型采集接口：每页输出候选、下一游标、覆盖区间和健康事件；候选和游标必须共同提交成功，才认定该页完成。
- 人工输入以稳定 `submission_id + input_hash` 幂等处理；同 ID 不同输入拒绝；回执与候选／已有身份引用原子提交，成功后才返回 queued／already_known。拒绝项保留可解释原因，提交失败返回未确认。
- `manual_url` 仅代表一次性主文入口；源 ID、别名、重定向、可信 canonical 与正文哈希进入统一索引，归并人工和订阅 provenance；重复提交返回项目／PR 真实状态，不重置 skip、closed 或暂停。
- URL 只删已确认追踪参数，保留业务参数；正文变化建立新版本。身份合并与主题归组分开，不能因相同主题丢弃反例或新实验。
- 为两项入口做只读适配 spike：核对实际列表、分页／RSS、正文域名、重定向和日期，不猜 URL；保存最小脱敏响应 fixture，记录采样日期与提取器版本。
- 首次七天、每批五十条为配置默认值；保留分页位置和日期未知条目。时间游标加稳定 ID 及回看区间，不假设列表严格递增；人工历史 URL 不受窗口限制、不推进订阅游标。
- 解析／分页失败不能返回空列表成功；持久化逐来源结果，历史丢失记录 `coverage_gap`，恢复读取不自动关闭历史缺口。

通过标准：首次／重复／回执丢失的人工入队、人工与订阅相同文章、跨域 canonical 伪造、五十条以上分页、未知日期、乱序、停机缺口及单源失败均可重放。真实来源核对在 G4 完成，静态 fixture 通过不能证明在线适配仍有效。

## A4 知识索引与固定上下文与公平调度

依赖：A1、A3；交付轨提供待审／合并事实。预期文件：`src/context/{index,examples,bundle}.ts`、`src/schedule.ts`、`evals/fixtures/context/`。

- 从目标默认分支提取标题、标签、来源、短摘要，合并待审项目去重视图；先关键词召回，再让选题模型评估新增机制、实验、反例及适用边界。
- 正例按相关性召回后优先近期整理，默认三篇全文。日期依次用 reviewed_at／updated、created、合法 YYMMDD 文件名、首次入库 Git 日期，记录采用字段；不使用 published 或 checkout mtime。
- 固定样例路径、commit、哈希、skill、提示词和证据版本形成 context_id；恢复时载入相同生成上下文，同时检查最新限制。冻结评估留出文章及对应笔记从所有提示词检索路径排除。
- 按来源轮转、来源内先恢复再选题；等待超过七天的可执行项按等待时间优先。每项目每轮最多一批，人工阻塞项目不挡住其他项目。

通过标准：重复主题但有新证据不被直接淘汰；待审 PR 参与去重但数量不影响领取；历史产品公告正例只影响写作，不放开选题；跨轮调度保留所有未处理候选。

## A5 SDK 阶段执行器与调用回执

依赖：A1、A2、存储轨回执接口；无模型替身可提前开发，真实 SDK spike 必须在 G1 后。

预期文件：`src/stages/{executor,selection,research,writing,review}.ts`、`src/runtime/{sdk,invocations,usage,deadline}.ts`、`prompts/`、`evals/fixtures/sdk/`。

- 固定 SDK／模型版本；核对官方文档及实际类型声明后实现薄适配层，明确 query 返回消息、结构化结果、usage、取消与错误的观测能力，不能按未验证 API 写假接口。
- 每次 query 前先检查当前 policy 并持久化 prepared；提交确认后才启动。message ID 去重累计 usage，query 汇总与逐步 usage 选一种明确的归集方式，保留原始可观测记录用于核算。
- 格式修复最多一次，每次新 query 仍有独立意图、消耗与权限检查；一般暂态重试最多两次额外尝试，仅适用于确认未执行的失败。不确定结果不自动重跑。
- 回执 completed／failed_known 落盘后才应用阶段转换；只有 prepared、响应丢失或取消不能证明未执行时记 unknown，转人工，其他无依赖项目继续。
- 研究工具和产物独立落子任务检查点。新会话从结构化证据恢复，不使用 SDK session resume 作为持久性保证；审校使用新上下文，不携带写作聊天。
- 每批四十工具调用、八份新补充材料；修订累计两轮；连续三批无有效进展转人工。跨天／resume 不重置累计计数，成功提交让出检查点后才创建下一批。
- 六十分钟运行、最后五分钟停止新生成并主动收束／中止在途 query；工具共享 deadline。费用未知标 unknown，不作为零；按 scope、项目、北京时间日期汇总，不设金额上限。

SDK spike 通过标准：观察并记录内部重试、取消、timeout、工具回调与最终响应丢失的实际行为；证明模型密钥不进入 shell／浏览器工具环境，内置工具不能绕开受限文件和网络网关。若 SDK 无法满足，先调整进程隔离／工具桥接并复测，不假设禁止提示词有效。

## A6 受限读取与研究证据与来源复核

依赖：A2、A4、A5；可先用 fixtures 实现程序校验。预期文件：`src/tools/{fetch,browser,pdf,repository,files}.ts`、`src/stages/research.ts`、`src/validate/evidence.ts`。

- 统一 URL 网关对每次请求、DNS 解析、跳转、浏览器子资源执行边界检查，拒绝私网／元数据／本地文件；限定 MIME、下载量和超时。浏览器不持有登录态；仓库固定 commit，只读内容，不执行其代码。
- 模型先提出三至五个 required／optional 问题，再从已登记材料真实链接选择下一步，不能自由全网搜索；跟读材料登记读取状态、失败原因和核心性。
- 网页证据绑定快照与行／章节，PDF 绑定页码，代码绑定 commit／文件／行；摘录必须可在对应快照定位，推断必须引用已有证据并在正文标明归属。
- 只有主文已读、必答问题可追溯、中心机制可解释且核心材料缺口解决才进入写作。来源未提供可以作为缺口记录，不能变成肯定结论。
- 封存前复核核心来源访问及变化，向交付轨提供 sources_verified_at 和源哈希；交付轨先排除既有／未决 PR，再申请过期内容复核。publish-only 不启动模型；分类凭证失效或需语义复核时也只返回“需要 resume”，不能通过分类调用偷偷恢复付费执行。

通过标准：伪造 URL／证据、截断 PDF、错误代码行、作者报告被写成独立验证、正文恶意指令、私网跳转、核心论文访问失败均被发现；合法研究的中间证据可在新 runner 继续。

## A7 Linux skill与图文产物与审校

依赖：A4–A6；正式最终审校另依赖交付轨资源适配器。预期文件：`tools/Dockerfile`、`src/tools/{skills,render,image-read}.ts`、`src/validate/{note,claims,images}.ts`。

已只读核对目标库：skill 实体在 `.agents/skills/`；obsidian-note 仍包含本机 vault、PicGo、Chrome 工具名和 brew 命令；fireworks 已有 `fireworks.py` CLI、PNG 导出、结构检查与 Linux Chromium 候选路径。不能把文件存在视为云端可用。

- 单独准备目标库 skill 适配变更：增加 VAULT_ROOT、浏览器／资源能力映射和 Linux 环境说明，保留原有本地默认行为与笔记规范；通过审阅并取得固定 commit 后由本项目打包引用。当前计划阶段不改目标库。
- 固定 commit 解析并物化 `.agents/skills` 与 `.claude/skills` 两个只读路径视图，不从 OSS 恢复可执行内容；只执行已允许的固定脚本。
- 镜像预装 Chromium、Python、PDF 工具、实际渲染依赖与中文字体。构建时完成依赖安装，任务执行时不运行 skill 中的 brew 或材料中的安装指令。
- 用完整链路 fixture 验证 SDK 激活 obsidian-note、读取 diagram-playbook、调用 fireworks、渲染 PNG、图像读取和视觉检查；失败按 skill 降级，影响中心解释时暂缓。
- NoteJob 输入证据包、figure/caption 映射、相关笔记和样例；产出 Markdown、图形计划、图源、资源清单和 claims.json。固定文件日期，路径白名单仅允许目标笔记／图源目录。
- 审校输出带具体位置、证据和修正目标的 blocking／advisory 问题；最多两轮定点修订。程序同时检查 frontmatter、引用存在、HTML 配对、活动脚本、图片、软链和非预期改动。
- 正式资源清单经可信上传器处理并回填后重新审校，任何正文／引用改变都使旧审校哈希失效；模型和渲染容器不直接获得上传凭据。

通过标准：在干净 Linux 环境生成可读中文笔记和图像，记录结构及视觉检查，验证 Obsidian 目标格式；固定样例检查不得依赖本机 Chrome、PicGo 或用户目录。模型审校通过与程序检查通过必须同时成立。

## A8 预览整链与故障恢复

依赖：A1–A7、存储轨 G1、交付轨 preview workflow 权限隔离。预期文件：`src/preview/{scope,resources,report}.ts`、`evals/scenarios/preview/`。

- 预览只使用独立 workspace、图像相对引用、只读正式索引和专属调用回执；禁止实例化 Publisher，不导入正式写凭据，不让产物声明提升 scope。
- 私有预览输出含 Markdown、图源、PNG、证据映射、审校与费用报告；正式上传、正式 URL、PR 检查明确为 not_exercised，不声称 G3 已通过。
- 配合存储轨使用同一个 50 GB 容量视图与互斥，preview 不能读无关正式证据／修改正式账本；预览和正式不共享可删除 blob。
- 注入采集提交前后、prepared 后、工具证据提交后、生成完成未保存及审校中断故障；确认从最近有效快照恢复，未知付费 query 不重启。
- 五篇真实 preview 至少包含工程教程、论文关联文章、观点文章、混合发布内容、纯营销／材料不足案例；覆盖接受、淘汰和暂缓路径，展示合格产物供用户检查深度与配图。

通过标准（G2）：以上恢复与隔离场景通过；预览 skip／成功后正式提交同 URL 仍重新走正式策略与去重。若五篇中合格样本不足以评估笔记和配图，补充文章，不能以案例数量替代质量。

## A9 离线评估和上线质量证据

依赖：A3–A8；可在开发初期准备未标注候选与人工标注说明。预期文件：`evals/{dataset,split,rubric,run,report}` 及最小必要的版本化元数据／fixtures。

- 从两项来源准备约三十篇候选，包含应收录、不收录、材料不足，以及重复转载、营销和产品发布；用户标注后冻结至少十篇留出集。
- 留出文章及对应笔记排除出正例与检索上下文；提示词调试只看开发集，冻结评估按版本运行，报告不得把训练样本表现当留出结果。
- 分别报告选题查准／查全、材料不足识别、人工抽查的主张支持率、数字／接口／链接错误、机制／取舍／边界覆盖和图文质量；保留样本数、分母及错误实例。
- 人工评分、模型审校和真实 PR 反馈分栏；合并、修改后合并、关闭与长期待审分别统计，不自动将单次动作变成偏好。
- 成本与耗时按合格产物及 scope 记录；未完成、不确定调用和没有产出也计入总消耗；费用未知不填零。
- 输出配置／提示词／模型／skill／样本版本及失败清单，与运营轨汇总重复 PR、丢失候选、来源失败误报无内容等可靠性指标。

通过标准（G4/G5）：用户依据真实样本确认质量阈值和上线表现；不能预先虚构合格率。正式定时仍关闭，直到质量、来源、权限、恢复与测试交付门槛均完成。

## 集成顺序和待验证事项

先合并 A1 共享契约；A2、A3、A4 与容器准备可并行。A5 用替身完成故障路径后等待 G1，再运行真实 SDK spike；A6/A7/A8 组成 G2。A3 在线来源验收与 A9 支撑 G4，G3 的正式资源回填／最终审校与交付轨联合完成。

尚未证明的关键事项是 SDK 取消及凭据隔离、两项网页的实际稳定分页、skill 的干净 Linux 全链、人工质量阈值与样本表现。每项均有上述 spike 或验收出口；未通过时保留阻塞及证据，不靠增加重试、费用上限或降低质量规则规避。
