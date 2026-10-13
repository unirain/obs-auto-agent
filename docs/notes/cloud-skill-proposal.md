# Cloud skill 适配提案与验证

2026-10-13。提案基于目标笔记库固定提交 `edb8abf75690dae7fb9244c46cfe6d09babfe912`，保留其新长文规范。原笔记库 HEAD 未改变；未向目标远程仓库推送。

- 适配补丁：`agents/reading/tools/obsidian-note-cloud.patch`。
- 本机隔离 Git 仓库：`.reading-local/cloud-skill-proposal`；提案 commit：`38589ebab14db0156ae51d3d7c9fec90402fcaef`。
- 改动仅为四个 skill 文件新增内容：obsidian-note/SKILL.md、diagram-playbook.md、fireworks-tech-graph/SKILL.md、reading-agent-cloud-contract.json。既有正文、long-form-structure.md 和渲染脚本不改。
- 三个规范入口共享版本 marker；固定 JSON 契约列真实写作／审校工具、SVG 图源及 PNG 图片能力。提到 VAULT_ROOT 不再构成已适配的证据。受信任写作提示词明确声明 reading_agent_cloud。

写作使用固定研究包和现有受控工具。输出由控制器保存与上传；没有本机 Chrome、PicGo、任意文件写入或安装命令。审校仅可读取 Writing.resources 的真实字节，校验路径、SHA、MIME，并保存资源清单绑定的独立像素读取回执；写作视觉回执不能替代审校。

实际 Linux 容器已从该固定 commit 物化两个只读 skill 入口，运行 doctor、结构检查、中文 PNG 渲染、浏览器 fixture 和隔离检查。图像中文字、箭头、图例及边界清晰，无截断；这是技术 fixture 的代理视觉检查。机器证据在 `agents/reading/evals/runtime/evidence/cloud-skill-proposal-20261013.json`，原报告与 PNG 在 ignored `.reading-local/linux-cloud-skill-proposal/`。

这不是 G2 完成证据。真实 SDK skill 激活、文章写作与模型审校、Obsidian 质量及用户验收仍未执行。GIF 等可选能力没有被静态 PNG 测试证明。提案尚需进入目标库受审阅的固定版本；部署仍消费目标库的已发布 Git commit，不能将本机提案 SHA 冒充可由远端 checkout 取得的版本。

2026-10-13 只读核对[DeepSeek 官方图像文档](https://api-docs.deepseek.com/zh-cn/guides/vision/)：所选 deepseek-flash 声明支持图片及 Anthropic 兼容入口。该文档支持保留当前模型选择，不替代真实 SDK 工具图片传输和质量验收。

本机可核对差异：

```sh
git -C .reading-local/cloud-skill-proposal diff edb8abf75690dae7fb9244c46cfe6d09babfe912 38589ebab14db0156ae51d3d7c9fec90402fcaef -- .agents/skills
```
