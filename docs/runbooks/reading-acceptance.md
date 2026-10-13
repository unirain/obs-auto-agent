# Reading Agent 验收证据与真实测试

## 本地命令

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run coverage:spec
```

`evals/delivery` 验证上传 immutable keys、reservation、未知读回、内容冲突、最新策略，Publisher 检查每次外部边界后的持久状态和下一实例恢复。原生 `git hash-object` 测试验证本地 commit/tree 构造；不证明 GitHub canonical commit SHA。`evals/operations` 验证四模式、三部署、Scope/capability 拒绝、逐来源与 gap projection、Issue/comment 响应丢失和漏跑监控。全部替身测试只能记 local_verified。

## 明确选择隔离真实资源

不得创建资源来取得绿灯。配置已存在且权限核验完成的 integration profile；所有测试内容和 PR 仅进入独立测试仓库，图床只进入专用 integration 前缀，私有 OSS 原文不得公开。环境变量只提供凭据引用，不在日志输出值。

```text
READING_LIVE_DEPLOYMENT=/absolute/path/verified-integration.json
READING_LIVE_DELIVERY=1
```

`npm run test:live` 默认所有真实测试跳过，只有所需显式开关才执行。`evals/integration/delivery-operations/github.live.test.ts` 使用真实 OSS checkpoint 与真实 App，从封存 fixture 构造确定性 commit，注入 PR 返回丢失，在重新 restore 的进程状态中对账同一 PR。随后只关闭测试 PR，保留分支与提交链以供审计；不合并。这个 technical spike 不验证模型质量、真实图床或整套 G3/G4。

真正 G3 还需手动 `scheduled + input_urls` 隔离 test workspace 跑完整模型→图片→最终审校→seal→PR 链路，并按计划 O7 的每个边界注入故障（blob/tree/commit/branch/PR、回执、策略刷新、默认分支冲突、跨 scope 与并发）。真正 G4 必须有两真实信源分页/失败/恢复/gap、Issue 权限和丢失响应演练、共享正式+preview+图床历史版本容量视图，以及用户认可的质量校准，不能以 spike 代替。

## 每次验收记录模板

```text
acceptance_id:
work_packages:
gate:
code_commit:
lockfile_sha256:
config_sha256:
execution_scope:
workspace_id:
workspace_revision_before/after:
isolated_repository:
isolated_oss_bucket/prefix:
isolated_image_prefix/versioning:
credential_reference_names:  # 不写凭据值
scenario/injection_boundary:
expected:
actual_external_fact:
actual_persisted_record:
next_run_observation:
result: passed|failed|not_exercised
cleanup_receipt:  # 保留 commits；不删除 protected/unknown 资源
quality_confirmation: not_exercised|user-confirmed
```

按 S/A/O/V 25 个工作包和 G0–G5 一项项登记到 `docs/tasks/implementation.md`，详细证据与决策登记到 `docs/notes/implementation-log.md`。无账号／凭据时记录 live_unverified 或 blocked_external；严禁“测试文件存在”“测试跳过”“mock 通过”升级为真实门槛 complete。用户至少五篇不同类型文章反馈、约三十篇分类标注和冻结十篇留出集仍在最终范围。
