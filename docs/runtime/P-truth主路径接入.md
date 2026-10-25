# P 总集成：I/E、W 接收与 truth 调查运行路径

2026-10-24，Windows / Node 24.19.0 / npm 11.17.0，contractVersion 0.1.0。

本轮已接收完整来源历史，且实现、验证一条 **W 实际 HTTP 客户端 → Fastify → 持久任务宿主 → 真实 I 模块 → 原始供应商响应解析 → PaidGateway → 预算账本 → 不可变报告** 的离线路径。真实网络由测试内的 `controlled_fixture` transport 替代，业务模块没有被 stub 替代。不是完整调查质量、真实供应商、部署或产品 AC 验收通过。

## 接收与隔离

- 主目录接收前：`D:\侦探agent`，`feat/foundation`，`02d9b5474075e8a13a00c1748b6fe951029ebcff`；`.gitignore` 有在途修改，`docs/ui/` 与 Hermes UI 材料未跟踪。
- P 隔离目录：`C:\Users\111\.codex\worktrees\platform-lifecycle\侦探agent`，`codex/platform-lifecycle`。
- 接收 `feat/platform-run-store` 至 `b963178` 的整个历史：合并 `114e2ba`，包含 `43a0bf0` 的 I/E 第三轮接收及 `44a9754` 正文规范化/hash 修复。没有只取末尾文档。
- 该合并的 `database.ts` 和 `runs.ts` 冲突保留 P 已接通 watch、迁移 006、epoch 和生命周期门禁的新实现；旧来源的 RunStore 增量早已取入，不用旧版覆盖新平台。development-ledger 同时保留两边记录。I/E 业务代码和测试实际取入。
- 接收完整 `codex/web-headless` 至 `abb51a2cecb8dbadcd84fc120d55e080a1d8c00a`：合并 `c28fa6a`，包含 W1–W5 及其 P 检查点 `1d50513049e58dc59f85776649329cfd1385068e`。
- 两个交付 SHA 均以 `git merge-base --is-ancestor` 验证是集成 HEAD 的祖先；来源工作树不修改。集成后基线 294 项测试通过，再开发本增量。没有重新开启已关闭的三轮返修。
- 不提交在途 UI，不冻结视觉，不修改 UI 源码，不移动 `g0-parallel-v1`，不推送 GitHub。

## 新接线与取舍

### 明确启用的 truth profile

`src/server/platform/truth-runtime.ts` 的 `createTruthRuntime` 直接组装已接收 I 导出、真实响应解析器、transport 和版本化价格。P adapter 负责宿主兼容，未改写 I/E/W/M 的交付目录。

- `main.ts` 通过 `truthRuntimeFromEnvironment` 选择是否启用；默认关闭，未配置时调查 start 继续 503，不挂测试模块。
- `TRUTH_RUNTIME_ENABLED=1` 才组装真实 worker；必须有 `RUNTIME_FUNDING_JSON` 和一种搜索认证及 DeepSeek 凭据。错误只说明配置项，不打印值。
- 此 profile 只接 `truth`；`latest` / `identify` start 返回 503。实际 I 的 watch compare 仍为 unknown 占位，因此本 profile 不启动扫描，不开放创建、续期、恢复或手动检查收费入口，健康能力也不宣称 watches。既有报告、监测记录仍可读，旧监测可暂停/删除。
- 支持完整能力的受控宿主注入仍保持原测试行为；不是删除已完成 P/M 平台实现。

### 供应商、Abort 与费用

`provider-transports.ts` 固定官方域名：元宝 Bearer SearchPro 或锁定腾讯 SDK 的 TC3 `SearchPro`，DeepSeek Fetch 与 chat completions。TC3 使用 SDK 实际支持的 `request(...,{signal})`；`Cnt` 按官方 10 的档位转换，不把 I 的 3 直接作为非法参数发送。无自动 POST/SDK 重试。

所有付费 send 都在 PaidGateway 内，绑定持久 run epoch、窗口、Abort、期限、并发、预计用量和价格版本。读取前检查初始 HTTP(S) 目标及 DNS 全部地址；DNS 检查有 5 秒和取消边界，完成后 gateway 再核对权限。托管 Fetch 没有提供完整跳转链，不能声称已验证远端每一跳；若响应提供 finalUrl，仍检查其公开地址。供应商请求自身禁止 HTTP 重定向。JSON 响应最多读取 4 MiB。

