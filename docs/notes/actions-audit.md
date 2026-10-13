# O5 Actions／CLI 只读审计

审计时间：2026-10-13 21:55 Asia/Shanghai。范围为 [O5](../plans/03-delivery-operations-plan.md) 全部工作与验收条目；不修改源码、workflow、Secrets、环境保护或云权限，不 dispatch 实际任务。协调器负责修复及 canonical tasks/log。

本地入口、模式和 workflow 接线已有证据；**O5 尚未 complete**。已发现尚未接线的每日逻辑键、取消信号、普通运行入口互斥检查与 G1 证据配置。四种模式、同时 writer、取消／重跑及 RAM／App 限权仍需隔离环境实际 Actions 验收。以下事实是审计时快照，后续协调器修复后须重验。

## 真实仓库观察

通过只读 `gh api` 查询 `unirain/obs-auto-agent`：默认分支 `master`；HEAD `bae2cbb6b32d4e692d9f5118ccc536022e7d0c32`。服务端已注册 CI、Reading Agent、Maintenance、Recovery、Watchdog 共五个 active workflows；active 表示已注册，不代表阅读 cron 已启用。

所有分页返回的运行仅有五次 CI push，结论 success。最新 [CI run 38408098528](https://github.com/unirain/obs-auto-agent/actions/runs/38408098528) 对应上述 SHA；未观察到 Reading Agent、Maintenance、Recovery 或 Watchdog 的实际 run。CI 通过不证明 Secrets、environment protection、Docker 宿主隔离、原生 OSS 或发布 App 链路。

通过 contents API 读取 `master` 上四个 O workflows，计算 SHA-256，与审计时本地逐字节一致：

| 路径 | SHA-256 |
| --- | --- |
| `.github/workflows/reading-agent.yml` | `2cf0795beaa1553951d70d09435ad49877ba6c707bacd37d76bf24dcb28f0715` |
| `.github/workflows/reading-maintenance.yml` | `aa06b45f0cc5bae7a1f88e71dd04fac6042bc40b224bd0197ac866c87b960610` |
| `.github/workflows/reading-recovery.yml` | `7b28ebe1a499c7e629c8712471e5bc43fce5345e3eaa06e48bac91acc4b216b5` |
| `.github/workflows/reading-watchdog.yml` | `4ea93c6cc3fe15890f382230baaec3e84b044b16298a576cad60688dc9c1f887` |

## 全部 O5 条目

| 计划条目 | 实际接线与当前本地证据 | 剩余证据／缺口 |
| --- | --- | --- |
| O1／G1／CLI 依赖；preview 权限隔离先于 G2；真实发布等待门槛 | `parseDeployment`、`executionTarget` 先解析 scope；bootstrap paid admission 调用 `assertG1Evidence`；preview 没有 image／publisher／Issue binding。`modes.test.ts`、`storage/bootstrap.test.ts` 有拒绝与真实 factory 组合替身检查 | G1 live assertions incomplete；G2/G3 未证明；**workflow 缺 G1 evidence env 接线**。Publisher 独立 fake 不是实际 App 验收 |
| 定时固定 scheduled+production，无 input_urls | YAML schedule 路径固定模式／profile并强制 `[]`；`parseDispatch` 拒绝 cron 的人工参数 | cron 当前注释；仅 parser/YAML 验证，没有实际 schedule 运行 |
| 手动默认 preview；JSON URL 类型化，不拼 shell | workflow mode+deployment 默认均 preview；CLI `--input-url` 未指定 mode 默认 preview，必须给可信 deployment 文件；URL 放 env，run shell 无 `${{ inputs.* }}`。`modes.test.ts`、`cli.test.ts` 验证 JSON与shell字符 | 不会根据 URL 自动猜 production 配置；显式错误组合拒绝。需要实际 dispatch 字符输入与日志验收，不能仅以 JSON parse 证明 Actions 表达式／shell行为 |
| scheduled+input_urls 接受人工 URL，先对账，原子入队，再处理积压和来源 | controller 先 reconcile publishing/pr_open，再 `intakeManual`；同一 `commitMany(identity)` 保存候选+submission；来源随后收集，URL 经 current PolicyGate。`collect/intake.test.ts` 验证提交失败／重复回读，已有来源和人工身份合并 | 需要 isolated production-scope Actions 同日两次不同 URL、相同 submission retry 与来源游标实际不被人工入口推进的组合证据；当前单测是分组件证明 |
| 历史／首批信源外人工 URL 仍按当前许可，不推进订阅游标 | `intakeManual` 调 main_read gate，保留 origin/source refs，只写 identity，不改 sources progress | 当前许可 remote default refresh、实际受限 URL 被拒且游标不变需整链验收 |
| resume/publish-only 仅已有 production project；拒新URL／previewID | parser要求project_id且拒 input_urls/preview_id/submission_id；scope mismatch拒绝；bootstrap restore不允许初始化这两种模式；controller查实际已有项目。`modes.test.ts`、`cli.test.ts`、controller test | 实际测试 workspace 的两模式、不存在项目拒绝、历史 PR 对账和跨scope尝试仍 live_unverified |
| preview 用自身 ID恢复，只写自身状态；正式须重新scheduled原URL | CLI新preview生成UUID；已有preview_id复用，deployment固定previewprefix且无正式写cap；model tools／控制器保持scope；`modes.test.ts`、bootstrap restore测试 | 实际 RAM 对生产／图床／GitHub拒绝仍未证明，不能靠没有字段声明权限完成 |
| 正式／preview／清理固定全仓库 writer组、不主动取消 | Agent、Maintenance、Recovery均 `reading-workspace-writer`、`cancel-in-progress:false`，无branch/runID。watchdog独立Issue组；`workflows.test.ts`逐文件核对 | 正常run CLI／bootstrap当前没有mutex guard；手工非local启动可绕Actions并发。还需 actual Actions preview+integration+maintenance overlap，测第二任务开始前首任务退出 |
| 全局只读容量view，scope自己的预留／回执，不能把等待队列当任务队列 | 宿主 `capacityBrokerFromEnvironment` 读 all managed prefixes；本scope reservation写已提交journal；SDK/tool只拿受控方法。`storage/broker.test.ts`、reservation／capacity测试已有独立本地证明 | readonly broker权限及50GB跨scope版本计量需live；Actions concurrency默认pending会替换，尚未启动任务中的URL没有OSS receipt，取消后操作者必须重提，不能声称“排队已持久化” |
| 每日逻辑键上海日期，runID/attempt仅审计 | `dailyLogicalKey` utility及单测正确，host run ID为id-attempt；manual默认submission基于runID+URL，候选本身统一去重 | **dailyLogicalKey未被controller/RunReport任何实际生产路径消费／持久化**；应记录逻辑日期，不能用其阻止新submission |
| 预留主动收尾时间；取消／超时abort SDK，恢复最后commit | 第一step记录job起点，依赖安装／测试／build计入60分钟；`RunDeadline`默认最后5分钟禁新query并触发signal，executor转接SDK abortController；unknown不重试。`runtime/executor.test.ts`与bootstrap jobclock测试 | **没有process SIGINT/SIGTERM取消接线**；当前只证明主动deadline／策略撤销，实际Actions取消与冷启动journal必须验证。runner强杀后不能声称会写收尾report |
| 付费／写能力仅可信code/config，不受PR／评论触发 | paid workflows只workflow_dispatch/注释schedule，job guard default_branch，checkout默认分支persist-credentials:false；validate prerequisite无Secrets；remote policy source从真实repo defaultcommit读取，拒非default policy branch；CI PR只contents:read | Actions仅按default branch guard，CLI `--from-actions`本身是输入读取标志不是签名；本机启动依赖可信操作员。环境保护／installation实际repo范围未审验，不能从YAML判已保护 |
| 先校验scope再取凭据，容器allowlist看不到秘密 | mode/profile validate job先于带Secrets的三个jobs。preview只有preview OSS／model／只读；正式与integration分environment／envrefs。SDK替换env只model，toolsDocker无network/read-only/cap-drop/固定mount与env，`executor.test.ts`验证SDK env、`tools`本地测试验证受控工具 | Docker real isolation跨job／真实Secrets哨兵未执行；capacity credential具有多scope readonly访问，不能错误称其仅preview。publish-only host不读model/imagekey但workflow仍注入（可缩小注入） |
| 验收矩阵：模式、恶意JSON、重复dispatch、跨scope、取消重跑、同日URL、并发 | parser／workflow／intake／executor局部测试通过，persistent fake next-run有候选／query未知/控制状态检查 | 未形成所有矩阵的真实Actions evidence；重复manual默认submission随runID变化但候选去重（显式稳定submission更强）；同日新URL无生产daily逻辑键，所以缺对应组合回归 |
| 08:17北京时间；G5前不启用 | 注释UTC `17 0 * * *`等于08:17；deployment cron_enabled=false，enabled_at/g5_evidence=null；parser要求G5启用字段 | 未启用是正确状态；部署时确认G5、schedule语法和首轮actualrun，GitHub延迟不作为准点保证 |

## 应由协调器补齐的代码缺口

1. **G1 evidence workflow接线。** bootstrap默认paid adapter要求 `READING_G1_EVIDENCE_PATH` 与可信 `READING_G1_EVIDENCE_SHA256`；当前所有run step都没有。这是完成环境后的执行阻塞，不能通过修改verified flags或复制partial report绕过。应绑定已审验、隔离、完整真实断言的文件及hash；配置变量需显式映射到env。
2. **每日逻辑键。** 将 `dailyLogicalKey` 接入真实report／审计。保持 runID-attempt 作为审计，daily key绝不能阻止同日新人工submission。
3. **取消链。** 将宿主停止信号接入正在运行的query与收尾协调器；通过实际中止、重启恢复验证，没有收尾commit时使用最后已确认revision，unknown先对账。
4. **普通run入口mutex。** Actions YAML持锁不等于所有CLI持锁。非local run应证明全局writer互斥／接受真实外部mutex port，否则拒绝可能并行的容量检查与写入；不能让简单设置环境变量冒充实际锁。
5. **最小凭据注入。** publish-only factory已通过Proxy测试证明不读model／imagekey，但workflow仍无条件注入它们。宜依据mode缩小env注入，并真实核对App installation仅目标repo、RAM仅声明prefix、preview deny；当前声明／模板都不算live证据。

GitHub默认 concurrency 只保留一个pending，较新的pending替换旧任务；`cancel-in-progress:false`只保留正在运行者。官方已提供 `queue:max` 扩大等待队列，但队列仍不能代替应用持久入队，本审计不要求更改它。[官方Concurrency说明](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)、[官方2026年队列更新](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/)。

## 本轮验证与实际验收清单

只运行：`npx vitest run` 下列7文件；2026-10-13 21:52，**51测试通过**。本轮无源码变更，未重复build或更换依赖。

- `operations/workflows.test.ts`、`operations/modes.test.ts`
- `contracts/cli.test.ts`、`integration/controller.test.ts`
- `runtime/executor.test.ts`、`collect/intake.test.ts`、`storage/bootstrap.test.ts`

最少实际Actions证据需覆盖：preview新URL与ID续跑；integration scheduled新URL／同日另一URL／相同submission重复；resume与publish-only已有项目及跨scope拒绝；三类writer overlap及pending取消后重提；setup消耗时间／生成截止／实际用户取消／重跑unknown不重复query；恶意JSON作为数据；model与tool秘密哨兵；实际App/RAM范围；全部回执绑定commit、runID-attempt和scope。这些动作等待已授权、已准备的隔离资源，由协调器推进，本次只读审计未自动执行。

## 21:57 授权后的 workflow 局部修复

上述表格及remote SHA是修复前的审计快照。协调器随后授权修改workflow接线、对应test和runbook；不修改app/CLI/runtime，也没有dispatch或云权限操作。

本地 `reading-agent.yml` 已为生成task从Environment Variables显式映射G1 path/hash，生成前检查只能选择默认分支已检入且内容匹配HEAD的非secret eval JSON，拒绝符号链接／越界路径／未跟踪／workingtree改动，并执行真实 `assertG1Evidence` 的schema/完整断言校验。publish-only不注入model或图床上传secret，跳过tool image build与G1生成检查，保持notes readonly checkout及交付所需能力。

`operations/workflows.test.ts` 新增实际提取并执行YAML的检查脚本；临时Git仓库内验证checked-in fixture通过、未跟踪／改动／incomplete fixture均拒绝。fixture的完整断言是测试数据，**不是G1 live proof**。工作流8例本地通过；协调器负责daily key、signal、mutex及最终当前总验收。本地修改尚未以remote run证明，O5仍live_unverified。

21:58最终局部复测：workflows/modes/CLI三文件20例通过，typecheck/build通过。扩大到storage/bootstrap时出现3个旧fixture因协调器并行新增普通run mutexguard而失败，已通知其owner补显式持锁fixture；不能报告这轮扩大检查全绿。本次审计及workflow修复冻结，后续集成测试由协调器记录。
