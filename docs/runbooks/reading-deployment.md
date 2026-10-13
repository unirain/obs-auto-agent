# Reading Agent 部署与权限

状态：实现入口已提供；真实 RAM、GitHub App、模型实际 query 与图床未验证。示例配置不是已上线证据。用户已提供私有 Standard bucket `obs-agent`，北京公网 endpoint `oss-cn-beijing.aliyuncs.com`、公共访问阻止开启；生命周期、版本控制从未开启和凭据权限仍必须通过真实探针验证。

## 三个可信绑定

- `agents/reading/deploy/examples/production.json`：固定 production scope、`obs-notes-hub/reading`、`unirain/obs-notes-hub`、`reading/production/`。
- `agents/reading/deploy/examples/preview.json`：preview scope，每个 preview_id 独立 workspace；只有 `reading/preview/` 写入、模型和笔记只读权限，没有正式图床、目标仓库 App 或 Issue 密钥。
- `agents/reading/deploy/examples/integration.json`：独立 production scope `obs-notes-hub/reading-integration`、`reading/integration/`、专用图床 `reading-agent/integration/` 和测试仓库。禁止使用正式目标仓库。

所有配置字段由 `parseDeployment` 校验，不接受任意 extra 字段。凭据仅引用环境变量名；不要在配置中写密钥。示例 `private_verified=false`、`lifecycle_verified=false`、`versioning_verified=unknown` 防止用未验证声明开始真实运行。探针获得证据后才调整这些字段；宿主仍读取实际 bucket 配置，不能用配置标记代替服务核验。

## 六类能力与 Secrets

| 身份 | 权限 | 禁止 |
| --- | --- | --- |
| workspace 管理器 | 本 scope 前缀 List/Get/禁止覆盖 Put；读取 ACL、版本控制、生命周期与 bucket policy | 修改 bucket 配置；删除 commits；跨 scope 写入 |
| preview | 预览前缀同上、模型调用、笔记库只读 | 正式前缀写入、图床、目标仓库写入、Issue 写入 |
| 容量清单 | 所有受管私有与图床前缀的对象／历史版本只读清单 | 对象正文读取、写入与删除；成为模型工具 |
| 图床 uploader | 本系统专用前缀 Get/Put；版本历史核算 | 其他图片前缀、私有 workspace、任意同键覆盖 |
| Publisher App | 测试或正式绑定的目标仓库 Contents read/write、Pull requests read/write、Metadata read | 自动合并、实现仓库规则写入；不授予模型 |
| watchdog | 实现仓库 Actions/Contents read、Issues write、必要 OSS 提交和报告只读 | workspace 写入、模型、图床、目标笔记仓库写入 |

分别配置 `reading-preview`、`reading-production`、`reading-integration`、`reading-watchdog` GitHub Environments。工作流首先在无 Secrets 步骤校验模式，随后只给对应宿主步骤注入本身份的环境变量。App 凭据环境变量为 JSON `{ "app_id": "...", "installation_id": 123, "private_key": "PEM..." }`，不输出解析结果。OSS 环境变量为 JSON `{ "accessKeyId": "...", "accessKeySecret": "...", "stsToken": "..." }`；STS 可省略。凭据应通过本机受保护环境／GitHub Secrets 注入，不通过聊天发送。

RAM 由用户在现有账号配置，不由程序创建资源。每个身份需记录 Allowed/Deny 验证结果，包含 List 所需 bucket 范围、GetBucketVersioning/GetBucketACL/GetBucketLifecycle/GetBucketPolicy。对提交前缀明确拒绝 DeleteObject；GC 仅能删除经过保护引用计算的 blobs/manifests。preview 对正式前缀 Put/Delete、Publisher 对非目标仓库写入必须实际返回拒绝。列举权限要通过 bucket 与 prefix 条件限制；记录所用 RAM policy 的非秘密哈希及真实测试结果，不把本地 mock 当权限验证。

## 实际前置检查

1. `npm ci && npm run typecheck && npm test && npm run build`。
2. 配置非秘密生产／预览／集成样例；选择隔离测试 App 安装与仓库，配置独立密钥引用。
3. 用 `npm run reading -- verify-storage --deployment <trusted-json>` 验证真实 bucket。仅 `NoSuchKey` 表示缺对象，403、超时、bucket 不存在都不能触发空初始化。
4. 验证 workspace 版本控制从未开启、私有 ACL、匿名不可读、无会删除提交或引用资源的生命周期规则、使用公网 HTTPS 原生 endpoint。不要修改 bucket 设置来让测试通过。
5. 核对图床版本状态与唯一写入约束。禁用版本控制时实测禁止覆盖；开启或暂停时需专用前缀唯一可信 writer，上传稳定键加完整 SHA-256，同键内容只能复用。历史版本计入共享容量。未知状态不能上传。
6. App 安装仅有预期仓库；实测读取 open/closed/merged PR、确定性 commit、分支、PR 和后续检查是否触发。验证工具容器进程无法看到上述密钥。

官方 API 行为需要真实服务 spike；安装包声明和原生 Git 哈希测试只证明本地类型及对象构造。本地核对依赖为 `@octokit/rest`、`@octokit/auth-app`、`ali-oss` 的固定 lockfile。工作流 action 已按来源固定：[checkout 4.2.2 commit](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683)、[setup-node commit](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020)。

环境准备分步操作见 [test-environment-setup.md](test-environment-setup.md)，包含现有 bucket 的限定 RAM 策略生成器、测试 GitHub App 和 DeepSeek 可信兼容 endpoint。