模型使用 `deepseek-flash`、JSON mode、关闭 thinking，最多按 I 请求的输出上限，且 gateway 保留单次 24k 输入/2500 输出上限；这只是当前 truth 接线配置，尚未证明足以满足复杂真假/反证质量。未来更换模型、推理配置或价格须更新价格版本并重新评测，不能沿用此处预算假设。

价格依据当日官方 [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[Fetch](https://api-docs.deepseek.com/api/fetch/)、[元宝计费](https://cloud.tencent.com/document/product/1806/121798)、[SearchPro](https://cloud.tencent.com/document/api/1806/121811)，并核对锁定 SDK 的 `.request`、`signal`、错误 `.code` 和请求类型源码。采用 CNY 高峰/无缓存折扣上界：元宝按最高档 0.026 元/次，Fetch 0.005 元/次，模型输入/输出分别 2/8 元每百万 token。**账本金额是保守预算计量，不是供应商实际账单。** 搜索档位可能更便宜；不因空捕获就认定 Fetch 免费；模型无可靠 usage 时保留 unknown 预留。

当前工程价格版本 `2026-10-24-cny-conservative-v1` 到 `2026-10-26T00:00:00.000Z` 失效；这是短期工程复核期限，不是供应商定价承诺。到期后拒绝发送，需复核并发布新版本。模型输入无 tokenizer 时按 UTF-8 字节数加固定提示余量预留，不能低估后先发送。

### 真实 I 的平台适配

- 已成功的完全相同查询只在单次 run 内复用，防止现有 I 循环重复同一收费查询；不同 run 不共享缓存。任何 provider 异常触发内部 Abort，I 即使吞掉异常也不再新发调用，host 用已保存 checkpoint 保守结束。鉴权/余额/限流等仅保留安全类别，不回传供应商原始消息。
- 空正文、inaccessible、snippet_only 不进入 I 的搜索摘要回退，不能由未读正文生成 answered 结论。非空 partial 捕获仍保留部分读取条件；截断与语义支持仍需真实评测。
- 澄清回答由 RunStore 持久化后提供给 prepare；P adapter 将已回答的对象线索交给现有 I，并保留原问题作为 goal。等待用户不发送请求，活动时间不累计。
- summary 取已通过结构/引用闭包校验的 answerBlocks，条件和缺口从 claims 合并，不能只显示“读取 N 份来源”。这不等于另做过独立语义复核。
- 后续结果补齐前一版本 delta 链，不改旧报告；变化列表此轮为空，不冒充语义差异比较已完成。旧 GET 保持旧正文，只给新版 notice，W 显式打开新版本。
- 进度事件来自实际操作，未生成百分比或内部推理；queryId 暂为 null，避免关联到与 I 工作材料不同的 ID。
- `BudgetLimitFault` 内部记录超限维度，host 准确保存 read_limit/model_limit/token_limit/time_limit/cost_limit 等停止原因；外部 HTTP 错误 schema 不变。

## 配置与使用边界

本轮未读取或修改真实 `.env`，未配置/启动付费实例，没有新增真实请求，费用 0。历史探针额度不自动成为本 worker 的额度。

配置名称见 `.env.example`。`RUNTIME_FUNDING_JSON` 必须是对象，包含 `global` / `trial` / `demo`；每项都是完整 BudgetAmounts：

|字段|单位|
|---|---|
|activeMs|累计活动毫秒|
|searches / reads / modelCalls|实际尝试次数|
|inputTokens / outputTokens|累计 token|
|moneyMicros|人民币微元，1 元 = 1,000,000|

所有值均须为有限非负安全整数。先明确总资金和各组上限，再填写实际值，不从 controlled_fixture 额度复制授权。全局与组池取最先到达上限；普通窗口仍为既定 RESEARCH_LIMITS。恢复使用已保存限额/用量；改环境额度不会覆盖原池，会拒绝启动并要求显式迁移。

搜索认证只能选一种：`YUANBAO_API_KEY`，或 `TENCENT_SECRET_ID` + `TENCENT_SECRET_KEY`。若并存，配置拒绝而非猜测。DeepSeek 使用 `DEEPSEEK_API_KEY`。不要把配置文件、密钥或数据库发给其他 Agent。

离线开发仍执行 `npm ci`、`npm test`、`npm run typecheck`、`npm run build`；默认 `npm run dev:api` 不会组装测试替身，也不会自动把历史探针变成新收费调用。实际环境启用后，由显式 start/resume/add_budget 经 HTTP 触发，浏览器断开不取消 worker；unknown 请求不自动重放，resume 仍保留原额度和 unknown 预留。生产运行按单实例部署，本轮没有引入多实例 leader 选举。

## 本轮检查证据

- 新增真实 I 链路测试 10 项：HTTP 重复启动、迟到取消/同窗继续、鉴权一次失败不重发、共享金额耗尽、浏览器只读断线/事件游标重连、追加版本与旧快照、服务重启保留报告、澄清后开始、未实现模式门禁、活动任务关闭/重启保留 unknown 与时间、空正文不生成摘要结论、读取到限保留材料（部分组合在同一测试）。
- transport / 价格 4 项及启动配置 2 项；全部材料标记 controlled_fixture，网络替身仅在 tests 内。
- 关键故障均先观察失败再修复：资金误报 token_limit、DNS 取消悬挂、健康能力/监测入口门禁、空正文误出 answered、TC3 鉴权误分 network、空捕获误计零费用、读取限额误报 cost_limit。
- 独立只读审查没有确认 Critical/Important；一个 queryId Minor 已修正。增量复核 15/15 及最终预算维度修复复核 33/33 通过；审查者确认预留仍在同一 immediate 事务中完成，没有改变原子性、结算和回滚语义。没有用该审查代替总集成测试。
- 2026-10-24 23:32，P 隔离目录最终代码：`npm test` **32 文件 310/310 通过，无失败/跳过**；`npm run typecheck`、`npm run build`、`git diff --check` 退出 0。
- Edge 基础浏览器测试 `PLAYWRIGHT_CHANNEL=msedge npm run test:e2e`：**3/3 通过**，仅覆盖当前占位 UI 的连接恢复/HTTP Cookie 隔离，不代表调查 UI 或音频通过。

### 主项目合回结果

代码检查点 `c3b1b6d84216fab06505840d74f56b4720be75bd`，本地标签 `p-truth-runtime-v1`。主目录 `feat/foundation` 已从 `02d9b54` 快进到此检查点，包含上述两条来源的完整历史。合并前后核对主目录全部 **77 个在途/未跟踪文件的 SHA-256，变化或丢失 0 个**，包含 `.gitignore`、UI 资料及压缩包；没有提交这些内容。

2026-10-24 23:36 在 `D:\侦探agent` 合回后重新执行：**32 文件 310/310 测试通过，无失败/跳过；typecheck、build、git diff --check 均退出 0**。G0 仍为 `1aaf2d197bdeb7f9987338b6ea6aa2fffc489835`。后续文档提交只补此条证据，不改变已检查代码；没有推送 GitHub。

## 未完成项与后续顺序

1. I：补完整三模式、缺口驱动查询、日期/原始出处/转载归并、反证与冲突核验、独立语义检查、followup 和 watch compare，并按原任务包交付反例。P truth adapter 没有完成这些策略。
2. P：在已有明确金额和调用数授权、配置核对后做受控真实 truth 查询，保存材料、用量和人工支持关系核对。当前仅实现真实 transport，没有运行本阶段真实调查。
3. W/U：依据独立 UI 交接，接现有 RuntimeApi/TaskController；加入点击、并发请求竞态、旧版本明确切换和真实浏览器主路径测试，不把本轮占位页认作视觉定稿。
4. E/P：视觉上传私有文件边界、伴读服务和实际 TTS、浏览器播放验收。现有 E 函数接收不等于正式 HTTP 业务已接通。
5. I/P/M：正式语义 compare 后再对真实 profile 开 watch，做关闭浏览器后的真实受控页变化/通知/新旧报告伴读回看，执行 AC11/15。
6. 按原计划补 Linux 安装/目标部署、HTTPS 与完整产品 AC；本轮没有宣称任何这些验收通过。
