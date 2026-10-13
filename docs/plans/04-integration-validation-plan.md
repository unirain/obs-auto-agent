# 阅读 Agent 集成验收计划

本计划把[spec 的验收场景](../specs/reading-agent-spec.md#验收场景)分配给模块测试及跨模块演练。测试通过条件是持久状态、实际目的地与下一次执行相互一致。当前所有验收均为待执行。

实施顺序与环境门槛见[总计划](README.md)。模块内测试分别由[存储](01-workspace-storage-plan.md)、[Agent](02-agent-runtime-plan.md)、[交付与运行维护](03-delivery-operations-plan.md)计划负责。

## 验收目录和执行分层

拟新增目录为 `agents/reading/evals/contracts/`、`evals/recovery/`、`evals/security/`、`evals/quality/` 和 `evals/integration/`。在 G0 将具体命令写进 package scripts，按层分开运行：

| 层级 | 环境 | 使用限制 |
| --- | --- | --- |
| contract | 纯函数、JSON fixtures、本地文件 | 每次契约变更执行；无需网络、模型或秘密 |
| fault | 对象存储、SDK、GitHub 和时钟替身 | 可模拟响应丢失、乱序、取消和持久化失败；不冒充真实服务行为 |
| oss-live | 独立私有 OSS 测试桶 | G1；核对实际 SDK 请求、服务错误及允许／拒绝权限 |
| preview-live | 隔离 preview workspace、模型及工具容器 | G1 后；无正式存储、图床和 GitHub 写入能力 |
| delivery-live | 独立测试部署的 production scope、测试仓库和图床 | G2 后；测试配置与正式配置分离，不能提升 preview scope |
| production-smoke | 正式目标与正式凭据 | G5；先通过前述层级，只做明确的受控手动验证 |

`delivery-live` 中的 production 表示允许完整交付的执行语义，不表示使用正式数据；测试 bucket／受管前缀、仓库、App 配置和回执均独立。preview 一直保持禁止交付。

## 验收索引

下表是用例组索引，不替代 spec 中的逐项用例。G0 建立可机读映射，为每条 spec 验收场景分配 case ID、主责模块、测试层和结果位置；未映射或未执行的故障／权限用例不能算通过。

| 用例组 | 必须验证的行为 | 主责与层级 | 门槛 |
| --- | --- | --- | --- |
| V01 契约与模式 | 未知 schema 拒绝；nullable 候选字段；候选和项目 subject；四模式参数；preview scope 不可提升 | S/A/O，contract | G0 |
| V02 初始化与恢复 | 空前缀加 NoSuchKey 才初始化；403、超时、损坏链、缺口、哈希错误均停止；孤立对象不作 HEAD | S，fault + oss-live | G1 |
| V03 检查点原子性 | 候选和游标、提交回执和候选、事件和采集结果同版本；提交响应丢失可读回；同序号仅一个赢家 | S/A，fault + oss-live | G1 |
| V04 私有访问与 scope | 匿名读、错误 bucket 版本状态拒绝；preview 无正式写入；凭据、软链、伪造 skill 不被恢复或上传 | S/A/O，security + live | G1/G2 |
| V05 当前策略 | 启动后修改限制；query、工具、上传和 PR 写入前重检；读取失败停止；既有未知交付仍只读对账 | A/O，fault + preview/delivery-live | G2/G3 |
| V06 受限分类 | 无标签及混合内容可分类；allowed/excluded/unresolved 路径；次数跨轮保留；不能跟读论文、绘图或发布 | A，contract + preview-live | G2 |
| V07 人工提交 | 首批来源外的历史 URL；重复 ID、同 ID 不同输入、响应丢失；跨来源 canonical 合并；禁用来源不可绕过 | A/S/O，fault + delivery-live | G3 |
| V08 SDK 调用事实 | 多步 query usage 去重；unknown 与零费用区分；query 前意图；取消后回执不明不自动重跑；未知价格不阻塞其他项目 | A/S，fault + preview-live | G2 |
| V09 分批与时间 | 超过八材料／四十工具仍能续跑；同轮每项目一批；修订和无进展计数跨天保留；最后五分钟收束 | A/S，fault + preview-live | G2 |
| V10 证据与内容 | 主文、论文和代码真实定位；作者主张与推断分离；核心缺口阻断；摘要未知不等同低价值；无合格文章正常零产出 | A，quality + preview-live | G2/G4 |
| V11 Skill 与资源 | 激活固定 skill、读取 references、Linux 渲染和视觉检查；preview 相对资源；正式上传回填后再最终审校 | A/O，preview/delivery-live | G2/G3 |
| V12 发布对账 | PR 响应或 OSS 回执丢失；open/closed/merged；用户修改分支；仅有分支；同来源已人工入库；不创建第二个 PR | O/S，fault + delivery-live | G3 |
| V13 来源过期与重新分类 | 先对账后判过期；已有 PR 只补回执；来源变化建立新版本；策略凭证失效；publish-only 不偷偷调用模型 | A/O/S，fault + delivery-live | G3 |
| V14 文件与目的地约束 | hash/路径/MIME/大小、workflow/符号链接拒绝；不执行产物脚本；资源 URL 不可变；修改后校验失效 | O/A/S，security + delivery-live | G3 |
| V15 信源覆盖与公平性 | 两个入口真实分页、外部正文域名、产品发布排除、未知日期、超过五十条继续；逐来源进度、积压优先、无篇数门槛 | A，fixtures + 只读 live | G4 |
| V16 容量与 GC | 正式加 preview 加图床版本合计；未决上传不双计；45/49/50 GB；保护 HEAD、活跃和待审引用；无法释放时暂停 | S/O，fault + oss-live | G4 |
| V17 来源故障通知 | partial 也通知；短暂故障恢复不漏事件；去重、原因变化、恢复；coverage_gap 独立；暂停抑制不是恢复 | O/A/S，fault + 测试 Issue | G4 |
| V18 调度监控 | 三十六小时漏跑；取消、无报告、API 失败；publish-only 不掩盖采集漏跑；同平台故障局限；暂停后恢复基线 | O，时钟回放 + 测试 Actions | G4 |
| V19 质量校准 | 约三十篇分类候选，至少十篇冻结留出；至少五篇不同类型真实 preview；人工评分和模型审校分开 | A，quality + 用户确认 | G4 |
| V20 正式切换 | 正式资源检查、手动入队及 PR 对账、监控可见、记录启用时间、定时首轮、暂停与恢复手册 | O，production-smoke | G5 |

## 关键跨模块演练

### 候选入队与调用中断

1. 提交同一人工 URL，分别在候选文件生成后、提交记录创建后但响应返回前中断。
2. 恢复后断言候选、提交回执和去重身份一致；只有确认提交后可返回 queued。
3. 在 query 发出前、获得部分消息后和完成后持久化前分别中断。确认只有明确未发出的调用可以自动重试；unknown 转对账或人工处理。
4. 其他无依赖项目继续；不能因一个 unknown 将整个 workspace 当作空状态重建。

### 当前策略与发布交错

1. 在草稿完成、图片上传、publishing 意图持久化及 PR 创建响应丢失后分别撤销许可。
2. 已完成的事实保留，新远端写入停止；未知 PR 继续只读查找，不能被 policy_blocked 覆盖后遗忘。
3. 解除限制后检查原有修订／调用计数及阻塞原因；解除策略限制不等于解除未知付费请求或质量阻塞。
4. 在 publish-only 中令语义分类凭证失效，确认返回需要 resume，模型调用次数保持零。

### 从预览到正式处理

1. 在 preview 将 URL 分别判为 skip 和完成，检查正式状态没有变化，产物没有正式图片 URL 或 PR。
2. 用 scheduled + input_urls 正式提交同一 URL，重新做许可、正式去重和来源检查；不导入 preview 控制状态。
3. 再次提交并模拟回执丢失，始终返回同一正式候选／项目。隔离测试发布后再跑一轮，目标仓库仍只有一个逻辑交付。
4. 在正式和 preview 同时请求容量时检查互斥与全局计量，不能各自享有 50 GB，也不能扩大 preview 读取权限。

### 部分失败到恢复通知

1. 一个来源失败，另一个来源成功交付，工作流总体为 partial；监控仍产生对应来源故障通知。
2. 故障在两个监控周期之间恢复，监控从持久事件生成合并记录；重复执行不重复通知。
3. 保留一个无法补采的 coverage_gap，再让当前抓取成功，确认缺口仍开放。
4. 用户通过可信入口接受缺失后，记录 accepted_gap；普通 Issue 评论不能直接改变来源状态。

## 测试产物与秘密处理

每次真实演练记录代码 commit、配置与 skill 哈希、测试环境标识、case ID、停止点、前后 revision、外部资源标识和期望／实际结果。保留必要的失败诊断，但不得把密钥、原始 SDK 认证信息或完整私有证据塞进公开 CI artifact、Issue 或 PR。

拟新增 `agents/reading/evals/coverage.json` 映射 spec 用例，`evals/results/` 保存脱敏摘要。真实私有材料和完整回执留在对应隔离 workspace，CI 输出可查询引用。质量留出集按访问范围隔离，不能通过 prompt fixtures 或已有笔记样例泄露标签。

版本控制已开启／已暂停的拒绝测试使用专门的测试配置或桶；禁止对正式 bucket 切换该设置来注入故障。实际容量边界使用可控计量替身和少量真实对象验证，不为验证 50 GB 阈值真的上传 50 GB 数据。

## 退出条件

- G0 至 G5 分别填写通过证据，不跳过失败项；环境未准备记为未执行，而非通过。
- 所有 spec 故障恢复、权限、最新策略、来源告警和 preview 隔离场景都有映射和通过结果。
- 真实 preview 的内容质量由用户确认；模型自评不替代人工质量结论。
- 发现规格缺口时记录触发条件、现有行为和影响，再修订 spec 与用例；测试不得私自放宽规范。
- 正式定时仅在 G5 条件满足后启用。出现故障先暂停新增付费／发布并保留状态，对账后恢复，不用删除 OSS 提交链或清空账本作为回滚方式。
