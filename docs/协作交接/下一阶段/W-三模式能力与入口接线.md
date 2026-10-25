# W：三模式真实能力与入口接线

P继续统一协调，原W唯一写web，UI视觉保持独立。先提交/保留当前全部工作，再完整合入P本任务随消息给出的固定SHA（不是只取本文件）。

## 范围与先读

先读README/AGENTS、PRD三基本模式、核心调查与追问接收门、P-W媒体追问接收与模式能力接口记录，以及src/shared/capabilities-http.ts。写入范围仅src/web及tests/web-model、自有浏览器测试与W交付记录。公共接口/平台/调查/根依赖不改；0真实调用/0元、不读凭据。

## 直接实现

1. 增加认证后GET /api/v1/capabilities API/schema校验及可取消的状态读取；未登录不读，旧session/旧请求晚到不覆盖新状态。失败显示真实错误及只读重试，不能默认为三模式全开。
2. 新草稿basicMode不再硬编码truth。沿既有三个按钮，只有basicModes列出的模式可选。默认truth（若不可用则第一个可用）；basicModes=[]时仍可保留原truth草稿输入/显式503流程，最新和模糊不得假开放。既有case恢复必须使用case.basicMode，不能用默认值覆盖。
3. 已存draft更改模式等同改问题/呈现：不能用原案开查，应说明显式新开一桩保存。已有截图仍属原案，不能转移。切换三模式仅改交互状态与必要说明，不重做视觉。
4. 新案建议保留原案basicMode（或显式选择新的可用mode），不能在追问suggest_new_case后静默硬切truth。不自动start，不自动POST重试。
5. 关注模式能力错误/失效：已有报告/伴读/追问历史继续可读；不因capabilities失败清空当前案或偷偷打开新版。followup/watch入口可按真实cap字段禁用或解释未开放，现有503安全恢复保持。

## 验证门

先失败回归再实现，控制器/API＋实际HTTP浏览器覆盖：truth/latest/identify保存请求确实携选定mode；刷新恢复旧mode；已存稿改mode阻止start；服务只truth、空cap、401/503/网络失败与旧响应竞态。POST不自动重发、截图归属、当前固定报告不变。fixture全部controlled_fixture。

跑相关及全量测试、typecheck/build、浏览器。交完整分支SHA、基准、范围、实际证据与未完成项。生产I尚未接收三模式是P工作，不必等待I开发；受控宿主明确声明三模式进行前端验证，不能把fixture开放部署。
