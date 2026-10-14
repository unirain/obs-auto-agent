# 质量评估与冻结输入

`inspect`／`versions`／`freeze`／`report` 只处理显式输入或本地版本；`execute` 在 G1 完整证据与已发布 skill 具备后运行真实模型，只使用 preview。不会创建 PR 或宣称上线通过。30 个来源候选已在 `agents/reading/evals/quality/candidates.unlabeled.json` 准备，其中 10 个留出；当前全部未标注，也没有固定正文版本。标题或来源不能代替用户的判断。

## 样本准备与用户标注

保留样本 ID、公开 URL、source_id、split 及对应笔记路径。正文经受控网关读取后，记录 MaterialSnapshot 的真实 `source_snapshot_hash`；不要以 URL、标题或抓取列表的 hash 代替正文 hash。用户阅读该版本后标注 `human_label`：`collect`（值得收录）、`reject`（不应收录）、`insufficient`（材料不足）。不由模型补齐人工标签。重复转载、营销、产品发布和工程内容须经过实际标注后才能确认样本覆盖，现有标题列表不证明这些类别已覆盖。

至少 30 个不同规范化 URL 和 10 个留出样本才能冻结。留出文章的 URL 及对应 `Organize Notes By AI/*.md` 路径传入 `heldoutExclusion`；评估 runner 构建 context 时必须将排除集传入 buildApplication 的 heldout，不能只在评分函数里排除。开发集用于调试，留出集禁止用于正例和相关笔记上下文。对应笔记路径应从可信目标库索引核对，不能为了扩大正例偷偷清空。

## 检查与冻结

```sh
npx tsx agents/reading/evals/quality/run.ts inspect --input agents/reading/evals/quality/candidates.unlabeled.json
```

在受保护目录准备 `{ "samples": [...] }` 标注文件以及版本文件。版本文件包含 config/prompt 的真实 SHA-256、model 标识和 skill_commit 的完整 Git SHA；这些值不能使用虚构的占位版本。`versions` 读取干净 notes checkout 的 HEAD、五份实际 prompt 字节和 canonical deployment + preferences/sources/runtime 三份策略文件 hash，生成版本文件。工具保留模型标识仅为 identifier_only_unverified，不把滚动别名当不可变模型版本。

```sh
npx tsx agents/reading/evals/quality/run.ts versions --config /protected/preview.json --notes-repository /absolute/notes --output /protected/versions.json
```

```sh
npx tsx agents/reading/evals/quality/run.ts freeze --input /protected/labeled.json --versions /protected/versions.json --output /protected/frozen.json
```

输出使用 mode 0600 并拒绝覆盖。冻结 hash 绑定规范化 URL、样本 ID、来源、标题、split、人工标签、对应笔记和正文版本；不把尚未产生的预测／费用／评分混进不可变输入。人工标签、split 或正文版本改变后，旧评估绑定会失败，须明确新建冻结版本。

## 执行冻结评估

保存受控读取后的完整 MaterialSnapshot（含正文、真实检索时间、链接、图形映射、PDF 页或代码 commit/file），将其与标注后的正文 hash 逐样本绑定：

```json
{"schema_version":1,"snapshots":[{"sample_id":"样本 ID","snapshot":{"url":"https://公开原文","requested_url":"https://冻结的候选URL","text":"真实已读取正文","hash":"正文SHA256","retrieved_at":"实际UTC时间","links":[],"kind":"web"}}]}
```

JSON 应含全部冻结样本的正文，不能用 URL/title/list hash 代替。PDF 的 text 必须等于 pages 用 `\n\f\n` 拼接；代码绑定完整 commit 和 file。固定主文直接作为已验证证据载入，补充材料仍通过正常受限网关读取。该模式评估冻结材料上的模型表现；不证明在线来源采集仍有效。

宿主注入 `READING_G1_EVIDENCE_PATH`／`READING_G1_EVIDENCE_SHA256`、preview 的受限 OSS 身份、全局只读容量身份与共享 writer mutex、模型和只读 GitHub 身份。CLI 不提供绕过 G1、以本地模型替身冒充真实执行、正式 scope 或发布入口。还会只读核对 notes origin 的默认分支及固定 skill commit 祖先关系，拒绝把本地 proposal 当已发布版本。保持正常工具镜像、SDK、策略和 checkpoint 检查。

```sh
npx tsx agents/reading/evals/quality/run.ts execute --frozen /protected/frozen.json --snapshots /protected/snapshots.json --config /protected/preview.json --notes-repository /absolute/notes --session calibration-v1 --split holdout --local-root /protected/runner --output /protected/execution.json
```

开发和留出分开执行，`--sample ID` 可重复指定本次明确选择的样本，不是产品篇数上限。每个样本使用由 session + ID 决定的独立 preview namespace；在模型 query 前提交不含人工标签的冻结绑定与来源 provenance。所有留出 URL（含固定重定向／canonical URL）和对应笔记路径均传入正例、当前知识摘要与正文检索排除集。人工标签及评分不传入模型。

