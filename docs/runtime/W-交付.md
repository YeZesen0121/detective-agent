# W 非视觉前端交付

> W1–W4 为上一轮历史证据；本轮 P runtime 接入见文末 W5。W5 发布后以 P 的 `updateNotice:{latestResultVersionId,createdAt}` 和实际 HTTP 接入清单为准，早期私有字段与“无 adapter”描述不再代表最新代码。

任务书：`D:/侦探agent/docs/协作交接/功能并行开发/04-W-UI无关前端逻辑.md` v1.0；用户已明确授权执行 W1–W4，UI 之后另做。

- 基准：`1aaf2d197bdeb7f9987338b6ea6aa2fffc489835`；contractVersion `0.1.0`。
- 分支：`codex/web-headless`；工作树：`C:/Users/111/.codex/worktrees/web-headless/侦探agent`。
- Node `24.19.0`，npm `11.17.0`；`npm ci` 退出 0（201 packages）。
- 基线：`npm run typecheck` 0；`npm test` 0（5 文件/44 测试）；`npm run build` 0。
- 写入范围：`src/web/api/`、`src/web/model/`、`src/web/controllers/`、`tests/web-model/`、本文件。其他工作树与主目录改动不纳入。
- 真实供应商调用 0；费用 0；所有合成数据标记 `controlled_fixture`。未读取主目录 .env。

## 执行账本

按 W1 → W2 → W3 → W4 连续实施，最后独立审查整条分支。

预检：W1 错误模型供 W2 使用；W2 TaskPort 为私有归一化接口，不扩充公共 HTTP；W3 固定版本且独立更新提示；W4 只消费公共 AudioManifest，不依赖真实 Audio/TTS。

W1 完成：先观察缺实现的 13 个断言失败，再实现；`npm test -- tests/web-model/client.test.ts` 退出 0（13/13），typecheck/build 退出 0。使用真实 G0 Fastify 注入验证会话/草稿，浏览器 cookie jar 仅在测试端模拟。生产不读 cookie/存储历史，不重试 POST，不自造幂等键。

W2 完成：17 项缺实现断言失败后实现；补充首次读取期间取消、终态事件重连、取消 401 三个回归均先失败后修复。`npm test -- tests/web-model/task.test.ts` 0（22/22）；typecheck/build 均 0；完整测试 0（7 文件/79 测试）。使用假时钟/受控 Promise，不靠 sleep。

决议：TaskController.follow 的 Promise 在首轮读取/事件分页结束后完成，后续由调度器轮询；终态完整取完事件后停读，若取终态事件失败仍退避重连。取消 401 同样停止轮询。此为私有消费者生命周期，不修改公共契约。

提交身份：本环境无 Git identity；沿用 G0 已有 `Codex <codex@local.invalid>`，仅通过单次 `git -c` 指定，未改个人或根配置。

W3 完成：先运行缺实现测试（13 项中 12 项失败，跨版本拒绝测试仅异常断言在 stub 下通过，不计红灯证据）；实现后 13/13 通过。`npm test -- tests/web-model/result.test.ts tests/web-model/companion.test.ts` 0；typecheck/build 0；完整测试 0（9 文件/92 测试）。结果保留原 payload 全字段并按事实状态分组，snapshot 深拷贝/冻结；不会因提供方失败编造报告。

决议：补充纯 reducer 的 notice/open 显式动作以及伴读 withCompanionTurn/resume/finish，落实 W3 的旧版与主线隔离要求。notice 使用契约已有 `{latestVersionId,changedAt}`；finish 仅为本地意图，后续 UI/P 负责保存 PATCH，不自动请求研究。

W4 完成：13 项缺实现断言均先失败，再实现；`npm test -- tests/web-model/audio.test.ts` 0（13/13）；typecheck/build 0；完整测试 0（10 文件/105 测试）。严格 fake driver 控制每段完成/拒绝，不使用真实浏览器声音。

