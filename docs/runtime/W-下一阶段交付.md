# W 下一阶段：交互编排与接入测试

用户明确授权执行 W-N1～W-N3。外部任务书：D:/侦探agent/docs/协作交接/下一阶段/W-交互编排与接入测试.md。

- 基准 SHA：2c6b0127591a76adc0341f8d217aa580784c7c08，contractVersion 0.1.0。
- 已保留旧分支 codex/web-headless / abb51a2cecb8dbadcd84fc120d55e080a1d8c00a；同一角色原隔离工作树新建 codex/web-next，并快进指定基准（已包含完整旧 W 历史），不重做 W1–W5。
- 工作树：C:/Users/111/.codex/worktrees/web-headless/侦探agent。
- 写入：src/web/api、controllers、model，tests/web-model，本报告；不自行改 UI、P/shared/server/migrations/root/deps 或旧交付报告。
- Node 24.19.0 / npm 11.17.0；npm ci 成功。所有业务/供应商替身仅 tests 内 controlled_fixture；不读 .env、不跑 live、不发送供应商请求。

## 执行计划与决议

延续 executing-plans/TDD 内联执行，唯一报告兼账本；用户已确认任务书，不另起需求或视觉设计审批。

1. N1：investigation.ts 动作控制器复用 FoundationApi、RuntimeApi、TaskController；按 case/action/previousRun 或 clarification/answer 绑定逻辑动作和固定 key，双击合并；写响应未知先 GET 恢复，不自动 POST。case generation + action revision 防旧 GET/POST/澄清回写。明确重试调用原方法，复用同一逻辑 key。
2. N2：result.ts 控制器复用结果 reducer，select 请求代次、notice/copy 独立代次，绑定案件和版本。notice 只更新提示；明确打开新版才更换正文，并同步通知宿主停止旧声音。复制绑定选中版本，失败保留旧内容。
3. N3：真实 loopback Fastify 端口，测试内注入 controlled_fixture；真实 W fetch/client/controller 穿过 HTTP，网络延迟由 deferred/gates 控制，无任意 sleep。覆盖任务书全部路径；不改服务器以迁就测试。
4. 每阶段先红后绿、完整测试/typecheck/build、小提交；最终独立只读审查整轮及回归。报告给 UI 导出/生命周期/接入注意。

决议：复用既有隔离目录而保留旧分支引用，新阶段分支 codex/web-next。纯控制器不承诺真实点击/手机/语音/部署/语义验收；最终不自动合主线或推远程。

## N1 执行证据

- 指定基准 npm ci 0（201 packages）；npm test 0（32 文件/310 测试），typecheck/build 0。
- 12 项缺实现断言先红后绿；另补旧 GET 失败覆盖新动作、disconnect 误留 connected 两项，均先复现失败再修复。
- N1 当前完整 npm test 0（33 文件/324 测试），typecheck/build 0。
- 控制器增加 dispose 以解绑 TaskController 订阅；disconnect 可保留材料并再次 open，不取消服务端。响应未知保留 outcome=unknown，即使 GET 找到运行任务也不冒称 POST 已确认；明确重试才复用原 key。

## N2 执行证据

- 9 项缺实现断言先全部失败，再实现通过；完整 npm test 0（34 文件/333 测试）、typecheck/build 0。
- select/notice/copy 各自有取消与代次；复制返回 versionId+text，迟到复制返回 null。读取失败保留旧 report，不依 notice 改写正文；notice 刷新发现同 ID hash 改变时报告协议错。
- onVersionChange(previous,next) 在已验证同案的版本提交前同步执行，宿主在该钩子 audio.stop()；无自动播放。钩子异常则保留旧报告，钩子重入导致代次变化时不提交旧响应。断开页面时宿主仍应显式 stop/dispose 音频。

## N3 执行证据（审查前）

- interaction-http.test.ts 6/6 通过：真实 Fastify listen(127.0.0.1, port 0)，真实 fetch 与 W RuntimeApi/两个动作控制器穿过 HTTP；不以 stub TaskPort 代替网络。
- 覆盖双击/延迟 ack、丢失响应后发现已完成 run 及显式同 key 重试、取消 POST 后 GET 失败只读恢复、跨会话 404、Origin 拒绝、澄清重复、新旧报告/复制/延迟 select、disconnect 后旧 POST 不跟随/不 cancel。
- 业务模块/供应商严格测试内 controlled_fixture；网络延迟为 deferred 闸门，轮询调度为手动 scheduler/状态订阅，无任意时长 sleep。每个本地服务最终关闭，所有 paid provider 调用数为 0。
- 审查前并行运行完整 npm test / web-model / build：完整 npm test 退出 1，338 pass / 1 fail；P 的 truth-configuration.test.ts 第一项动态导入配置测试超出 5000ms（5169ms），无断言不符。web-model 0（10 文件/119 测试），typecheck/build 0，UI bundle hash 不变。前一提交误提前记全量通过，现已核对输出并更正；不得将此失败计 PASS。随后单独复现和顺序重跑见后续记录，未改 P 或 timeout。
- N1、N2 为先失败后实现的功能测试，N3 为既有实现穿过真实 HTTP 的接入验证，不冒称它首次运行失败。

