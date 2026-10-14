# 敏感内容边界

宿主以可信 env 和实际加载的 OSS 凭据构造 `SecretContentGuard` 闭包。模型、工具与 WorkspaceHandle 不接收这个值集合。读取 env 中 JSON 时只登记凭据字段；部署配置中的 credential_ref 名称仍可保存。

Manager 在新文件和控制记录进入任何 blob/manifest/commit 写入前检查内容。恢复的字节在缓存／模型目录物化或惰性读取返回前检查。Publisher 检查文件与对外 metadata；ResourcePublisher 在预留、权限及图床读写前检查图像字节。错误固定为 `Sensitive content is excluded`，不报告匹配到的值。没有自动删词、换 hash、改旧快照或把秘密费用事实改成零的行为。

路径白名单同时拒绝 credentials、auth.json、cookies、私钥／执行文件、dotpaths、scratch、依赖目录和浏览器 profile/cache/local-storage/session-storage/IndexedDB 目录。任务只提交显式文件清单，不递归上传 runner 工作目录。

内容检测覆盖至少八字符的宿主已知凭据、常见整值 JSON 转义／URL／base64 表达，以及私钥和常见 token 形态。它不是能识别任意未知秘密的通用 DLP：未知 cookie 值、任意拆分/加密/隐写及所有编码对齐不能由这个检测器保证识别。主要边界仍是凭据不进入模型与沙箱、浏览器无登录态、明确文件范围和发布前校验。

旧链含敏感内容时保留原 immutable facts 并停止相应恢复/读取/交付。使用宿主受保护入口检查原版本；不要关闭生产 guard、回滚/删 HEAD 或自动脱敏重写来重新启动模型。修复需要独立、可审阅的迁移决定。测试中的不安全 adapter 只用于构造旧本地 fixture。

本地回归：`npx vitest run agents/reading/evals/integration/secret-boundaries.test.ts`。它验证 FileStore、Manager、Publisher、ResourcePublisher 和嵌套凭据收集的真实代码路径；远端 SDK/OSS/RAM 的隔离仍由 G1–G5 单独验收。
