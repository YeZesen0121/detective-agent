# W+UI 本轮接收返修（P只读审查）

**状态更新：本轮已关闭，请勿重复返修。** W在acfd9aae5bbe0caf7fd2c80f7b29e0bc1a767fb9完成全部项目，P独立复审通过并以22bdbcd完整合入最新P/E；主目录已接续。最新实际证据见 [完整接收复验](../../runtime/P-WUI完整接收与复验-20261025.md)。下文保留为最初反例和派发记录，不再是待办。

继续原W+UI分支，不重新设计视觉、不重复已经关闭的返修。P已审查完整 `fd51ff6177fb09a456d40b43758dafb3e8c0029c..3e1584c564e91a3000c00c823885a94a839c2ef8`。完整W/UI祖先关系及唯一获授权公共vite代理修复确认；当前两项Important尚未关闭，**P暂未接收/合入该交付**。不改动原始工作树或主目录。

## 修复1：failed不能调用resume

`src/web/main.tsx` 约174/179行，对首轮failed和有旧报告的failed都执行 `start('resume',run.id)`。P RunStore约198行只允许cancelled/interrupted使用resume；真实HTTP受控prepare抛错后failed/provider_error，再点此动作必然409 INVALID_STATE。

保留取消/中断的同窗口resume；failed不展示或发送不支持的恢复动作。显示本轮安全错误，保留旧报告/复制和当前状态，提供明确的新开案件操作（现有平台已支持），不可把重新调查伪装为同案恢复。**不把add_budget静默当retry，不因失败自动新建研究/更换幂等键。** 如果要提供同案failed恢复，需要P单独增加状态和未知费用门禁；本轮先按现有公开状态完成正确界面，不修改shared/server来让测试通过。

先写首轮failed无报告、R2 failed有旧V1两条actual HTTP/浏览器回归，验证不发送非法resume，旧正文不丢，错误和动作含义明确。也保留已有cancelled/interrupted同预算resume测试，不能一刀移除所有恢复。

## 修复2：取消页必须显示恢复失败和只读恢复状态

`src/web/main.tsx` 约178行的无报告cancelled分支没有渲染caseState.error/task.error。实际Edge+内存Fastify复现：首轮取消→明确resume被受控503拒绝→POST1次，但alert0、安全消息节点0，用户看不到失败。

同一状态分支展示安全错误、提交pending与unconfirmed/recovering状态；保留输入/停止任务，防重复动作。只读恢复失败提供明确重读状态入口，不能说仍在后台调查，不能自动重发POST或换key。先测503、断网后结果未知、读恢复再次失败/成功；检查POST数量、幂等键和可读提示，不只查class。

## 同轮对齐已有输入契约

公共 `src/shared/contracts.ts` 的 InvestigationInputSchema 及实施接口契约已支持4000字符；UI 500来自Hermes原型，不能据此反向降低公共能力。P本轮决定让文本输入校验/计数/提交与既有**4000**上限一致，不重设视觉方案或改shared。先测501字符可提交、4000边界与4001拒绝/正确反馈，恢复/历史文本不被前端截断。原型图仅供设计参考，不改历史原型归档。

## 所有权与复验

只改原W/UI拥有的src/web、tests/web-model、tests/ui和交付记录；vite已交代理修复保留，不新增公共修改。不要覆盖P的新音频工作，不读.env/凭据，不跑付费探针，不合P最终主线。原有固定P基准可以继续用于UI返修；P后续会将完整W/UI分支与最新P/E合入隔离集成树再复验。

按同一完整分支提交新修复，交最终完整SHA、所有提交、定向/全量/typecheck/build/Edge实际结果及未完成边界。实际模块/供应商替身均controlled_fixture；不把本轮桌面通过当手机/真实API/音频/部署或最终视觉确认。

独立P审查已执行web-model126/126、typecheck、diff-check，另两个失败场景均actual HTTP/Edge复现；没有重复声称原378全量或6项Edge已在最新P验证。0真实供应商调用。
