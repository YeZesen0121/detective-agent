# I 接续开发任务：调查质量、三模式与比较

这是可直接转发给 Agent 的编码任务。用户转交并要求执行即授权领取 I；沿用原 I 执行者，不能同时开第二个 I 写入者。不重问 PRD v1.0 已确认需求，不重做第三轮已关闭返修，不修改 P adapter 来掩盖业务缺口。

**Goal:** 将已接入的最小 I 循环推进为缺口驱动、可核验的调查模块；优先交 I-N1，然后分提交交剩余模式、followup 和 compare。
**Architecture:** 保留 InvestigationModule / InvestigationServices 边界。只产 scope、checkpoint 和草稿；PaidGateway、预算、正式快照和 HTTP 由 P 唯一负责。
**Tech Stack / Spec:** Node 24.19.0、npm 11.17.0、TypeScript、Zod、Vitest；PRD v1.0、系统实施设计 §调查/模式/追问/比较、实施接口契约、任务包 T03。

## 开工、范围和当前事实

- 共同起点 `2c6b0127591a76adc0341f8d217aa580784c7c08`，contractVersion 0.1.0。同机源 `D:\侦探agent`；异机须配 `detective-agent-next-base-full.bundle`，完整历史不要求旧G0仓库。新机器先 `git clone -b codex/next-stage-base <full.bundle绝对路径> <新目录>`，进入新目录再建角色分支；只有本文件/一个SHA不含源码。
- 建独立工作树，建议分支 `codex/investigation-next`；目录/分支已存在时核对所有者，不 reset。已有原 I 分支保留全部工作，用 merge 接续基准，冲突中的公共改动交 P。
- 先读 README、AGENTS、docs/AI开发需求文档.md、系统实施设计、实施接口契约、并行开发任务包、验收追踪矩阵、runtime/P-truth主路径接入.md，以及实际 shared/contracts.ts、ports.ts 和 src/server/investigation/index.ts。
- 已接收：原始搜索/读取/模型归一化、最小材料循环、引用坏 ID 拒绝、model 额度不足保留材料、读取截断与规范化 hash。不要推翻这些修复或重新要求用户打包。
- 当前限制：prepare 基于文本长度；query 基本重复；核心裁决一次；followup 简单路由；compare 返回固定 unknown。P 当前兼容层阻止异常重试/摘要冒充正文，补 summary/条件和版本链，但没有实现调查质量策略。
- **允许写** src/server/investigation/、src/server/providers/search/、model/、reader/、tests/investigation/、docs/runtime/I-下一阶段交付.md。拆分文件可在这些目录内进行。
- **不得写** shared、platform、watch、app.ts、migrations、web、根依赖/配置、UI。公共接口缺口写报告供 P 修改。不得读 .env/Key 或运行 --live；通过 injected services 完成 controlled_fixture 测试，真实调用 0 次。
- 先 npm ci、npm test、npm run typecheck、npm run build，记录自己的实际基线；310 只是旧基准证据。

## 接口约束

沿用 `InvestigationModule` 四个导出 `prepareInvestigation` / `runInvestigation` / `routeFollowup` / `compareWatchResult`，输入/输出逐字采用 shared/ports.ts 的已有类型。不得自行新建平行 JSON 协议。

工具只走 `services.search/read/model(input, context, signal)`，工作材料用 checkpoint.save、真实操作 events.append；clock 和 budget.snapshot 由宿主注入。准备范围要使用 clarificationAnswer，无法知道的对象不能编造；从 previousScope 恢复保留归属和已确认范围。不要自己 new Date 取代注入时钟。

Run epoch、预算、正式版本由 P 决定；模块不得写数据库、自动建预算、隐式重跑 unknown。普通总约束仍为活动约 420 秒、搜索含重试最多 12，至多 4 批每批 3，读取/模型/token/金额都看同一 snapshot；不是要求用满。重要设计依据写清采用哪个固定源码机制，拒绝哪个反模式，不能只列参考名。

## I-N1，先交：truth 质量和有效退出

**Files:** investigation/{scope,planner,engine,evidence,judge,prompts}.ts 可拆分，由 index.ts 保持入口；tests/investigation/{preparation,truth-quality,planning}.test.ts。

