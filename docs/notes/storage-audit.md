# S1–S8 与 G0 存储审计

审计日期：2026-10-13，Asia/Shanghai。依据 `intent.md`、`docs/specs/reading-agent-spec.md`、`docs/plans/01-workspace-storage-plan.md` 和当前共享契约。本文是存储模块的实现／证据索引；规范进度仍以 `docs/tasks/implementation.md` 为准。没有修改生产开关、云资源、RAM 权限或既有 OSS 对象。

## 本轮发现及修复

1. **被接纳的材料不能稳定保存**。HTTP 单响应限制、64 MB 每批下载限制和多批恢复并不能保证项目控制 JSON 小于 32 MiB。项目包含累计全文，PDF 同时保存全文和页文本；一个 source JSON 也可能大于 32 MiB。S Manager 现对大逻辑文件透明分块：ManifestFile 保留完整路径、字节和 SHA-256，新增可选 `chunks: {sha256,size}[]`；物理 blob 每块不超过 32 MiB。恢复验证每块、顺序／总量与整体哈希，不能截断。小文件沿用原布局。容量计算仅统计物理新块，重复块计一次；GC 和历史恢复保护全部块。Root 将全文从项目控制行移到独立 evidence 文件，只保存引用；此项属于组合层，不能以存储分块测试代替组合层 hydration 证明。
2. **通用控制文件绕过业务校验**。原来 `change.files` 可直接写 state JSON 绕过 Invocation/Reservation 校验，`remove_paths` 可删除调用审计。现所有 state JSON 文件和删除均经过同一 record validators；state 必须为 control role。注册机制新增恢复回调，组合层可在 Manager restore 前注册 A/O 自己的 DTO 解析器。
3. **未知／不一致的调用事实**。Invocation 现在拒绝不安全整数 tokens、known+null 与 unknown+数值费用、与 record key 不一致的 ID；只有唯一的受信 `not_started_<id>` 零 usage summary 及 running/failed 状态可标记 request_started=false，已保存的启动证据不能改写。重复观察、unknown 下界和恢复归属仍由 usage ledger 保持。
4. **过宽的封存解析**。ArtifactSeal 新增 exact schema 1；验证完整的项目 artifact/output 集合、scope 对应发布检查、提交引用及文件哈希。不能以改版本、删文件集合或重算 seal hash 取得授权。
5. **容量及元数据不确定性**。OSS 旧 VersionId `"null"` 与 absent/null 合并计一次；重复身份的大小矛盾、负数／非法元数据、不完整／非法分页均拒绝。容量写入预检拒绝改写 50 GB 口径，不允许用超大 limit 绕过硬边界；计数器新增溢出校验。
6. **历史 GC 的认证缺口**。原 GC 对历史 manifest 仅解析 JSON，没有按不可变 commit 链核验其哈希。现先验证完整提交链及当前 HEAD，再认证历史 manifest 字节与 parent revision，才能计算引用闭包；未提交 manifest 按对象时间和孤立宽限处理。冷启动测试篡改历史 manifest 后 delete 数为零，过时 HEAD 也不允许清理。
7. **替身和解析边界**。FileStore 新增 stat/configuration 及 list 响应后故障，commit 删除拒绝；stat 响应丢失后持久预留仍 pending，新进程读取同一稳定键确认，未重复上传。规范化 JSON 拒绝 Date/Map、循环、稀疏数组、undefined 和非有限数，避免把非 JSON 静默写成别的事实。未知 checkpoint event 类型／字段拒绝。OSS 原生 endpoint 校验地区、路径和认证信息；未知异常只输出安全 error category。

## 逐工作包核对