决议：保留 `play(manifest)`，增加可选 `expectedEpoch` 和 subscribe/unsubscribe。异步合成前调用 stop()，保存 getState().epoch，响应返回后 play(manifest, epoch)；否则单凭 manifest 无法分辨是新点击还是迟到请求。旧 epoch 不改变状态或播放。partial manifest 只播放从 0 开始的连续 ready 前缀，缺块后 failed，不跳过缺块；真实 driver.play 必须在播放结束时才 resolve，stop 同步停止并释放资源。未新增 TTS HTTP 或取消收费承诺。

环境异常：2026-10-24 22:18（上海）全量测试启动报 ENOSPC，npm 退出 1；紧接着报告写入失败导致本文件为 0 字节。核验时 C 盘已恢复约 2.4 GB 可用；仅从 W3 本角色提交恢复本文件，再补充 W4 记录，未删除/移动其他任务或个人文件。全量重跑 105/105 通过。

决议：以本文件代替技能通用 scratch/ledger，遵守任务书唯一文档写入范围；原任务书保留在主目录作为外部输入，不复制到基线或改动其他文件。

## 参考与取舍

- ui-ux-pro-max：`loading cancellation feedback --domain ux -n 3` 命中 Feedback / Loading Indicators（All，High）。采用可感知 loading/reconnecting/cancelPending/error 数据状态；不采 spinner、动画、布局或配色建议。
- 实施设计 D04：借真实事件与来源关联，拒绝 Vane 2/6/25 质量档及页面搬运。
- D08：保留引用闭包与读取程度，不把 ID 合法称为语义核验。
- D10、R07/R08、伴读适配 §5/7：固定版本和保存游标、打断独立于主线、收尾不自行研究。

## 验证边界

本轮仅模块受控测试、类型与构建；不代表真实 API、浏览器、听音、UI、部署或产品 AC 验收通过。

## 独立整分支审查与修复

依据 executing-plans / requesting-code-review 技能派发一次独立只读审查；基准 G0 至 `1658e2c0037116f2f5ad15c256fe2f3d22452d0c`。未另派实现者；审查者未改文件/index/HEAD，未读取 .env、未做真实调用。

审查发现 2 Important + 1 Minor；按实际影响将音频 dispose 重入上调 Important，同一修复轮次全部处理。三项新增回归同一次运行均失败（3 fail / 48 pass），修复后相关 51/51 通过：

- 已确认 cancelled 之后迟到 cancel/running 响应复活：GET/cancel 统一保持已确认终态，不退回 running/cancelPending。
- response.json 的传输断流被当格式错：SyntaxError 仍为 INVALID_RESPONSE；其他正文读取失败为安全、可重试 NETWORK_ERROR；不自动重试 POST。
- dispose 通知重入 play：先锁定 disposed，再停止和通知；销毁期间拒绝任何新播放。

审查后没有遗留 Important/Critical 或延后 Minor。按技能单次修复规则，依靠先红后绿回归与完整套件验证修复，没有另派重复审查。

审查暂不判断的事项与处置：

- 缺失任务 HTTP、真实 Audio/objectURL、云取消/计费：属于明确后续集成；本轮只交私有端口和控制器。若误当成生产闭环，会漏验真实调用/资源释放，因此不作此声明。
- 单参 play 无法辨认异步迟到：采用已记录的 expectedEpoch 协议；调用方不用 epoch 的异步接入仍需修复和测试。
- 通知乱序、显式 open 的异步竞争、伴读结束后的迟到 turn：模型当前没有异步请求调用方；不扩充未派发 UI。后续 UI/controller 必须绑定请求 generation/version 并测试，不能据本轮纯 reducer 通过推定已解决。
- 语义质量、实际听音、完整产品 AC：保留未运行，不以 controlled_fixture 替代真实验收。

## 交给 P / 后续 UI 的接入清单

