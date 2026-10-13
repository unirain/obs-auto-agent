# 共享容量与垃圾回收

正式、预览 workspace 及本系统新增图床资源合计上限 50,000,000,000 bytes。清单包含所有存活 blob、manifest、commit、孤立对象和受管图床历史版本；相同 bucket/key/version 去重，实际副本分开计量。

## 写入前

`managedInventory` 完整读取各受管前缀并汇总图床版本提供器；任一提供器不完整或列举失败，新增上传停止。preview 只能接收可信汇总，不为了计量获得正式证据和写权限。

`capacityView` 将尚未出现的 pending reservation 加到实际占用；稳定键已经出现在清单时不重复加。对象大小与预留不符，停止对账；confirmed 对象不存在，容量未知。模型费用仍为 observe_only。

45 GB 预警；49 GB 停止新增采集/生成。最后 1 GB 只用于回执、检查点、清理记录。任何写入包括控制 manifest、commit 和状态 blob 都不能突破50 GB。

`reserve` 先把稳定键、scope、预计字节及意图持久化。预留检查点自身使用保守 envelope 上界，并在 Manager 发布时再次计算准确新增字节；没有可信实时全局容量回调和共用互斥组，不能运行真实新增写入。上传未知保持 pending；读取稳定键确认存在后改 confirmed；明确未写入才允许释放。

## 清理

1. 同一互斥组内先提交解除过期项目正文引用的快照。
2. 给 `collectGarbage` 提供 HEAD、全部活跃/未决项目、待交付/待审 PR 所需 revision 的集合，以及完整引用知识证明。
3. 保留 HEAD、保护版本、最近三十天历史 manifest 的全部 blob 引用。
4. 删除无引用且超过七天宽限的 blob、过期未保护 manifest。commit 永不删除。
5. 删除回执丢失则 stat 核对；只有明确不存在才记删除成功。重新枚举容量后才能减账，不能依据发出 delete 请求先减账。
6. 图床清理由图床引用提供器核对默认分支及待审 PR；未知则保留。合并笔记中的图片长期保护。

空间无法安全释放时，保留候选与游标，暂停新增任务并报告 storage_capacity。不能删除仍被引用的正文或图片换取绿色验收。

## 命令和证据

`npm test -- agents/reading/evals/storage/workspace.test.ts` 验证边界、预留去重、不可变提交与失败后恢复。真实图床历史版本清单、独立 GC RAM delete 权限及共享云端互斥仍需隔离资源验收；本地测试不能证明这些能力。

## 云端只读容量 broker

`storage/broker.ts` 从 host 的 `READING_CAPACITY_VIEW_CREDENTIALS` 接收单独的只读 RAM 身份，字段为 `accessKeyId`、`accessKeySecret`、可选 `stsToken`，以及 `bindings`。也可将绑定清单放在可信的 `READING_MANAGED_STORAGE_PREFIXES` JSON 配置中。凭据不可放入 Markdown、Git 或 workspace。

每个 binding 含 `kind`（workspace/image）、`scope`（production/preview/integration/images）、`bucket`、`region`、`endpoint`、`prefix`。必须覆盖正式、预览及所有受管图床前缀，并包含本次部署的目标。确认系统尚无受管图床对象时，配置可显式声明 `image_inventory: none_managed_verified`；缺失信息不会被视作零。

Broker 完整列举受管对象。workspace 仅读取提交链、HEAD manifest 与容量预留控制 blob，不下载来源证据；图床通过原生 `getBucketVersions` 完整分页列举历史版本。broker 不持有写权限，也不将适配器或证据暴露给 preview。

Bootstrap 的 scoped workspace/image 凭据只从部署指定的环境变量 JSON reference 加载，不回退到广域账号凭据文件。`OSS_CREDENTIALS_FILE` 仅供已授权、隔离前缀的 OSS 探针使用。

## 独立维护入口

