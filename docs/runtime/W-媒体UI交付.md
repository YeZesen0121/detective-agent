# W 媒体 UI 接入交付与执行记录

任务：docs/协作交接/媒体UI接入/W-媒体功能接入UI.md，W-A～W-C。

- 分支：codex/w-media-ui；隔离工作树沿用 web-headless。
- 实际完整合入基准：c77408b004782732b81fac5e406446eabae6ea57（含代码基准 1b17cebff761257f174d926488830dcff46d0ccb）。旧 W 工作已提交，快进无冲突。
- 仅写任务允许的 W 路径；不改 P/shared/根配置、全局 CSS、既有视觉组件。
- 真实供应商调用 0 次 / 0 元，不读取凭据。所有替身标记 controlled_fixture。
- 执行 executing-plans / TDD / verification-before-completion；局部可用性参考 ui-ux-pro-max。

## 前置核对与取舍

- A→B→C 共用 ExperienceApi 和按会话/案件/版本隔离的提交恢复记录；HTTP TurnView 独立于领域 CompanionTurn。
- Ruling：执行记录直接写本文件，避免在派发写入范围之外增加计划文件。
- PRD 与伴读适配决定结论和未知先呈现、段落关联证据、口气不改事实；不加入世界编辑器或答题门槛。来源展开复用已有报告与局部 evidence 详情。沿用 W epoch 播放控制，不新增全局状态框架。
- GET recovery 的 null 永远不证明未提交；unknown 不自动重发或换 key。浏览器只缓存恢复标识，不缓存正文、图片、音频或 cookie。

## 增量记录

- W-A：API/上传控制器/草稿接线已完成。RED：新模块不存在；GREEN：定向 7/7，全量 55 文件 521/521，typecheck/build/diff-check 均退出 0。npm ci 206 packages，Node 24.19.0 / npm 11.17.0。浏览器旅程在 C 阶段统一验证。
- 公共测试同步需求：按任务将一步开查拆为“保存草稿→开查”，现有 tests/ui 中创建新案的用例需要在原“开查”前点击“保存草稿”。这些旧测试文件不在 W 写入范围，本轮不自行修改；新 tests/ui/media-*.spec.ts 验证新流程。

- W-B：同版发现/分页历史/显式生成/打断与游标 PATCH/收尾和重开已实现。定向 5/5，typecheck 0。HTTP TurnView 独立显示 reply.kind；补查请求保留方向并明确未执行，不伪造 run。

- W-C：真实浏览器 AudioDriver（同源鉴权 URL、Range、同步停止/清 src、迟到 promise 隔离）、音频任务 singleflight/恢复/取消/分段播放、局部控件已实现。没有临时 objectURL，因此无 objectURL 生命周期泄漏；服务器图片 URL 只在鉴权会话内可读。
- 2026-10-25 中间验证：全量 57 文件 536/536；typecheck/build/diff-check 0。新增音频边界后定向 media-audio 7/7。最终完整检查见后续记录。
- 媒体浏览器 4 个旅程在完整 e2e 运行中已通过：三图+丢响应原 key 恢复+刷新+503保图+360px+跨session404；旧伴读notice到显式新版；固定版伴读/追问/游标/收尾/重开+真实浏览器多块播放+404文字保留+真实Range416；本地停播与显式取消生成。核心 API 全部真实 P HTTP/SQLite/host，只有供应商 controlled_fixture；丢响应通过 route.fetch 后断开，错误播放仅单个asset故障注入，没有拦截所有核心API。
- 测试素材修正记录：初次多块测试因 E 丢弃模型重复文案而只有1块；扩大保存的受控报告条件。一次试图更新已建测试快照被数据库不可变触发器拒绝，改为提交前构建长条件，无绕过触发器/改P代码。追问恢复游标原先用模型提供的1，实际 E 使用当前保存游标0；测试改为先选择第二段再追问，遵守真实语义。
- playable fixture 在运行时用机器已有 ffmpeg 生成 440 Hz 提示音（进程 stdout 内存），不保存/提交音频，未引入依赖。它证明浏览器可解码/顺序播放，不能证明真实TTS或听感。手机仅360px模拟。


## 独立审查与修复

