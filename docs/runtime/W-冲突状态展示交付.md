# W 冲突状态准确展示交付

日期：2026-10-25。分支 `codex/w-media-ui`。完整快进固定 P 基准 `289fa6d78c7e4faee21aa2c88d2ada66402a452c` 后实施；本轮完整 SHA 见交接消息。未读取或使用 P 未提交源码。

## 行为与写入范围

- `src/web/ui/ResultView.tsx`：mixed 标签由“部分成立”改为“存在冲突”；refuted 仍为“不成立”。原 `refuted || mixed` 合计逻辑保留，标签由“限定”改为“反证/冲突”。仅改文字，DOM、class、CSS 和布局未改。
- `src/web/ui/result-status.ts`：带来源或证据的 `no_useful_direction` 报告映射为 partial，无材料仍为 empty。定向回归发现，固定旧版与当前 run 不一致时 main 不传 run 状态，原映射会把这类未解决报告显示成 normal/“已查”；该一行补充按报告自身停止原因保持“部分结果/材料不全”。其他停止原因未改。
- `tests/web-model/result-view.test.ts`、`result-status.test.ts`：准确冲突标签、refuted 保持、混合计数与缺失 run 状态时的停止结果映射。
- `tests/web-model/conflict-result-fixture.ts`、`conflict-http-fixture.ts`：手写 controlled_fixture，两条同届同人群、同一渠道的互斥截止日，均为 mixed，含双方引用、Conflict、未解决说明与条件；真实 SQLite 持久化旧版和更新版，run 均为 partial/no_useful_direction。测试原文只在本机 fixture 路由提供。供应商 transport 显式禁止调用。
- `tests/ui/media-conflict.spec.ts`：本机真实 HTTP、固定旧版、两侧原文 popup、刷新保留与非完成展示回归。
- 本记录。

没有改 shared、server、根配置/依赖、CSS、主题或独立 UI 稿。旧版内容、条件和核查时间没有改写；已有冲突说明通过原命题依据/缺口及未知区块显示，没有新建冲突布局。

## 实际检查

- 产品修改前，新增展示单测失败：原 mixed 为“部分成立”，统计为“限定”；另新增停止原因断言失败：预期 partial，实际 normal。
- 修复后，相关三文件 11/11 单测通过。
- `npm test -- tests/web-model`：19 文件、179/179 通过，退出码 0。包含既有读取恢复、取消、音频与预算控制器回归。日志 `%TEMP%/w-conflict-web-model.log`。
- `PLAYWRIGHT_CHANNEL=msedge npx playwright test tests/ui/media-conflict.spec.ts --workers=1 --reporter=list`：1/1 通过，退出码 0。最终日志 `%TEMP%/w-conflict-final-browser-2.log`。
- 浏览器实际验证：两个互斥日期与两个“存在冲突”标签、反证/冲突计数 2、未解决说明、适用条件；旧版结果 HTTP 返回双方 Conflict 与 mixed，旧 run HTTP 返回 partial/no_useful_direction；两侧本机原文均打开并核对正文；已有更新时固定旧版 URL、核查时间和版本字段逐项刷新不变，未展示新版摘要，刷新后仍显示“材料不全”。没有“调查完成/已确定截止日”文案。
- 浏览器开发过程保留失败证据：初次发现旧版停止状态回落 normal；修复后两次分别因摘要前缀和 innerText 视觉换行的测试定位/比较方式失败。最终按现有 DOM 定位摘要、按两个元数据 span 逐项比较，不改产品 DOM、不放宽超时或重试。前序日志为 `%TEMP%/w-conflict-red.log`、`w-conflict-green.log`、`w-conflict-final-browser.log`；状态单测红态日志 `%TEMP%/w-conflict-status-red.log`。
- `npm run typecheck`、`npm run build`、`git diff --check`：通过，退出码 0。

## 独立审查与集成边界

`/root/conflict_display_review` 只读独审产品 diff、全部新 fixture/spec 及最终定位器调整：Critical 0、Important 0、Minor 0。审查确认固定旧版停止状态修正符合非完成要求；最终摘要和元数据定位器更改保持准确内容核对。独审未替代实际测试。

独审明确不将未新建 Conflict 独立区块判为遗漏：原依据、缺口和 unknowns 已显示未解决说明，本任务限定最小语义更改；不将手写 fixture 当作 I 生成能力或真实调查质量证据；无来源/证据时仍 empty 沿用原材料判断范围。上述边界均接受，不扩展本次任务。

W 本轮真实供应商调用 0 次、费用 0 元，只使用测试自行建立的临时数据库，未读取生产数据库、env、access 或凭据。P 明确释放测试端口后才运行浏览器，没有终止未知进程。全量浏览器与真实产品验收仍由 P 统一执行；请接收本分支完整历史，本轮不推远端。
