# 87 场景逐条证据审计

2026-10-14。此表是具体断言范围审计，不是完整验收通过列表。87 个 full-layer 场景仍 pending；本地 covered 87、partial 0、missing 0；当前命名 local 组合缺口已由具体断言闭合，仍须真实服务及人工分层验收。完整证据指针、test_name、proves 和分层 remaining 在 agents/reading/evals/case-audits/*.json；npm run coverage:spec 验证 ID/range、文件、真实测试标题及状态与残余层的一致性，不以测试文件存在推断场景通过。

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
| C015 Claude 目录条目指向允许的外部官方正文域名 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | source_live |
| C016 列表只有活动或无文字视频，或正文日期未知 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live, source_live |
| C017 首次窗口内超过五十个条目 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, source_live |
| C018 同轮已有三篇产出或已有十个待审 PR | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, sdk_live |
| C019 加载质量正例 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality |
| C020 历史正例来自本轮排除的内容或来源类型 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C021 摘要不完整但全文有价值 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C022 多站转载同一文章 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, source_live |
| C023 同主题文章有不同实验或相反结论 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C024 核心论文读取失败 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live, source_live |
| C025 单个信源失败 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, source_live |
| C026 一个来源连续失败，另一个持续创建 PR，Actions 成功退出 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live, source_live |
| C027 同一来源同一原因多轮失败，之后实际读取恢复 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live, source_live |
| C028 故障在两次监控之间发生并恢复 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live |
| C029 当前来源读取恢复但历史 coverage_gap 未补齐 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, oss_live, source_live |
| C030 停用来源、全局暂停、publish-only 或其他来源成功 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, source_live |
| C031 发现候选后进程崩溃 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, source_live |
| C032 SDK query 内包含多步模型请求 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C033 SDK query 结果不明或仅存启动意图 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C034 未配置模型金额上限或价格未知 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C035 四十次工具调用后仍有必需工作，或补充材料超过八份 | covered | 已验证真实host/持久化与固定本地renderer进程的40工具让出、checked source冷续写、unknown/消费丢失/提交后硬停、无进展与修订/审校保护；模型、图片与服务语义仍是local fixture | sdk_live |
| C036 跨天恢复持续无进展或已用完两轮修订的项目 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
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
| C059 未发布结果过期，来源未变／发生变化 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C060 下载不完整或文件哈希不符 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live |
| C061 manifest 指向工作流文件或非法路径 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C062 skill、样例等生成配置更新但旧项目尚未完成 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C063 用户新增排除主题或停用来源，旧项目正在积压 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | ram_live, sdk_live |
| C064 本轮已启动后用户撤销许可 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, image_live, sdk_live |
| C065 已持久化 publishing 意图后用户全局暂停 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C066 最新策略读取失败或受限分类后语义排除仍未决 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | sdk_live |
| C067 新限制命中已创建 PR 或之后解除限制 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, sdk_live |
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
| C079 已发布图片在重生成中发生变化 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, image_live |
| C080 凭据、浏览器登录信息或缓存出现在工作目录 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | oss_live, sdk_live |
| C081 原文带恶意指令 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C082 生成目录包含符号链接或 workflow 文件 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live |
| C083 图片无法渲染或无法视觉检查 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, image_live |
| C084 模型连续修订仍有事实错误 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | human_quality, sdk_live |
| C085 当天没有合格文章 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | production_smoke, source_live |
| C086 阅读调度未触发而监控工作流正常 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, production_smoke |
| C087 故障恢复或 GitHub 平台整体不可用 | covered | 当前审计未发现local断言缺口；仍不等同真实通过 | github_live, production_smoke |
