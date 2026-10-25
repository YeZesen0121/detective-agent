# W 接续开发任务：异步动作和结果版本编排

用户转交本文件并要求执行即领取 W。沿用原 W 对话，只设一个写入者；UI 仍由独立对话推进，**本任务不写页面、组件视觉、CSS 或 design-handoff**，不重问已确认需求。

**Goal:** 为已实现 W1–W5 增加可由任意 UI 接入的动作控制器和真实 HTTP 竞态测试。
**Architecture:** 复用 RuntimeApi / TaskController / 结果 reducer / 音频控制器。新增薄的动作协调层，统一幂等键、请求代次和显式版本选择；不另建 HTTP 数据协议。
**Tech Stack / Spec:** Node 24.19.0、npm 11.17.0、TypeScript/Vitest；PRD v1.0 的 start/澄清/停止/继续/版本回看，实际 shared/runtime-http.ts。

## 开工与写入

- 起点 `2c6b0127591a76adc0341f8d217aa580784c7c08`（contractVersion 0.1.0）；主源码 D:\侦探agent。异机配套 `detective-agent-next-base-full.bundle`，新机器先 `git clone -b codex/next-stage-base <full.bundle绝对路径> <新目录>` 后进入新目录建角色分支；完整历史不要求旧G0仓库，只有任务文件/SHA不够。
- 建独立工作树，建议 codex/web-next；已有 W 分支先保留状态、merge 此基准，不 reset。先 README、AGENTS、PRD、系统实施设计、实际 ports/runtime-http.ts、W-交付.md 和 P-truth主路径接入.md。
- W1–W5 已完整接收：foundation/runtime/task-http API、TaskController、结果 model、伴读 model、音频 driver、90 项 W 测试。不得复制第二套 client、重做相同基础任务。
- 可写 src/web/api/、controllers/、model/、tests/web-model/、docs/runtime/W-下一阶段交付.md。不可写 App.tsx/pages/components/style、docs/ui、shared、server、迁移、根配置/依赖。测试可导入 server 来验证，但不修改它。
- 不读 .env、不跑 --live、不把 fixtures 挂到正式启动。先 npm ci/test/typecheck/build，记录实际基线；共享契约缺口交 P。

## 实际接口

`createRuntimeApi(fetch)` 已有 startRun(id,{action:'start'|'resume'|'add_budget',previousRunId},key,signal)、answerClarification(runId,clarificationId,{answer,proceedWithUnknown},signal)、getRun、getEvents、cancel、getResult、copyResult。

`createTaskController(TaskPort,scheduler?)` 已有 follow/cancel/disconnect/getState/subscribe；disconnect 只停前端读取。结果 notice 固定为 `{latestResultVersionId,createdAt}`；收到 notice 不自动换正文。createFoundationApi.getInvestigation 可读 activeRun 和 latestResultVersionId，供写请求响应未知时只读恢复。

## W-N1：开始/继续/澄清动作

**Files:** 新建 src/web/controllers/investigation.ts、tests/web-model/investigation-controller.test.ts；复用现有 API。

**建议接口:** `createInvestigationController({foundation,runtime,keyFactory?,task?})` 返回 open(investigationId)、start(action,previousRunId)、answer(clarificationId,input)、disconnect/getState/subscribe；输入类型用已发布 schema 推导，keyFactory 默认 crypto.randomUUID，task 复用已有控制器。具体导出类型一并给 UI/P，不自定 wire 字段。

- [ ] 先测双击同一逻辑动作只发一次 POST、保留原幂等键；换案件或不同动作才用新键；post 网络结果未知时不自动重发，先以只读 GET 找当前任务；用户明确重试时复用原逻辑键。
- [ ] 先测 open(A) 慢响应晚于 open(B)、start 后旧 draft GET 迟到、disconnect 后 POST 迟到：不得替换当前案件/启动旧轮询/重复执行动作。
- [ ] 先测澄清仅等待状态可提交；重复同答不造成二次启动；迟到旧 clarification 回应不得覆盖新问题；按服务端 409/429/503 显示安全状态，不伪造成功。
- [ ] 实现控制器并复用 TaskController 跟随服务端 run；服务端排队/失败/中断明确保留，浏览器断开不发隐式 cancel，任何 POST 不自动重试。
- [ ] 定向测试→全量→typecheck/build，先交 W-N1 小提交。

## W-N2：固定版本结果与声音生命周期

**Files:** 新建 src/web/controllers/result.ts、tests/web-model/result-controller.test.ts；复用 model/result.ts 和 controllers/audio.ts。

**建议接口:** `createResultController({runtime,onVersionChange?})`，select(versionId)、refreshNotice()、openLatest()、disconnect/getState/subscribe；onVersionChange 供宿主显式停旧音频，普通 notice 不触发。保存当前 investigation/version 的请求代次。

- [ ] 先测收到新版 notice 正文/hash/选中版本不变；只在 openLatest 或 select 动作后读取并替换；旧请求迟到不能回退选中版本，跨案件版本拒绝。
- [ ] 先测切新版本时停旧声音，不自动播放；旧 play/seek Promise 迟到不恢复旧版本音频；仅 notice 到达时既有固定版本伴读可继续，不混新材料。
- [ ] 先测 copy 使用选中版本 ID，复制的条件/未知/来源不因 latest 改变；失败保留旧报告可读，不清屏冒充新结果。
- [ ] 定向测试→全量→typecheck/build，单独提交并给独立 UI 一份函数/状态/事件接入说明，写在本角色报告内，不改 UI 方案。

## W-N3：实际 HTTP 集成

**Files:** tests/web-model/interaction-http.test.ts，可新增本目录受控帮助文件。

- [ ] 启真实本地 Fastify，注入 controlled_fixture 业务/供应商，不用 stub TaskPort 代替全部 HTTP；实际 W client/controller 连真实端口。
- [ ] 覆盖重复启动、取消 POST 后 GET 失败、网络只读重连、跨会话 404、Origin 拒绝、澄清重复、旧结果保留与明确开新版；测试有可控延迟，不能依赖随便 sleep 恰好成功。
- [ ] 不把只有基础占位页的 3 项浏览器测试当本任务端到端 UI 完成。真实点击/手机/视觉验收留给 U 确认后接线阶段。
- [ ] 全量 npm test、npm run typecheck、npm run build；写实际结果，无失败/跳过才写通过。

## 交付

报告 docs/runtime/W-下一阶段交付.md：完整基准/最终 SHA、所有提交范围、工作树、文件清单、实际命令和测试数、幂等/竞态设计依据、导出/状态给 UI 的说明、未完成项、0 真实调用。不能自行改公共 server 来配合测试。

同机交 SHA；异机 commit 后 `git bundle create <交付文件> 2c6b0127591a76adc0341f8d217aa580784c7c08..HEAD`，连同报告和完整 SHA 交回。不要合主线、推远程或自动联系其他对话，不发送个人配置/凭据/数据库。
