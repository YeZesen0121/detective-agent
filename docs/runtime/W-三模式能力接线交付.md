# W 三模式能力与入口接线

基准完整快进：1130f904616ee13d15df0609f0a46b6a80c6f9ed；原成果cc04bcc已由P完整接收。分支codex/w-media-ui，唯一W工作树不变。

按任务docs/协作交接/下一阶段/W-三模式能力与入口接线.md执行。先读README/AGENTS、PRD§4.1/4.2、核心接收门、P-W媒体追问接收与模式能力接口。P发布的实际schema为src/shared/capabilities-http.ts。

- 采用executing-plans/TDD/verification-before-completion；此记录兼执行ledger，避免范围外文件。沿用ui-ux-pro-max已确认的错误恢复、可访问状态与按钮原则，不改全局视觉。
- Preflight：schema→authenticated capabilities controller→新草稿mode状态/保存门禁→既有case恢复和建议新案。能力失败只影响开放状态，不清报告或替换版本；fixture三模式只用于前端受控验证，不开放生产I。
- 仅改W src/web、自有测试与本记录；不改P/shared/根依赖、独立视觉。0真实调用/0元，不读凭据。
- 默认模式由实际basicModes决定，truth优先；空列表保留truth草稿和明确503，未确认能力不假开放其他模式。已有case.basicMode永远优先于默认值。
- 先写cap API/会话竞态/错误重试/模式匹配失败回归。


## 实现与独立审查

- capabilities API复用标准same-origin envelope/schema；认证session变更会取消并作废旧读取，失败清除旧开放状态，不缓存个人数据/凭据。401/503/网络错误展示安全说明，可显式只读核对。
- 原匿名health读取已移除；case/report独立控制器不受能力失败清空/选版影响。watch入口用真实watches布尔；追问未开放提示与原503提交保护并存，历史仍可读。
- main新增basicMode状态，默认truth或实际列表首项；成功读取空列表时truth草稿仍可显式保存/启动503。未知/失败能力不开放其他模式，提交前也核对当前能力。
- 已存case恢复basicMode，默认值不覆盖它。问题、基本模式、呈现任一改变均阻止原draft开查，提示新开案；截图不转移。建议新案保留current.basicMode，仍仅明确创建draft，不自动start。
- UI仅沿原三按钮接状态/aria-pressed与必要说明，未改任何CSS/设计稿/视觉组件。

RED证据：最初API/controller模块缺失失败；模式入口回归暂时恢复固定基准旧main/build，latest按钮在声明三模式的真实受控宿主仍被禁用，浏览器退出1，finally恢复本轮源码。日志 `%TEMP%/w-modes-red.log`，trace `%TEMP%/w-modes-red/`。首轮本轮模式浏览器10/10通过。

一名fresh-context reviewer只读审查本轮差异，发现1项Important、0Critical/Minor，未改文件/凭据、未运行浏览器或真实供应商。

- 问题：开查先检查mode再await附件GET，等待期间仍可切mode；cap能力也可能在等待期间失效，之后仍会POST旧案。
- 两个浏览器RED分别证明未锁输入与能力失效后仍启动，日志 `%TEMP%/w-modes-preflight-red.log`，trace同名前缀目录。
- 修复：提交期间锁问题/基本mode/呈现；POST前通过最新输入ref、案件ID/保存值及capability controller最新快照再次检查。能力撤销时不POST，保留稿/截图并提示重新核对。
- 修复只做一轮本地回归与全量检查，不声称reviewer再次审查。真实I策略、供应商、付费、部署、最终视觉及旧已接收W任务不在此轮审查范围，沿原接收门未验收。

## 场景与证据

| 场景 | 测试 |
|---|---|
| envelope/schema与重复/虚构mode拒绝、未登录0请求、旧session成功/失败迟到作废、401/503清空能力与重试、truth/首项/空列表默认和draft匹配 | tests/web-model/capabilities.test.ts，5项 |
| truth/latest/identify各自保存真实mode→刷新恢复→报告追问新案建议保留同mode，明确新建draft不start | 自有模式浏览器3项 |
| 已存latest改identify禁止旧案start，原附件仍属旧案，新案无迁移 | 模式浏览器1项 |
| truth-only与未配置空cap不开放其他mode；空cap明确start503保留输入 | 模式浏览器1项 |
| 未登录不自动读；network/401/503错误可见，retry只GET保留输入 | 模式浏览器3项 |
| 无truth时默认服务首项identify；已有固定报告在cap失败/retry且新版存在时仍旧版不清空 | 模式浏览器2项 |
| 附件核对期间锁输入，能力失败时最终门禁拒POST | 模式浏览器2项 |

