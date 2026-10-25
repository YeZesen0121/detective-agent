# P5 媒体 UI 接入与恢复实施计划

> 执行方式：P 在当前隔离工作树直接实现；W/E 由用户转发任务后在各自工作树并行开发。使用 test-driven-development、verification-before-completion；不再次请求已授权开发的确认。

**Goal:** 让 W 能可靠接入附件、固定版本伴读和音频，并可在响应丢失、刷新与生成服务关闭后只读恢复。

**Architecture:** 复用现有 SQLite 提交映射和体验表，增加只读 HTTP/schema；不新增收费路径、数据库或客户端伪造结果。W 负责 API/controller/功能组件，E 负责业务输出与真实可播放的离线验收素材，独立 UI 保留视觉决策权。

**Tech Stack:** Node 24.19.0、TypeScript、Fastify、SQLite、Zod、React、Vitest、Playwright。

**Spec:** PRD v1.0 §7/8/AC06/AC10/AC15；系统实施设计；公共契约；现有 P3/P4；固定源码基准 `0c01daddd9ed2bdc0341c66a2bf3d64777597b2b`。

## 约束和审查重点

- 仅 P 写 shared/platform/app；W/E 独立 checkout，无覆盖/reset/clean/push，保留主目录 UI 草稿。
- GET 必须按浏览器会话和所属案件/版本过滤，不返回 request_json、内部路径、供应商音色参数或账本。
- 未发现提交不等于请求未到达；禁止据此自动换键或重发。
- 页游标严格校验、每页最多 50；历史页包含进行中/失败问答，不能只恢复成功答案。
- 音频与生成分离；刷新/轮询/打开历史不得启动收费任务或自动播放。
- 预算：Q14/Q27 初始300元，保留演示；已执行 truth-20261024-01 的0.10元/3次不转授。此次不运行真实 API、不读凭据。5元交互工程上限不是新增授权。

## 可验证增量

- [x] 先加 HTTP 回归：凭原 key 找回四类提交；跨会话/案件隔离；deleted 附件仍可识别原提交；关闭宿主后重开恢复不增加 jobs/ledger；历史分页及固定版本。
- [x] 增加 `src/shared/experience-recovery-http.ts`、`src/server/platform/experience-recovery-http.ts`，在 app 注册。复用持久表，不迁移。
- [x] 定向测试、全量测试、typecheck/build；独立只读审查。
- [x] 写 W/E 独立任务及分发入口，明确冻结源码 SHA、写入范围、并行依赖、验收和完整历史交付要求。
- [x] 记录实际结果，发布本地代码提交；安全快进主目录，核对原77项 UI 文件不变。主目录重跑514项/typecheck/build通过。不推送；任务文档与打包随后仅文档提交。
