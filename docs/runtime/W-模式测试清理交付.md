# W 模式测试清理交付

日期：2026-10-25。分支：`codex/w-media-ui`。完整快进 P 基准 `03ec7d62f3461e21b7b5e696c93ff3217164ad39` 后执行；交付完整 SHA 见交接消息。

## 定位证据

只读取 P 指定的受控测试 trace、error-context 和对应浏览器日志，没有读取生产 local、凭据或私密内容。

- P 原 trace 的测试起点约 48076ms，最后输入保留断言在 50604ms 完成；到约 78157ms 才进入超时后的清理。503 提示与原输入断言均已通过，没有失败的产品断言。
- 先原样单项 `--workers=1 --repeat-each=3`：3/3 通过，说明不能仅凭单次重跑判定已解决。
- 在 W 自有 `modes-http-fixture.ts` 临时记录 TCP 连接、`preClose`、`onClose` 与关闭起止；仅运行原失败单项 `--workers=2 --repeat-each=5`。结果 3 通过、2 超时，退出码 1。
- 两次超时均进入 `app.close()` / `preClose`，随后只剩一个 `destroyed=false`、可读写、`bytesRead=0`、`bytesWritten=0` 的 TCP 连接，尚未到达 `onClose`。测试超时后的浏览器上下文清理释放连接，随后 `onClose` 和 `close done` 才出现。这直接定位了复现中的服务关闭等待；零字节连接符合浏览器预连接特征，不能称作正在处理的 HTTP 业务请求。P 原 trace 未包含 TCP 统计，原运行与本次复现的底层连接是否完全相同无法逐连接追认。

## 最小修改

仅修改 `tests/ui/media-modes.spec.ts` 的 truth-only/empty 单项：每种服务配置使用独立浏览器上下文，完成原有真实 HTTP 页面断言后先关闭上下文，再关闭对应 HTTP fixture；嵌套 `finally` 确保上下文关闭异常时仍执行服务清理。避免原先浏览器仍存活时先等待服务关闭、随后在同端口换服务的清理顺序。

没有调整 30 秒超时、重试配置或原业务断言，没有修改 server/shared、产品 UI 或设计。临时 TCP 诊断已全部移除，fixture 文件恢复到基准内容。

## 验证与证据位置

- 修复后：`PLAYWRIGHT_CHANNEL=msedge npx playwright test tests/ui/media-modes.spec.ts -g 'truth-only and empty' --workers=2 --repeat-each=5 --reporter=list`，5/5 通过、退出码 0；每次均执行 truth-only 与空 runtime 两种服务的真实本机 HTTP 路径。
- `npm run typecheck`、`npm run build`、`git diff --check`：通过，退出码 0。
- 未重跑全部 38 项浏览器测试，也未将 P 的 895 项结果冒充本轮新验证结果。
- 原样单 worker 日志：`%TEMP%/w-modes-close-diag.log`。
- 红态连接诊断日志：`%TEMP%/w-modes-close-sockets.log`；失败 trace/error-context 副本：`%TEMP%/w-modes-close-red-20261025/`。
- 绿态日志：`%TEMP%/w-modes-close-green.log`。

以上为 controlled_fixture。真实供应商调用 0 次、费用 0 元，没有终止未知进程；浏览器验证结束后释放本轮服务端口。请 P 接收完整历史，按集成状态执行后续门禁；本修复不代表真实供应商、设备或产品验收通过。
