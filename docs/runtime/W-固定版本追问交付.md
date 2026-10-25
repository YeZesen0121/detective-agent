# W 固定版本追问闭环交付

任务：docs/协作交接/下一阶段/W-固定版本追问闭环.md。

- 既有媒体完整交付：94d7718bac777f62be9abb23a4f6153c9d613ca9，保持独立提交与记录。
- 完整接受 P 发布：d6bc9caf8624e797680685e8bd86ab318ca84dc9（代码7cc276b16ee7381d505304c916c7fd7db84a5210），无冲突 merge。当前分支 codex/w-media-ui。
- 唯一 W，限定 src/web API/controller/model/局部组件、tests/web-model、自有media浏览器测试与本报告。不修改 P/shared/根配置/全局主题。0真实调用/0元，不读凭据。
- 使用 executing-plans/TDD/verification-before-completion，沿用已有 ui-ux-pro-max 局部可用性原则。此文件作为执行记录，避免增加范围外计划文件。
- PRD §5.3/系统设计§5.3为行为真源：固定版本解释不搜索；同案补查复用剩余窗口；新案仅建议；追加预算明确确认；旧版补查stale必须显式查看新版。I/P决定策略，W不实现关键词路由。
- Preflight：API消费P schema；followup controller记录原key、只读恢复；新run经已有Investigation/TaskController跟踪；版本选择经已有result controller；伴读只预填同一入口，不隐式搜索或提交。

## 执行记录

- API 初始因模块不存在而失败；实现后回归通过。question schema、原key GET、null不重放由测试验证。
- 调查 controller.followRun 初始缺失失败；直接跟踪服务端 run、不发start后通过。增加祖先链保护，避免稳定turn.newRunId在刷新后把恢复后的新run回退为旧取消run；20项调查控制器回归通过。
- 固定版本自由追问、历史分页、单turn状态、原key丢响应恢复、SHA256问题摘要记录、budget明确确认/持久恢复、stale显式新版本入口已接。sessionStorage只放标识/key/hash，原问题正文从鉴权历史恢复，不缓存cookie/报告正文。
- main保留当前报告version地址参数，刷新重新鉴权读取该version并核对case；新案删除旧version参数。notice只提示、显式选版才切换。报告追问在所有固定报告可用。
- 补查/恢复运行中继续显示旧报告和追问/伴读；任务进度、停止、取消后恢复沿用既有TaskController。对已有后继run不因旧turn稳定ID重新跟踪祖先。
- 伴读research_request只预填同一版本入口并保留resumeCursor/段落，用户提交后由I/P决定解释/补查/新案/预算。未自行搜索或重置额度。
- 建议新案仅在用户明确点击后create draft；同点击singleflight/固定key，不自动start。

## 独立审查及失败证据

本阶段一名fresh-context reviewer只读审查本轮范围，发现2项Important、0Critical，无另列Minor；没有改文件或真实调用，也未复审修复。

1. resume trigger为resume时旧报告和面板卸载。调整主界面保留旧报告，补查恢复中的任务控件仍可用。浏览器增加第二次执行受控gate，明确断言运行中原报告/未提交追问、刷新后的后继任务保持，释放gate后才完成。
2. followRun祖先GET的旧失败可污染新case。新增失败回归先复现新case从ready变error，再把catch纳入对应generation/revision保护，回归通过。

自行发现并回归：稳定turn.runId在resume后仍指旧run，增加descendant祖先链保护；预算确认STALE_VERSION只读取当前固定结果的notice，显示显式打开新版入口，绝不自动换版/重问。

首轮浏览器4项失败：受控seed从前一天运行时间到当前时刻commit，原窗口activeMs被真实记账耗尽，因此research按正确平台规则变成needs_budget；测试种子改为同一历史时刻完成，未修改P预算门。预算丢响应后刷新选latest而丢当前旧版历史，新增URL固定version恢复；503断言原先只匹配“尚未开放”，实际“尚未配置”，按实际安全返回匹配。第二轮6项全部通过；最后带持续resume gate与原媒体合并复测见最终表。

审查不判的真实I策略、供应商语义/费用、公开部署、视觉定稿、真实手机及P范围旧浏览器同步，均保留未验收。测试helper中的controlled_fixture情景标签不是产品策略。



## 最终实际验证

