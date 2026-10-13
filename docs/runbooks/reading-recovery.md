# Reading Agent 恢复与交付冲突

## 判定顺序

先恢复 validated consecutive immutable OSS chain。列举失败、403、哈希不符、序号缺口、未知 schema 或读超时都停止；不得按最后更新时间选 HEAD、跳序号或重新初始化。保存最后已确认快照和错误，检查原 fixed commit key 的读回结果。

Publisher 首先对账项目全部历史 delivery：机器标识、所有版本分支、expected commit、open/closed/merged PR 与完整 diff。读失败保留 publishing 和 uncertain_action。已存在 PR 即补事实：open 保持待审不重写；closed_unmerged 不当作入库、不自动重提；merged 从默认分支读取实际笔记建立索引，不用生成副本推断。

| 持久状态／外部事实 | 恢复动作 |
| --- | --- |
| PR 写成功、返回或 OSS 回执丢失 | 查稳定 delivery/project 标识，复用原 PR；不重研、不再建 PR |
| 只有 expected commit，无 branch | 核对 base、tree、expected SHA 与完整新增 diff；仍获准才创建缺失 branch |
| 只有正确机器人 branch、无 PR | 全历史无其他 PR、完整 diff 匹配、许可仍有效才续建 PR |
| branch SHA 不同、额外文件或人工修改 | delivery_conflict；人工处理，不强推、不覆盖、不删旧分支 |
| 当前默认分支同名文件或同来源已入库 | delivery_conflict／去重；禁止覆盖或重复 PR |
| GitHub 无法读取或远端写入不确定 | 保持 publishing；不建立替代 generation/delivery，不删除资源 |
| 已核实无 PR／无未决写入，材料核验超过 24 小时 | needs_resume；publish-only 不调模型。resume 重新核验来源 |
| 核验材料未变 | 保留正文与 generation，新的不可变 delivery 仅刷新核验时间，旧 superseded；完整匹配旧 branch 可复用 |
| 材料影响结论的变化 | 更新证据、增加 generation、重写重审；旧分支保留，不强推 |
| 当前策略暂停／不可读 | 只读对账并保存已发生事实；不补上传、对象、branch 或 PR |
| 分类失效 | 明确无远端未决结果后回运行时；执行许可允许才受限 classify_only |

刷新前需证明全部旧 delivery 无 PR、无未决写入；每项目只允许一个活跃交付，新发布前再次检查旧版本是否被人工建 PR。不要把“GitHub 查询失败”当“没有 PR”。一次流程中途暂停后不能补写余下步骤。解除限制沿用固定生成 context；不自动关闭／重写已存在 PR。

## 图片与容量

图片键为专用前缀 + project + 固定首次生成日期 + 描述命名 + 完整 SHA-256。上传前先提交 reservation/intent，再写；响应丢失按同键读回。未知读回或公开 URL 无法核验时保留预留；同键大小、MIME、哈希不符停止。确认回执后资源进入共享账本，重复同内容不重复计量。生成变化使用新键，旧 PR 与已入库图片维持原 URL。

清理仅用 S GC 的保护引用与宽限期规则：HEAD、活跃项目、待审、已合并、结果不明和预留资源均保护。提交记录永久保留。容量不足或无法统计时暂停新增、保留候选；不得分别向正式、preview、图床各分配 50 GB。控制事实的保留空间受同一总额度约束。

## 代码回滚

回滚受信任程序版本前检查当前 schema 兼容；恢复读取与只读对账必须支持已发生事实。不能回退 workspace HEAD 抹去模型消耗、外部 PR 或图片回执。更新日志记录原代码／新代码 commit、配置哈希、恢复前后 revision、受保护资源、外部事实和下一步，绝不记录 Secrets。