|任务|生产文件/导出|生命周期与状态|实际能力与 AC 边界|
|---|---|---|---|
|W1|api/client.ts: request、ClientError、safeError、parseInput；api/foundation.ts: createFoundationApi、SessionViewSchema、InvestigationViewSchema|调用方提供 AbortSignal；一次创建固定 key，明确重试复用 key；无自动 POST 重试|真实 G0 会话/草稿路由经本地注入验证；AC08/12 的消费者部分|
|W2|api/task-port.ts: TaskPort、RunViewSchema、EventPageSchema；controllers/task.ts: createTaskController、TaskScheduler；model/task.ts: TaskViewState|follow 首次读取后返回；subscribe 返回 unsubscribe；disconnect 中断本地读取、不取消服务端。data、connection、cancelPending、events、lastSeq、error|只有注入端口；无生产任务 HTTP adapter。AC07/08/09 的模块状态要求|
|W3|model/result.ts: projectResult、findEvidence、createResultState、reduceResult、UpdateNoticeSchema；model/companion.ts: projectCompanion、withCompanionTurn、resumeCompanion、finishCompanion|纯函数、冻结快照，无网络/订阅。result 保留全部事实字段；notice 与 selectedVersionId 独立；伴读保留版本/游标、打断分离|成功/冲突/不足/提供方失败/新版受控输入；AC03/05/09/10/15 的数据与引用边界|
|W4|controllers/audio.ts: createAudioController、AudioDriver、AudioPlaybackState|play/stop/dispose；subscribe 返回 unsubscribe。epoch、jobId、chunkIndex、idle/playing/stopped/failed、error|只有 fake driver 控制测试；AC10 控制器边界，不代表真实听音或不叠音验收|

测试文件：tests/web-model/{client,task,result,companion,audio}.test.ts；测试工具 fixtures.ts（controlled_fixture）。
共用内部工具 model/snapshot.ts 只深拷贝/冻结，不创建事实。

### 后续 adapter 约束

1. 唯一当前生产 HTTP 消费层是 foundation，路径 /api/v1/sessions、/session、POST /investigations、GET /investigations/:id。未实现的任务/结果/伴读/音频/通知路由均未冒充可用。
2. P 提供任务路由后，将映射集中放进未来 api/task-http.ts：GET run 归一化到 RunView；若部分材料为对象，只转换成摘要；cancel 短响应需随后 GET 完整 Run。TaskPort 返回值仍经消费者 schema/归属检查。不要让 UI 直接导入测试 fixture。
3. 后续 UI 需呈现 loading/reconnecting/error、401 停止、cancelPending 与服务器 run.status、waiting_for_user/partial/failed/interrupted、stopReason、剩余预算、partialMaterialSummary；内部事件不出现在公开事件列表，不造百分比。
4. 结果页更新提示不派发 open；用户明确打开新版才替换。通知目标版本由后端给定；旧版伴读继续绑定旧版。伴读 finish/resume 等本地意图由 UI 通过 P 的未来 PATCH 保存。
5. 异步音频例：controller.stop(); const epoch = controller.getState().epoch; const manifest = await synthesize(); await controller.play(manifest, epoch)。每次新的用户请求先 stop 使旧请求失效；停止/销毁也使旧 epoch 失效。直接已有 manifest 可 play(manifest)。
6. 真实浏览器 AudioDriver.play 在该段真正结束时 resolve，并响应 AbortSignal；stop 立即清空播放并释放 objectURL 等浏览器资源。声音加载失败不能替换/清空结果或伴读文字。云 TTS 调用预算/取消由 P/E 负责。

### 未完成但明确在本轮范围外

真实任务 HTTP adapter、浏览器 Audio/objectURL、TTS 音色/试听、JSX/CSS/页面、tests/ui、UI 视觉确认、真实 API 探针、部署、真实产品验收均未执行；本轮未新增公共 schema、根依赖或跨角色代码。复制/上传/完整历史与通知页面仍留后续主路径，不能由本轮模型测试宣称可用。未发消息给其他聊天或人员，未合并主分支、未推送远程。

## 最终模块验证与版本

