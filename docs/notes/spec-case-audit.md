# 87 场景逐条证据审计

2026-10-13。此表是具体断言范围审计，不是完整验收通过列表。87 个 full-layer 场景仍 pending；本地 covered 30、partial 54、missing 3，57 个场景仍有明确 local 组合/入口缺口。完整证据指针、test_name、proves 和分层 remaining 在 agents/reading/evals/case-audits/*.json；npm run coverage:spec 验证 ID/range、文件和真实测试标题，不以测试文件存在推断场景通过。

| 场景 | 本地范围 | 本地未证实要求 | 其他缺失层 |
| --- | --- | --- | --- |
| C001 合格文章有论文和代码 | partial | 补同一主文+论文+固定commit代码→证据→图片→最终审校→一个Fake PR的组合测试；现有各层fixture独立。 | github_live, human_quality, image_live, sdk_live |
| C002 文章只有营销描述 | partial | 现测试未直接断言对外/持久淘汰理由及无笔记文件；分类输出是product_announcement，需补纯marketing类别fixture。 | human_quality, sdk_live |
| C003 LangChain 或 Claude 入口出现产品发布公告 | partial | 两官方source_id+产品公告正文的集成fixture，断言reason_code product_announcement与无研究/交付；不能由两独立fixture合成已覆盖。 | human_quality, sdk_live, source_live |
| C004 技术教程提到产品名，但主体解释机制与取舍 | missing | 未找到含产品名的机制教程与公告成对输入测试；selection prompt有指令，但不能当执行断言。 | human_quality, sdk_live |
| C005 新候选没有标签，正文同时介绍新产品与技术机制 | partial | 补无标签混合正文的真实driver/Manager组合，断言没有人工前置屏障且已呈现主文片段后分类。 | human_quality, sdk_live |
| C006 内容未知但来源被停用、域名被拒绝或项目暂停 | partial | 补三条件source_disabled/domain_denied/project_paused分别作用于新classify_only请求，断言SDK stream=0且无prepared调用。当前测试未同时覆盖这些分支。 | sdk_live |
| C007 受限分类判为技术实践／产品发布／仍未决 | partial | 补actual driver+持久Manager的unresolved两次→deferred/manual/policy_review_required冷恢复，及三分类路由同组断言；现是分散额度/分支测试。 | human_quality, sdk_live |
| C008 分类过程中尝试跟读论文、绘图、写笔记或发布 | partial | 补实际classify_only工具表对论文/绘图/写笔记/发布四类调用的拒绝且无外部效果；现direct helper只测follow_reference，options断言不等于所有具体工具调用。 | sdk_live |
| C009 语义规则更新令旧分类失效 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, image_live, sdk_live |
| C010 首次正式提交首批信源之外、早于七天窗口的公开 URL | partial | 补explicit published_at早于窗口且不属于首批域名的scheduled输入，种入订阅cursor并断言人工入队不改变它、进入正式选题。 | oss_live, sdk_live |
| C011 两次正式提交同一 URL，或提交回执响应丢失后重试 | partial | 补不同submission_id同URL以及提交成功后丢回执的FileStore/controller冷重启，断言研究调用、Project/PR计数不增加。 | github_live, oss_live, sdk_live |
| C012 同一 URL 经人工和订阅发现，或跳转后确认同一文章 | partial | 补经过实际redirect读取的人工/订阅两候选归并，完整provenance与单Project/单Fake PR的冷恢复断言。 | github_live, source_live |
| C013 人工提交命中禁用来源或全局暂停 | partial | 需直接intakeManual(source_disabled/global_paused)断言items.rejected/原因、零新candidate且冷恢复一致；当前源码有拒绝分支但缺精确场景测试。 | oss_live |
| C014 预览成功后使用 scheduled + input_urls 正式提交 | partial | 补同一URL先preview成功再scheduled提交两个真实FileStore namespace的组合；断言正式许可重新执行、fresh正式候选、未复制预览classification/PR/usage。 | oss_live, ram_live, sdk_live |
| C015 Claude 目录条目指向允许的外部官方正文域名 | partial | 补外部官方正文经Gate实际读取以及全部候选均来自card而非nav的断言。 | source_live |
| C016 列表只有活动或无文字视频，或正文日期未知 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live, source_live |
| C017 首次窗口内超过五十个条目 | partial | 补页1提交后销毁本地目录/冷restore，再采后11的source adapter+Manager原子候选/cursor组合，断言总61无遗漏/重复。 | oss_live, source_live |
| C018 同轮已有三篇产出或已有十个待审 PR | partial | 需明确种入3本轮产物和10待审PR后仍执行新合格候选，分别证明time/capacity不足才让出；纯scheduler无数量参数不能代替该组合。 | github_live, sdk_live |
| C019 加载质量正例 | partial | 补多个相关笔记不同整理日期的明确排序、样例版本/date_basis持久化冷恢复及固定Git目录加载的组合断言；当前单笔记fallback不能证明近期优先。 | human_quality |
| C020 历史正例来自本轮排除的内容或来源类型 | partial | 补含被排除内容/停用来源的历史质量正例，同时新候选为公告/禁用来源，断言只作写作参照且不改变分类或发现URL。 | human_quality, sdk_live |
| C021 摘要不完整但全文有价值 | partial | 补摘要空/短但全文有机制和证据的候选，断言读主文后research而不是提前skip；prompt的unknown-not-absent文字不是测试。 | human_quality, sdk_live |
| C022 多站转载同一文章 | partial | 补两个站已各建项目再读出相同body的controller组合，断言一个active owner/一次研究和Fake PR，loser保留解释并冷恢复。 | github_live, source_live |
| C023 同主题文章有不同实验或相反结论 | partial | 尚缺不同实验/相反结论进入selection与research的成对fixture，验证后续知识增量不被主题相似过滤；身份不合并只是前置条件。 | human_quality, sdk_live |
| C024 核心论文读取失败 | partial | 补核心论文HTTP/提取失败→持久gap+deferred→冷恢复的driver/Manager路径，断言无writing/PR及理由披露。 | sdk_live, source_live |
| C025 单个信源失败 | partial | 需双来源（一失败、一成功）scheduled+FileStore冷恢复，断言失败cursor原样、成功候选可继续及RunReport partial/逐来源失败。当前controller fixture sources=[]，未覆盖该组合。 | oss_live, source_live |
| C026 一个来源连续失败，另一个持续创建 PR，Actions 成功退出 | partial | 补A多轮fail+B真实host回放产PR+success Actions状态的组合，断言source_id+reason告警不被总成功抹除。 | github_live, oss_live, source_live |
| C027 同一来源同一原因多轮失败，之后实际读取恢复 | partial | 补good页的checkpoint失败时watchdog不得closed，下一次持久化good成功才closed；当前monitor测试直接给recovered事件，未验证此关键提交屏障。 | github_live, oss_live, source_live |
| C028 故障在两次监控之间发生并恢复 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C029 当前来源读取恢复但历史 coverage_gap 未补齐 | partial | resolveGap目前为未接入CLI/controller的纯函数；需受信用户接受/真实补采核验入口与原子持久事件、下一次watchdog的组合。测试手工注入accepted_gap不证明用户入口。 | github_live, oss_live, source_live |
| C030 停用来源、全局暂停、publish-only 或其他来源成功 | partial | 补已有来源故障之后disabled/not_attempted/publish-only与另一来源success的完整矩阵，核对SourceHealth事件不减少且停用来源Issue明确suppressed；当前disabled测试从空health起步，监控helper disabled_sources总是空数组。 | github_live, source_live |
| C031 发现候选后进程崩溃 | partial | 注入成功采集页候选+实际非空cursor_after提交后进程退出，用新manager读取并比较候选集合及下一页游标；不能把提交失败空候选测试当作这个场景。 | oss_live, source_live |
| C032 SDK query 内包含多步模型请求 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C033 SDK query 结果不明或仅存启动意图 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C034 未配置模型金额上限或价格未知 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C035 四十次工具调用后仍有必需工作，或补充材料超过八份 | partial | 把实际40工具边界及8材料边界各接到FileStore/controller冷恢复，断言已完成子任务/图源继续复用、每批计数按允许条件重置、累计计数不重置且剩余工作完成。 | sdk_live |
| C036 跨天恢复持续无进展或已用完两轮修订的项目 | partial | 从真实driver产生research_stalled/quality_blocked，经controller保存manual；跨上海日期scheduled冷恢复验证同generation计数未重置且无query，只有显式人工新输入可恢复。 | sdk_live |
| C037 剩余五分钟但 SDK 仍在执行 | partial | 用活动StageExecutor stream推进generation_deadline timer，核对先前已提交产物仍在、query中止后unknown账本冷恢复和新付费拒绝，补精确最后5分钟场景。 | production_smoke, sdk_live |
| C038 PR 创建成功但响应丢失 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C039 PR 已待审多日 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, production_smoke |
| C040 用户关闭未合并 | partial | 增加关闭未合并事实经host reconcile后冷恢复的candidate/project状态与default知识索引断言，确保没有已入库条目且下一scheduled不重提。 | github_live |
| C041 用户手工修改 PR 分支 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C042 用户合并 PR | partial | 补实际host reconcile→identity入库状态→后续召回索引的冷恢复闭环，输入默认分支真实修改后的note bytes，验证索引用default内容而非原封存草稿。 | github_live |
| C043 首次运行且提交链为空、零号对象不存在 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C044 读取 OSS 超时、403 或 manifest 损坏 | partial | 补writer restore的commit/manifest read超时、403和manifest字节损坏；allow_initialize=true时检查零新create/不丢旧快照，不能用list错误或blob损坏代替每种边界。 | oss_live, ram_live |
| C045 产物已上传但提交记录尚未发布时退出 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C046 提交记录创建成功但响应丢失 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C047 两个客户端争写同一提交序号 | partial | 补两个客户端同序号且完全相同prepared commit bytes/意图的对账回执；并核对败方不同意图停止后不能再以旧handle跳号。当前只有不同意图竞争与单caller丢回执。 | oss_live |
| C048 workspace bucket 版本控制已开启或已暂停 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C049 提交前缀列举中断、提交链有缺口或哈希不符 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C050 workspace bucket 不存在或匿名可读 | missing | 当前source存在NoSuchBucket→configuration分类及private/anonymous preflight守卫，但未找到NoSuchBucket、public ACL或anonymous_readable=true驱动manager启动并断言零初始化写的测试。补这三个反例，不能把unknown错误分类或unverified配置声明当场景证据。 | oss_live, ram_live |
| C051 GC 清理超过保留期的历史数据 | partial | 补GC前后完整commit key/hash集合不变、GC之后protected历史revision新manager读取完整bytes以及逻辑HEAD重建的组合断言；当前覆盖保护集合与HEAD，不完整证明所有承诺。 | oss_live, ram_live |
| C052 Actions 超时或被取消 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | production_smoke, sdk_live |
| C053 工具容器在绘图中退出 | missing | 未找到绘图容器运行途中exit/kill的故障注入。missing sandbox测试只证明不退回宿主；lost draft checkpoint测试只模拟阶段提交丢失。需证明已提交证据/已检查图源保留、半成品图不被认可，冷恢复继续未完成操作。 | image_live, sdk_live |
| C054 同时触发两个 Actions | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, production_smoke |
| C055 PR 已创建但回执失败 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live, sdk_live |
| C056 回执丢失超过二十四小时且 PR 已存在 | partial | 组合PR已创建/未确认回执+推进25小时以上+publisher冷恢复，明确记录先找到PR再判来源过期，assert不新增seal/generation/model/PR。当前两个分开的测试不证明整个组合。 | github_live, oss_live |
| C057 超过二十四小时且 GitHub 结果无法确认 | partial | 补同一旧delivery的GitHub结果不可确认→host下一run及maintenance，核对所有sealed IDs/generation保持、PR/model调用无增加、图床对象与reservation不删除；不能用独立GC保护例冒充组合。 | github_live, image_live, oss_live |
| C058 仅有机器人分支／commit，尚无 PR | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C059 未发布结果过期，来源未变／发生变化 | partial | 缺完整controller冷恢复回放：过期后真实verifySources返回变化，归档旧交付、建立g+1、完成重新研究/审校，并断言旧Git分支未写入。 | github_live |
| C060 下载不完整或文件哈希不符 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C061 manifest 指向工作流文件或非法路径 | partial | 缺执行Actions交付校验入口的恶意manifest回放；已有直接validateDelivery拒绝不能独自证明独立job实际拒绝该输入。 | github_live |
| C062 skill、样例等生成配置更新但旧项目尚未完成 | partial | 缺真实Git skill/正例/提示词更新后：旧活跃项目继续原bytes，新项目取新bytes，同时最新限制生效的完整bootstrap回放。 | sdk_live |
| C063 用户新增排除主题或停用来源，旧项目正在积压 | partial | 缺已积压项目命中新主题排除/停用核心来源，冷恢复后同时断言research调用、image.create、Git写入均为0的组合测试。 | ram_live, sdk_live |
| C064 本轮已启动后用户撤销许可 | partial | 没有把active_query_refresh计时器触发的策略撤销跑到进行中ModelAdapter并断言abort、未知回执和冷恢复不重付；SIGTERM测试不能替代策略刷新场景。 | github_live, image_live, sdk_live |
| C065 已持久化 publishing 意图后用户全局暂停 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C066 最新策略读取失败或受限分类后语义排除仍未决 | partial | 缺真实driver连续两次返回content_eligibility=unresolved后的持久manual barrier、第三次恢复无模型/上传/发布，以及policy读失败对这些effects的组合断言。 | sdk_live |
| C067 新限制命中已创建 PR 或之后解除限制 | partial | 缺先暂停活跃项目再解除相同限制、冷恢复原证据/skill/sample bytes与计数，并继续原阶段而不重做已完成阶段的完整回放。 | github_live, sdk_live |
| C068 默认手动触发单 URL 试运行 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live, sdk_live |
| C069 预览把某 URL 判为 skip 或已完成，随后正式处理同 URL | partial | 缺同URL preview skip和preview_ready两个分支之后分别正式scheduled入队的双workspace测试，逐项断言正式游标、identity与项目状态没有读到preview结果。 | oss_live, ram_live |
| C070 preview 产物声明 ready_for_delivery，或传入正式发布参数 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, ram_live |
| C071 对 preview_id 调用正式 resume／publish-only | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C072 预览图文审校通过 | partial | 缺对controller提交的previews/<id>.checks三个not_exercised字段及PNG相对Markdown引用的同时断言；现seal字段不是整份preview报告的完整证明。 | human_quality, sdk_live |
| C073 正式与预览同时请求存储 | partial | 缺两个真实FileStore manager模拟preview/production同时申请的统一预留互斥及不交叉改控制状态回放；workflow静态group与纯费用汇总不能代替该竞争场景。 | oss_live, production_smoke, ram_live |
| C074 OSS 快照包含伪造 skill 或可执行配置 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C075 清理时旧 blob 仍被 HEAD 或待审版本引用 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C076 OSS workspace 与新图床资源合计接近容量上限 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C077 容量不足且所有对象仍被保护 | partial | 缺所有对象均受保护导致GC无法释放、仍保留实际候选queue并报告storage_capacity，随后空间释放后恢复同项目的完整controller冷启动回放。 | oss_live |
| C078 上传成功但容量回执丢失 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | image_live, oss_live |
| C079 已发布图片在重生成中发生变化 | partial | 缺完整重生成后新URL与已存在旧PR/已合并笔记中的旧URL、旧远端字节同时保持不变的组合断言；当前上传测试仅断言两个对象/receipt数量。 | github_live, image_live |
| C080 凭据、浏览器登录信息或缓存出现在工作目录 | partial | 缺针对credentials/auth.json/cookies、浏览器profile/cache文件的逐项同步清单断言；现测试未证明任意allowed文件内容中的凭据会被识别/排除（paths.ts主要按路径/扩展名过滤）。 | oss_live, sdk_live |
| C081 原文带恶意指令 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C082 生成目录包含符号链接或 workflow 文件 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C083 图片无法渲染或无法视觉检查 | partial | 缺renderer实际报错后符合skill的HTML/Mermaid降级并在笔记/PR披露，以及非core skipped可交付、core skipped不可交付的driver/publisher完整分支测试；目前validation.ts有条件检查但这些路径未被断言。 | human_quality, image_live |
| C084 模型连续修订仍有事实错误 | partial | 缺真实driver/model回放连续事实错误blocking review→两轮修订→持久quality_blocked、冷恢复模型/上传/PR零新增的完整链路；当前只证明计数保护和转换。 | human_quality, sdk_live |
| C085 当天没有合格文章 | partial | 缺scheduled模式两来源完整空/全不合格且无合格积压的真实controller回放，确认零产出run记录、无空PR与正确success_no_selection；当前端到端仅preview excluded。 | production_smoke, source_live |
| C086 阅读调度未触发而监控工作流正常 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, production_smoke |
| C087 故障恢复或 GitHub 平台整体不可用 | partial | 代码和reading-operations runbook明确同平台限制，但缺GitHub Actions/API/Issue全部不可用时无法保证通知的专门故障回放；不能拿可用Issue服务的read_failed测试替代。 | github_live, production_smoke |

本轮另发现 A9 的冻结输入/评估结果未强绑定，已补校验与 inspect/freeze/report 工具。当前 30 个候选仍有 30 个缺人工标签、30 个缺固定正文版本；不能冻结或宣称质量门槛通过。

优先补实际入口缺口 C029：resolveGap 已有纯函数，但缺可信人工接受/真实补采调用入口。其余优先项是 C050/C053 缺少具体局部故障断言，以及候选/游标提交、跨天计数、active query 收尾、PR 超期对账和双scope恢复组合。修补后应重新审计对应行的实际断言与残余层，不批量将covered改complete。
