# M 后台盯梢交付

## 授权、基准与范围

2026-10-24，用户在本对话明确派发 M，按外部任务输入
`D:/侦探agent/docs/协作交接/功能并行开发/05-M-后台盯梢.md` v1.0 实施。
基准 `1aaf2d197bdeb7f9987338b6ea6aa2fffc489835`，contractVersion `0.1.0`。
分支 `codex/watch`，工作树 `C:/Users/111/.codex/worktrees/watch/侦探agent`。
只写 `src/server/watch/`、`tests/watch/` 和本报告；不修改 shared、平台、迁移、app 或根依赖。

## 实施计划

Goal：完成可注入宿主的服务端检查编排，支持 P/I 后续真实集成。
Architecture：M 串行 claim→execute→compare→finish，P 负责原子权限、预算和持久化；I 负责事实比较。
Tech Stack：Node 24.19.0 / npm 11.17.0 / TypeScript / Zod / Vitest，无新增依赖。
Spec：PRD v1.0 §9、系统设计 §8/D06、实施接口契约、M 任务包 M1–M3。

1. M1/M2：定义 ports.ts；scheduler.ts 管本地并发、可注入心跳、Abort 和 stop；index.ts 导出。
   先写 scheduler.test.ts 失败断言，再最小实现；测试 claim=null、并发 tick/manual、迟到 claim、心跳失效、停止与清理。
   `npm test -- tests/watch/scheduler.test.ts` 预期红→绿，随后 typecheck/build 并独立提交。
2. M3：check.ts 管候选/比较的 schema 与归属校验、三态映射；tests/watch/check.test.ts、versions.test.ts 验证。
   先写失败断言；覆盖页面 A/B、页脚、读取/模型失败、开放问题转载/排名/新公告、非法证据、失效提交、A→B→A。
   `npm test -- tests/watch` 预期红→绿；全量 test/typecheck/build 后独立提交。
3. 最终复核：检查异步边界和写入范围，完成接口说明、证据与未验证项，提交报告；不合并主线。

Review Focus：并发重复检查；失败误报无变化；心跳/停止期间迟到执行；失效 lease 迟到提交；旧报告/伴读改写；回转变化被压掉。

本轮直接按已派发实施计划执行，不创建额外设计文件或子 Agent。
所有测试材料标记 controlled_fixture；没有真实 API 或付费探针。

## 基线检查

在上述隔离工作树执行：`npm ci` 退出 0（201 packages）；
`npm run typecheck` 退出 0；`npm test` 退出 0（5 文件，44/44，0 跳过）；
`npm run build` 退出 0（tsc + Vite）。

## 执行记录

### M1/M2 第一增量

- 已定义宿主端口及导出，scheduler 无 import/构造时启动定时器；每次 tick/manual 最多取得一个本地槽位。
- 采用可注入 one-shot timer，默认 30s 心跳；心跳不重叠，提交前等待在途心跳。
- stop、心跳失败和 context/watch 期限触发 Abort；迟到结果不会 compare/finish；停止等待清理。
- `npm test -- tests/watch/scheduler.test.ts`：先 12/12 失败（未实现工厂），实现后 12/12 通过，退出 0。
- `npm run typecheck`、`npm run build`：退出 0；`npm test`：6 文件，56/56，退出 0。
- 此增量 check.ts 仅有基本 execute/compare 映射，M3 将补充 scope、证据及技术失败保护，不能提前作为完整模块集成。

### M3 检查与版本增量

- check.test.ts 首次 31 项中 20 失败、11 已被基础实现覆盖；失败指出读取失败误报、run/scope/lease 校验及证据闭包缺失等问题。
- 最小实现后 `npm test -- tests/watch`：3 文件，50/50，通过、无跳过，退出 0。
- `npm run typecheck` 退出 0；`npm test`：8 文件，94/94，退出 0；`npm run build` 退出 0。
- 已覆盖 page A/B、页脚 contentHash 变化，open_question 排名/转载/新公告的注入比较结果；未实现另一套 I prompt/search 循环。
- versions.test.ts 使用严格内存宿主双重检查前基线、epoch、scope；证明 M 会交回完整 lease、不重试 finish=false、不在本地压掉 A→B→A。
  double 的通知和快照仅是宿主契约样例；不能证明 SQLite 原子性、真实去重或事实比较正确。
- 保守规则：任何读取失败都降为 unknown（仍向 I 传 readFailures）；stopReason 非 answered/no_useful_direction 的候选也不推进成功基线。
  这是本模块避免不完整执行误报成功的实现选择，可能延后部分有价值变化的提醒。