- 最终代码 SHA：`01c031afabde85fc52f88868e1a55ee3b64f3f6b`（全部实现/测试/审查修复）。
- 最终交付分支：`codex/web-headless`；此后的提交只补本交付文档，完整最终分支 SHA 随聊天交付，同机 P 可用 `git rev-parse codex/web-headless` 核对。
- 代码检查版本：上述最终代码，与最终文档提交中的代码完全相同。
- `npm test -- tests/web-model`：退出 0，5 文件、64 测试通过，无跳过。
- `npm test`：退出 0，10 文件、108 测试通过，无跳过（G0 44 + 本轮 64）。
- `npm run typecheck`：退出 0。
- `npm run build`：退出 0。既有 web bundle 仍为 index-vL9xy0FN.js，未改视图入口或 CSS。
- `git diff --check`：退出 0；范围检查：16 个文件均在允许范围。
- 基线与每个增量的检查记录见执行账本；中途缺实现/回归红灯与 ENOSPC 均保留记录，没有将失败当通过。
- 真实 API / 浏览器 / 听音 / 部署 / 产品验收：未运行。供应商调用 0，费用 0。

增量提交：W1 `d457896`；W2 `578be0b`；W3 `898f1cf`；W4 `1658e2c`；独立审查修复 `01c031a`。同机交付无需 bundle；P 可从本地分支取完整提交，集成后须在当前平台版本重跑检查。

### 实施取舍的影响

- 报告兼作 ledger，避免越过唯一文档写入范围；代价是通用 sdd scripts 不参与自动账本生成，进度以本报告和 git 提交为准。
- follow 首轮返回、终态排空事件后停读：UI 不应把 follow Promise 完成误当成调查完成，必须读 run.status。
- 纯 reducer/伴读本地意图：后续需显式保存和处理请求竞态，不能只接静态投影便宣布完整历史/伴读闭环。
- 异步音频 expectedEpoch 是必要接入约定；partial 缺块后停止并 failed，代价是不能跳读缺块或把部分声音当完整成功。
- Git 身份仅沿用已有 Codex local.invalid、单次命令指定；没有代用户设置全局身份。

## W5：P runtime HTTP 接入计划与账本

用户本轮已明确要求按 P 发布记录完成接入、测试并提交，仅非视觉 W 范围。

- W 起点：`5dcc8f38852dd72d5385682f4cf7281742371a0b`；P 依赖：`1d50513049e58dc59f85776649329cfd1385068e` / p-platform-runtime-v1。
- 合并依赖提交：`efa916fced5583c1a6b3d34a1a5b7cbdc0f84438`；无冲突，P 的 shared/server/migrations/root 相关文件与发布检查点相同，没有自行修改 P 实现。根依赖与锁文件无变化，沿用原 npm ci 安装。
- 合并后基线：npm test 0（19 文件/172 测试）；typecheck/build 0。
- 继续原隔离分支 codex/web-headless；代码写入仍限 api/model/controllers、tests/web-model 和本报告；UI、P 目录不新增修改。

### 实施步骤（延续 inline/TDD）

1. W5a：先写 HTTP adapter 失败断言，再新增 api/task-http.ts 的 createTaskHttpPort(transport):TaskPort，复用 P RunView/Events/CancelledRun schema。取消只 POST 一次短响应，然后 GET 完整 Run；ID/游标/key、响应归属、事件分页和 AbortSignal 均检查，不制造 fallback Run。
2. W5b：api/runtime.ts 的 createRuntimeApi(transport) 组合 TaskPort，并提供 startRun(investigationId,input,key,signal)、answerClarification(runId,clarificationId,input,signal)、getResult(versionId,signal)、copyResult(versionId,signal)。start/resume/add_budget 仅由显式调用触发，POST 无自动重试。model/result.ts 改复用公共 UpdateNoticeSchema；notice 与 open 仍分开。
3. W5c：用真实 P Fastify/app 与测试内 controlled_fixture 模块验证消费者全路径、同 key、取消/恢复、澄清、事件分页、结果/复制、旧版通知、跨会话拒绝及默认未配置 503；真实 providers 禁止调用，不将测试模块挂到生产。
4. 每个相关测试观察失败原因后实现并验证；最后完整 npm test、web-model、typecheck/build、diff/范围检查，独立只读审查本次增量，再提交交付。

