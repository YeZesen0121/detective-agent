# 队友返修第三轮交付

日期：2026-10-24（Asia/Shanghai）

## 基线与提交

- 基线：`g0-parallel-v1` / `1aaf2d197bdeb7f9987338b6ea6aa2fffc489835`
- 分支：`feat/review-fixes`
- 业务修复 HEAD：以本文件所在提交的实际 `git rev-parse HEAD` 为准；外部交付说明记录最终 SHA。
- 本轮只修改 I/E 业务模块与测试；没有 platform、migration、shared 或根依赖改动。
- 没有合并主分支，没有执行真实或付费 API 调用。

## 本轮修复

- 空引用的 supported 命题、孤立事实回答块和伴读无证据确定回答均显式拒绝，不再过滤后保留正文。
- evaluate 前重新读取有效预算；`canModel=false` 时模型服务调用次数为 0，直接保留已读材料生成 partial。
- Fetch 正文超过 24,000 字符时截取保存上限，状态为 `partial`，失败码为 `content_truncated`，hash 只针对实际保存文本。

## 验证

使用 Node `24.19.0`、npm `11.17.0`，依赖按 `package-lock.json` 安装。

- A/B/C 专项：3 个测试文件，18 项通过。
- 完整 `npm test`：8 个测试文件，62 项通过。
- `npm run typecheck`：退出码 0。
- `npm run build`：退出码 0，Vite 生产构建完成。
- 验证使用离线 controlled fixture 与注入 transport；没有真实 API/付费调用。
- 真实 transport、PaidGateway、HTTP/任务宿主、快照集成、完整三模式、盯梢、视觉/TTS、部署仍未验收。

## Bundle

```text
git bundle create teammate-review-fix-round3.bundle g0-parallel-v1..HEAD
git bundle verify teammate-review-fix-round3.bundle
```

Bundle 不包含凭据、`node_modules`、数据库、私人上传、音频或个人配置。
