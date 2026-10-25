# E 真实伴读失败诊断：已确认格式缺口与最小修补

## 基准与范围

2026-10-25，沿用`codex/experience-next`与独立工作树`C:\Users\111\.codex\worktrees\experience-next\侦探agent`。原HEAD `0eb89b7fc0cc85005336069cdc96fdfa15645189`干净，完整fast-forward到P固定检查点`ce264c9ae72a6659828febbceb7546f84e7f5766`，保留全部E历史；无根依赖/锁文件变化。

本轮只改`src/server/companion/build.ts`、`turn.ts`，新增同目录`output-format.ts`与`tests/experience/output-format.test.ts`，以及本记录。shared/platform/app/migrations、P测试、I/W/UI均未修改。真实API 0次/费用0元，不读生产DB、env、access、cookie或其他私有运行文件。只读取任务明确允许的结果JSON：`D:/侦探agent/.local/runtime/results/bf79ba32-7187-48f7-8ede-deaa72982f81.json`。

源码提交：`8c1535b6ead6726f3dcf18e0e7c7881aa2094426`，4文件，新增123/删除4行；随后独立文档提交仅收录本记录。P接收范围为固定基准`ce264c9ae72a6659828febbceb7546f84e7f5766`之后的这两项提交，完整merge `codex/experience-next`，无需重放旧E修补。本分支不合主目录、不推远端。

## 事实与不能得出的结论

- 允许读取的结果标记`real_provider`；summary为“已保存来源材料；目前不足以回答，尚未形成可核验结论。”；stopReason=`invalid_output`；claims=0、evidence=12（raw_capture_only存档3）、answerBlocks=0、conflicts=0。
- P提供的既有真实生成事实：session `33a19ae4-7b6d-439a-a214-e842342c6f8e`失败、0段落、无音色，模型1次、4430微元；本轮没有访问生产DB核验这些计数。
- 原始模型value没有保存，因此**不知道真实失败是哪个字段或校验阶段**。本修补不是对该丢失回包的复现，也不证明真实问题已经关闭。不推测UUID/action/引用/段数为真实根因，不补造原响应、不重发原生成。
- P后来告知新增私有E模型trace发布`36593a045f502b9a1341d2b4296abf10bea59ca2`尚未部署，旧job仅有PROVIDER_ERROR。本轮仍固定ce264c9，不读新trace/DB；新合法回包由P后续明确导出后再离线精确复现。

## 能由源码确认的格式缺口

实际P `createExperienceModelProvider`在线路上只要求`response_format:{type:'json_object'}`并加入通用“Return JSON using the requested schema”。模型请求的schemaId是标识符，完整Zod schema并没有被自动发送。旧E提示词仅列字段名，未完整说明下面的内部格式和公开保存格式差异。

|对象|实际内部解析约束|与公开保存对象差异／旧提示缺项|
|---|---|---|
|build根|strict `{segments,summary}`|不能返回公开CompanionDraft的resultVersionId/personaVersion；后两者由程序填入。公开schema允许1–100段、summary≤12000，私有模型输出须3–5段、summary≤1200|
|segment|strict `{id,text,action,claimIds,evidenceIds}`；合法UUID id；text非空≤1200；action为string或null；refs为UUID数组|旧prompt写了UUID和字段名，但未明确null/数组/必需字段/额外键；重复段id仍另行拒绝，动作仍白名单语义校验|
|turn|strict kind/text/refs；可省resumeCursor或给非负整数；followupQuestion可省/null/非空字符串|公开reply必须有resumeCursor和followupQuestion，E会根据kind补齐；还须校验cursor不超过段数、research_request有问题、answer有依据|

“schema通过”和引用/事实语义分开，补格式说明不会放宽后者。无法仅凭此缺口证明任意一次真实失败由它引起。

## 最小修补

- 新`output-format.ts`直接从既有`DraftOutputSchema`、`TurnOutputSchema`生成JSON Schema并随system prompt发送，明确所有必需字段、类型、UUID/长度/数组限制、可省与nullable字段、strict额外键边界，减少手写说明漂移。
- build提示明确内部根对象不是公开保存对象；段id仍由模型提供合法且唯一UUID，未改为程序生成、未改变其幂等或持久化语义。动作语义仍按原白名单，refs仍限固定版本；公共schema和schemaId未改。
- 明确claims为空、结果不充分或失败仍可组织3–5段，引用可以全为空，围绕保存摘要/未知/条件解释，不编出原问题的答案。程序仍从固定报告呈现事实；模型自由正文不直接显示。
- turn提示明确answer必须有固定版本依据。无可引用依据时不放行无引用answer；finish可展示保存摘要/未知，新事实请求只给research_request建议，不伪造搜索/新run。
- promptVersion分别更新为`experience.companion.v3`、`experience.turn.v3`，使P私有trace能区分新旧提示。1次模型/无自动修正或重试、1800/1200输出预留、预算前检及所有原事实校验均保持。