Review Focus：取消短响应之后断网/abort不能重发 POST；相邻案件/run/version ID 不能串用；断线重连仅 GET；旧报告提示字段改名不能暗换内容；缺 runtime 的 503 必须保留；不扩大到 UI、伴读/音频或未发布 HTTP。

### W5a–c 实施结果（审查前）

- 20 项 adapter 断言先因未实现全部失败；新 notice 的旧版保持测试先失败，再改用公共 schema。实现后 runtime/result 28/28 通过，typecheck 0。
- 新增 `createTaskHttpPort`，共享 P 的 RunView/CancelledRun/EventsPage schema；事件游标额外用 CountSchema 限制安全整数，与 P 的 HTTP 输入限制一致。getRun/事件/取消校验 ID 归属；取消后只读 GET，不造完整 Run、不自动重发取消 POST，GET 断网或中途 abort 保留错误。
- 新增 `createRuntimeApi` 组合 TaskPort 与 startRun、answerClarification、getResult、copyResult，全部复用 P schema 和现有同源 request。动作和幂等键均来自显式调用；API 自身不刷新预算或重试 POST。
- `UpdateNoticeSchema` 在 model/result.ts 原名 re-export P 公共形状 `{latestResultVersionId,createdAt}`；notice 和 open 动作仍独立。老私有字段不再作为第二份契约保留。
- 6 项真实 P 路由的消费者集成测试（Fastify inject，无外网）覆盖：同 key 一次执行、105 个公共事件触发分页、内部事件不外显、引用/复制/会话隔离、取消/恢复原预算、澄清复答/冲突、真实新旧版本 notice、GET 断线恢复与 disconnect 不取消，以及默认 runtime 缺失 503。
- 集成首次 5 pass / 1 fail：误把澄清冲突预期为 INVALID_STATE；读取 P runs.ts 确认已发布实现是 IDEMPOTENCY_CONFLICT 后修正测试。未修改 P 或放宽生产错误处理。
- 测试等待使用显式 deferred/手动调度器以及 P setImmediate 分发的事件循环推进，没有时长 sleep；测试内 providers 一旦被调用即失败，实际计数 0。
- 审查前检查：`npm test -- tests/web-model` 0（7 文件/90 测试）；`npm test` 0（21 文件/198 测试）；typecheck/build 0。原页面 bundle hash 不变。

### W5 给 P / 后续 UI 的最新接入方式

- `createRuntimeApi(transport: typeof fetch): RuntimeApi` 位于 `src/web/api/runtime.ts`。它继承 TaskPort，可直接传入 `createTaskController(api)`；同一 transport 也传给 createFoundationApi，沿用浏览器同源 HttpOnly 会话。
- 显式写操作：`startRun(investigationId,{action:'start'|'resume'|'add_budget',previousRunId},key,signal)`；`answerClarification(runId,clarificationId,{answer,proceedWithUnknown},signal)`。调用方按同一次逻辑动作保留 key；API 不自动新建预算或重试 POST。
- `createTaskHttpPort(transport):TaskPort` 位于 `src/web/api/task-http.ts`，也可独立使用。getRun/getEvents 是 GET；cancel 是一个无 body 的 POST + 一个 GET。显式重试取消复用原 key；若短响应后读取失败，只报告安全错误，后台 controller 后续轮询只读真实状态。
- 新增结果读取：`getResult(versionId,signal)` 返回 P ResultView 的 `{version,updateNotice}`；`copyResult(versionId,signal)` 返回 `{text}`。复制文本由 P 生成，W 不删限定或另拼事实。
- `UpdateNoticeSchema` 在 model/result.ts 同名导出但已复用 P 类型；字段必须是 `latestResultVersionId` 和 `createdAt`。将 notice 派给 reducer 不触发 open；打开新版仍是显式动作，旧版 payload/hash/伴读不跟随替换。
- 所有 response 继续验证统一 envelope/contractVersion；schema 错误、HTTP 错误和协议归属错误分开。ID/游标/key/请求体在发请求前验证；游标必须安全整数，事件最多 100 条。internal 防御过滤保留 nextSeq，不通过“补假事件”推进状态。
- 生产入口 main、JSX/CSS、design、P schema/server/migrations/root 无自行改动；不自动注入模块/价格/资金，不挂 controlled_fixture 到页面。不实现未发布的附件/伴读/音频/通知/追问/历史列表路由。