一名 fresh-context reviewer 只读检查 c77408b..2e69b54，未读凭据、未改工作树、未运行真实调用；2 项 Important、0 Critical、1 Minor。

1. PATCH 开始后启动的轮询可在 PATCH 完成后回滚游标/ended。新增“PATCH 在途启动读取”的回归，先观察 0 ≠ 2 的失败，再使 busy 期间拒绝 refresh、停止计时器、PATCH 结束二次作废读取。回归通过。
2. 新音色/重试提交 failed 或 unknown 会遮蔽 journal 中旧 confirmed 音频。新增 failed/unknown 两个失败回归，分开恢复“最新提交”与“最近已确认音频”；unknown 仍禁止写，旧音频可播。回归通过。
3. 恢复 B 音色时选框可显示默认 A。选框在异步 manifestVoiceId 首次恢复时同步，稳定 voiceId 不覆盖用户后续选择；媒体浏览器旅程增加 B 音色生成与刷新恢复断言。

修复由 W 本地回归/全量验证，不声称独立 reviewer 再次审查通过。Declined to judge 的真实 API、真实 TTS 听感、最终视觉、部署、真实手机、旧测试所有权均确实在本轮外，保留为未验收。

## 完整浏览器套件与 P 最小集成改动

实际运行 `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e -- --workers=3`：17 项中 **6 通过 / 11 失败 / 0 跳过**，约 2.8 分钟。四项媒体场景都通过；11 个旧用例全部仍定位首屏“开查”，而规范要求首屏先“保存草稿”。4001 字用例的禁用断言也需指向“保存草稿”。没有扩大超时、禁用用例、改回一步开查或把失败写成成功。

P 集成时最小调整（这些旧文件不在 W 可写范围）：

| 文件 | 调整 |
|---|---|
| tests/ui/dev-proxy.spec.ts | 新建案的首次“开查”前先点击“保存草稿”；刷新恢复的既有草稿仍直接“开查” |
| tests/ui/workbench.spec.ts | 首次提交先“保存草稿”再“开查”；两个会话 HTTP 隔离用例不用改 |
| tests/ui/runtime-states.spec.ts | 两个新建案旅程先“保存草稿”再“开查” |
| tests/ui/revision.spec.ts | 新建案的初次操作补“保存草稿”；501/4000 字走两步；4001 字断言“保存草稿”禁用 |

完整失败日志：`%TEMP%/w-media-e2e.log`；旧用例 trace 保存在本工作树 `test-results/`。最终定向媒体复测另用 `%TEMP%/w-media-final-browser/`，不覆盖全量失败证据。测试实际 P 服务用 32760+worker；现有根 Playwright 启动器仍用固定 3000/5173（当时能独占启动），未改根配置。P 并行运行时需避开这两个启动端口，或统一提供可配置端口。

## 集成约定

- 完整合入 codex/w-media-ui 历史；不要只取最后的文档提交。既有 P/UI/I/E 基准仅快进接受，没有 W 自行修改。
- main 保留原视觉，只增功能接线：保存草稿→最多三图→显式开查。保存后改问题/呈现会禁用开查并要求新案，绝不把改后的输入悄悄送进旧案。4000 字不回退500。
- API 以 shared schema 推断 JSON 类型；204/二进制独立处理；FormData 不指定 boundary；没有 cookie/localStorage 凭据访问。sessionStorage 仅最小恢复标识/key，按公开会话期限与access group命名空间、case/version/companion/segment隔离，401清除当前 journal。
- unknown 的 null 仍 unknown，仅有上限的退避 GET，不自动POST/换key/加预算。停止本地读取不等于取消服务端任务。服务器明确拒绝/费用待对账以安全错误展示，不能把 fixture 配置注入生产。
- 显式切版经既有 result controller，提交新版本前同步停旧音频，组件卸载取消旧轮询；notice 本身不换段落。游标/ended 只在 PATCH 确认后更新。HTTP TurnView 不伪造 CompanionTurn；research_request 只保留方向及未执行状态，等待 P 新的正式 followup 协议后另行接入。
- 音频生成与播放分开。用户手势 play；NotAllowedError 指引再点播放、不重发TTS；切段/追问/切案/卸载停止播放；取消生成才 POST cancel。失败/partial/unknown保留旧文字和已保存音频。换音色显式开新请求，旧 job 身份保持不变。
- 生产无 transport/价格/音色的 503/configured:false/voices:[] 是有效状态。未验收真实 API、费用、TTS听感、真实手机和部署；本轮真实调用 **0 次 / 0 元**。