### 超时复核

未修改 P 的配置模块/测试，单独 `npm test -- tests/platform/truth-configuration.test.ts` 退出 0（2/2），约 1.67s；再单独执行默认 `npm test`，退出 0（35 文件/339 测试，无跳过）。并发 CPU/动态导入争用符合已观察现象；未用此推断删除失败记录或修改全局 timeout。

## 独立审查与单轮修复

只读独立审查基准 2c6b012..7d4e25f：2 Important、1 Minor，无 Critical。审查者没有改文件/index/HEAD、没有读取 .env 或调用真实供应商；完整测试证据来自执行方，没有冒称独立复跑。

三项发现均补测试并观察失败（结果 2 项 + 真实 HTTP 恢复 1 项）后处理；本轮未另派重复审查，修复依据回归与完整检查：

1. 较早 select(V2) 返回 null notice 会抹掉期间已确认的 V3：选版记录 notice 代次，保留在其后成功确认的提示，再结束旧版 notice 生命周期。
2. 最新报告对应 run 被误当最新任务：cancelled/failed/interrupted 不再从旧报告猜当前 run。读取已有公开 run.queued 生命周期事件，以最大案件 seq 找最新入队 run，再 GET 核对 run ID/案件/status 后跟随。公开事件由 P 随创建/澄清事务持久化，业务模块不能自造；不需要修改 P 契约。
3. 并发 notice 在选版后永远 loading：与第 1 项同一生命周期修复，选版提交显式 abort/结束旧 notice 并清除 noticeRefreshing。

最初保守修复只标出最新终态 ID 不可知；继续检查 P 已有只读事件后找到完整恢复路径，并以真实 HTTP 再次先红后绿验证“R1 已有报告 → R2 取消 → 新控制器恢复 R2 → resume 仍用 R2 预算”，没有停留在本可解决的契约阻塞。恢复若事件缺失/不前进/超过 100 页或状态不一致，则 recoveryIncomplete=true，保留案件/旧报告入口、禁止提交猜测的继续目标；读取失败按安全错误呈现，可明确重新 open。

补充跨页最新任务和缺生命周期记录的保护测试。当前 N1 16、N2 11、N3 7，共 34 项定向测试通过；typecheck 0。修复过程中一项新错误状态最初直接放 Error，structuredClone 丢失 code，已由同一回归捕获并改成 safeError plain object。

审查暂不判断事项：供应商真实质量/收费/部署与浏览器点击/移动端/听音/资源释放不在本轮；公共 P 字段实现不归 W，实际恢复使用现有事件完成而没有新增公共字段。

## 给 U/P 的控制器接入说明

### 调查动作

`createInvestigationController({foundation,runtime,keyFactory?,task?})`（src/web/controllers/investigation.ts）：

- foundation 只要求 getInvestigation；runtime 为已发布 RuntimeApi；task 可注入既有 TaskController（测试可注入 scheduler），默认使用 createTaskController(runtime)；keyFactory 默认 crypto.randomUUID。
- `open(investigationId)` 只读案件/现存 run，必要时读已保存 latest result 找到已完成 run，再 follow；不 POST。换案件提高 generation，并丢弃旧案显示/动作缓存。
- `start(action,previousRunId)`，action 为 start/resume/add_budget：同逻辑动作合并 Promise 和固定 key；重复成功调用不重复 POST，显式失败/未知重试复用原 key。不会自动 add_budget。resume/add_budget 要有 previousRunId。
- `answer(clarificationId,{answer,proceedWithUnknown})`：只接受真实 waiting_for_user 与当前保存问题；相同答复去重，新的问题有新的逻辑签名；迟到旧答复不重启新问题轮询。
- `cancel()` 调既有 TaskController.cancel；取消后的网络错误也不能由宿主擅自当作已取消。disconnect 只停本地 IO。
- `getState()` 返回冻结快照：investigationId、investigation、task、phase（idle/loading/ready/submitting/recovering/error）、submission（kind/key/outcome）、error。task 内 status/budget/clarification/events 保持服务器数据。phase=ready 只表示读状态可用；不能把它当“调查完成”或“POST 成功”，必须读 run.status / submission.outcome。
- 写结果未知时 submission.outcome=unknown，保留安全错误；只读恢复后仍不冒称已收到 POST 确认。用户明确再次调用原动作才重发同 key。没有收到响应，不代表服务端停止或请求未计费。
- `subscribe(listener)` 返回 unsubscribe；`disconnect()` 可保留材料后再次 open；`dispose()` 永久失效并解绑 task 订阅。一个 controller 配一个任务阅读器，不与另一个案件 UI 共同驱动同一 task。

### 固定版本结果

`createResultController({runtime,onVersionChange?})`（src/web/controllers/result.ts）：