| 命令 | 实际结果 | 退出码 |
|---|---|---|
| npm test | 64文件，619/619，0失败/跳过；本阶段新增13项 | 0 |
| npm run typecheck | 通过 | 0 |
| npm run build | 通过，149前端模块，index-gcW7FsO0.js | 0 |
| git diff --check | 通过，只有Git换行归一化提示 | 0 |
| PLAYWRIGHT_CHANNEL=msedge npm run test:e2e -- tests/ui/media-experience.spec.ts tests/ui/media-followup.spec.ts --workers=3 --output %TEMP%/w-followup-final-browser | 10/10通过（原媒体4+追问6），0跳过，38.1秒 | 0 |

本阶段没有重跑已知需要P同步入口的旧全套浏览器用例。上阶段完整套件6通过/11失败的证据仍见W-媒体UI交付.md，不能把当前自有10项通过表述为完整仓库e2e全绿。P需完成旧“保存草稿”步骤同步后在集成分支再跑全套。

| 场景 | 实际证据 |
|---|---|
| 双击/相同逻辑key、解释不start、503保留输入且显式重试原key、unknown/null不重发 | followup-api 1项；followup-controller 9项含其他下列场景 |
| 跨案件/新输入迟到、分页保留失败、引用/归属检查、stale预算只读notice、预算unknown恢复已关联run | followup-controller |
| 只跟踪服务器run/不POST、终态run照常GET、后继run不被旧turn覆盖、旧GET失败不污染新case | investigation-controller 本阶段新增3项（该文件总20项） |
| 真实P HTTP/SQLite/宿主：解释丢响应原key恢复→刷新→同窗口补查→通知不换正文→显式新版→旧版回看→stale入口；另一session读turn404 | 浏览器追问第1项 |
| 到限点击前0研究run；明确预算确认丢ACK后GET turn恢复同run，不追加第二次；刷新仍读旧版历史 | 浏览器追问第2项 |
| 真实E伴读research_request→同入口预填，提交前0路由/搜索，原cursor和问题保留；提交后同窗口补查 | 浏览器追问第3项 |
| 2001字禁用、503保留原报告和问题，生产无策略不注入fixture | 浏览器追问第4项 |
| suggest_new_case不自动建案，明确点击只建一个draft，0 start | 浏览器追问第5项 |
| 取消补查→GET失败→只读恢复→resume原问题/原窗口；第二轮暂停时旧报告和未提交输入保留；刷新不回退祖先任务 | 浏览器追问第6项 |

所有新流程接真实P HTTP/SQLite/host；策略模块及供应商替身为controlled_fixture，没有page.route替代核心API。故障仅对真实route.fetch后的单POST断响应、GET故障作注入。enableFollowups仅测试传true，正式truth profile未改。0真实供应商调用/0元。

日志：`%TEMP%/w-followup-final-unit.log`、`%TEMP%/w-followup-final-browser.log`。首轮失败trace `%TEMP%/w-followup-browser-1/`，第二轮6项通过 `%TEMP%/w-followup-browser-2.log`；未提高超时或跳过用例。

最终截图：`C:/Users/111/AppData/Local/Temp/w-followup-final-browser/media-followup-controlled--160f8-est-and-old-version-history-chromium/fixed-followup-history.png`。媒体窄屏截图同目录media-experience子目录，均为模拟设备/controlled_fixture，不是真实手机或TTS听感验收。

## P 集成注意事项

- 完整合入同一 codex/w-media-ui 分支（含先前媒体94d7718历史及P d6bc9ca发布的merge），不要只取最后文档提交。当前源代码执行基准merge为a602e64bb60031ecd53aa0dfff9f5baf359ea04b。
- `FollowupController`消费P schema，不在前端重做I路由。`turn.newRunId`为稳定原任务ID，不能从activeRunId名字猜状态。InvestigationController.followRun通过现有TaskController读取，并保留当前新后继任务。
- `needs_budget_confirmation`只明确按钮调用add_budget+followupTurnId；同一逻辑动作原key不变，unknown只读turn恢复，null不重发。旧版STALE只提示显式开新版，不替用户重发原问题。
- URL保存当前version，启动恢复验证case；切版仍经result controller，音频先停，旧伴读与引用不随notice自动改变。新案清除旧version参数。
- 伴读补查转交是预填用户确认，不是自动生成；当前cursor和原文保留。新案建议仅明确create draft，不自动start。
- 关联预算POST已经成功但只读恢复暂失败时保持确认/未知记录，不更换key。UI任务取消/恢复仍沿原窗口，费用未知由P账本处理。
- W不改P/shared/investigation/migrations/根配置/全局主题；fixture帮助文件只是测试组合。正式I N3语义、真实供应商、完整产品AC、部署待P集成核验；本轮不能把受控模块绿当策略质量通过。
- 工作树保留，未推远程、未直接合主目录。P先保护自身在途改动，再完整merge与复验旧全套测试。