| 工作包 | 当前实现及本地证据 | 尚缺或弱证据 |
| --- | --- | --- |
| S1 / G0 | strict ESM、锁文件、统一 TypeBox 注册；workspace/checkpoint/invocation/storage/reservation/artifact-seal exact schemas。`schema.test.ts`、`reservation-envelope.test.ts`、`audit-contracts.test.ts` 覆盖未知版本、scope、控制入口和不合法 JSON。注册 restore hook 通过真实 FileStore 重启证明。 | A/O/Root 核心业务控制 DTO 必须分别注册或在读取入口强校验；通用 JSON record 不等于各业务 schema。A 已提供 `parseRuntimeProject/parseContextBundle/parseMaterialSnapshot`，Root 负责 pruned project、source reference 与其余 host rows 组合。不可宣称 G0 全部业务对象已由 S 自动解析。 |
| S2 | 真实文件持久对象，禁止覆盖创建，create/read/stat/list/delete/configuration 故障；`workspace.test.ts`、`metrics.test.ts`、预留 metadata-loss 重启测试。缓存／本地目录可丢失，恢复依赖持久对象。 | FileStore 是本地协议替身；不能证明 OSS 网络时序或 RAM。原 stat 故障缺口已补。 |
| S3 | ali-oss 固定版本、禁止覆盖头、显式不存在与权限／暂态／unknown 分类、完整分页及配置核验。`oss-live-evidence.json` 记录已有私有隔离资源的原生 probe：争写一成功、私有性、分页和提交恢复。 | 服务返回后在适配器人为抛错，仅证明受控丢响应对账；真实传输级响应丢失、取消／超时行为及独立 RAM 允许／拒绝仍未完成。没有重新运行或增加 live 证据。 |
| S4 | 零号显式初始化、连续序号父 SHA、immutable manifest/blob、固定下一序号竞争与读回；历史 handle 只读、按需读取。`workspace.test.ts`、`chunks.test.ts` 覆盖旧/新完整快照、缺块/坏块、历史读取及 restart。 | 大逻辑文件全部字节最终仍须在 host 上组装；分块不是流式模型阅读或无限内存保证。Root 的 source sidecar/read reference 需要其组合测试。已合法 GC 的历史正文缺失明确失败，不能借此重建旧材料。 |
| S5 | production/preview 独立身份、根目录及前缀；文件白名单与 symlink 拒绝；exact seal、完整文件集、历史快照核验。`workspace.test.ts` 和新 seal 非法 envelope tests。 | 真正凭据层 preview→production 写拒绝未证实；Linux 工具容器与远端发布授权由 A/O 负责，S seal 本地通过不替代它们。 |
| S6 | prepared/observed/terminal 原子持久、message ID 去重、summary 覆盖 step；权威 Invocation/meta 按 scope/workspace/project/轮/北京时间日归集，unknown 保留 null+已知下界。`usage-ledger.test.ts` 与 invocation 持久 tests。 | HTTP 内部重试、实际供应方账单／取消后的支出仍不可推断。缺 metadata 明确 unattributed；不静默迁移历史回执。RuntimeProject 自身 counters 的完整 DTO/预算归 A，不用 S 通用 counters 代替它。 |
| S7 | 全局清单／预留、45/49/50 GB 控制区、去重物理块、严格 reservation v1、先解除引用再 GC、30 天 manifest/7 天 orphan、commit 永久保护。`control-reserve.test.ts`、`maintenance.test.ts`、`chunks.test.ts`、`metrics.test.ts`。 | 全局 broker 的不同 RAM 身份、真实云共享互斥、图床所有版本与真实默认分支／PR 引用、图床删除范围需 live 验证。O 的严格 image GC 和真实引用 provider 仍须隔离实测；缺引用必须保留。供应方金额/真实请求与出网未观测时为未知，绝不以适配器调用数冒充 HTTP 数。 |
| S8 | 恢复手册、shared fake store、合成 collection→invocation→artifact→seal→receipt；FileStore 下一进程和 host composition 回放；结果明确区分 simulated/local/live。 | G1 仍缺 RAM/transport，G2 缺真实 SDK/质量，G3 缺独立 GitHub/图床交付故障链，G4 缺真实容量/GC/人工质量，G5 缺正式手动及启用确认。不能将可运行脚本、skip 或测试数当门槛已通过。 |

## 本轮验证

- `npm run typecheck`：通过。
- `npm test -- agents/reading/evals/storage`：12 files、65 tests 通过。
- `npm test`：55 files、333 tests 通过（21:17 Asia/Shanghai 检查点）。21:19 并行新增 generation 测试后的 336 项中 335 通过、1 项因 Root generation 的 undefined 输入比较失败；已交 Root 修复，不能将该轮称为全量通过。后续以 canonical 最新结果为准。
- `npm run build`：通过。
- `npm run coverage:spec`：87 场景均有映射，complete 0、pending 87；映射完整不代表 live／人工验收完成。

新增 `chunks.test.ts` 使用真实 64 MiB logical file 和大控制 JSON，在 FileStore 中写入、重启、读回核验、注入 manifest 前退出、损坏／删除块和执行保护／解除保护 GC。它证明存储实现，**没有**运行真实材料下载、付费模型、OSS 分块上传或正式图片 GC。

`bootstrap.test.ts` 的受控 classifier fixture 显式注入稳定 tool-runtime fixture（SDK 版本／文件哈希来自实际安装）；此 fixture 不执行 Docker 工具，不是 Linux tool image 验证。真实 Docker/runtime 证据保持独立。

## 交接接口

- `manifestBlobs(file)` 返回逻辑文件对应的所有物理 blob/hash/size；引用、容量指标及 GC 消费方不能只使用 logical SHA。
- `readManifestFile(store,prefix,file)` 顺序读取并验证全部物理块与完整逻辑哈希。Root 通过 Manager.readFile 的 API 继续使用逻辑路径。
- `registerRecordValidator(prefix,validate,restore?)` 的 restore 为 `(value,execution_scope,key)=>void`；注册必须发生在 restore 前。业务 DTO 仍由其 owner 定义，S 不复制 A/O schema。
- `parseStorageReservation(unknown)` 只接受 exact v1；无隐式 live 迁移。
