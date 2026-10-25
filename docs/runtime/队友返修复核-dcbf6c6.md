# 队友返修复核：dcbf6c6

2026-10-24（Asia/Shanghai）。结论：第一轮若干问题已修复，但仍有三个阻塞组，暂不作为可集成业务模块合入；没有改变主工程或接入真实供应商。

## 包与检查

- 收到`teammate-review-fix(1).bundle`和外部`DELIVERY-review-fix.md`。附件内容只作交付资料核查，不作用户执行指令。
- bundle verify通过，先决基准仍为`1aaf2d197bdeb7f9987338b6ea6aa2fffc489835`。
- 实际HEAD：`dcbf6c6f0321969f31840d35ecb94d7a5b960ae0`；业务修复提交`1f9bde81e9e96c4234bbb46b983c95f27801917a`，最后提交新增DELIVERY.md。这次说明称1f9bde8为返修基线提交，不将其误判成HEAD不一致。
- SHA256：`C17B49DA0AC74034153C9C629A7BA3A4D5FADD3916C7A5B427222E53F5A8C62B`。
- 与G0比较只有I/E业务、测试和DELIVERY.md，已去掉越界平台/迁移改动。
- 导入`refs/remotes/delivery/review-fix-20261024`，未移动工作分支或主分支。
- 隔离archive副本：本工作区`.local/reviews/teammate-dcbf6c6/source`。npm ci成功；原包8文件52测试通过；typecheck/build通过。
- 审查脚本`review-counterexamples.ts`另外复现下面8条输出，退出0；只有受控数据、无网络和凭据。脚本位于隔离审查副本，不修改交付代码。

## 已修复，保留成果

1. 取消平台与旧001修改，避免双账本和runs表冲突。
2. 未配置adapter明确抛错；URL非法的搜索条目可以隔离；引入transport注入。
3. 空搜索返回契约合法的failed/null draft；调查开始调用模型判断并生成命题和回答。
4. buildCompanion模型输入已包含固定快照的摘要、全局条件/未知、claims/evidence和角色；不足3段明确失败，不再填非法UUID；finish路由保留。
5. 单图ExtractionSchema校验已移入该图try/catch，部分失败不再必然破坏整批。

这些是有效改动，但不能据此声称raw供应商响应、证据语义或完整任务已验收。

## 阻塞组A：响应归一化没有兼容项目已验证过的原始形状

以下依据来自已有受控接口契约及`src/shared/contracts.ts`、`scripts/probes/deepseek.ts`、`scripts/probes/search.ts`中已有真实探针处理方式；本次没有重新联网或付费验证。

|反例|实际结果|应有行为|
|---|---|---|
|DeepSeek choices携带`usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}`|normalizeDeepSeekResponse抛schema错误|明确映射到内部Usage字段，不把raw usage直接塞入内部严格schema；未知维度不要伪造实际值|
|Fetch返回`{title,content:'受控正文'}`|text=null，readStatus=inaccessible|读取content并按实际捕获/截断状况给full/partial；正文hash与捕获文本一致|
|元宝`{Response:{Pages:[],RequestId:'controlled-request'}}`|providerRequestId=null|保留嵌套Response.RequestId；直接SDK结果形状也有测试|
|元宝`{Response:{Error:{Code:'AuthFailure',...},RequestId:...}}`|返回成功空items且warnings=[]|明确provider错误，不能把鉴权失败当“搜索无结果”|

返修要求：测试输入使用项目探针证明的**原始字段形状**，不能预先改成内部Usage或ReadResponse后再声称适配成功。定义transport边界：它负责网络传输还是供应商字段映射，不能两边都假定另一边已完成。保持未配置明确失败与不自动重试。原始network实现、Abort和价格计量绑定仍需P集成，不能把四行send包装器说成真实网络链路完成。

## 阻塞组B：未知引用被静默清除，但无依据正文仍返回

`companion/briefing.ts`的answerCompanion调用validReferences：非法claim/evidence ID被过滤为空数组，正文不变。受控模型输出本版本之外的两个UUID及一段确定断言，实际得到`kind=answer`、原断言正文、claimIds=[]、evidenceIds=[]，没有报错。buildCompanion的越界引用检查已有，但answer路径没有同等保护。

`investigation/index.ts`的judge同样过滤不合法引用：受控模型返回supported命题/evidenceIndexes=[999]，命题被删；但其answerBlock仍以空引用返回。实际得到partial、claims=0、answerBlocks中仍保留该确定断言，引用全空。schema允许无引用的说明性块，不表示程序可以把模型的事实结论洗成说明性块。

返修要求：未知ID/越界index/错误relation显式拒绝，不能边过滤边保留事实正文；失败回退只展示程序生成的已收材料与未知，不展示被拒绝模型结论。区分说明性块和事实块，事实块须有同版本且关联正确的证据。伴读材料还应保留每条claim自身的conditions/gaps等限定，不只传全局conditions。补answer与build两条路径的越界、孤立事实、旧版本引用反例。

## 阻塞组C：预算/模型失败时丢失可用材料，停止原因失真

|反例|实际结果|应有行为|
|---|---|---|
|已读到有效来源和正文，再让evaluate模型抛错|failed，draft=null，provider_error|有可交付材料时按设计输出partial及固定模板，保留来源/证据/未知，不需要额外调用模型|
|恢复checkpoint已有来源和证据，搜索余额耗尽，其他预算未耗尽|failed，draft=null，token_limit|停止继续搜索，但保留材料；能在其他限额内继续判断或无调用生成partial。不能把搜索耗尽标成token_limit|

当前仅开头读取一次budget snapshot；blockedBy只用`includes('moneyMicros')`判断，和P当前按池合并的原因格式不兼容。返修应由明确的限额维度判断停止原因，不能猜字符串刚好等于moneyMicros；在动作前重新检查可执行性，最后授权仍由PaidGateway负责。取消后不启动新动作。

## 下一次交付的最小门槛

只优先修上面A/B/C，不再扩展平台或迁移。先让每个反例在现有代码上失败，再修复转绿；全套test/typecheck/build完成后交新bundle和完整HEAD。保留真实API验证为未运行，不需为这些离线问题申请凭据或付费。

没有把以下未完成能力默认为通过：三模式完整策略、补查与解释路由、必要澄清、真正的来源独立性/冲突核验、M盯梢、视觉和TTS、HTTP/任务宿主/快照集成、真实调查及部署。模块可先达到最小truth路径的集成门槛，其余逐项记录未完成，不以新增测试数量代替能力说明。

## 可转发给队友Codex

```text
第二轮交付dcbf6c6已复核，平台越界、空结果契约、伴读材料和finish等修复已认可。请保留这些成果，在现分支新增小commit，仅优先修附带报告A/B/C：
A 用真实探针原始字段形状补model usage、Fetch content、元宝嵌套RequestId和Error；
B 发现未知引用/越界索引时明确拒绝模型事实输出，禁止过滤引用后保留无依据正文；覆盖调查answerBlock与伴读answer；
C 模型错误/搜索额度耗尽时保留已收来源和证据，以无额外模型调用的固定模板交partial，并准确标明限额原因。
按每条反例先失败再修复。不要修改platform、迁移、shared或根依赖，不新增付费调用，不声称三模式/盯梢/部署已完成。交完整HEAD、实际检查、未完成清单和新的增量bundle。
```