- scope 可更新 referenceTime，其他字段必须与 lease.before 一致；模型/读取/结构异常无自动重试，由 P 的有界 gateway 和后续周期处理。

### 独立审查与修复

依据 requesting-code-review 技能安排一次只读 reviewer，审查 G0 至 `9f4adf3096133ad9158dd0ba5df82ab91f151499`。
无 Critical，确认两项 Important，已全部修复，无遗留 Minor：

1. stop 在 claim 的微任务启动前获胜，原实现仍发 claim。现在进入 run 时先检查取消；已经在途的 claim 返回后仍 fail 清理。
2. 原实现运行中只靠 timeout 回调判断期限。现在 execute 后、compare 后和 finish 前重新核对 context.deadlineAt/watch.expiresAt，事件循环延迟或时钟跳变也会停止后续动作。

两项对应新增 3 个回归断言，先 3 失败/12 通过，再 15/15 通过。
`npm test -- tests/watch`：53/53；最终全量 `npm test`：8 文件、97/97，0 失败、0 跳过；
`npm run typecheck`、`npm run build` 均退出 0。运行于本地 Windows / Node 24.19.0 / npm 11.17.0。
审查者读取工作树时看到了尚未修复的 3 项新增失败测试，其报告是修复前状态；最终结果以上述修复后实际检查为准。

## 交付文件与任务状态

|任务|文件|本轮完成边界|
|---|---|---|
|M1|src/server/watch/ports.ts、index.ts|私有宿主接缝与统一导出，共享契约未改|
|M2|src/server/watch/scheduler.ts、tests/watch/scheduler.test.ts|本地并发1、单轮claim1、心跳、停止、期限、失败清理|
|M3|src/server/watch/check.ts、tests/watch/check.test.ts|校验候选与比较决定；changed/unchanged/unknown，不复制事实判断|
|M3|tests/watch/versions.test.ts、fixtures.ts|受控前后版本、回转、重复/失效提交、旧报告与伴读隔离|
|交付|docs/runtime/M-交付.md|计划、证据、集成端口和限制|

本报告随代码提交；最终交付 commit 是本报告最后一次提交所在 SHA：
`git log -1 --format=%H -- docs/runtime/M-交付.md`，接收方同时核对 `git rev-parse codex/watch`。
最终完整 SHA 另在本对话交付消息给出，避免在提交内写入自引用 SHA。
同机交付无需 bundle；没有推送、合并或修改主工作树。

## P/I 接入说明

入口：`src/server/watch/index.ts` 导出 createWatchScheduler、executeWatchCheck 和全部私有端口类型。
P 实现 WatchRuntimePort 的 claimDue/claimManual/heartbeat/execute/compare/finish/fail，使用真实持久存储和有界 gateway。
正式宿主应经 createWatchScheduler 调用；executeWatchCheck 只负责单次候选比较，本身不持有心跳、时钟或扫描生命周期。

```ts
const scheduler = createWatchScheduler(runtime, { now: () => new Date().toISOString() });
// 由 P 常驻宿主每 30 秒调用 tick()，并处理 Promise rejection；M 不在 import 时启动扫描。
await scheduler.tick();
// 参数必须取自服务端鉴权和已校验 watch ID；busy/stop/claim=null 时不执行、不在 M 内排队。
await scheduler.checkNow(authenticatedSessionId, validatedWatchId);
// P 先停止自己的扫描计时器和接单，再等待模块清理。
await scheduler.stop();
```

- tick/checkNow 的 Promise 等待本轮执行和清理，返回 void，不表示一定取得 claim，也不返回 checkId。
  P 的 HTTP 202/状态查询与错误码必须由宿主持久状态适配，不能从 void 推断检查成功；活动期间的重复调用直接返回，不排队。
- 可选第三参数 `{timer, heartbeatMs}`；默认 heartbeatMs=30000，正整数且小于 180000；timer 是 setTimeout/clearTimeout 一次性接口。
  heartbeat 串行执行；提交前等待在途心跳。finish=false 不重试，也不再 fail 伪造失败。
- claim 返回 WatchLease，watch active、check running、非空 runId/budgetWindowId/leaseUntil；owner、案件、check、run、baseline 和 leaseEpoch 关联必须一致。
  这些结构检查不替代 P 的数据库授权；P 必须再次核对当前 scopeVersion、epoch、锁、基线和到期时间。