## 最终验证与场景矩阵

| 验证 | 实际结果 | 退出码 |
|---|---|---|
| npm test | 57 文件，541/541 通过，0 跳过；本轮新增 27 项 | 0 |
| npm run typecheck | 通过（最终浏览器测试定位调整后也重新执行） | 0 |
| npm run build | 通过，144 前端模块；产物 index-CMms_vq8.js | 0 |
| git diff --check | 通过，仅 Git 换行归一化提示 | 0 |
| msedge 完整 test:e2e -- --workers=3 | 6 通过、11 旧入口用例失败、0 跳过 | 1 |
| msedge test:e2e -- tests/ui/media-experience.spec.ts --workers=3 --output %TEMP%/w-media-final-browser-2 | 4/4 通过，0 跳过，25.9秒 | 0 |

最后一轮媒体浏览器曾因 wrapped label 的严格 getByLabel 定位不到音色框而 3过1失败；可访问性快照确认 combobox 名为“音色”，改用 getByRole('combobox', {name:'音色', exact:true}) 后4项全部通过，未提高超时。此前失败日志及 trace 在 `%TEMP%/w-media-final-e2e.log`、`%TEMP%/w-media-final-browser/`，最终日志 `%TEMP%/w-media-final-e2e-2.log`。全量单测日志 `%TEMP%/w-media-final-unit.log`。

| 场景 | 证据 |
|---|---|
| 同图不同 key 不合并、同key singleflight、字节上限、跨案迟到、pending重开、401清恢复 | media-attachments 5项 |
| ID校验、multipart、204、binary404/416、原key GET null | media-api 4项 |
| 同版发现不POST、notice不换正文、失败/在途分页、两种PATCH轮询竞态、同动作追问合并、unknown只读、跨版迟到 | media-companion 9项 |
| NotAllowedError、旧play promise、stop/dispose、生成singleflight、跨段迟到、unknown原key、partial、换音色身份、失败/unknown不遮蔽旧音频 | media-audio 9项 |
| 三图丢响应→真实 GET恢复→刷新→显式start503保图→删图、360px、另一session404 | 媒体浏览器第1项 |
| 旧版notice保段落→显式新版，不自动生成新伴读 | 媒体浏览器第2项 |
| 固定报告→伴读→B音色多块真实浏览器播放→停播→404文字保留、真实Range416→刷新恢复音色→360px追问/游标/收尾/重开 | 媒体浏览器第3项 |
| 本地停止不发cancel；显式取消生成真实POST，迟到供应商回执不恢复播放 | 媒体浏览器第4项 |

最终截图（本机临时证据，未提交私有资产/音频）：

- `C:/Users/111/AppData/Local/Temp/w-media-final-browser-2/media-experience-controlle-ffbf0-creen-and-session-isolation-chromium/media-three-images-mobile.png`
- `C:/Users/111/AppData/Local/Temp/w-media-final-browser-2/media-experience-controlle-07fda-ial-playback-and-local-stop-chromium/media-companion-mobile.png`

公共协议缺口：当前媒体路径未发现必须改 shared/server 的缺口。正式异步 followup 接口由 P 后续发布，未猜测实现。P 需先按上表同步11项旧浏览器用例，再在集成分支重新跑完整套件；当前不能宣称完整 e2e 全绿或产品验收完成。


## 完整提交范围与写入文件

- 实际基准：`c77408b004782732b81fac5e406446eabae6ea57`。
- W-A：`4a620d413d063e19a77708b8318ef2628136328e`。
- W-B：`332fd3cce95bd69e13495c906974887d1ebccadf`。
- W-C：`2e69b54255c5044bab9535f666ade6ffbe27860e`。
- 最终代码及审查修复：`5a06ea4a8d4f3af155b84650e9b543b65ae43841`。
- 分支：`codex/w-media-ui`；最终交付还包含本记录的收尾提交，完整分支 HEAD 在本轮交接消息提供。P 合完整分支历史。
- 保留独立工作树 `C:/Users/111/.codex/worktrees/web-headless/侦探agent`。不推远程、不直接合主目录，不清理该工作树。