## 受控复现与实际结果

- 新7项回归使用**真实P模型transport和DeepSeek JSON归一化**，仅fetch注入controlled_fixture wire，无网络/凭据。该wire明确要求线路上带可解析的完整输出schema，旧代码7项红；补充schema后7项绿。它证明格式信息已穿过实际transport，不能当作真实模型遵循率或丢失响应的证据。
- 从实际wire取声明schema，验证合法提案可接受，公开层额外键、非UUID段id、错误action类型、null引用数组、缺action、错误kind、非法cursor、错误followupQuestion及自造newRunId均不符合声明格式。语义门仍独立工作：无引用answer拒绝，finish/research_request保留报告/游标。
- no-claims受控输入仿公开失败报告结构，含原始存档；生成3段空引用草案通过公开保存schema。展示文本仍是不足以回答/关键未知，模型“肯定支持/已电话确认”不展示，旧结果不变。
- 另对**唯一获准读取的实际结果JSON**进行了内存离线检查：受控模型1次、真实0次；新prompt messages UTF8字节+512为4166，生成3段且所有引用为空，公开保存schema通过，失败摘要与关键未知保留。未把该实际材料或其模型响应复制进仓库，未保存资产或音频。
- `npm test -- tests/experience`：12文件174项通过；`npm run typecheck`、`npm run build`、范围`git diff --check`通过。`npm test`实际92文件881项：879通过、2失败，均为下节P测试桩旧版本路由；不是全量通过。
- fresh-context只读独审`review_e_output_schema`：E源码无Critical、无待修Minor；指出P旧fixture为Important集成前置。独立复跑新7项与P HTTP14项：19通过/2失败，精确重现下面两项失败。E实现可接收，P补fixture并复验后才算集成绿；不声称审查已经批准带失败发布。

## P需要接续的既有测试桩

全量已发现`tests/platform/experience-http.test.ts`的受控provider在第35行通过promptVersion白名单`['experience.turn.v1','experience.turn.v2']`区分build/turn。新v3会被错误返回build草案，导致默认实际E路径的问答失败。这是测试桩路由，不是生产provider的路由方式。

该文件归P，本轮不修改。建议P将测试桩按实际`schemaId==='experience.companion.reply.v1'`区分回包，并将显式版本覆盖的类型及测试表补入v3；保留v1/v2兼容覆盖，不需修改公开接口或生产规则。已观察到的两项失败为：

1. `runs actual E text modules over HTTP (prompt override undefined), persists cursor and shares the case budget across questions`
2. `recovers accepted HTTP actions without repeating their POSTs or paid calls`

P后续明确确认将自行按稳定schemaId/purpose调整此受控provider桩，不放宽结果断言，E不得越界或回退v3。修复与主线复验属于P接续；本记录保留当前实际2失败，不预填P未来检查结果。

## 尚未关闭

原真实失败原因仍未知；待P明确提供新的合法ModelResponse导出，才可定位实际错误路径。真实生成质量、自然语言节奏、音色、TTS、浏览器/手机与完整AC10尚未验收。本轮不申请/消费供应商调用，不重发原失败session。

独审同样未判断丢失响应的实际根因、真实模型遵循与质量、私有结果衍生测量真实性、TTS/浏览器/手机/部署或完整产品验收。私有结果离线测量来自执行者本轮明确授权读取，不称独立复核。所有这些边界保留给后续P真实trace和产品验收，不由受控测试替代。

## L01 新 trace 精确重放与正文长度修复

### 新起点和已排除假设

P明确提供新L01失败session `6b4559fd-d047-4cda-bf79-41e2078a1e08`的完整ModelResponse与固定结果。本轮从干净`e8bf05c0015451f964a6c2562ff1e640e1ec4370`完整fast-forward到P固定`03ec7d62f3461e21b7b5e696c93ff3217164ad39`，旧诊断历史保留。

本轮只读新增获准文件`D:/侦探agent/.local/dispatch/e-real-companion-v3/model.json`及`result.json`，未访问生产DB/env/access/cookie、其他私有文件或供应商。原始JSON不入仓；回归使用独立受控材料，本节记录原值重放结果和文件hash：

