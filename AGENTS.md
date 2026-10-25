# 侦探 Agent 开发约定

先读 README.md。需求真源为 docs/AI开发需求文档.md v1.0 和后续用户明确指令。实施机制见 docs/系统实施设计.md、docs/实施接口契约.md；任务、所有权和门禁见 docs/并行开发任务包.md。

- P 负责 src/shared、src/server/platform、src/server/app.ts、migrations、根配置和依赖。I/E/W/M 只修改自己被派发的目录；公共改动先交给 P。
- 同机并行使用独立分支和 checkout/worktree，不在同一目录互相切分支。没有派发记录就不自行抢模块。
- Node 版本见 .node-version，npm ci 使用锁文件。不要关闭 engine 校验来绕过错误。
- 所有公共输入经 schema 验证。完成前执行与改动有关的测试、typecheck 和 build，报告实际结果。
- schema 通过不等于语义核验、真实 API、部署或产品验收通过。fixtures 必须标记 controlled_fixture，不暴露为真实调查结果。
- 不提交环境凭据、cookie、私有上传、数据库、音频、node_modules 或个人配置。
- 真实付费探针使用显式有限预算和调用数；CI 默认离线。缺凭据报告受阻，继续不依赖凭据的工作。
- UI 遵守独立设计交接；占位页不是产品视觉定稿。不得用假通知或预设答案冒充核心功能。
- 重要取舍、契约变更和执行结果记入 docs/runtime，任务交付填写基准 SHA、写入范围和检查证据。