- [ ] 先写并运行失败反例：缺对象→等待；用户明确回答→只补线索，不改原问题；proceedWithUnknown 不能编造必需对象。
- [ ] 失败反例：两个 query 文本相同、目的改名也不能重复收费；后续 query 只能对应明确未解命题/日期/来源缺口；够回答就停止，不固定凑 4 批。
- [ ] 失败反例：来源正文为空/只有 snippet/截断遗漏条件时，不输出无条件肯定；模型输出仅 insufficient 或无支持段落时，不以 answered+completed 假完成。
- [ ] 失败反例：三份转载同一通知不算三份独立证明；旧届通知不能用作新届报名事实；正文中“忽略规则”不能变成工具指令。
- [ ] 实现材料到命题的核心语义检查，保留支持/反驳/限定、日期和不足；来源 ID 存在不是支持成立。核心命题允许一次有预算复核；不反复要求模型更肯定。输出 summary/answerBlocks 不得强于 claims，保留 claims.conditions/gaps。
- [ ] 工具成功后及时保存 checkpoint；任何失败/取消都不继续发调用，不丢前面成功材料；来源读取最多实际请求 limit 的项，不把供应商 Cnt=10 全部无目的读取。
- [ ] 模型上下文超出 24k 单次上限时，在模块侧选择证据片段并明确 excerpt/截断局限，保留定位/原始 hash，不改写已捕获正文冒充完整；没有足够输入额度则 partial，不请求超额后再补救。
- [ ] 实测反馈：Fetch捕获可含 `Node\.js` 等Markdown转义，模型引用可能显示为规范化文本。分开原始capture与规范化视图，保留映射/真实locator；不能把规范化引句谎称原文逐字符匹配，也不能给整页摘录统一标paragraph 1。
- [ ] 全部定向测试绿后，运行全量/typecheck/build，提交 I-N1。先将这一增量交 P，不必等 I-N2/3 完成。

## I-N2：latest / identify 和冲突

**Files:** investigation/modes/ 可新增，tests/investigation/modes-next.test.ts。

- [ ] 先测 latest：发布日、事件日、抓取日不同；刚转载旧新闻；同主题不同届次；无有效日期材料。只报告可核对的最新有效事实，未知仍未知。
- [ ] 先测 identify：两个都像的候选有各自来源、匹配/不匹配条件；证据不足时保留候选，不强选一个。
- [ ] 先测 truth：两个独立来源在有效范围内实质矛盾→mixed/冲突；来源失效或转载不能多数票压掉反证。不同 presentationMode 不改变调查质量/预算标准。
- [ ] 实现模式策略，复用已有工具/循环/证据类型；不得写三个互不兼容的聊天壳。定向→全量→typecheck/build 后单独提交。

## I-N3：followup 与正式 watch compare

**Files:** investigation/{followup,compare}.ts，tests/investigation/{followup-next,watch-compare}.test.ts。

- [ ] routeFollowup 失败反例：已有材料足够解释不搜索；明确同范围缺口才 research_same_scope；范围不同 suggest_new_case；没额度 needs_budget_confirmation，不自动刷新预算。
- [ ] compare 失败反例：A→B 核心结论变/缺口真解决/重要冲突→significant，changes 指向 candidate 内合法 claim/evidence；同事实改写/排序/抓取时间变化→unchanged；任何读取失败或无法比较→unknown，不能宣称无变化。
- [ ] factSignature 来自规范化事实与条件，不含 run/UUID/抓取时间，不用全文 hash 替代语义判断；如要模型比较只走注入服务并遵守 Abort/预算。P/M 负责基线租约和通知，不得在 I 去重提交通知。
- [ ] 定向→全量→typecheck/build 后独立提交，说明尚未经过真实后台验收；P 审查后才开放正式 watch profile。

## 交付

每增量按失败→最小实现→测试→提交推进。完成时提供基准/完整最终 SHA、分支和工作树、所有提交及写入目录、实际测试数与退出码、重要机制参考及取舍、导出签名、未完成项和 P shim 可撤销建议。报告写 docs/runtime/I-下一阶段交付.md。

同机交完整 SHA，**不要自己合主线/推送/发消息**。异机在 commit 后用 `git bundle create <新文件> 2c6b0127591a76adc0341f8d217aa580784c7c08..HEAD`，把 bundle+报告+完整 SHA 一起交回；不得包含凭据、node_modules、数据库。测试通过只代表所列层次，不把未跑真实语义/产品 AC 写通过。
