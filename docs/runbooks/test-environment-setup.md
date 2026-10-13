# 准备隔离测试仓库、App、图床与 RAM 身份

这份手册用于准备已有账号内的隔离验收资源，不自动创建云资源或开启正式 cron。已知私有 workspace bucket 是 `obs-agent`，地域北京，endpoint `oss-cn-beijing.aliyuncs.com`。保持私有与“阻止公共访问”；图片使用另外的公开图床。现有 AccessKey 只完成基础探针，不代表以下隔离权限已通过。

## 1. 建一个专用 GitHub 测试仓库

在 `unirain` 账号下新建 **`obs-reading-agent-test`**（建议名，目前未自动创建），选 Private，初始化 README，默认分支 main。这里接收测试笔记、分支、PR 和监控 Issue；正式 `obs-notes-hub` 不参与故障注入。

本地复制 `agents/reading/deploy/examples/integration.json` 到受保护的非秘密配置文件，将：

```json
{
  "target_repository": "unirain/obs-reading-agent-test",
  "implementation_repository": "unirain/obs-auto-agent",
  "watchdog_repository": "unirain/obs-reading-agent-test"
}
```

分别合并到完整配置。implementation_repository 是可信代码、最新策略和 Actions 读取来源；watchdog_repository 是测试 Issue 写入目的地。它们含义不同。workspace 保持 `obs-notes-hub/reading-integration` 和 `reading/integration/`，scope 保持 production；这是一套独立测试部署，不是把 preview 升级为 production。

## 2. GitHub App 只安装到测试仓库

进入 GitHub 头像 → Settings → Developer settings → GitHub Apps → New GitHub App。App name 取账号内唯一名，例如 `unirain-reading-test`，Homepage URL 填测试仓库 URL。程序只用 API，无 webhook 接收服务，取消 webhook 的 Active；无 OAuth callback 需求。App 仅本账号可安装。

Repository permissions 设置 **Contents: Read and write**、**Pull requests: Read and write**；Metadata read 为必要基础权限。不要授予 Administration、Workflows 或分支保护绕过；不启用自动合并，发布程序不提供 merge API。保存后 Install App → `unirain` → **Only select repositories** → 仅 `obs-reading-agent-test`。权限设计需对照 [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)。

记录 App ID（不是 Client ID）和 Installation ID；安装详情页面 URL 中的安装编号可定位 Installation ID。App 设置的 Credentials → Key pairs → New key 后下载 PEM（部分界面显示 Private keys → Generate a private key）；按 [GitHub private key 文档](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps) 保存到受保护本机目录，不提交 Git、不贴聊天。通过本地脚本读取 PEM 并生成 JSON，避免手动破坏换行：

```python
import json
from pathlib import Path
pem = Path('/absolute/protected/path/test-app.pem').read_text()
Path('/absolute/protected/path/test-github-app.json').write_text(json.dumps({
    'app_id': '填 App ID',
    'installation_id': 12345,  # 填实际 Installation ID
    'private_key': pem,
}))
```

给该 JSON 文件限制仅当前用户可读，添加到 GitHub `reading-integration` Environment 的 Secret **`TEST_GITHUB_APP`**。本地测试则把 JSON 内容通过受保护环境注入同名变量；运行器负责生成 installation token，不需要手工保存长期 token。

测试 watchdog 使用独立身份：可另建仅 **Issues: Read and write** 的 App，也只安装到同一测试仓库，Secret 名为 **`TEST_WATCHDOG_GITHUB_TOKEN`**（支持 token 或相同 App JSON 格式）。实现仓库的策略和 Actions 使用另一个只读 token：**`READING_REPOSITORY_READ_TOKEN`**，需要实现仓库 Contents/Actions read，以及 notes skill checkout 的 Contents read；若两仓库不在同一权限范围，应按用途分别准备身份。正式 watchdog 后续可用实现仓库工作流自带 `GITHUB_TOKEN`（Contents/Actions read、Issues write），不会将其用于测试仓库写入。

## 3. 给图床一个测试前缀

选现有公开图片 bucket，记录 bucket 名、region、公网 endpoint、公开 URL 根地址、版本控制状态。**不要把 `obs-agent` 改成公开 bucket。** 如果现有 bucket 不适合专用前缀隔离，可手动准备独立公开图片 bucket；程序不会代建。

示例配置统一采用 **`reading-agent/integration/`**。将 integration.json 的 image 更新为真实值，例如：

```json
{
  "bucket": "填已有公开图片 bucket",
  "region": "oss-cn-beijing",
  "endpoint": "oss-cn-beijing.aliyuncs.com",
  "prefix": "reading-agent/integration/",
  "public_url": "https://已有图床域名",
  "credential_ref": "OSS_TEST_IMAGE_CREDENTIALS",
  "sole_writer_verified": false,
  "versioning": "unknown"
}
```

