# 队友返修第二轮交付

日期：2026-10-24（Asia/Shanghai）

## 基线与提交

- 基线：`g0-parallel-v1` / `1aaf2d197bdeb7f9987338b6ea6aa2fffc489835`
- 分支：`feat/review-fixes`
- 最终 HEAD：`cb7e4177a0abc9be3d263c100b74545559333805`
- 本轮只修改 I/E 业务模块与测试；没有 platform、migration、shared 或根依赖改动。
- 没有合并主分支，没有执行真实或付费 API 调用。

## 本轮修复

- A：DeepSeek `prompt_tokens/completion_tokens` 映射为内部 Usage；Fetch `content` 映射为正文并计算 hash；元宝读取嵌套 `Response.RequestId`，供应商 `Error` 显式失败。
- B：伴读和调查发现未知 claim/evidence ID、越界 index 或孤立事实块时显式拒绝，不再过滤引用后保留事实正文；伴读材料包含 claim 的 conditions/gaps/reasonSummary。
- C：模型判断失败时保留已读取来源和证据，生成固定模板 partial；搜索余额耗尽时保留 checkpoint 材料并返回 `search_limit`，不猜测为 `token_limit`。
- 保留上一轮的 transport 注入、空结果契约、多图失败隔离、固定版本伴读和 finish 路由修复。

## 修改文件

- `src/server/investigation/index.ts`
- `src/server/providers/search/yuanbao.ts`
- `src/server/providers/model/deepseek.ts`
- `src/server/providers/reader/deepseek-fetch.ts`
- `src/server/companion/briefing.ts`
- `tests/investigation/providers.test.ts`
- `tests/investigation/review.test.ts`
- `tests/experience/modules.test.ts`

## 验证

Node `24.19.0`、npm `11.17.0`，依赖按 `package-lock.json` 安装。

- `npm test`：8 个测试文件，58 项通过。
- `npm run typecheck`：退出码 0。
- `npm run build`：退出码 0，Vite 生产构建完成。
- 新增 A/B/C 复核反例测试全部通过；验证使用离线 controlled fixture 与注入 transport。
- 没有真实 API/付费调用；真实网络 adapter、PaidGateway、HTTP/任务宿主、快照集成、三模式完整策略、盯梢、视觉/TTS/部署仍未验收。

## Bundle

```text
git bundle create teammate-review-fix-round2.bundle g0-parallel-v1..HEAD
git bundle verify teammate-review-fix-round2.bundle
```

Bundle 不包含凭据、`node_modules`、数据库、私人上传、音频或个人配置。