- runtime 只要求 getResult/copyResult；`select(versionId)` 为显式选版，首次成功绑定案件；后续不同案件版本拒绝，换案件请重建 controller。
- `refreshNotice()` 只 GET 当前选版并更新 updateNotice；不替换正文/hash，不停声音，不重建旧伴读。并发旧 notice 不覆盖新 notice。
- `openLatest()` 读取当前 notice 指定版本；未有 notice 则不发请求。只有 select/openLatest 成功后才替换正文。失败保留旧报告可读。
- `onVersionChange(previous,next)` 同步钩子：在新版本完成归属校验、提交显示前调用。宿主应接 `() => audio.stop()`；新伴读也应重新绑定明确版本，不自动播放。只收到 notice 不触发此钩子。
- 异步声音沿用已有 epoch 协议：显式开始前 audio.stop()，保存 epoch，迟到 manifest 只能 audio.play(manifest, epoch)。切版钩子会提高 epoch，旧 play/加载/切段完成不得复活。真实浏览器 seek/objectURL 仍归后续 driver 接线，不声称已测。
- `copy()` 固定调用当前 selectedVersionId 的 copyResult，返回 {versionId,text} 或 null；只有非 null 才交给剪贴板。迟到旧版/断开后的 copy 不可用于新报告。文本直接来自 P，不删条件/未知/时间/来源。
- 状态：data（原 ResultViewState）、phase、selectionPending、noticeRefreshing、copying、copy、error；subscribe/unsubscribe、disconnect、dispose 与上面同义。离开页面时宿主另行 audio.stop()/dispose()。

### 范围和验收

本轮没有页面、组件、CSS、design-handoff、共享 wire 字段或服务器变化。N3 为本地真实端口/HTTP 的控制器集成验收，仍是 controlled_fixture；不是实际用户点击、手机、真实供应商、语义、云 TTS 试听、浏览器音频资源、部署或完整产品 AC 验收。

文件清单：src/web/controllers/{investigation,result}.ts；tests/web-model/{investigation-controller.test,result-controller.test,interaction-http.test,interaction-http-fixture}.ts；docs/runtime/W-下一阶段交付.md。原 W1–W5 文件未复制或重做。

### 最新终态恢复补充

state 另有 `recoveryIncomplete:boolean`。open 在无 activeRun 且案件为 cancelled/failed/interrupted 时，分页读取本案公开入队生命周期（最多100页），用最大 seq 的 run.queued 定位最新 run，再 GET 确认 ID/案件/status。不是用旧报告 runId 猜当前任务；不自动 POST。记录缺失、不前进、超上限、状态变化导致无法确认时，phase=error、recoveryIncomplete=true，保留案件和历史报告入口，禁止使用猜测的 previousRunId；明确重新 open 可重试只读恢复。实际本地 HTTP 已验证新控制器能恢复 R2 并 resume 原预算，无待 P 增加字段的阻塞。

## 最终交付与验证

- 最终实现 SHA：`2a489ac0c13aaf9ec97641a119aaa5b0115e8ec3`；后续只补本报告，完整最终分支 SHA 在聊天交付并可由 `git rev-parse codex/web-next` 核对。
- 基准：`2c6b0127591a76adc0341f8d217aa580784c7c08`；分支 codex/web-next；原隔离目录不变。
- 最后顺序执行默认 `npm test`：退出0，35文件344/344，无失败/跳过（基准310 + 本轮34）。
- `npm test -- tests/web-model`：退出0，10文件124/124，无跳过。
- `npm run typecheck`：退出0；最后 `npm run build`：退出0（同样先运行 tsc --noEmit）。
- `git diff --check`：退出0；范围为上述7个文件；shared/server/migrations/根配置和依赖/main/UI 对基准无自行修改，页面 bundle 仍 index-vL9xy0FN.js。
- 真实外部供应商调用0次，费用0；未读取 .env、未跑live、未部署、未合主线、未推送远程、未自动联系其他对话。同机可直接按本地分支取完整历史，无需bundle。
- N1 提交 `6c2ba82`；N2 `b0886ba`；N3 `09f300d`；超时证据更正 `7d4e25f`；审查修复 `2a489ac`。全部任务实现/测试按阶段提交，没有只交最后报告遗漏代码。
- 独立审查提出的2 Important和1 Minor已在同一轮修复中处理，新增失败回归和最终全量验证是修复证据；未声称审查者对修复后代码又做过独立复跑。没有已知遗留的本轮阻断问题。
- P 集成到当时的新平台版本后必须重新执行相关及完整检查；本地结果不能替代远程CI或产品AC。

## 决议影响

- 唯一报告兼计划/账本，避免越权写文档；不使用通用脚本生成另一套进度真源。
- 控制器状态与服务器事实分开，错误记录为安全 plain object；phase不是业务成功状态。代价是 UI 要同时处理 submission.outcome、task.run.status 和 recoveryIncomplete。
- 最新终态恢复用现有公开生命周期；最多100页，发现竞争变化/记录不足时明确不完整而不猜测。代价是极长历史或持续变化案件需重新读取或由P提供更直接的查询能力，本轮未改公共协议。
- 同版本 notice 与选版有独立请求代次；宿主同步停旧声音，迟到copy返回null。真实浏览器资源和剪贴板调用仍需接线阶段验证。
