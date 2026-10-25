# I-N1 接收与平台离线回归（隔离候选）

2026-10-25。本轮按用户最后的具体接收要求执行 P 总集成审查；遵守并行接入的隔离要求，不修改主目录或原 P/I/E/W 分支，也不自行合入最终分支。需求基线仍为 PRD v1.0，contractVersion0.1.0。

## 基准、来源和写入范围

|项目|实际状态|
|---|---|
|本轮工作树|`C:\Users\111\.codex\worktrees\a4e2\侦探agent`，开始时干净、detached HEAD，随后建立自己的 `codex/p-i-n1-regression`|
|P 已提交基准|`fd51ff6177fb09a456d40b43758dafb3e8c0029c`，与本对话上一阶段已提交交付及开始时主目录 HEAD 一致；没有猜测或接入其它 P 在途实现|
|I 共同基准|`2c6b0127591a76adc0341f8d217aa580784c7c08`|
|I 来源|`codex/investigation-next` / `C:\Users\111\.codex\worktrees\investigation-next\侦探agent`，核对仍为 `09ea6913a557f2ce1289ce0be87dfdd18302b9de`，源工作树干净|
|完整取入|代码 `ac4ee6063bd0ce8972b8711665e3edf3e184e00a` 加报告 `09ea6913a557f2ce1289ce0be87dfdd18302b9de`，非仅最后文档提交；本分支合并提交 `b16c2044f8d1a37bb1d3cc146fddc8da6c59790a`，无冲突|
|E/W 状态|只读核对 E `19893b2` 的消费者代码，不接收 E/W/UI；没有重复接入 codex/web-next|

原 I 13 文件增量保持完整：`src/server/investigation/{scope,planner,evidence,prompts,judge,engine,index}.ts`、`tests/investigation/{controlled,planning.test,preparation.test,review.test,truth-quality.test}.ts` 和 `docs/runtime/I-下一阶段交付.md`。

本轮额外代码/测试只写：

- `src/server/investigation/judge.ts`、`tests/investigation/truth-quality.test.ts`：审查发现的单一 I-N1 完成判据修补，不扩展 N2/N3，不改原 I 分支。
- `src/server/platform/truth-runtime.ts`：撤掉已过期的澄清拼接适配。
- `tests/platform/{truth-runtime,truth-probe,runs}.test.ts`、`tests/helpers/run-worker.ts`、新增 `tests/helpers/exit-worker.mjs`：平台与夹具回归。
- 本文、README/runtime 台账及 `docs/协作交接/下一阶段/E-I-N1捕获存档兼容修补.md`。

没有改 shared/app/migrations/根配置或依赖，没有写 E/W/UI，没有移动 `g0-parallel-v1`，没有推 GitHub、清理未跟踪文件或切换主目录分支。主目录仍有原 `.gitignore`、docs/ui/Hermes 相关在途文件，本轮全部未写入。

## 读取断言与真实到限的区分

先复现旧用例：新 I 返回 completed/answered，旧断言要求 partial/read_limit，因此失败。实际请求 limit=3，却要求消费供应商返回7条中的6条，和本轮需求冲突，不恢复该行为。

将旧用例替换为两个独立场景，保留真实 HTTP → W client → P 宿主 → 实际 I → normalizer/gateway/SQLite/快照：

1. 供应商 controlled_fixture 返回10条；在实际 provider port 记录 I 请求 `limit=3`，断言只读3条、保存3来源、账本读取3。底层 SearchPro 的 Cnt 向10取整不扩大 I 的读取授权。
2. 同样返回10条，显式把受控全局/组读取额度设为2（研究窗口仍6）；断言 partial/read_limit、2次读取、0模型调用、剩余读取0、保留2份完整捕获、不生成已判断命题。没有删去预算测试，也没有把到限改成 completed。

## 连接、进程和冷导入：证据与修复

