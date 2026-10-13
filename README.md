# obs-auto-agent

持续发现技术文章，研究原文和相关材料，生成符合个人 Obsidian 笔记规范的笔记与配图，并通过人工审阅的 PR 入库。需求见 [intent](intent.md)，行为边界见 [spec](docs/specs/reading-agent-spec.md)，实施与验证顺序见 [plans](docs/plans/README.md)。

当前实现进度见 [tasks](docs/tasks/implementation.md)，验证结果与决策见 [implementation log](docs/notes/implementation-log.md)。正式 cron 默认关闭；本地测试与真实云端验收分别记录。

## 开发命令

使用 Node 24 和 npm；依赖版本固定在 package manifest 和 lockfile。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run coverage:spec
```

`coverage:spec` 检查 87 个 spec 场景与验收索引是否一致；带 `--strict` 时要求全部场景有完成证据。它不将单元测试数量当作全部验收通过。

## 运行入口

先检查可信部署配置与输入，操作不加载模型或外部写入凭据：

```sh
npm run reading -- validate-dispatch \
  --deployment agents/reading/deploy/examples/preview.json \
  --input-url https://claude.dev/blog/building-effective-agent-automations/
```

预览生成入口：

```sh
npm run reading -- run \
  --deployment agents/reading/deploy/examples/preview.json \
  --notes-repository /path/to/obs-notes-hub \
  --input-url https://claude.dev/blog/building-effective-agent-automations/
```

真实执行需要独立 scope 的 OSS 凭据、可信全局容量视图、G1 证据、模型凭据及工具镜像。缺失时明确失败；不能使用修改配置验证标志的方式替代实际检查。模型首选为用户指定的 `deepseek-flash`，SDK 使用 DeepSeek Anthropic 兼容入口；通过 `DEEPSEEK_API_KEY` 注入宿主凭据。

`scheduled --input-url` 为正式人工提交；`resume --project-id` 和 `publish-only --project-id` 只处理既有正式项目；预览续跑使用 `preview --preview-id`。所有正式与预览写入共享 Actions writer concurrency，CLI 本地开发不授权多个云端 writer。

## 测试环境

环境准备步骤见 [test environment setup](docs/runbooks/test-environment-setup.md)，部署与暂停恢复见 [deployment](docs/runbooks/reading-deployment.md)、[operations](docs/runbooks/reading-operations.md)及 [recovery](docs/runbooks/reading-recovery.md)。

通过代码原生适配器与隔离 OSS 前缀验证存储协议的命令为：

```sh
npx tsx agents/reading/evals/storage/oss-probe.ts
```

探针从宿主环境读取 OSS 配置和凭据；具体变量见该探针与存储恢复手册。凭据不得传入图形／浏览器容器或写入仓库。真实 GitHub、模型、RAM 和图床测试按各自门槛使用独立资源；跳过的 live 测试保持未验证状态。
