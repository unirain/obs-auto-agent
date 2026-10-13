# 质量评估与冻结输入

本工具只处理显式输入的样本／标签／测量记录，不调用模型、创建 PR 或宣称上线通过。30 个来源候选已在 `agents/reading/evals/quality/candidates.unlabeled.json` 准备，其中 10 个留出；当前全部未标注，也没有固定正文版本。标题或来源不能代替用户的判断。

## 样本准备与用户标注

保留样本 ID、公开 URL、source_id、split 及对应笔记路径。正文经受控网关读取后，记录 MaterialSnapshot 的真实 `source_snapshot_hash`；不要以 URL、标题或抓取列表的 hash 代替正文 hash。用户阅读该版本后标注 `human_label`：`collect`（值得收录）、`reject`（不应收录）、`insufficient`（材料不足）。不由模型补齐人工标签。重复转载、营销、产品发布和工程内容须经过实际标注后才能确认样本覆盖，现有标题列表不证明这些类别已覆盖。

至少 30 个不同规范化 URL 和 10 个留出样本才能冻结。留出文章的 URL 及对应 `Organize Notes By AI/*.md` 路径传入 `heldoutExclusion`；评估 runner 构建 context 时必须将排除集传入 buildApplication 的 heldout，不能只在评分函数里排除。开发集用于调试，留出集禁止用于正例和相关笔记上下文。对应笔记路径应从可信目标库索引核对，不能为了扩大正例偷偷清空。

## 检查与冻结

```sh
npx tsx agents/reading/evals/quality/run.ts inspect --input agents/reading/evals/quality/candidates.unlabeled.json
```

在受保护目录准备 `{ "samples": [...] }` 标注文件以及版本文件。版本文件包含 config/prompt 的真实 SHA-256、model 标识和 skill_commit 的完整 Git SHA；这些值不能使用虚构的占位版本。工具保留模型标识仅为 identifier_only_unverified，不把滚动别名当不可变模型版本。

```sh
npx tsx agents/reading/evals/quality/run.ts freeze --input /protected/labeled.json --versions /protected/versions.json --output /protected/frozen.json
```

输出使用 mode 0600 并拒绝覆盖。冻结 hash 绑定规范化 URL、样本 ID、来源、标题、split、人工标签、对应笔记和正文版本；不把尚未产生的预测／费用／评分混进不可变输入。人工标签、split 或正文版本改变后，旧评估绑定会失败，须明确新建冻结版本。

## 测量与报告

模型结果与人工测量写入另一个同样带 `samples` 的文件，保持冻结的输入字段。predicted 与 human_label 分开；人工主张支持率使用实际抽查的支持／检查数，支持数不得大于检查数。数字、接口、链接错误及机制、取舍、边界、图像分数仅填实际观察；未观察用 null。score 是非负整数，具体尺度与合格阈值由用户在校准时确认，不在代码里发明合格率。

记录真实 PR 反馈（merged/modified_then_merged/closed_unmerged/pending），不能从一条评论或合并自动更新偏好。所有样本的费用和时长包括未完成、失败及零产出；未知费用／时长用 null，qualified 仅由已确认的合格结果决定。

```sh
npx tsx agents/reading/evals/quality/run.ts report --input /protected/measured.json --frozen /protected/frozen.json --output /protected/report.json
```

报告分别保留人工、模型、反馈、错误、样本数和分母。任一样本费用／时长未知时，总值保持 null；已观察的下界单列。未抽查项有单独计数，不把 null 当没有错误。报告仍标记 awaiting_user_confirmation；没有用户对真实样本的质量确认，不能通过 G4/G5 或启用正式 cron。

当前工具完成冻结／导入／统计契约；真实评估模型执行仍依赖 G1、已发布 cloud skill、真实 preview 和用户标注。使用 synthetic fixtures 验证这些函数，不算真实质量校准。
