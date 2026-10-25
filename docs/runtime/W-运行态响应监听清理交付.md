# W 运行态测试响应监听清理交付

2026-10-25，分支 `codex/w-media-ui`。完整快进 P 基准 `c287244299d21801f1d983f0b088d662796bfbb2`；本轮提交完整 SHA 见交接消息。

## 定位与红绿证据

仅读取 P 指定的受控 `edge-failure-20261025-0700` trace/error-context 和 `p-intent-canonical-edge.log`。未读取生产 local、env、access 或私密内容。

原 trace 中 reload 从约 66472ms 开始，旧 response listener 的另一次 `response.json()` 在约 66515ms 开始、66551ms 因 `Network.getResponseBody: No resource with given identifier found` 失败；约 66562ms 才进入 After Hooks。因此该错误发生于 reload 导航期间，而不是等到 context 关闭才发生。匿名异步事件回调没有可等待、可移除的读取生命周期，未处理的拒绝被 Playwright 报为测试失败。

- 原样单项 Edge、双 worker、重复 5 次：5/5 通过。自然竞态未在这组本地样本复现，不能据此声称已修复。
- 临时将监听器读取响应体延后 500ms，扩大已有的导航竞争窗口：旧代码单项 1/1 失败，报错与 P 相同，退出码 1。
- 修复后保留同样 500ms 诊断延迟：单项 1/1 通过，退出码 0。
- 另作临时负向诊断：把已读取的受控 run 数据注入 `run:null`，确认 schema 错误进入读取错误集合，并在等待边界使测试失败（1/1 失败、退出码 1）。没有把 JSON/schema 错误吞成通过。
- 以上临时延迟和数据注入均已移除。最终代码 Edge、双 worker、同一单项重复 5 次：5/5 通过，退出码 0。默认 30 秒超时、零重试不变。

## 最小修改

仅修改 `tests/ui/runtime-states.spec.ts` 中取消补查并恢复原预算窗口的单项，以及本记录：

- 使用具名 request/response 回调；立即接住异步读取拒绝，集中在明确等待点断言所有错误，避免未处理 promise。
- 所有捕获的 run 响应数据经 `RunViewSchema` 验证，不再默默跳过缺失 run/window 的响应。
- reload 前移除 response listener 并等待已开始的 JSON/schema 读取完成；reload 后恢复监听。
- 最终业务断言前再次移除并等待，避免预算窗口记录尚未完成；显式检查保存的窗口非空。
- `finally` 同样等待并校验读取，移除 request listener 后关闭 fixture；即使读取检查失败仍执行服务清理。

保留全部 cancel、resume、旧报告、新报告、调用动作与原预算窗口断言，没有修改产品、server/shared、公共契约、依赖或视觉设计。没有新增固定 sleep 到交付代码。

## 验证与证据

`npm run typecheck`、`npm run build`、`git diff --check` 均通过，退出码 0。最终浏览器命令：

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
npx playwright test tests/ui/runtime-states.spec.ts -g 'a cancelled newer run' --workers=2 --repeat-each=5 --reporter=list
```

临时本地日志在 `%TEMP%`：`w-runtime-listener-baseline.log`、`w-runtime-listener-delayed-red.log`、`w-runtime-listener-delayed-green.log`、`w-runtime-listener-schema-negative.log`、`w-runtime-listener-final-green.log`。延迟红态 trace/error-context 副本在 `%TEMP%/w-runtime-listener-red-20261025/`。这些 controlled_fixture 诊断材料不进入 Git。

本轮没有重跑全部 38 项，也没有将 P 的 912 项结果冒充本轮测试结果。真实供应商调用 0 次、费用 0 元，没有终止未知进程。请 P 接收完整历史后执行集成门禁；本项修复不代表真实供应商、设备或产品验收通过。
