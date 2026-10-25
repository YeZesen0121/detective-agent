# W：固定版本追问闭环（核心优先，直接开工任务）

P已获用户统一协调授权。用户最新明确调查策略/追问最高优先级；继续由原W唯一开发，不另开第二个web写入者。UI视觉独立。

## 基准与范围

- P固定代码SHA：`7cc276b16ee7381d505304c916c7fd7db84a5210`，分支 `codex/platform-lifecycle`。先保留并提交当前媒体UI返修，然后在原W独立工作树完整merge该SHA，不覆盖文件，不推远端。
- 先读README/AGENTS、PRD5.3、系统设计5.3、[核心接收门](../../runtime/核心调查与追问接收门-20261025.md)、[P6接口与验证](../../runtime/P6-固定版本追问平台接线-20261025.md)，再读 `src/shared/followup-http.ts`、`runtime-http.ts`。
- 仅改原W范围 src/web API/controller/model及局部功能组件、tests/web-model和自有浏览器测试、W交付文档。不得改shared/platform/investigation/迁移/根依赖、全局UI主题。
- 真实供应商0次/0元，不读凭据。测试用controlled_fixture；生产不挂替身。I策略仍在开发，不把P接口绿当真实策略通过。

## 目标行为

1. 当前打开的固定报告有自由追问入口，提交绑定该resultVersionId；不从全局latest偷偷替换。2000字符限制和输入保留。
2. 接入POST followups、GET单turn/list、submission原key只读恢复。queued/running显示真实状态，POST不自动重试；同逻辑动作保留原key；丢响应通过只读查找，null不触发自动重发。刷新能恢复历史和进行中任务。
3. `explain`显示对应版本回答和引用，不另起调查；`research_same_scope`显示补查方向，通过turn.newRunId连接已有TaskController/轮询，不再POST start；新run可能已终态，不能由activeRunId字段名猜状态。
4. `suggest_new_case`只展示新题建议与用户明确创建入口，不自动创建；`needs_budget_confirmation`解释额度不足，用户明确点击才POST runs `{action:'add_budget',previousRunId,followupTurnId}`，同动作只一次。旧报告仍可读。
5. `STALE_VERSION`展示latestResultVersionId入口，用户显式打开新版，不能自动换报告后重发原问题。收到新版本提示也不替换当前报告/伴读。
6. 伴读`research_request`携followupQuestion进入同一追问入口，保留原version与cursor；不能自己搜索或绕过确认刷新预算。解释/伴读/补查的具体策略仍由I/P返回。
7. 503表示当前生产策略未开放，保留问题与原报告，不静默挂fixture或伪造回答。404/过期安全展示，不暴露其他会话内容。

## 必测反例

- 双击、丢响应、取消后GET失败、刷新/重连不重复POST或增加调用；旧请求晚到不覆盖新案件/新输入。
- 解释0研究run；自动补查只跟踪服务端新run；到限点击前0新run；explicit add_budget重复点击同key。
- 旧报告解释仍可读，旧报告补查stale需显式开新版；通知不改当前report。
- 追问补查取消→resume保留原问题；伴读转补查不丢游标/原文本。
- 连接真实P HTTP/SQLite/host、受控module的浏览器完整路径，至少覆盖解释→补查→新版提示→旧版回看；所有材料标controlled_fixture。

相关测试/typecheck/build/浏览器检查后交完整分支SHA、基准、范围、实际证据和未完成项。不要为等真实I卡住API/controller开发；最终真实I/供应商质量由P总集成后核验。
