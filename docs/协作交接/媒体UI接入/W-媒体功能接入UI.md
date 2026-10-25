# 给 W Agent：截图、伴读和音频接入 UI

这是可直接执行的开发任务。用户转发即派发给唯一 W 执行者；你独立实现下述工作，不重新询问已确认需求，不等 E 或最终视觉稿。P 继续总集成，UI 独立决定视觉。

**Goal:** 用户可以在现有工作台上传截图后启动调查、阅读固定版本伴读、打断追问、听取/停止已有音频，并在刷新/断线后恢复真实状态。

**Architecture:** 现有 HTTP schema → W API → 可测 controller → 独立媒体 React 组件 → main 功能接线。业务数据和收费任务由 P/E 提供；不在前端编造报告、生成结果、通知或音色。

**Tech Stack:** Node 24.19.0、npm11.17.0、React/TypeScript/Zod、Vitest、Playwright。使用 executing-plans / test-driven-development / verification-before-completion；用现有 ui-ux-pro-max 辅助功能可用性检查，不重设计整站。

**Spec:** README、AGENTS、PRD v1.0 §7/8及AC06/AC10/AC15、系统实施设计、实施接口契约、并行任务包、`docs/伴读角色生成与交互适配.md`；需求优先于早期研究建议。

## 基准与所有权

- 固定代码 SHA `1b17cebff761257f174d926488830dcff46d0ccb`；包含已接收 W/UI acfd9aa、E f63365a、P5。完整 merge，不只取最后文档。不重做已关闭WUI返修。
- 使用自己的分支/工作树，建议 `codex/w-media-ui`；不得在 P/主目录切分支。已有在途工作先检查保存，不 reset/clean。新依赖、shared/server/migrations、根配置由 P 修改。
- 可写：`src/web/api/`、`src/web/controllers/`、`src/web/model/`、`src/web/ui/media/`（新增）、`src/web/main.tsx`（只做功能接线）；`tests/web-model/`、`tests/ui/media-*.spec.ts`（新增）、`docs/runtime/W-媒体UI交付.md`。
- 不改 `workbench.css`、`integration.css`、设计稿/归档、其他现有 UI 组件的视觉方案；需要证据展开时复用 ResultView 或在 media 内适配。必要公共变更写给 P。UI 会继续独立推进。
- 默认生产无体验 transport/价格/音色，POST 503 是合法状态。不得注入 fixture 让生产“看起来可用”。测试材料必须写 controlled_fixture。
- 本轮真实 API 授权 **0 次 / 0 元**，不读凭据。所有工程额度都不是付费授权。

## 实际接口（已实现，不必等待）

先读 `src/shared/experience-http.ts`、`experience-recovery-http.ts`、`contracts.ts`、`runtime-http.ts`；P3接口补充可查完整表。路径前缀 `/api/v1`，JSON均 `{data,meta}`，cookie同源，写操作Origin，POST调用方持有原幂等键。

|功能|方法 / 路径|关键请求与返回|
|---|---|---|
|附件|POST/GET `/investigations/:id/attachments`|POST FormData 单个 `file`，201 AttachmentPublic；GET `{items}`|
|删图/原图|DELETE `/investigations/:id/attachments/:attachmentId`；GET `/attachments/:id/content`|204 / 鉴权二进制；不能套JSON parser|
|创建伴读|POST `/results/:id/companions`|`{personaId:'default'}` →202 companionSessionId/status|
|发现伴读|GET `/results/:id/companions?after=...`|`CompanionHistoryPageSchema`：items为CompanionView，50/页，nextAfter或null|
|伴读/游标/收尾|GET/PATCH `/companions/:id`|GET session/voiceId/updateNotice；PATCH `{cursor?,ended?}` 返回CompanionSession|
|追问|POST `/companions/:id/turns`|`{question}` trim后1–2000 →202 turnId|
|问答状态/历史|GET `/companions/:id/turns/:turnId`；GET `/companions/:id/turns?after=...`|TurnView；历史items=`{turnId,question,createdAt,view}`，50/页|
|余额/音色|GET `/investigations/:id/interaction-budget`；GET `/voices`|只读；configured:false和voices=[]均正常|
|生成音频|POST `/companions/:id/audio`|`{segmentId,voiceId,speed:0}` →202 audioJobId；不能传text|
|音频状态/取消|GET `/audio-jobs/:id`；POST `/audio-jobs/:id/cancel`|AudioManifest；取消是幂等动作，保存块仍保留|
|音频字节|GET `/audio-assets/:id`|鉴权MP3，200/206/416，单Range/If-Range；不公开路径|
|丢响应恢复|GET `/investigations/:id/media-submission?operation=attachment\|companion\|turn\|audio`|请求头原 `Idempotency-Key`；MediaSubmissionViewSchema，submission为null或已存公开ID|