写入文件共19个（相对实际基准）：

- `docs/runtime/W-媒体UI交付.md`
- `src/web/api/experience.ts`
- `src/web/controllers/attachments.ts`
- `src/web/controllers/audio-session.ts`
- `src/web/controllers/audio.ts`
- `src/web/controllers/companion-session.ts`
- `src/web/controllers/media-submission.ts`
- `src/web/main.tsx`
- `src/web/ui/media/AttachmentsPanel.tsx`
- `src/web/ui/media/AudioControls.tsx`
- `src/web/ui/media/CompanionPanel.tsx`
- `src/web/ui/media/browser-audio.ts`
- `src/web/ui/media/media.css`
- `tests/ui/media-experience.spec.ts`
- `tests/web-model/media-api.test.ts`
- `tests/web-model/media-attachments.test.ts`
- `tests/web-model/media-audio.test.ts`
- `tests/web-model/media-companion.test.ts`
- `tests/web-model/media-http-fixture.ts`


## P 审查返修：重试音色必须匹配已保存音频（2026-10-25）

修复前工作树完整HEAD：`4ead69656e64133c4fb292e8f7ceeec64e6bc369`（固定版本追问已经交付）。本返修独立提交，只涉及两个媒体源文件、两个自有测试及本记录，供P在媒体接收后单独cherry-pick，不要求先接固定版本追问。

P提出的场景已由实际回归确认：A音色partial显示→切B被409拒绝→刷新选框/当前音频恢复A，但“明确重试生成”错误读取最新失败submission.voiceId=B。

- 浏览器 RED：实际点击请求 `Expected controlled_voice / Received controlled_voice_b`，退出1；未靠静态字符串检查代替交互。
- controller RED：A保存/B失败记录后 generate('b',true) 实际发出一次B请求，断言0次失败。
- 修复：按钮读取manifestVoiceId，且该已保存音色须仍可用；controller拒绝retry与当前保存音色不一致的调用。显式换音色仍用独立“用所选音色生成新音频”动作。
- 浏览器测试复用真实P HTTP/存储/宿主和controlled_fixture E。仅注入两个故障边界：已存ready manifest投影为partial、B生成请求返回409；A生成和恢复仍走真实P路径。本测试验证UI重试身份，不宣称真实partial供应商或听感验收。
- 新用例：tests/ui/media-audio-retry.spec.ts。RED日志 `%TEMP%/w-media-voice-retry-red.log`，失败trace `%TEMP%/w-media-voice-retry-red/`；controller回归追加在media-audio.test.ts。
- 不处理I所有权、不改P/shared/根配置/全局主题。P7新基准1fcf6c8尚未合入；本轮0真实调用/0元。


返修最终验证：

| 命令 | 结果 | 退出码 |
|---|---|---|
| npm test | 64文件620/620，0跳过；新增controller防错音色回归 | 0 |
| npm run typecheck / npm run build / git diff --check | 均通过；149模块，index-C-ZFTqJq.js | 0 |
| msedge test:e2e -- tests/ui/media-audio-retry.spec.ts tests/ui/media-experience.spec.ts --workers=3 --output %TEMP%/w-media-voice-retry-green | 5/5通过（新回归1+原媒体4），0跳过 | 0 |

新回归确认请求序列A→B被拒→刷新显示A→重试请求A；controller拒绝以retry=true向B派发。GREEN日志 `%TEMP%/w-media-voice-retry-green.log`，全量单测日志 `%TEMP%/w-media-voice-retry-unit.log`；RED trace保留未覆盖。旧仓库完整浏览器11项入口同步仍由P处理，本次未声称全仓e2e通过。

独立修复提交仅包含：`src/web/ui/media/AudioControls.tsx`、`src/web/controllers/audio-session.ts`、`tests/web-model/media-audio.test.ts`、`tests/ui/media-audio-retry.spec.ts` 和本记录。P可在完整接收94d7718媒体后单独cherry-pick本提交；不必为此先取固定版本追问。最终完整修复SHA见本轮交接消息。