## 提交与写入范围

- P发布：`d6bc9caf8624e797680685e8bd86ab318ca84dc9`。
- 接受发布后的本地实施基准merge：`a602e64bb60031ecd53aa0dfff9f5baf359ea04b`。
- 最终实现（含独立审查修复）：`d1f9270c713dd5419c41329de30ff397f76487c6`。
- 最终交付分支：`codex/w-media-ui`；末尾文档收尾提交完整SHA在本轮交接消息提供，完整merge此分支。
- 工作树：`C:/Users/111/.codex/worktrees/web-headless/侦探agent`；不推远程、不直接合主目录。

本阶段相对实施基准写入14个文件：

- `docs/runtime/W-固定版本追问交付.md`
- `src/web/api/followup.ts`
- `src/web/controllers/followup.ts`
- `src/web/controllers/investigation.ts`
- `src/web/main.tsx`
- `src/web/model/followup-submission.ts`
- `src/web/ui/media/CompanionPanel.tsx`
- `src/web/ui/media/FollowupPanel.tsx`
- `tests/ui/media-followup.spec.ts`
- `tests/web-model/followup-api.test.ts`
- `tests/web-model/followup-controller.test.ts`
- `tests/web-model/followup-http-fixture.ts`
- `tests/web-model/investigation-controller.test.ts`
- `tests/web-model/media-http-fixture.ts`


## P 复审返修：固定URL读取失败不得切到latest（2026-10-25）

返修基准完整HEAD：`3d35ef8ce6e26f2393f235f8ce043fffee7451c9`。本返修独立提交，保持P/共享/全局视觉不变，0真实调用/0元。

- RED：旧版URL的首次GET分别注入503和断网；两个浏览器用例均因无可见错误失败，503失败快照明确显示新版标题，确认发生了自动换版。日志 `%TEMP%/w-fixed-version-red.log`，trace `%TEMP%/w-fixed-version-red/`。
- controller RED：初始失败没有持久requestedVersionId；首次select也未消费expected case绑定参数。两项回归失败后实现对应状态与校验。
- 修复：ResultController新增requestedVersionId和retrySelection，失败保留请求目标及expected case，重试沿原version；select直接在单次HTTP响应中验证case，去掉main中会把错误落入登录状态的双重预读。
- main初始恢复直接调用select(version,case)，有请求目标时禁止latest自动兜底；已登录界面显示所选报告读取错误和只读“重试所选报告”，不依赖隐藏的sessionError。读取中的按钮禁用。已有正文仍保留时也可显式重试未成功的所选版本。
- 浏览器回归：先发布真实持久化新版，再访问旧version URL，只让旧版首次GET失败；断言URL仍旧版、错误可见、旧版只读1次且不显示新版；用户重试仍GET旧ID，成功后正文旧版、通知显示新版，写请求0。503和network均覆盖。
- controller回归：初始503保留target→retry读取同ID；首次恢复case不匹配拒绝渲染，retry仍遵守原case约束。
- 新用例为 `tests/ui/media-version-recovery.spec.ts`；控制器回归在 `tests/web-model/result-controller.test.ts`。P按完整历史接收，先前媒体cherry-pick建议不再作为当前集成流程。


本次返修最终验证：

| 命令 | 实际结果 | 退出码 |
|---|---|---|
| npm test | 64文件622/622，0跳过；新增2项初始选择/案件绑定回归 | 0 |
| npm run typecheck / npm run build / git diff --check | 均通过，149模块，index-BTQTWly8.js | 0 |
| msedge test:e2e -- media-version-recovery.spec.ts media-followup.spec.ts media-experience.spec.ts media-audio-retry.spec.ts --workers=3（文件均在tests/ui下） | 自有13/13通过，0跳过，39.7秒；含新503/断网2项 | 0 |

GREEN输出 `%TEMP%/w-fixed-version-green.log`，工作目录 `%TEMP%/w-fixed-version-green/`；全量unit `%TEMP%/w-fixed-version-unit.log`。没有自动GET重试旧版或自动打开新版，显式按钮后的GET仍为URL旧ID；新通知只提供入口。未声称仓库旧全套e2e通过。

独立提交5个文件：`src/web/controllers/result.ts`、`src/web/main.tsx`、`tests/web-model/result-controller.test.ts`、`tests/ui/media-version-recovery.spec.ts` 及本记录。完整修复SHA见本轮交接消息；分支仍codex/w-media-ui，P按完整历史接收。0真实调用，未推远端、未合主目录、未改P/共享/视觉主题。