|现象|实际定位|改动与验证边界|
|---|---|---|
|HTTP setup 的 NETWORK_ERROR|新增连续8轮完整 app.listen/会话创建/关闭、复用同一真实端口的用例，失败在 POST `/api/v1/sessions`；诊断为服务器仍 listening、底层 `ECONNRESET/read ECONNRESET`。普通裸 HTTP 30轮复用未复现，实际 Fastify/W 夹具才触发|Node 测试 transport 发送 Connection:close，防止全局 fetch 池把旧服务器代次的连接用于新代次；原测试先红后绿。没有改浏览器 W、服务器计费逻辑或添加 POST 自动重试；保留非主动 Abort 的简短连接诊断，不记录 cookie/header/body|
|truth 首用例5秒冷导入超时|默认全量诊断实际动态 import 3976.19ms，首用例5591ms，超过既有5000ms|将 createTruthRuntime 改为测试文件静态 import；加载仍真实执行，业务用例不再把首次模块编译算进自身时限；未放宽 timeout 或修改 vitest 配置|
|runs 双进程15秒超时|原 helper 只在 spawn error 时 reject ready，对提前 exit 和丢结果没有 reject。新增子进程 exit17 的受控反例确实只等到5000ms超时；另测 ready后exit23|父夹具现在记录 startup/request 阶段、退出码、最多4KiB stderr，并在提前关闭/发送失败时 reject；finally 与 onTestFinished 回收自己创建的进程。保留两个独立 SQLite 连接/进程，跨入队与领取两轮复用，减少4次冷启动为2次，不降低并发竞争断言；原15秒上限不变|

历史 runs 的那一次15秒超时没有保存当时子进程退出信息，不能证明一定由上述缺陷造成；本轮修复的是已复现的生命周期悬挂，并增加今后定位证据。历史两个 NETWORK_ERROR 也没有原始 cause；本轮建立了相同 setup 位置的可重复连接复用触发条件，并非宣称还原每一次旧失败。不同调度全量结果见下节。

## P shim与接线逐项核对

- **已撤：澄清回答拼进原问题。** HTTP 回归先观察 `claimsToCheck=['回答；原问题：？']` 失败；撤掉 prepare override 后由原生 I 消费 clarificationAnswer，goal/claimsToCheck 保留原问题，knownClues 保留回答；此前已确认 scope 由 I 原生保留。
- **保留：同 run 完全相同请求缓存、空正文读取失败、错误 Abort、预算/价格/epoch和正式快照门禁。** I 去重不替代 P 的最终收费控制；空正文测试仍无可用正文/不调用判断模型/无伪正式结果。没有只因签名兼容就移除安全边界。
- **保留：summary/conditions/gaps 的 schema 投影、delta/旧版本门禁。** I 原生输出已含这些内容；P 继续校验结构/归属/捕获及停止原因，旧报告不被覆盖。取消迟到、恢复不重置余额、unknown 不重放、断线重连和历史版本测试继续运行。
- **新阶段已实际接线：** HTTP 受控场景记录 `investigation.evaluate.v2`、`investigation.review.v1`，真实 transport normalizer 和共享网关执行2次模型，合法 checks/addressesQuestion=false 使相关但未回答问题的命题降 insufficient，保留条件和核心未知。修正了测试响应按 messages[0] 分流的盲点：provider 会前置通用 system，现遍历实际消息，并验证确实发送了一份合法复核回执；该加强断言也经历失败→修复。
- **原有一次模型调用探针的预期需变化：** 新 I 对 Node.js 一般/翻译命题要求核心语义复核，旧 campaign 只有1次模型。受控 probe 现在正确为 PIPELINE_INCOMPLETE/partial，保留来源和 insufficient/核心缺口；仍断言只搜索/读取/模型各1、31600微元受控计量、预留0、同key重复启动同run、防 campaign 重跑。没有放宽旧授权、改真实 probe 限额或重写此前真实报告；此前86d050c实测只代表当时版本。

## 独立审查与额外修补