- model.json SHA256：`9e4242d361b728c61ee030b160c098ebac2bd23113f27f656966a482d6205f94`
- result.json SHA256：`fb8d9c21b524015d056c639f65549296891dc2432644b5bf7a0f385cc38732d4`
- 固定ResultVersion：`3831ba9f-699a-40e7-9af7-fac8b3cb7dc1`；3条命题均insufficient。

实测：原value通过`DraftOutputSchema`；5段UUID合法不重复，全部动作（含“朗读本段”“跳到证据”）已在真实白名单中；引用也通过。动作猜测已排除，**本轮不改动作集合/prompt/动作schema，不为该假设新增无关修补**。

### 实际故障和最小修补

未修补时，以原始ModelResponse注入buildCompanion离线精确重放：模型服务仅1次本地注入，报`COMPANION_CONTENT_TOO_LONG`。固定overview长1232字符；选中一个共享证据的命题后，保真闭包扩展到3条命题/2条证据，facts长1356字符。失败来自build把**模型提案**1200字符限额再次施加给**程序从原报告恢复的正文**。

既有公开`CompanionSegmentSchema.text`已允许≤12000字符；无需改公共契约或扩大模型/输入/费用预算。新增`boundedSegmentText`直接使用该既有保存schema校验程序正文，build使用它；私有`DraftOutputSchema`的模型text/summary仍≤1200，公开summary仍≤12000。超出实际保存边界仍报同一安全错误，不截断、不删条件、不合并/替换引用。

代价：复杂报告可保留更长的正文；450–800字与短案3–5分钟仍是体验目标，不能用本修复声称阅读节奏达标。当前选择保真与现有保存契约，不以展示预算删限定。所有旧session/报告均不回写，修复只影响后续明确的新逻辑生成。

### 红绿与原回包复验

- 新`tests/experience/canonical-length.test.ts`4项：必要overview>1200、共享证据闭包正文>1200、正文超既有公开上限安全拒绝、模型提案1201字符仍拒绝。校准受控长度后，前2项在原代码精确报`COMPANION_CONTENT_TOO_LONG`，后2项通过；修补后4/4通过。
- 原始response一字不改注入修补后build：5段长度`[1243,1362,1365,1364,1239]`，全部通过公开CompanionDraft schema；保留原动作、UUID及引用闭包。
- 对每个选中claim逐项断言statement/reasonSummary/conditions/gaps完整出现、“证据不足”未升级；首段保留完整保存summary、全局conditions/unknowns；原version对象逐字序列化不变。真实调用0次，原response仅本地注入1次。
- 这确认了**本次新L01回包在该E版本中的具体失败路径**；旧丢失回包的失败原因仍未知，不能回推为同一问题。后续真实成功与保存状态仍须P在新逻辑生成中验证，不能以离线成功改写历史失败。

本轮生产写入仅`src/server/companion/{material,build}.ts`；新增上述E测试与更新本记录。源码提交`14093ace841460e9d553533ac63da48c4acd2b69`，3文件（2生产/1测试）、新增67/删除3行；后续文档提交只补本节记录。基准是`03ec7d62f3461e21b7b5e696c93ff3217164ad39`，P可完整接收本分支后两个提交。

本轮实测`npm test -- tests/experience`：13文件178项通过；`npm test`：94文件899项通过；`npm run typecheck`、`npm run build`、范围`git diff --check`通过。上轮P旧fixture两项失败已由新P基准解决，本轮无遗留失败。

fresh-context只读独审`review_e_canonical_length`：Critical 0、Important 0、Minor 0，范围最小、可接收。审查者独立读取获准的两个导出、核对文件hash并用未改原ModelResponse离线重放，确认同一5段长度/合法动作和引用、全部选中命题/理由/条件/缺口/不足状态以及首段摘要与全局限定保留、原版本不变；独立新增4项测试与范围diff通过。审查者未重跑全量/typecheck/build，后者是执行者本轮实际结果。

公共接口/P/I/W/UI不改，不自动重试、不推远端。真实仍0次/0元。本节精确回包诊断覆盖新L01导出，不覆盖历史丢失响应；真实成功、阅读时长/节奏、TTS和完整产品验收仍待P/W后续。

独审未判定旧丢失响应根因、真实供应商生成成功率/质量、实际保存/阅读/TTS体验、部署及完整产品验收。本次仅关闭L01所给精确回包的E本地正文长度故障；生产重新生成和持久化必须另记实际结果，不能用本记录覆盖原失败。
