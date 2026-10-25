# W 读取计量显示语义交付

- 分支：`codex/w-media-ui`。
- 基准 SHA：`f69a21d293794036b680d03ab8bd4cb4a32352a5`。
- 本轮仅修改计量显示文字，无公共接口同步需求，未合入 P 的 `36593a045f502b9a1341d2b4296abf10bea59ca2`。交付提交完整 SHA 见交接消息。

## 修改范围

- `src/web/main.tsx`：将 `remainingBudget.used.reads` 的计量标签从“全文读取”改为“读取调用”。调用数不表示成功取得全文。
- 每源 `full`、`partial`、`snippet_only`、`inaccessible` 状态与对应文字保留；没有改动 UI 布局、样式、P 所有目录或根依赖。
- 本交付记录。

## 检查证据

2026-10-25，在本分支运行：

- `npm test -- tests/web-model/result.test.ts tests/web-model/result-view.test.ts tests/web-model/task.test.ts`：3 个文件、32 项测试全部通过，退出码 0。
- `npm run typecheck`：通过，退出码 0。
- `npm run build`：通过，153 个前端模块完成构建，退出码 0。
- `git diff --check`：通过，退出码 0。

现有相关测试未依赖计量标签，本轮未添加文案镜像测试。没有重跑全量浏览器或真实设备验收；本项结果只覆盖上述文字语义修正和检查。真实供应商调用 0 次、费用 0 元，未读取凭据或生产私密内容。

## 集成注意事项

请 P 接收本分支完整历史，并在集成后按 P 分支实际状态检查。`used.reads` 继续按调用计量解释，是否读到全文以每个来源的读取状态为准。本轮未推远端，不代表完整真实 UI、设备或产品验收通过。