中断后用相同 session／frozen／snapshot／配置继续，输出文件选一个新路径。相同 session 中改标签、split、正文、版本或排除集合会失败；须显式新建评估版本/session。底层调用 uncertain 时保持 manual 与原消耗，不自动重跑。query、正常格式修复、失败与无产出都包含在 invocation 账本中；中断且没有完整 RunReport 的尝试使总耗时保持 null，已观察耗时单列。一次命令中的各样本共享起始截止时间。私有产物和报告留在受保护/ignored 目录。

输出 `samples` 可供后续人工测量和 `report` 使用，另有 `cases` 的实际项目状态、versions、workspace revision、run IDs、实际 input/implementation commit、policy check refs、usage、失败与产物 hashes。`collect` 对应实际 research 选题，`reject` 对应 skip/excluded，`insufficient` 对应明确选题 defer/核心材料不足；不把容量、未知调用或未决分类随意记为材料不足。未完成或未选中的预测仍为 null；`qualified` 一律等待人工判定。模型审校与人工评分分开，上传／正式 URL／PR 均为 not_exercised。部分执行不能作为完整留出报告或 G4/G5 验收。

## 测量与报告

模型结果与人工测量写入另一个同样带 `samples` 的文件，保持冻结的输入字段。predicted 与 human_label 分开；人工主张支持率使用实际抽查的支持／检查数，支持数不得大于检查数。数字、接口、链接错误及机制、取舍、边界、图像分数仅填实际观察；未观察用 null。score 是非负整数，具体尺度与合格阈值由用户在校准时确认，不在代码里发明合格率。

记录真实 PR 反馈（merged/modified_then_merged/closed_unmerged/pending），不能从一条评论或合并自动更新偏好。所有样本的费用和时长包括未完成、失败及零产出；未知费用／时长用 null，qualified 仅由已确认的合格结果决定。

```sh
npx tsx agents/reading/evals/quality/run.ts report --input /protected/measured.json --frozen /protected/frozen.json --output /protected/report.json
```

报告分别保留人工、模型、反馈、错误、样本数和分母。任一样本费用／时长未知时，总值保持 null；已观察的下界单列。未抽查项有单独计数，不把 null 当没有错误。报告仍标记 awaiting_user_confirmation；没有用户对真实样本的质量确认，不能通过 G4/G5 或启用正式 cron。

当前工具已实现真实执行入口，并以实际本地 Controller/driver/不可变文件链和模型回放验证恢复、版本绑定与标签隔离；尚未进行真实模型评估。真实执行仍依赖 G1、已发布 cloud skill 和用户标注。使用 synthetic fixtures 验证执行器，不算真实质量校准。

## 汇总开发集与留出集执行

两个 split 分开运行后，用 `merge` 汇总同一个冻结语料的执行文件。此命令只读取本地文件，不调用模型或写远端。每个样本保留其真实 preview scope、累计 query 账本、观察到的费用／耗时下界，以及仍未知的总值；尚未执行的样本仍未知，不以零补齐。

```sh
npx tsx agents/reading/evals/quality/run.ts merge --frozen /protected/frozen.json --execution /protected/development.json --execution /protected/holdout.json --output /protected/merged.json
```

同 session 的恢复输出可以重复传入 `--execution`。汇总核对冻结身份、正文版本、split、namespace、case 与 samples 的映射，并验证以前的 run metadata 和 invocation/message 哈希前缀仍在。它选择包含旧事实的最新累计快照，不相加旧快照与新快照；冲突的同一批 run、丢失观察、不同 namespace 的同一个样本或 live/local_replay 混合均拒绝。不同评估 session 的同一样本应单独比较，不能借汇总掩盖额外调用。 早期执行文件缺少 invocation/message 哈希时，merge 会拒绝把它当作已核验的累计账本；保留原文件，不默认补齐或修改旧费用事实。旧人工 measured 文件仍可通过 report 导入，但缺失 scope／下界保持 unknown。

在 merged 文件的副本中填写人工评分、反馈及 qualified，保留 `executions`。然后执行已有 `report` 命令；它重新校验执行绑定，拒绝用人工文件改变已观察到的预测、模型审校或费用／耗时事实。也可在 merge 时通过 `--input /protected/measured.json` 提供同一冻结语料的人工测量。

新输出样本包含 `execution_scope`、`known_cost_usd`、`known_duration_ms`。同一样本里有已定价 query 和未知 query 时，已定价部分进入 known 下界，`cost_usd` 仍为 null；没有任何费用观测时 known 也是 null。存在缺最终报告的尝试时，总耗时为 null，其他完整尝试的耗时仍保留。确实观测到零费用可以记录零。这些费用来自整个 query 的汇总，绝不再叠加其 step usage。

最终报告明示 scope，提供 `by_scope` 和 `by_split` 消耗及样本数；主选题评分仍针对留出集，开发集另列。`qualified_outputs` 单列每篇人工确认合格产物的费用与耗时，下界和未知分别保留；每合格产物的摊销费用／耗时包含未合格、失败和零产出的消耗，总值未知时摊销总值也未知。旧人工文件没有 scope 或下界时保留 unknown，不能推断它属于 preview。完整执行 case 的失败和版本事实随 report 输出保留。上述流程仍不证明真实模型质量或通过 G4/G5。