W5 修改文件（9 个）：src/web/api/{task-http.ts,runtime.ts,task-port.ts}，src/web/model/result.ts，tests/web-model/{runtime.test.ts,runtime-http.test.ts,runtime-http-fixture.ts,result.test.ts}，docs/runtime/W-交付.md。

W5 对应 AC 的消费者部分：AC07 澄清读取与回答、AC08 停止/重连/错误、AC12 会话资源拒绝、AC14 固定版本复制、AC15 新旧报告/更新提示；受控 HTTP 通过不等于这些产品 AC 全部通过。

### W5 独立审查与最终验证

- 本轮独立只读审查范围：`efa916fced5583c1a6b3d34a1a5b7cbdc0f84438..9dd42b751aaa49b9428c18a3d53224c5dfda1fbd`。审查结论：Ready to merge yes，仅 W 模块；Critical 0 / Important 0 / Minor 0，无待修问题。
- 审查者核对了真实 diff、新增测试、共享 schema、P 路由与关联控制器；确认 P 目录未改，工作树干净，diff --check 通过。测试/build 为执行方证据，审查者没有冒充独立复跑。
- 暂不判断：真实 I/providers/资金/部署、UI/浏览器/伴读/音频均不属于 W5；UI 点击编排/异步请求竞态留到实际调用方；StartedRun 和 CopyResult 不携带案件/版本归属字段，W 不能自行补公共协议。P 路由已按 ID+会话处理，消费者对现有字段执行可验证的匹配检查。
- 最终 W5 代码 SHA：`9dd42b751aaa49b9428c18a3d53224c5dfda1fbd`。此后仅补交付文档，最终完整分支 SHA 随聊天交付；P 可用 `git rev-parse codex/web-headless` 核对。
- `npm test -- tests/web-model`：退出 0，7 文件/90 测试。
- `npm test`：退出 0，21 文件/198 测试，无跳过；合并基线172 + 本轮新增26。
- `npm run typecheck`：退出 0；`npm run build`：退出 0，页面 bundle 仍为 index-vL9xy0FN.js。
- `git diff --check`：退出 0；P 发布检查点对比 shared/server/migrations/root/原页面入口无自行改动，W5 增量仅上述 9 个获准文件。
- 真实供应商请求 0 次、费用 0。未读取 .env、未部署、未运行浏览器/手机/真实听音验收，未修改主目录分支、未合并回 P、未推送远程。
- 本分支包含完整旧 W1–W4、P 发布依赖和 W5；P 集成当前分支后仍须在当时的平台版本重跑相关与完整检查。同机不需另造 bundle。

### W5 决议与代价

- 原样合入 P 发布检查点作为依赖，避免复制另一份平台或修改公共协议；代价是本分支历史包含 P 的已发布增量，集成时应按提交祖先关系处理。
- 复用公共 notice 字段并废弃旧私有别名；后续调用方需使用 latestResultVersionId/createdAt，不再接受老字段。
- GET 断网/abort 不自动重复取消 POST；代价是短响应之后读取失败时，UI 暂时看到错误，需要通过后续只读轮询恢复实际状态，不能凭缺字段补造已取消 Run。
- 继续用报告作为唯一文档账本；无新增 UI/设计文档、无额外审批阶段，执行范围来自本轮用户明确指令。
