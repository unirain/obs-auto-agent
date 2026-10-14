# 87 场景逐条证据审计

2026-10-14。此表是具体断言范围审计，不是完整验收通过列表。87 个 full-layer 场景仍 pending；本地 covered 74、partial 13、missing 0，13 个场景仍有明确 local 组合/入口缺口。完整证据指针、test_name、proves 和分层 remaining 在 agents/reading/evals/case-audits/*.json；npm run coverage:spec 验证 ID/range、文件、真实测试标题及状态与残余层的一致性，不以测试文件存在推断场景通过。

| 场景 | 本地范围 | 本地未证实要求 | 其他缺失层 |
| --- | --- | --- | --- |
| C001 合格文章有论文和代码 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, human_quality, image_live, sdk_live |
| C002 文章只有营销描述 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C003 LangChain 或 Claude 入口出现产品发布公告 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live, source_live |
| C004 技术教程提到产品名，但主体解释机制与取舍 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C005 新候选没有标签，正文同时介绍新产品与技术机制 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C006 内容未知但来源被停用、域名被拒绝或项目暂停 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C007 受限分类判为技术实践／产品发布／仍未决 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C008 分类过程中尝试跟读论文、绘图、写笔记或发布 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C009 语义规则更新令旧分类失效 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, image_live, sdk_live |
| C010 首次正式提交首批信源之外、早于七天窗口的公开 URL | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C011 两次正式提交同一 URL，或提交回执响应丢失后重试 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live, sdk_live |
| C012 同一 URL 经人工和订阅发现，或跳转后确认同一文章 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, source_live |
| C013 人工提交命中禁用来源或全局暂停 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C014 预览成功后使用 scheduled + input_urls 正式提交 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live, sdk_live |
| C015 Claude 目录条目指向允许的外部官方正文域名 | partial | 补外部官方正文经Gate实际读取以及全部候选均来自card而非nav的断言。 | source_live |
| C016 列表只有活动或无文字视频，或正文日期未知 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live, source_live |
| C017 首次窗口内超过五十个条目 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, source_live |
| C018 同轮已有三篇产出或已有十个待审 PR | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, sdk_live |
| C019 加载质量正例 | partial | 补多个相关笔记不同整理日期的明确排序、样例版本/date_basis持久化冷恢复及固定Git目录加载的组合断言；当前单笔记fallback不能证明近期优先。 | human_quality |
| C020 历史正例来自本轮排除的内容或来源类型 | partial | 补含被排除内容/停用来源的历史质量正例，同时新候选为公告/禁用来源，断言只作写作参照且不改变分类或发现URL。 | human_quality, sdk_live |
| C021 摘要不完整但全文有价值 | partial | 补摘要空/短但全文有机制和证据的候选，断言读主文后research而不是提前skip；prompt的unknown-not-absent文字不是测试。 | human_quality, sdk_live |
| C022 多站转载同一文章 | partial | 补两个站已各建项目再读出相同body的controller组合，断言一个active owner/一次研究和Fake PR，loser保留解释并冷恢复。 | github_live, source_live |
| C023 同主题文章有不同实验或相反结论 | partial | 尚缺不同实验/相反结论进入selection与research的成对fixture，验证后续知识增量不被主题相似过滤；身份不合并只是前置条件。 | human_quality, sdk_live |
| C024 核心论文读取失败 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live, source_live |
| C025 单个信源失败 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, source_live |
| C026 一个来源连续失败，另一个持续创建 PR，Actions 成功退出 | partial | 补A多轮fail+B真实host回放产PR+success Actions状态的组合，断言source_id+reason告警不被总成功抹除。 | github_live, oss_live, source_live |
| C027 同一来源同一原因多轮失败，之后实际读取恢复 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live, source_live |
| C028 故障在两次监控之间发生并恢复 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C029 当前来源读取恢复但历史 coverage_gap 未补齐 | partial | 人工接受路径已接线并有原子/冷恢复/漂移断言；真实补采仍缺读取已提交覆盖证据、验证实际区间并调用filled的可信入口，不能用validated_fill boolean当证明。 | github_live, oss_live, source_live |
| C030 停用来源、全局暂停、publish-only 或其他来源成功 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, source_live |
| C031 发现候选后进程崩溃 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, source_live |
| C032 SDK query 内包含多步模型请求 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C033 SDK query 结果不明或仅存启动意图 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C034 未配置模型金额上限或价格未知 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C035 四十次工具调用后仍有必需工作，或补充材料超过八份 | partial | 把实际40工具边界及8材料边界各接到FileStore/controller冷恢复，断言已完成子任务/图源继续复用、每批计数按允许条件重置、累计计数不重置且剩余工作完成。 | sdk_live |
| C036 跨天恢复持续无进展或已用完两轮修订的项目 | partial | 从真实driver产生research_stalled/quality_blocked，经controller保存manual；跨上海日期scheduled冷恢复验证同generation计数未重置且无query，只有显式人工新输入可恢复。 | sdk_live |
| C037 剩余五分钟但 SDK 仍在执行 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | production_smoke, sdk_live |
| C038 PR 创建成功但响应丢失 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C039 PR 已待审多日 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, production_smoke |
| C040 用户关闭未合并 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C041 用户手工修改 PR 分支 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C042 用户合并 PR | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C043 首次运行且提交链为空、零号对象不存在 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C044 读取 OSS 超时、403 或 manifest 损坏 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C045 产物已上传但提交记录尚未发布时退出 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C046 提交记录创建成功但响应丢失 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C047 两个客户端争写同一提交序号 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C048 workspace bucket 版本控制已开启或已暂停 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C049 提交前缀列举中断、提交链有缺口或哈希不符 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C050 workspace bucket 不存在或匿名可读 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C051 GC 清理超过保留期的历史数据 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C052 Actions 超时或被取消 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | production_smoke, sdk_live |
| C053 工具容器在绘图中退出 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | image_live, sdk_live |
| C054 同时触发两个 Actions | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, production_smoke |
| C055 PR 已创建但回执失败 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live, sdk_live |
| C056 回执丢失超过二十四小时且 PR 已存在 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C057 超过二十四小时且 GitHub 结果无法确认 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, image_live, oss_live |
| C058 仅有机器人分支／commit，尚无 PR | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C059 未发布结果过期，来源未变／发生变化 | partial | 缺完整controller冷恢复回放：过期后真实verifySources返回变化，归档旧交付、建立g+1、完成重新研究/审校，并断言旧Git分支未写入。 | github_live |
| C060 下载不完整或文件哈希不符 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C061 manifest 指向工作流文件或非法路径 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C062 skill、样例等生成配置更新但旧项目尚未完成 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C063 用户新增排除主题或停用来源，旧项目正在积压 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | ram_live, sdk_live |
| C064 本轮已启动后用户撤销许可 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, image_live, sdk_live |
| C065 已持久化 publishing 意图后用户全局暂停 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C066 最新策略读取失败或受限分类后语义排除仍未决 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C067 新限制命中已创建 PR 或之后解除限制 | partial | 缺先暂停活跃项目再解除相同限制、冷恢复原证据/skill/sample bytes与计数，并继续原阶段而不重做已完成阶段的完整回放。 | github_live, sdk_live |
| C068 默认手动触发单 URL 试运行 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live, sdk_live |
| C069 预览把某 URL 判为 skip 或已完成，随后正式处理同 URL | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C070 preview 产物声明 ready_for_delivery，或传入正式发布参数 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, ram_live |
| C071 对 preview_id 调用正式 resume／publish-only | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C072 预览图文审校通过 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C073 正式与预览同时请求存储 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, production_smoke, ram_live |
| C074 OSS 快照包含伪造 skill 或可执行配置 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C075 清理时旧 blob 仍被 HEAD 或待审版本引用 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C076 OSS workspace 与新图床资源合计接近容量上限 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, ram_live |
| C077 容量不足且所有对象仍被保护 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C078 上传成功但容量回执丢失 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | image_live, oss_live |
| C079 已发布图片在重生成中发生变化 | partial | 缺完整重生成后新URL与已存在旧PR/已合并笔记中的旧URL、旧远端字节同时保持不变的组合断言；当前上传测试仅断言两个对象/receipt数量。 | github_live, image_live |
| C080 凭据、浏览器登录信息或缓存出现在工作目录 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C081 原文带恶意指令 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C082 生成目录包含符号链接或 workflow 文件 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C083 图片无法渲染或无法视觉检查 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, image_live |
| C084 模型连续修订仍有事实错误 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C085 当天没有合格文章 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | production_smoke, source_live |
| C086 阅读调度未触发而监控工作流正常 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, production_smoke |
| C087 故障恢复或 GitHub 平台整体不可用 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, production_smoke |