- execute 使用 I.runInvestigation，返回 ResultPayload/null 和 readFailures。candidate.runId 必须是 lease.context.runId，scope 除 referenceTime 外保持原范围。
  compare 使用 I.compareWatchResult 和 lease 的 before/context/focus；M 不增加 prompt/search 循环，不按全文 hash 推断事实变化。
- changed 必须同时含候选、significant decision 和可解析的非空变化证据。P 在短事务内重新验证所有权、epoch、scope、前基线及证据，
  用 decision.changes 生成 delta（previousVersionId=lease.before.id、checkedAt=提交核查时间），生成新快照/VersionLink/基线和通知。
  不复用候选里未经核对的 delta；不可更新旧 payload 或旧伴读。schema 只检查结构及引用，不证明摘录实际支持事实。
- unchanged 更新 lastSuccessAt，不新增通知/结果快照；unknown 的 candidate=null，不推进基线或最后成功时间。
  读取失败统一 unknown；execute/compare/schema 异常通过 fail 标技术失败，不会转成 unchanged。
- fail 的 safeCode 为 WATCH_STOPPED / WATCH_LEASE_LOST / WATCH_DEADLINE / WATCH_CHECK_FAILED；不转发异常 message。
  claim 失败抛 WATCH_CLAIM_FAILED；fail 本身失败抛 WATCH_CLEANUP_FAILED。M 不重试任何一次网络、claim 或提交。
  P 的 fail 必须按原 lease 条件更新，不能让迟到清理覆盖新检查；已发生费用仍按 P 账本结算。
- stop 会等待在途 claim、execute/compare、heartbeat/finish/fail 的清理。P 端口必须有限超时并遵守 AbortSignal，
  不得把忽略取消且永不 settle 的服务交给调度器；M 不以释放本地槽位冒充远端收费调用已经结束。
- 默认每小时/24h、最多3项、同案1项、立即检查5min限频、租约180s、单轮活动120s及每类预算均由 P claim/gateway 校验；
  期限不能超服务结束。P 处理公平调度、全局并发2/watch占1、重启旧check interrupted、超时租约与安全后续周期，不重放旧付费请求。
- changeKey 由 P 用前事实签名＋新事实签名＋规范化关注条件计算，并以 watchId/changeKey 唯一键保护；
  M 无永久按新 hash 的缓存。普通同scope补查需 P 同步watch基线；暂停/删除/补查导致的旧finish必须返回 false。

## 参考机制与对应验收

采用系统设计 §8/D06、九方向 R09、PRD §9 的三态检查、历史快照和有界编排。
阅读本地 changedetection.io 固定 commit `352b036217e32d3622f282f49bebcdb89592a28c`：
`changedetectionio/llm/evaluator.py` 891–989、`changedetectionio/tests/llm/test_evaluator.py` 284–358（本仓库 docs/research/code 下的 .txt 快照）。
借鉴关注条件与内容噪声的区别、空差异和失败状态；没有复制第三方代码，也没有执行第三方项目。
不采用模型/预算失败时 important=true 作为已核实变化；没有复制其 diff 缓存，因为事实判断归 I、通知去重归 P，
全文 hash 不能代替事实签名。租约/基线/通知事务是本项目的 P 设计，不声称已有第三方正确性背书。

|对应项|本轮证据|未覆盖|
|---|---|---|
|AC11 / M01–M04|调度、失败保留未知、去噪/开放问题决定转交、失效提交与重复编排的受控测试|真实读取/元宝/事实判断、关闭浏览器后台运行、部署|
|AC15 / VERSION-01|M 不改旧快照、比较器副本隔离、旧伴读保留、回转变化继续交宿主|真实持久化唯一键/事务、新旧报告UI与伴读更新提示|
|AC08 / AC12 相关部分|停止、期限、本地并发、lease内部归属/引用校验|真实会话鉴权/数据库隔离、全局预算及跨进程锁|

## 未完成与真实边界

M1–M3 的可注入编排模块及受控测试已交付；没有改动 P/I/HTTP 或前端。
所有新增测试资源仅位于 tests/watch 并标 controlled_fixture，共享fixture仅在测试导入；生产代码无预设结果/假通知。
0 次真实供应商调用，费用 0；未读 .env、未执行 --live、未配置或使用任何 Key。
AC11/AC15 产品验收仍未运行，不能用 97 项单测宣布通过。
P 需要实现并集成上述真实端口，补数据库并发/预算/lease竞态测试，再运行真实受控页修改→关浏览器→后台核验→通知→新旧报告/伴读回看，
以及有显式金额/次数上限的元宝开放问题检查。模块分支未经主集成复验，不作为部署发布声明。