恢复返回 attachmentId/deleted，或 companionSessionId/resultVersionId，再加turnId或audioJobId。**null只是当前未见提交，不证明POST不会迟到**。禁止据此自动重发/换key。GET不启动生成；音频费用unknown时显式新key仍可能409，不能循环换key。

## W-A：API、提交恢复与截图（优先独立交付）

**文件：** 新建 `api/experience.ts`、`controllers/media-submission.ts`、`controllers/attachments.ts`、`ui/media/AttachmentsPanel.tsx`；测试 `tests/web-model/media-api.test.ts`、`media-attachments.test.ts`。

**接口：** 导出 `createExperienceApi(transport:typeof fetch)`，所有JSON返回类型由shared schema推断；attachment/companion/turn/audio动作传入key和AbortSignal。导出 `createAttachmentController({api,...})`，管理caseId、附件列表、每次上传的pending/unknown/confirmed/failed和原key。具体私有类型可自行选择，不能改公共HTTP。

- [ ] 写失败回归：同图不同key不合并；同动作双击只发一次；上传response丢失凭key GET恢复；GET null仍unknown；跨案件迟到响应丢弃；204删除不触发JSON错误。
- [ ] 实现同源API，复用client安全错误/校验；FormData不手写boundary；附件/音频ID生成URL前验证；空响应和二进制独立处理。上传期间/unknown禁止start；abort本地读取不等于服务器取消。
- [ ] 调整main当前“create后立刻start”：先保存案件draft，再上传最多3图，每图8MiB/合计24MiB，确认服务器列表后显式start。原问题/模式与draft一致；保存后修改输入不能悄悄继续旧案，可明确新建草稿。4千字边界不退回500。
- [ ] 附件可预览/删除/重载恢复，有顺序和逐图状态；释放临时objectURL。真正格式/像素限制仍由P解码确认。start503保留输入和图，不能自动剥离附件启动。
- [ ] 运行定向测试后提交W-A，提供基准→最终完整范围。W-B可在同分支继续。

## W-B：固定版本伴读和打断恢复

**文件：** 新建 `controllers/companion-session.ts`、`ui/media/CompanionPanel.tsx`、`tests/web-model/media-companion.test.ts`；可复用/修正 `model/companion.ts`。

**接口：** controller消费api和固定ResultVersion，提供open/selectCursor/ask/end/refresh/dispose，订阅不可变状态；开新版本由现有result controller显式驱动。`projectCompanion`校验绑定可复用。