使用 requesting-code-review 的只读席位审查整个 I 增量与 P 接线，独立运行原 I 56/56。没有重新开启已关闭的原6项返修，新增确认两项兼容/完成判据问题：

1. **I-N1已修：** 问实际截止日期，正文只反驳候选日期时，旧 fast path 错报 completed/answered 且未知为空。本轮新增反例观察失败，再在明确字段问题且无 supported 值时增加“核心截止日期未知”，保留原 refuted；I 定向变为57/57。只读复核原复现已关闭，未实现 latest/identify/watch。
2. **E尚未修：** raw_capture_only 存档被旧 E 及最新 `19893b2` 的 material() 全量重复送模型。独立三份24000汉字受控捕获，旧请求257029 bytes；超过每案输入总额，且单次模型还受24000上限。本轮不修改 E；提供[可直接转交的兼容修补任务](../协作交接/下一阶段/E-I-N1捕获存档兼容修补.md)。全量平台 green 不等于长报告伴读旅程已通过。

## 实际检查与结果

环境：Windows、Node24.19.0、npm11.17.0；所有供应商响应/故障进程为 controlled_fixture。**真实供应商调用0，真实费用0；不读取或输出凭据，不运行 --live。**

- `npm ci`：206包，20秒，退出0；未改锁文件或关闭engine校验。
- 接收前 P 基线：39文件342/342通过。取入后最初定向24项：23通过/旧读取断言1失败。
- 初次全量：384项中382通过/2失败：新规则下旧probe completed预期，以及冷import超时；均已保留上述定位与处理证据。中间 typecheck 曾因测试 `{port:undefined}` 违反 exactOptionalPropertyTypes 失败，已改首轮显式port0，未放宽类型。
- 当前 `npm test`：42文件 **389/389通过，无跳过**（01:43:29，10.94秒）。
- 当前 `npm test -- --maxWorkers=1`：42文件 **389/389通过，无跳过**（01:44:22，47.63秒）。
- `npm test -- --maxWorkers=4`：42文件 **389/389通过，无跳过**（01:46:15，14.26秒）。未修改根调度配置，不依据单独重跑宣布偶发现象完全消失。
- `npm run typecheck`、`npm run build`、`git diff --check`：当前代码退出0；build实际完成14模块/Vite产物。没有运行或声称本轮 UI/浏览器产品验收；真实 socket HTTP 集成、旧版本/取消/恢复均在上述全量中。
- 独立只读复跑 I+三个P文件：8文件91/91通过；随后加强 review 回执分支验证，审查者独立该例1/1通过，无新增本轮代码阻断；E待修仍单列。

## 发布与下一步边界

本轮先完成 I-N1 接收和平台回归，不开放 latest/identify/正式 watch，不实现 N2/N3，不把结构/受控语义检查当真实调查质量验收。E 的 raw 档消费是已知旅程缺口；原 P 接收本候选后应继续其所有权流程，不用根配置绕过额度，接入 E 修补后重跑相应完整旅程。

已提交的最终代码 SHA 为 **`8cf11d9f89e23e7c2fe5429a33c91e550158cfd4`**（平台回归），前一提交为 `fix(investigation): retain missing deadline after excluding a candidate`（`d464d5dd706d3b2c749dca61da03316fbe7fa199`），再前是完整接收合并 `b16c2044f8d1a37bb1d3cc146fddc8da6c59790a`。后续本文/README/任务文件的报告提交不改已验证代码；最终交付 HEAD 在回复及 `git log codex/p-i-n1-regression -1` 可核对。

原 P 接收前核对自己的 HEAD 和未提交工作，保留全部 UI；用整个 `codex/p-i-n1-regression` 历史集成，不能只 cherry-pick 最后文档提交。本轮没有代原 P 合到 `codex/platform-lifecycle` / `feat/foundation`。如 P 基准之后又前进，应先审查新差异，在其隔离工作树合并并重新完整验证；不自动覆盖更新。