public_url 是 bucket/CDN 的根地址，适配器自行追加完整对象 key，不要再追加一遍 prefix。如果没有自定义域名，可使用 bucket 的原生 HTTPS 图片访问域名；须实际验证该地址可以匿名读取测试图片。地域不在北京时 region 与 endpoint 一起改成实际值。

仅在核实此前缀由本程序独占写入、版本状态及匿名访问后记录对应 verified 配置和证据。禁用版本控制时实测 `x-oss-forbid-overwrite`；已开启或暂停时必须保证此前缀唯一 writer，且容量包含全部历史版本。对外只暴露最终测试图片，不暴露原文、模型回执、状态或配置。完整内容哈希进入键，响应丢失先读回，同键不能覆盖。

## 4. 建五个限定 RAM 用户或角色

先用 RAM 用户方式完成测试最直接；每个身份只绑定对应自定义策略，不附加 AliyunOSSFullAccess，也不复用主账号 AccessKey。RAM Console → 身份管理 → 用户 → 创建用户（用于 OpenAPI）→ 添加自定义权限。策略列表 → 创建权限策略 → 脚本编辑 → 粘贴下列生成文件。步骤见 [创建 RAM 用户](https://help.aliyun.com/zh/ram/user-guide/create-a-ram-user) 与 [OSS RAM Policy](https://help.aliyun.com/zh/oss/user-guide/ram-policy/)。

先在本机生成替换过真实图片 bucket 的文件：

```sh
npx tsx agents/reading/deploy/ram/generate.ts --image-bucket 实际图床bucket --out /absolute/local/ram-policies
```

生成器只写本地 JSON，不调用阿里云。仓库模板中的 `configure-image-bucket` 是占位符，不能原样授权。路径与示例部署一致，若改前缀应同步修改 generator 的非秘密 bindings 并重新检查。

| 专用身份 | JSON 策略 | 环境变量 Secret | 用途 |
| --- | --- | --- | --- |
| reading-preview | preview-workspace.json | OSS_PREVIEW_CREDENTIALS | 只写 `reading/preview/` |
| reading-test-workspace | test-workspace.json | OSS_TEST_CREDENTIALS | 只写 `reading/integration/`，不删 commits |
| reading-test-images | test-image.json | OSS_TEST_IMAGE_CREDENTIALS | 只写图床 `reading-agent/integration/`，不含私有 workspace 权限 |
| reading-capacity-readonly | capacity-readonly.json | READING_CAPACITY_VIEW_CREDENTIALS | 列举所有受管 scope／图片历史版本、读取容量预留控制记录；不写 |
| reading-test-watchdog | test-watchdog-readonly.json | READING_MONITOR_OSS_CREDENTIALS | 读取测试提交链、来源事件与运行报告；不写 |

ListObjects 使用 bucket Resource 并通过 `oss:Prefix` 条件限制目录；GetObject/PutObject 使用对象 Resource。策略单独授予 bucket ACL/versioning/lifecycle/policy 读取，不授予配置修改。workspace 删除权限只允许 blobs/manifests，并显式拒绝 commits 删除。图床与两个 readonly 身份显式拒绝写入／删除。图片历史清单额外需要 [ListObjectVersions 权限](https://help.aliyun.com/en/oss/developer-reference/list-object-versions)。

注意当前协议将控制记录与证据存为内容哈希 blobs，RAM 静态 prefix 不能按“文件角色”区分这些 hashes。容量和 watchdog 宿主只读经过 HEAD manifest 确认的控制 blobs，不读取无关证据；这些身份的密钥不得注入模型或工具容器。若要求 IAM 层也无法读其他 blob，需要根据已验证 manifest 签发只含精确控制 blob keys 的动态 STS 权限；不能把静态模板宣称为已经实现这种更细粒度隔离。

每个 OSS Secret 保存 JSON：

```json
{"accessKeyId":"RAM 用户的 AccessKey ID","accessKeySecret":"RAM 用户的 AccessKey Secret"}
```

使用 STS 时增加 `"stsToken":"临时 SecurityToken"`。凭据只放 GitHub Environment Secrets 或本机受保护环境；配置文件只保留引用名，不能把 JSON 密钥提交到仓库或发聊天。

## 5. 如需 STS，按身份签发临时权限

已有 RAM 身份可以改成 RAM role：创建“阿里云账号”可信实体角色，将相应角色策略绑定；只给凭据签发者对这个角色 ARN 的 `sts:AssumeRole` 权限。使用账号内可信凭据服务／本机工具调用 AssumeRole，拿到 AccessKeyId、AccessKeySecret、SecurityToken 与 Expiration，再按上面的 JSON 字段注入宿主。Session policy 可进一步缩小范围，但不能扩大 role 本身权限。流程参照 [创建 RAM role](https://help.aliyun.com/zh/ram/user-guide/create-a-ram-role-for-a-trusted-alibaba-cloud-account) 与 [AssumeRole API](https://help.aliyun.com/zh/ram/developer-reference/api-sts-2015-04-01-assumerole)。

临时 token 过期会停止读写；不要把一份短期 token 永久填入每天运行的 Secrets 后期待自动续期。持续云端运行需要可信签发机制（后续可配置 GitHub OIDC federation），或先用限定 RAM 用户 AccessKey 进行隔离验收；当前项目不会偷偷回退为主账号全权限 key。

## 6. 配置全局容量只读清单

`READING_CAPACITY_VIEW_CREDENTIALS` 的 JSON 在 readonly Key 字段之外，还需包含 `bindings`；它覆盖生产、preview、integration 和受管图床的所有真实前缀，合计共用 50 GB。首次没有生产产物也需列出其受管 scope：

```json
{
  "accessKeyId": "只读身份 ID",
  "accessKeySecret": "只读身份 Secret",
  "bindings": [
    {"kind":"workspace","scope":"production","bucket":"obs-agent","region":"oss-cn-beijing","endpoint":"oss-cn-beijing.aliyuncs.com","prefix":"reading/production/"},
    {"kind":"workspace","scope":"preview","bucket":"obs-agent","region":"oss-cn-beijing","endpoint":"oss-cn-beijing.aliyuncs.com","prefix":"reading/preview/"},
    {"kind":"workspace","scope":"integration","bucket":"obs-agent","region":"oss-cn-beijing","endpoint":"oss-cn-beijing.aliyuncs.com","prefix":"reading/integration/"},
    {"kind":"image","scope":"images","bucket":"实际图床 bucket","region":"实际 region","endpoint":"实际公网 endpoint","prefix":"reading-agent/integration/"}
  ]
}
```

若还有本系统受管正式图片前缀，追加绑定并同步授予对应只读 ListObjectVersions 权限。不能漏掉历史版本、将未知清单当零，或给多个 scope 分别 50 GB。不要复制本文示例作为已验证容量声明。

## 7. DeepSeek 模型凭据

当前用户选择 `deepseek-flash`。deployment 使用 `model_provider: deepseek`、`model_base_url: https://api.deepseek.com/anthropic`、`model_credential_ref: DEEPSEEK_API_KEY`，与 [DeepSeek 官方 Anthropic 兼容 API](https://api-docs.deepseek.com/guides/anthropic_api/) 一致；因此继续保留 Claude Agent SDK。该 endpoint 只能来自可信部署配置，不能由输入文章或模型指定。已有只读模型清单探针不代表付费 query、工具调用和恢复契约已验证。

将 DeepSeek Key 保存到对应 GitHub Environment Secret `DEEPSEEK_API_KEY`。它只进入可信宿主的模型适配器，不进入 Docker build、工具容器、OSS state、PR 或日志。模型费用仍为 observe_only；没有金额上限不拒绝运行，usage 或价格未知不能记录成零。实际 SDK query 必须在 G1 真实隔离证据通过后、拥有 committed invocation intent 才启动。

## 8. 验证后交给真实测试入口

把 integration 完整非秘密配置文件路径、测试仓库名、App ID/Installation ID、图片 bucket/域名/版本状态和 RAM 身份用途记到本机部署记录。只提供路径和非秘密配置给协作聊天；密钥留在 Secrets。

真实测试逐身份验证 Allowed 和 Denied：preview/test key 不能写正式前缀；图床 key 不能读私有 workspace；容量/watchdog 不能 Put/Delete；workspace key 不得删除 commits。期望拒绝需以真实 403 为证据，不能由本地 wrapper 假装证明 RAM 已拒绝。

`verify-storage` 验证真实服务配置；`READING_LIVE_DELIVERY=1` 和 `READING_LIVE_IMAGES=1` 加 `READING_LIVE_DEPLOYMENT=/absolute/path/integration.json` 才执行对应 live spike。完整 G3/G4/G5 仍须计划规定的真实模型、PR/Issue 故障恢复和质量确认。正式 cron 保持关闭。

## 9. 图片清理另用第六个 RAM 身份

`test-image-gc.json` 仅允许指定测试图片前缀的 GetObject/DeleteObject/DeleteObjectVersion 和必要元数据/版本清单读取；明确不允许上传，不允许私有 workspace 删除。给独立 RAM 用户/角色绑定该策略，Secret **`TEST_IMAGE_GC_CREDENTIALS`**；正式后续另建身份并使用 **`READING_IMAGE_GC_CREDENTIALS`**。不要把 `OSS_TEST_IMAGE_CREDENTIALS` 或当前基础探针 key 自动当清理身份。

确认专用前缀、唯一 writer 与版本状态后，在共享 writer 互斥下使用可信 `maintenance` 入口。无引用证明、无归属、仍在 HEAD/活跃/待审/已合并/unknown 路径上的图片不会删除。实际允许/拒绝和 DELETE 回读需在隔离对象验证；这些 JSON 模板与本地测试不证明 RAM 已配置。