`app/maintenance.ts` 的 `maintainWorkspace` 必须在全局写入互斥内执行；`buildMaintenanceApplication` 是纯存储入口，不启动 SDK，不加载模型／图床上传凭据，不创建或改写 PR，也不初始化缺失的 workspace。已有应用也返回 `maintenance()`。

可信 workflow 已持有统一互斥时传递 `READING_SHARED_MUTEX_HELD=true`，或由 host 提供实际 `maintenance_mutex`。缺少互斥证明会拒绝维护。

维护先识别结束项目并核对所有未决调用及当前真实 PR 状态。未决调用、待审／重新打开的 PR、GitHub 读取失败一律保护。项目完成时间未知时先持久化观察时刻，等待三十天；不能用创建时间猜结束时间。

达到保留期的已结束项目，先提交解除 `projects/`、`outputs/`、未再使用的 context 输入引用，并将项目控制记录缩为身份、状态、时间、生成版本、知识增量及调用审计 ID；删除对应的响应和诊断正文。候选／游标、usage、调用审计及交付事实长期保留。新快照提交后再调用引用闭包 GC；在两步之间退出，下次仍可恢复完整的新状态。

最近三十天历史 manifest 仍保护旧正文，所以解除 HEAD 引用不意味着立即回收。正式图片只有提供已核对默认分支和待审 PR 引用的 `image_gc` 才可删除；缺少该提供器报告 `not_exercised`，绝不假装安全。真实 RAM 删除范围、图床引用与云端共享互斥仍须实测。

回归：`npm test -- agents/reading/evals/storage/maintenance.test.ts` 覆盖惰性读取、解除引用后退出、下一运行 GC、未知调用、真实 PR 状态覆盖旧本地状态及未知结束时间。

## 请求与容量指标

`storage/metrics.ts` 的 `MeteredObjectStore` 记录实际发生的适配器调用、成功返回的 payload 字节和结果不明状态；传输层没有提供观测时，真实 HTTP 请求次数、wire 字节和重试次数为 null。一个 `configuration()` 可能包含多个 SDK 请求，不能将一个适配器方法直接称为一个 HTTP 请求。SDK 的失败可能已经产生网络费用，失败不代表零请求。

`inventoryMetrics` 对完整存活对象清单按 bucket/key/version 去重，分列 commit、manifest、引用 blob、孤立 blob、无法分类的 blob 和图床对象，以及 scope 和存储版本数。引用集合不完整时，不把任何未知 blob 当孤立。额外版本数可由完整清单计算；缺 latest 标记时，精确历史版本数仍是未知。

这些字段记录观测，不输出虚构的 OSS 或 Actions 金额。供应方账单、实际 wire 指标和 Actions 可计费用量仍需外部观测；本地适配器和文件恢复测试不会证明这些 live 属性。指标快照明确截至哪个 event，保存快照自身后发生的写入不得伪称已包含。

回归：`npm test -- agents/reading/evals/storage/metrics.test.ts` 包含成功后丢响应、指标落盘及新进程重放、部分传输指标和版本化容量清单。

## 预留记录版本

`storage/reservations/<reservation_id>` 必须是 `storage-reservation.schema.json` 定义的精确版本 1 envelope，含 `schema_version: 1`、稳定对象键、bucket、scope、预计字节、nullable 版本回执及 pending/confirmed/released 状态。生产方写入版本；读取方不补默认值。容量 broker、预留对账、通用 checkpoint 与恢复都拒绝无版本、未知版本、额外字段、身份和 scope 不一致的记录。

预留从 pending 开始，确认对象后可变为 confirmed，确认已不存在后可释放；释放的身份不能重新用于上传，对象绑定和已确认版本回执不可改写。现有未版本化记录需要单独审查迁移，不能在启动或容量统计时静默升级。此轮未读取或迁移 live 预留，不能将本地契约测试当作真实图床预留验证。

回归：`npm test -- agents/reading/evals/storage/reservation-envelope.test.ts` 覆盖所有读取入口拒绝非法 envelope、FileStore 重启的合法生命周期，以及完整不可变提交链中无版本／未知版本记录的恢复拒绝。
