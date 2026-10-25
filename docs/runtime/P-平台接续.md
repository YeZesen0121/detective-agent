# P平台接续：任务宿主与HTTP接入
2026-10-24。基准8f1d9ee；独立分支codex/platform-lifecycle。复核并取入分支交付5027281/a30304c（本分支对应114eb2c/51daa00），没有更改其他对话工作树。原工作目录的.gitignore在途改动保持原样。

## 本轮实现与检查边界
- P1：RunStore接续，scope提交、澄清问答持久化、活动区间、结果schema/归属/引用闭包、来源/证据必须匹配当前checkpoint、不可变ResultVersion、带限定/未知/查询时间/来源的复制。
- P2：单实例后台宿主、全局2个调查并发/队列20/每会话2个排队/开始继续5次每分钟；同一会话仅一个running或waiting任务，其余等待。
- start/resume/add_budget均幂等，改变body冲突；resume保留原窗口累计消费，add_budget显式新窗口但不重置全局/访问组额度。
- 普通任务search/read/model经PaidGateway与强绑定context的services；价格策略和原始adapter由P明确注入。无隐式重试，未知用量保留预留。
- 活动时间进入同一个预算窗口与上层池，排队/等待用户不计，重启保守计入停机间隔。多次GET不重复扣同一区间。
- 重启旧queued/running→interrupted，waiting保留；未发预留释放、已发变unknown、不自动重放。正常关闭先围栏中断再Abort，等物理请求完成结算后才允许关数据库。
- 失败/超限时不用模型整理，有有效scope和已存材料则保存标注未完成核验的partial版本；否则failed保留checkpoint。取消后迟到结果不能提交。
- 没有把未审过的队友I/E交付合入；另一已结束对话的返修报告指出真实响应兼容/引用与失败保留材料仍有阻塞，当前使用测试内严格受控模块。生产main未配置InvestigationRuntimeOptions，运行POST明确503，不能宣称真实产品调查可用。

## 给W的实际HTTP
公共请求/响应schema新增src/shared/runtime-http.ts，原contracts/ports的0.1.0不改字段，属于兼容补充。不是自动变更W的G0代码基准；W可先消费原types，接口schema待P发布本增量后按需取入。
- POST /api/v1/investigations/:id/runs：Idempotency-Key，StartRunSchema；202 StartedRunSchema。
- GET /api/v1/runs/:id：RunViewSchema；partialMaterialSummary为string|null。
- POST /api/v1/runs/:id/cancel：无body，202 CancelledRunSchema，已经结束返回当前状态。
- POST /api/v1/runs/:id/clarifications/:clarificationId：ClarificationAnswerSchema；202 AnsweredRunSchema；同问题同答案可重复，不同答案409。
- GET /api/v1/investigations/:id/events?afterSeq=N：EventsPageSchema，最多100条，仅public。
- GET /api/v1/results/:id：ResultViewSchema，version固定、updateNotice独立为{latestResultVersionId,createdAt}|null。
- GET /api/v1/results/:id/copy：CopyResultSchema。
所有响应继续使用{data,meta}及既有错误envelope；需要Origin的写请求、HttpOnly会话、跨会话404沿用。GET investigation现在返回实际activeRun/latestResultVersionId。健康能力只在注入runtime时声明runs/events/results。
跟踪事件目前以持久轮询提供，无SSE。W的TaskPort cancel短响应后再GET完整run，无需后端改成另一协议。

## 实际证据
- 取入代码后npm ci、原83项测试通过。
- 快照/澄清7项先因方法未实现失败，再实现通过；最初copy测试把不同fixture时间混用，已改用本用例明确的queryTime。
- HTTP前4项先因路由404失败，后实现通过；包括同key、跨会话、取消/恢复、澄清等待、未配置503。
- 三个后续RED→GREEN：正常关闭failed应为interrupted、复制遗漏命题条件/证据限制、调用门缺少物理请求drain。
- 目前完整npm test：14文件105项通过；独立typecheck/build通过；git diff --check通过。另有真实127.0.0.1 HTTP连接测试：客户端abort后服务任务继续完成。未做产品页面验收。
- 本轮无新增真实供应商调用、无部署、无公开发布；所有研究内容均controlled_fixture。Linux/远程CI、实际手机/听音/真实来源人工验收均未执行。

## 后续仍归P
1. 独立代码审查、修复和接入版发布；记录最终SHA与检查结果。
2. 接入返修后通过审查的I/原始providers，配置可核查价格和真实有限资金，再做首条有界真实调查。
3. P3私有图片上传/解码/存储、交互累计额度、伴读持久任务、AudioStorePort生产实现；当前拒绝附件快照与视觉请求。
4. P4给M的事务WatchRuntimePort、周期预算/双epoch、快照/通知原子提交。当前账本继续拒绝watch调用；本轮不改M的watch目录。
5. 追问异步宿主、历史分页、真实部署/恢复演练和完整AC验收。已保存结果可读，但尚未实现这些附加HTTP。

## 取舍
Ruling：复用另一结束分支的RunStore并在新的隔离工作树扩展，避免重建同名平台；原分支与队友分支都不切换。
Ruling：现阶段runtime须显式注入模块/原始adapter/价格/资金；默认main保持503，避免把测试fixtures或不兼容业务包挂入产品。代价是首条真实产品路径仍需业务返修后接入。
Ruling：材料原样匹配checkpoint是引用归属防线，不证明摘录与原页面语义一致；该层仍依赖I及人工真实来源验收。
Ruling：单实例SQLite和轮询事件沿用设计；跨实例租约/公开部署未验证，不扩大完成声明。
来源机制参考系统实施设计D01/D04/D06/D08；新增存储事务、围栏和成本生命周期为本项目实现，以以上测试为证据。

## 独立审查与修复（最终）

按requesting-code-review技能由新只读审查者审查8f1d9ee..f684bcb，不传递会话历史或凭据。Critical 0、Important 1、Minor 0：澄清回答重新入队绕过容量与开始/继续限频。
- HTTP回归先观察202而非应有429（会话已有2排队），增加统一准入与答复同事务。
- 另一个限频回归先观察第6次继续仍202，再新增005_admissions持久准入记录；开始与答复共享每分钟5次，幂等重放不计新动作。
- 修复后会话队列/每分钟上限转绿；再验证全局20队列时澄清继续返回QUEUE_FULL，回答仍为null；成功回答重复提交仍返回既有状态。
- 最终完整npm test：14文件108项通过；npm run typecheck/build、git diff --check通过。Edge基础3项通过（React/真实API、错误恢复、两浏览器会话隔离）；它们不是产品UI验收。

审查未判定项由P逐项裁决：
1. 真实I/provider兼容与价格/账单：未组装，必须先通过业务返修和有限真实探针。代价：真实首案暂不可用，不能提前宣传已跑通。
2. P3附件/视觉/伴读/TTS：继续明确拒绝未接入路径。代价：E模块暂不能真实整站验收。
3. P4watch：仍拒绝watch付费调用，等待事务适配。代价：M只能先受控开发。
4. Linux/多实例/部署/手机视觉：不作已通过声明，保留相应发布门。代价：本地运行证据不覆盖生产。
5. 注入模块永久无视AbortSignal：端口实现必须协作取消；真实I适配审查必须验证。代价：不合作模块可阻塞正常关闭，当前不将其自动安装到生产。

主集成发布时保持g0-parallel-v1不动。W仅需按新增runtime-http schema映射已存在TaskPort；I/E/M仍按原G0交付，不要求盲目追主HEAD。

最终代码检查点、主分支复验与可转发给W的指令见[P运行接口发布记录](P运行接口发布记录.md)。