受控HTTP测试帮助文件 tests/web-model/modes-http-fixture.ts 以supportedBasicModes显式声明模式；只有测试注入controlled_fixture业务模块，实际HTTP/SQLite/宿主、schema与浏览器正常运行。图片为运行时生成的受控PNG，另案附件鉴权通过真实P路由核验。生产profile与I实现没有改动，不以工程测试替代三模式语义验收。


## 完整验证与保留的失败记录

| 命令 | 实际结果 | 退出码 |
|---|---|---|
| npm test | 77文件706/706，0跳过（本阶段新增5项） | 0 |
| npm run typecheck | 通过；测试收尾修正后也执行通过 | 0 |
| npm run build | 通过，153模块，index-C9cLNzTM.js；未改全局CSS | 0 |
| git diff --check | 通过，仅Git换行归一化提示 | 0 |
| Edge 完整 npm run test:e2e -- --workers=3 --output %TEMP%/w-modes-final-browser-2 | 38/38通过、0跳过（含本阶段12项） | 0 |

完整Edge首轮37通过/1失败，错误为无应用栈的Unexpected end of JSON input；失败trace中该latest案已经走到建议新案，基本模式显示latest。检查发现旧自有音频故障注入用例只等待重试POST请求，未等随后manifest JSON与异步路由收尾，存在跨用例遗留回调的可能。补齐最后manifest响应完成及unrouteAll({behavior:'wait'})后完整复验通过；这一可能来源没有被写成已证实的产品根因，没有吞掉JSON异常、扩大超时或跳过测试。首轮日志 `%TEMP%/w-modes-final-browser.log` 和失败trace `%TEMP%/w-modes-final-browser/` 均保留。

最终日志：`%TEMP%/w-modes-unit.log`、`%TEMP%/w-modes-final-browser-2.log`。新增模式用例12项全部在完整38项中通过，包括两个post前竞态回归；无需再声称未跑的远端CI或真实I已通过。

## P 集成说明

- 完整接收codex/w-media-ui历史；本阶段固定基准1130f904616ee13d15df0609f0a46b6a80c6f9ed已完整快进，不仅取任务书。
- 新只读GET /api/v1/capabilities仅认证后读取，不能从health猜三模式。错误将能力设未知并明确只读核对，不清case/report/伴读/历史，不切latest。
- 新草稿真实basicMode进入foundation schema，保留case.basicMode恢复；已保存后改模式须显式另案，POST前实时复核。建议新案保留原mode，不自动start，附件不迁移。
- 空basicModes的truth只允许保留原稿及用户明确503流程，不是假开放调查；首次未知/失败不会默认all modes。
- I核心prepare/三模式质量、生产供应商、真实费用、部署与产品AC由P后续接收核验。受控支持三模式的宿主只在tests，未改生产truth配置。
- 真实供应商0次/0元，未读凭据、未动P/shared/调查/根依赖/视觉主题。未推远端、未合主目录，工作树保留供P接收。


## 完整提交范围

- 固定基准：`1130f904616ee13d15df0609f0a46b6a80c6f9ed`。
- 本阶段最终实现及审查修复：`f736dffba54481b46c100defe69d8458f5e4c894`。
- 分支：`codex/w-media-ui`；末尾文档收尾提交的完整HEAD见本轮交接消息，P完整合入本分支历史。
- 工作树：`C:/Users/111/.codex/worktrees/web-headless/侦探agent`；未推远端、未合主目录，已保留。

相对固定基准写入9个文件：

- `docs/runtime/W-三模式能力接线交付.md`
- `src/web/api/capabilities.ts`
- `src/web/controllers/capabilities.ts`
- `src/web/main.tsx`
- `src/web/model/basic-mode.ts`
- `tests/ui/media-audio-retry.spec.ts`
- `tests/ui/media-modes.spec.ts`
- `tests/web-model/capabilities.test.ts`
- `tests/web-model/modes-http-fixture.ts`