- [ ] 写失败回归：刷新先发现同版本伴读不POST；不同case/version响应迟到不覆盖；notice不换正文；历史turn分页不漏失败/在途；patch失败或迟到不冒充游标已保存。
- [ ] 任务开始前允许选择companion presentation；不是调查中切换三模式。结果顶部立即可见结论/未知，3–5段只是阅读路径。无答题门槛、无强制等待音频，继续/跳段/看证据/追问/收尾可用。
- [ ] 生成是明确动作，accepted后GET轮询；poll有退避、dispose/换案取消本地读取。保存最小恢复标识与原key，按session/case/version隔离；401清掉当前恢复状态，不存cookie/私有二进制/原文到公共缓存。
- [ ] 追问先停止播放，展示reply.kind，返回resumeCursor。HTTP TurnView不能伪装CompanionTurnSchema，缺字段不得编造；使用P历史条目或独立HTTP view模型。
- [ ] research_request显示补查方向及未执行状态，不能伪造newRunId或另发无关start；与I/P补查接口接通前给明确暂不可执行反馈，保留文字。不退回重做已完成I任务。
- [ ] 收尾PATCH ended，重新打开已存伴读可显式PATCH ended:false（服务端允许时）；失败保留段落。旧版伴读只提示新报告，打开新版时中断旧轮询/播放器。

## W-C：浏览器播放与音频任务

**文件：** 新建 `controllers/audio-session.ts`、`ui/media/browser-audio.ts`、`AudioControls.tsx`、局部 `media.css`；复用 `controllers/audio.ts` 的epoch/顺序播放；测试 `tests/web-model/media-audio.test.ts` 和 `tests/ui/media-experience.spec.ts`。

- [ ] 写失败回归：play()被浏览器拒绝、下载404/416、partial、切段与旧fetch/play promise迟到、dispose、两次点击。文字始终可读，同一时刻最多一个Audio播放。
- [ ] 实现真实浏览器AudioDriver（满足现有接口）。只用同源授权asset URL；Abort停止加载，stop同步pause并清空旧src/监听器，objectURL如使用则回收。声音不可自动播；由用户手势启动，NotAllowedError显示再次点播放，不重发TTS。
- [ ] 区分“停止播放”（本地）与“取消生成”（平台cancel）。切段/追问/换案先停播，迟到manifest不能自动播放；失败/partial保留已保存块与文字。切音色不能改旧job身份或伪造voiceType；只选GET voices中的可用项。
- [ ] 只按用户显式生成/重试请求；双击singleflight；unknown只读恢复，不能把缓存GET触发成重生成。409 unknown与503未配置均显示安全说明。
- [ ] Playwright连接真实P HTTP/存储/宿主，providers是controlled_fixture。复用现有HTTP fixture方式；若需要修改根启动脚本/配置，提交最小建议给P，不自行修改或等待全部工作。不能只page.route拦截所有核心API再宣称集成通过。

## 验收与参考取舍

必测旅程：三图→上传刷新→显式start（无视觉503也保图）；既有报告→伴读→打断→恢复游标→收尾；旧版notice→显式新版本；音频顺序播放→停播→切段不叠音→错误仍有文字；POST丢响应→GET原key恢复且调用数不增长；跨session404；手机窄屏基本操作。

引用依据写入交付：PRD决定事实/操作边界；伴读参考“结论先出现、段落关联证据、人物口气不改事实”，不搬世界编辑器/答题教学；源码审查P03只借来源展开机制，不按表现模式降低调查质量；当前W epoch controller作为取消/迟到基础，不引入第二套全局状态。

按增量执行定向tests→全量 `npm test`→`npm run typecheck`→`npm run build`→`git diff --check`；浏览器 `PLAYWRIGHT_CHANNEL=msedge` 后 `npm run test:e2e -- --workers=3`，PowerShell用 `$env:PLAYWRIGHT_CHANNEL='msedge'`。测试端口与其他人错开，报告actual counts/失败/跳过。手机模拟通过不能写真实手机；合成提示音不能写真实TTS听感。缺真配置作为未验收，不用fixture顶替。

交付 `docs/runtime/W-媒体UI交付.md`：基准/最终完整SHA、写入文件、场景矩阵、验证命令与退出码、0真实调用、截图或trace路径、公共缺口。提交整个分支交P审查，不推远程、不直接合主目录。
