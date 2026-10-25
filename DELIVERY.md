# 队友返修交付

日期：2026-10-24（Asia/Shanghai）

## 基线与提交

- 基线：`g0-parallel-v1` / `1aaf2d197bdeb7f9987338b6ea6aa2fffc489835`
- 分支：`feat/review-fixes`
- 返修基线提交：`1f9bde81e9e96c4234bbb46b983c95f27801917a`
- 本包只包含 I/E 业务模块；平台、迁移、shared、根依赖未修改。
- 没有合并主分支；没有执行真实或付费 API 调用。

## 返修内容

- 供应商适配器支持注入 transport；未配置时明确报错；搜索坏 URL 条目逐项隔离；保留 request ID、model ID、usage 和 reader failure。
- 调查循环读取 budget snapshot，记录 purpose/query，执行受控 truth 证据判断，形成 claims/answerBlocks 引用闭包；空结果、取消、预算阻断和模型失败返回契约合法结果。
- 伴读请求携带固定 ResultVersion 的 summary、conditions、unknowns、claims、evidence 和 cursor；保留 answer/research_request/finish；校验版本内引用；生成不足时显式失败。
- 附件提取逐图进行 ExtractionSchema 校验，单图失败隔离；增加多图、否定词、日期和失败样例。
- 增加审查回归测试和供应商适配器测试。

## 修改文件

- `src/server/investigation/index.ts`
- `src/server/providers/search/yuanbao.ts`
- `src/server/providers/model/deepseek.ts`
- `src/server/providers/reader/deepseek-fetch.ts`
- `src/server/companion/briefing.ts`
- `src/server/attachments/extract.ts`
- `tests/investigation/review.test.ts`
- `tests/investigation/providers.test.ts`
- `tests/experience/modules.test.ts`

## 验证

Node `24.19.0`、npm `11.17.0`，依赖按 `package-lock.json` 安装。

- `npm test`：8 个测试文件，52 项通过。
- `npm run typecheck`：退出码 0。
- `npm run build`：退出码 0，Vite 生产构建完成。
- 验证为离线 controlled fixture、注入 transport、单元和契约测试；没有真实 API/付费调用。
- 真实视觉、TTS、部署和完整产品 HTTP 集成仍未验证。

## Bundle

```text
git bundle create teammate-review-fix.bundle g0-parallel-v1..HEAD
git bundle verify teammate-review-fix.bundle
```

Bundle 不包含凭据、`node_modules`、数据库、私人上传、音频或个人配置。
