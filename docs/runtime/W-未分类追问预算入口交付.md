# W 未分类追问预算入口交付

日期：2026-10-25。分支：`codex/w-media-ui`。完整快进固定 P 基准 `778d11a764e94b534700229b2bb7d7990ce70edd`，没有读取或使用 P 工作目录未提交内容。本轮交付完整 SHA 见交接消息。

## 行为与范围

只有 `needs_budget_confirmation` 且 `researchPurpose` 去除首尾空白后非空，才显示该 turn 的追加研究额度入口，控制器也执行同样检查。null、空串和空白目的均不能通过直接调用控制器绕过入口；不会创建预算提交记录或发送追加 POST。

未分类时不再把用户原问题冒充已确认补查方向，不宣称只是研究额度不足。面板显示“尚未确认能否在当前案件补查，不能据此追加研究额度”，保留原追问和旧报告。没有新增交互预算功能，没有自动新案或自动重发。已有 linked run 的只读状态入口保留。

合法非空补查方向仍通过显式确认追加研究额度；原标识恢复、响应丢失后只读确认、固定版本、原追问和旧报告保持流程均保留。

写入范围：

- `src/web/controllers/followup.ts`：预算追加资格检查。
- `src/web/ui/media/FollowupPanel.tsx`：按分类结果显示准确说明和入口。
- `tests/web-model/followup-controller.test.ts`：null/空串/空白目的直接调用均无写操作；既有合法预算测试使用真实语义的非空目的。
- `tests/web-model/followup-http-fixture.ts`：增加显式 controlled_fixture 未分类场景脚本。
- `tests/ui/media-followup.spec.ts`：真实本机 HTTP 未分类场景；补充合法追加流程的原问题和旧报告保留断言。
- 本记录。

未修改 global CSS、视觉设计、shared、server 或根依赖。W 前端限制不能替代 P 的服务端权限与语义校验，请与 P/I 对应修复共同接收。

## 红绿与检查证据

- 产品修改前，控制器新增三项分别对 null、空串、空白目的调用 `confirmBudget`，均因原代码实际调用 `startRun` 失败（原有 9 项通过、新增 3 项失败，退出码 1）。
- 产品修改前，真实 HTTP 未分类 UI 单项失败：缺少“尚未确认能否在当前案件补查”的准确提示；旧页面仍显示追加入口。日志 `%TEMP%/w-purpose-null-red.log`，trace/error-context 副本 `%TEMP%/w-purpose-null-red-20261025/`。
- 修复后，`npm test -- tests/web-model/followup-controller.test.ts tests/web-model/followup-api.test.ts`：13/13 通过，退出码 0。
- `npm test -- tests/web-model`：19 文件、178/178 通过，退出码 0。日志 `%TEMP%/w-purpose-web-model.log`。
- `PLAYWRIGHT_CHANNEL=msedge npx playwright test tests/ui/media-followup.spec.ts --workers=2 --reporter=list`：7/7 通过，退出码 0。日志 `%TEMP%/w-purpose-followup-green.log`。
- 浏览器场景使用真实 P HTTP 路由、SQLite、宿主、W 控制器与页面；只有注入的业务模块为 controlled_fixture 场景脚本。未分类历史 GET 明确返回 null purpose，页面没有追加或新案入口，手动只读恢复后原问与旧报告保留，追加 run/new case POST 均为 0，追问 POST 恰好 1。
- 合法非空 purpose 浏览器场景仍显式追加成功，原问与旧报告保留；重复点击、丢失确认和刷新恢复后仅有一次追加 POST，补查使用新预算窗口。
- `npm run typecheck`、`npm run build`、`git diff --check`：通过，退出码 0。

未重跑全量浏览器或真实设备验收，未将 P 的此前全量结果算作本轮结果。真实供应商调用 0 次、费用 0 元，没有读取凭据或生产私密内容。提交完整历史交 P，不推远端。
