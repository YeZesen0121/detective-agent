# P5：媒体 UI 并行接入准备与恢复接口

2026-10-25。用户要求P继续，并提供可直接转发给W/E的截图、伴读、音频UI任务；真实调用先核对授权。UI继续独立。

## 当前代码及写入范围

起点 `0c01daddd9ed2bdc0341c66a2bf3d64777597b2b`，P工作树干净；主目录仍有原`.gitignore`和77项UI在途文件，保留不提交。P新增代码提交 **`1b17cebff761257f174d926488830dcff46d0ccb`**。

仅新增 `src/shared/experience-recovery-http.ts`、`src/server/platform/experience-recovery-http.ts`，app注册；新增平台恢复测试、扩充已有experience HTTP集成测试及runtime文档。不修改W/E业务、UI、依赖、数据库schema，不回退已接收成果。

## 本轮补齐的缺口

原平台有持久提交映射，但客户端若丢失POST响应就不知道资源ID；只有带ID的GET无法恢复。添加：

1. `GET /api/v1/investigations/:id/media-submission?operation=attachment|companion|turn|audio`，带原`Idempotency-Key`。同会话/案件/操作过滤，返回公开ID；附件另返回deleted墓碑。没有匹配为`submission:null`，仅代表此刻未见提交，**不授权自动重发**。不返回原请求、key、hash或供应商信息。
2. `GET /api/v1/results/:id/companions?after=...`：固定版本的历史发现；每页最多50、nextAfter/null，包含原session/voiceId/updateNotice。
3. `GET /api/v1/companions/:id/turns?after=...`：问答历史，包括queued/running/失败/取消；每条turnId、原question、createdAt和TurnView。游标稳定，不能用数组下标推导；已发现的非终态继续用单条GET刷新，翻页游标不是事件流。

三个路由不依赖运行中的体验宿主，不创建任务或预算、不重放unknown。复用现有SQLite表与权限；原HTTP契约0.1.0保持，新增schema是可选增量。查询均no-store。生产仍未配置真实视觉/TTS，生成不可用不能被这些读取接口掩盖。

## 实际验证

- 新文件5项先运行均失败（缺路由404），实现后5/5通过：四类key恢复、分页51条、跨会话/案件及schema校验、重复内容上传与删除墓碑、关闭重开无runtime通过真实监听端口/native fetch恢复。
- 另增1项Fastify inject路由集成：实际E文字/语音工厂＋P宿主＋SQLite＋controlled_fixture provider，分别POST伴读/问答/音频后仅凭原key找回；反复GET后模型2次/TTS1次不增长。
- 最终当前代码：`npm test` **53文件514/514通过**，无失败/跳过；`npm run typecheck`退出0；`npm run build`退出0，Vite129模块；`git diff --check`退出0。
- 过程中首轮typecheck发现Zod pipe输入类型TS2345；改为`z.coerce.number<string>()`后重新typecheck/build通过，没有关闭校验。
- 独立只读审查：Critical/Important/Minor均0；独立恢复5/5、experience HTTP14/14、typecheck0。区分inject集成和native-fetch真实本地HTTP；二者都不是供应商实测。
- 本轮未改浏览器代码，不重复宣称媒体UI完成。上一轮桌面Edge13项只是历史证据，本轮W新增浏览器场景尚待执行。
- 主目录安全快进至1b17ceb后，独立重新执行53文件514项/typecheck/build/diff-check均通过；原77项UI在途文件SHA256一致，未擅自提交。后续仅文档提交发布任务包，代码基准保持固定。

## 预算核对

已读需求澄清Q14/Q27：初始300元、独立演示预留，未给无限支出或代购授权。已读truth-live-20261024-01计划与结果：限定0.10元、搜索/读取/模型各1次已执行，总3次，账本保守计量0.034604元，实际账单未知。不能把300减去此数当已确认可用余额。

本轮是离线媒体接线准备，**真实供应商0次、费用0、未读取凭据**。旧truth campaign不扩展到视觉/TTS；P交互5元/2万字符只是工程cap。W/E任务明确0次真实调用。真实阶段由P在现有授权范围内另立有限campaign并核对金额、次数、价格/音色身份、既有用量和unknown，未满足则保持关闭，不要求用户重复回答产品需求。

## 并行派发与验收边界

见 [分发入口](../协作交接/媒体UI接入/00-分发说明.md)、[W任务](../协作交接/媒体UI接入/W-媒体功能接入UI.md)、[E任务](../协作交接/媒体UI接入/E-媒体内容与可播放验收材料.md)。W先API/截图，再伴读/播放器；E并行语义材料/可解码MP3。两路无强制先后，P唯一总集成，UI继续独立视觉方案。

仍未完成：W媒体组件和浏览器播放；E新跨层素材验收；真实视觉/TTS transport与价目/音色配置；I完整模式与补查接入；真实手机/听感/部署及完整产品AC。不能用占位提示音、fixture或本轮514单测覆盖这些验收。
