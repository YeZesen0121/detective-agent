# E 下一阶段交付：E-N1 / E-N2 / E-N3

2026-10-25（Asia/Shanghai）。用户明确要求本对话接手E、另建隔离工作区、先完成E-N1，随后依次授权E-N2、E-N3。本记录保留各阶段历史检查；最新N3分段/单次合成及缺少持久音频端口的交接见文末，不将其称为完整ExperienceModule或AC10产品验收通过。

## 基准、工作区与提交

- 基准：`2c6b0127591a76adc0341f8d217aa580784c7c08`，contractVersion0.1.0。
- 分支：`codex/experience-next`。
- 工作区：`C:\Users\111\.codex\worktrees\experience-next\侦探agent`；未在`codex/investigation-next`混写，也未修改主项目目录。
- 功能实现提交：`1ed3ba93f428bf6f10e8fda8bb85af9ff12b97f1`。
- 审查修正/最终代码SHA：`4f83cff12f1e0cc6801137d3a9720e63ebeb5f89`。报告文档提交不改变该代码SHA，最终分支HEAD以交付消息及git log为准。
- 写入：`src/server/companion/{briefing,build,turn,guards,material,module}.ts`、`tests/experience/{companion-fixture,companion-next.test,turn-next.test}.ts`、本文。
- 未修改attachments、providers/tts、shared、platform、app、迁移、根配置/依赖、web或UI；未读.env/Key/用户私有文件、未运行live探针、未合主线或推GitHub。

## 导出与P接线

|入口|交付能力|
|---|---|
|`companion/briefing.ts`|保留buildCompanion/answerCompanion兼容导出；新增CompanionError导出|
|`companion/module.ts`|experienceTextModule，类型为ExperienceModule的extractAttachments/buildCompanion/answerCompanion三方法子集；extractAttachments复用已有代码|
|buildCompanion|固定版本与当前案件一致、3–5唯一段ID、原版本引用、短段与动作边界、条件/未知/命题缺口保留|
|answerCompanion|answer解释原证据；research_request只交待查问题；finish显示原摘要与未知并收尾；不主动search、不切到latest版本|

每次操作只调用一次注入的services.model，不做自动修正请求。调用前校验输入及Abort，返回后再查Abort；取消后的迟到结果不交付。真实并发、期限、价格/资金、在途Abort和计费仍由P的model服务/gateway负责。未用伪预算绕过授权，也未自行创建交互池。

P应从服务端已授权快照、已保存伴读会话及角色构造输入，再调用文字模块；本模块验证结构、案件/版本关联，不承担数据库owner鉴权或payloadHash真实性验证。CompanionError提供稳定code与可读publicMessage，不暴露供应商原始错误。P应将其映射为已有HTTP安全错误，保存成功的segments/cursor/turn；失败不覆盖原报告或旧伴读。N1不新增公共schema/HTTP字段。

## 状态与内容边界

- schema校验输入、模型输出和最终输出；拒绝非ready会话、跨版本/跨案件、坏输出、少于3段/多于5段、重复段ID、未知引用、不合法动作与超长段落。
- 模型返回的cursor不得为字符串、NaN、负数、非整数或超界数字；不clamp/coerce。缺省时使用已保存cursor；answer/research_request保持当前cursor，finish到segments.length。E不写数据库状态。
- 人设、报告、用户问题都作为数据传入，不能覆盖事实约束。模型选择段落重点及引用；最终事实段、裁决标记、条件/缺口及摘要由程序从原快照呈现，模型的自由事实改写不直接展示。这是有意的保守策略，不宣称做了新的语义核验。
- supported/refuted/mixed/insufficient分别标明材料支持/反驳/冲突/证据不足，人物口吻不能升级状态。原报告的判断本身仍依赖I与P质量，不由伴读重新证明。
- 总览保留全局条件/未知、命题条件/缺口及原报告nextSteps，防止模型选段时遗漏；主线末段和finish独立保留nextSteps，不依赖生成3段还是5段。引用命题段同时保留其reasonSummary和链接证据。
- 所选命题/证据在同版本的有限关联图内补齐闭包：仅选证据也带出相连命题的裁决/限定，不因为省略claimIds就脱离语境；不会检索或添加新事实。若关联材料过多，按相同文字上限受控失败，不隐藏限定。
- 长证据原文留在完整证据卡，不截在否定词中间冒充完整引文；短引文最多240字符直接保留。
- action仅允许朗读、朗读本段、展开证据、查看原文、跳到证据、返回主线、直接收尾等固定说明；不会执行现实动作或付费研究。
- 人物表达当前仅使用有限的温和/冷静导语，不执行任意人设指令；不是完整自由表演、角色生成或长期人格记忆。
- 450–800字、每段80–160字是PRD起点，写入生成提示，不作为会删除限定的硬裁剪。模型单段提案/安全呈现段上限1200字符；必要限定过长时给可读失败，保留原报告，不能静默删字。材料超ModelRequest既定字符串上限也受控失败，不擅自增大shared限额。

## 参考依据与取舍

1. PRD §8与系统实施设计§7：结论/未知先出现、3–5段、打断后回到保存位置、人物不改变裁决。本次落实为固定快照总览、稳定段ID与游标规则，不靠隐藏结论或答题解锁。
2. `docs/伴读角色生成与交互适配.md` §4–5及D10：采纳引用入口、同一身份版本、短主线、明确收尾和按需深入；舍弃世界/剧情、群聊、闪卡、好感度、角色动作声称现实调查，避免改变本项目范围。
3. 伴读参考强调“有特点的表达而非机械播报”。本次在证据一致性优先下，仅交安全文字基线：模型选重点，程序呈现原裁决与限定。自由改写、解释的易懂度和人物自然度尚须后续真人阅读/语义评测；不以引用ID合法就宣称事实表达忠实。该保守取舍防止模型拿着正确引用却讲出相反结论。
4. PRD字数为目标而非硬删减门槛；复杂材料不能安全缩短时宁可让用户读原报告。本次没有把没有真实试读的字数或测试通过数当作3–5分钟体验验收。

## 实际检查

- 新工作区npm ci成功，基准完整310项测试、typecheck/build通过。
- 先新增18项边界测试：13项因原实现漏限定、可伪造动作、切换游标、跨版本输入或取消门禁等失败，5项原已满足；实现后转绿。
- 后续补足四种裁决、全局/命题限定、模型未引用的命题缺口、坏格式/缺段、无问题补查、缺省游标和安全取消等反例；其中“模型略过命题仍保留缺口”独立观察失败再恢复修复。
- 最终体验定向：3文件38项通过；完整：34文件344项通过；typecheck、build、git diff --check通过。
- 所有新增样例标记controlled_fixture，使用example.invalid和受控model服务；真实模型、视觉、TTS请求均为0，没有音频或真人试读验收。

## 独立审查与修正

按requesting-code-review技能派发一次不带会话历史的只读审查。首轮独立复跑339项通过、typecheck通过；无Critical，发现2项Important：evidence-only选择会漏关联命题限定，三段/有引用收尾及finish会漏nextSteps。两项均先补反例，观察3项失败再修正；再补关联图链路及有引用末段边界，形成4f83cff。原审查者仅复核这两项并独立重跑38项体验测试通过，确认修复，未发现这两项内的剩余问题。

审查明确未判定项逐一保留：E-N2/E-N3在后续E增量开发；音频持久化/播放与真实供应商另验，不能以此单测声称通过；P的owner鉴权/预算/HTTP/存储由P组装验证；UI与浏览器阅读由W/U及P联调；真实模型语义、角色自然度与阅读时长需真人阅读，当前不作通过声明。其余范围未因审查结论而默认为完成。

## 未完成与P所需能力

- **E-N2已接续**：三图ID/顺序、Abort、提取歧义及blockingQuestions的实际实现和检查见文末N2记录；不据此宣称真实视觉识别通过。
- **E-N3已接续**：分段、单块合成与私有接入类型见文末；正式音频asset/cache保存和播放仍受阻，experienceTextModule没有假装实现整个ExperienceModule。
- P仍负责交互预算、已授权角色/快照/会话读取、伴读/turn持久化、HTTP与UI状态；缺失的音频保存端口在N3按任务单另提，不在N1伪造assetId。
- 阅读节奏、人物自然度、实际模型语义、真实声音与播放/停止、旧版本更新提示及完整AC10/AC15需后续联调/真人验证。

同机P可按本分支实现提交审查取入，再运行P当前分支的完整检查；不要回退其后续工作到本基准。本次保留独立工作区，未向其他对话或队友发送消息。

## E-N2：逐图失败归属与取消边界

### 增量身份

- 用户在N1交付后明确要求继续E-N2；沿用隔离分支`codex/experience-next`和同一工作区。
- 本增量基准：`cf560ba1b95ad50153924475122dc3a34d50b673`；完整项目起点仍为上文2c6b012。
- 实现提交：`3f922d70718ea40105fce2c4f36706506dbc7042`。
- 审查修正/最终代码SHA：`d0dea0fabfa21d3295c2b8cd156c29bf12422458`。本增量独立于N1，P若已取入N1可以按序取入这两个N2代码提交及后续报告提交。
- 仅修改`src/server/attachments/extract.ts`、新增`tests/experience/extraction-next.test.ts`及本文；没有改N1伴读、shared/platform/HTTP/根依赖或UI。

### 实际行为

- 先用ExtractionInputSchema验证1–3图、格式、尺寸、order范围和上下文；重复attachmentId或order在任何模型调用前抛ExtractionInputError（稳定code及安全publicMessage）。不要求剩余图片的order必须连续，保留原始槽位含义。
- 按order处理，每次只把当前图的`id/mime/bytesRef`放到attachmentRefs；order与ID放到当前图文字说明，不将其他图片混进请求。实际请求通过ModelRequestSchema；修复旧实现把width/height/order额外塞入严格attachmentRefs造成的不兼容。
- 只接受结构完整、finishReason=stop的提取结果，数组/文字不再用String/default[]掩盖坏输出。模型如自带attachmentId，必须与当前图一致；最终ID由服务端请求绑定。
- 三种安全失败码：`extraction_failed`（服务失败）、`extraction_invalid_output`（坏结构/错误ID/未完整生成）、`extraction_cancelled`（取消）。单图失败不丢其他成功图，不自动重试，不暴露供应商原始错误。
- 有效批次中每个输入ID恰好出现在items或failed一次。原始输入不被修改。visibleText、speakerClues、visibleDates等来自该图模型输出，程序不推断年份或将截图说法升级为事实。只说明程序的传输/归属边界，不能据此证明模型没有OCR幻觉或看错像素。
- uncertainSpans/warnings保留；只有affectsConclusion=true才生成带“第N张图＋附件ID”的blockingQuestion，每图最多一个聚合问题。保留所有原不确定项，不为控制问题长度删原材料；清晰图或不影响结论的歧义不额外追问。
- 空visibleText补明确警告及“调查对象尚不明确”的关键不确定项，不假装成功识别对象。P还要结合原问题决定是否确实需要用户补图；失败图片是否阻塞全案也由P/I结合scope判断，E不擅自猜测。
- 已有warnings/uncertainSpans达到schema容量时，不挤掉条目或追加到越界；原数组完整保留，批次层仍独立给出带图ID的缺对象确认问题。

### 取消语义

- 每次派发前与返回后检查Abort。已取消批次不发送任何图；第一图处理期间取消不开始第二图；后续图处理中取消保留此前已接纳图。
- 在途返回与取消竞争时，未被接纳的当前图及尚未派发图均标cancelled，不返回迟到内容；正在被模型处理不等于已获得成功提取。
- 模型忽略signal时，模块仍能由本地Abort竞态及时结束结果交付，并清理监听器；迟到完成不会修改已返回的batch。底层实际请求能否停止、物理并发何时释放、unknown费用和结算仍由P gateway/service负责；本地取消不是零费用证明。

### 参考、检查与待接线

- 依据PRD §7、系统实施设计§7的逐图ID/原始顺序、否定/日期/人物归属、关键不清才确认，以及现有ExtractionInput/Batch、ModelRequest契约。没有新增schema或视觉API假设，没有读取bytesRef对应磁盘文件。
- 先新增16项测试并观察15失败/1通过：包括三图信息隔离、真实请求schema、坏结构/错误ID/不完整输出、重复ID/order、输入异常、取消前/在途/忽略Abort、关键对象歧义和空图。实现后全绿，再加长不确定项聚合与迟到结果不变性检查。
- 最终定向提取21项、体验4文件59项通过（N1/既有38＋N2新增21）；完整35文件365项通过；typecheck、build、git diff --check通过。真实视觉/TTS/模型请求均为0，未运行live探针。
- P仍负责8MiB候选上限等文件校验、私有owner/bytesRef授权解析、资金/价格/调用门、附件状态存储、HTTP/前端补图展示及将提取结果接到I；本增量不证明这些边界已验收。N3后续接续情况见下一节。

### N2独立审查

按requesting-code-review技能派发一次不带会话历史的只读审查；审查者独立体验55项通过，无其他归属/取消问题，发现一项Important/P2：空文字输出的warnings或uncertainSpans已有80条时，自动补未知提示会使合法结果越界、丢失已有线索。先新增回归并观察invalid_output失败，再按schema可容纳时才追加、否则在批次层独立确认对象；补三种容量（警告/不确定项/两者）与发送微任务前取消0调用。原审查者窄范围复核及独立提取21项通过，确认修复，没有同类剩余问题。

审查未判断项保留具体负责范围：E-N3/TTS后续E处理；P的HTTP/存储/真实Abort/并发和计费在实际接线时验证；真实OCR及私有文件访问/隐私另做真实图和授权边界验收；用户能否理解补图提示需实际使用验证。不能以本轮离线通过消去这些边界，未合主线、未向其他对话发送消息。

## E-N3：分段、单次合成与音频保存端口提案

### 增量身份与结论

- 用户明确要求继续N3，并要求保存端口缺失时交P方案，不伪造音频/assetId。
- 本增量基准：`0ca87a5c4f64e9f8d8dcdefcedcaac3fe9e37366`；同一分支`codex/experience-next`、同一隔离工作区。
- 实现提交：`e72ca4f29cfb3e177b449e37c9155960b7992ac8`；后续审查修正追加于下文。
- 只新增`companion/speech.ts`、`speech-ports.ts`、`speech-errors.ts`、`providers/tts/{tencent,attempt,audio}.ts`、`tests/experience/speech-next.test.ts`及本文。不改shared、平台、迁移、依赖、UI或已交N1/N2的实现。
- **分段和单块合成的离线受控实现可交P；正式音频持久任务/播放仍受阻。** 没有保存端口，不应先收费再发现无处保存。
- `synthesizeSegment(input,services,signal):Promise<AudioManifest>`保留公共签名，当前明确抛`SPEECH_STORAGE_UNAVAILABLE`，在任何TTS调用前结束，既不编造jobId/assetId，也不返回伪造ready清单。没有将此入口加入可用的完整ExperienceModule。

### 导出与行为

|导出|用途/边界|
|---|---|
|splitSpeechText|按句末/分号等保守标点边界分段，单块≤150个UTF-16计数单位，不切代理对、否定词或日期；无安全断点的超长句明确失败|
|prepareSpeechPlan|用P提供的已授权SpeechBinding核对owner/group/case/version/companion/segment/原保存文字/可用音色，生成不可变私有计划及缓存身份|
|synthesizeSpeechChunk|按计划一次合成一个索引，只调用注入services.tts；返回私有audioBytes和textHash，不创建可播放地址或assetId|
|synthesizeTencentOnce|只做一次注入transport调用及腾讯响应归一化；不读Key、无fetch/SDK直连、不自动重试|
|SpeechPersistenceProposal|给P的私有server端口类型提案；不是已修改的shared服务，也不是已实现的存储|

分段不删除非空白文本。段内英文空格保留，跨句块边界的外层空白按既有TTSRequestSchema.trim规则规范化；整段原始保存文字hash与每块实际发送文字hash分别记录。150是项目统一保守上限，不能因英文在供应商侧可更长就绕过既有schema。若单句>150或结果>100块，则在调用前要求缩短/分句，没有硬截掉限定。不支持SSML/控制字符或不完整Unicode编码，不让保存文本中的标记改变合成操作。

计划必须由prepareSpeechPlan在当前进程生成，不能从HTTP/JSON反序列化冒充；可见元数据冻结，内部WeakMap记录每块是否已尝试、计划是否停止。同一计划的同一块最多尝试一次；任一块失败/取消/超时后不再派发该计划的新块。它不是跨进程持久幂等或缓存锁，后者仍由P实现。

每次调用检查取消，20秒或context.deadlineAt中较早者到期即停止交付并Abort下游。迟到音频不交付；已发请求是否实际取消/计费不能在E层认定。SpeechError的mayHaveProviderCost只表达“调用过下游服务，可能有费用”，不能代替gateway账本的sent/unknown/settled判断，更不能将服务在发送前拒绝误记成实际收费。

私有音频需通过TTSResponseSchema、非空/4MiB上限、audio/mpeg及轻量ID3/MPEG签名检查；返回独立Uint8Array拷贝。**签名检查不是解码或听音验证**，不证明音色、声音内容或真实可播放。测试用显著标记的结构样例字节，不是可供用户播放的音频，没有创建任何音频文件或assetId。

### 官方API核查

2026-10-25核对[腾讯官方TextToVoice](https://cloud.tencent.com/document/api/1073/37995)：API版本2019-08-23，显式请求mp3/Speed=0，Audio为base64，SessionId回传、RequestId作追踪。适配器校验回传SessionId并保留RequestId；API没有回传可用于声纹核对的音色标识，所以本层验证配置映射，实际音色需试听。

不硬编码或宣称某VoiceType已在账号可用；SpeechVoice必须由P的已核验配置提供。供应商未返回实际计费字符/usage时保持null，不用输入长度冒充账单。客户端voiceId不能直接当VoiceType。原始错误Message不外泄，坏base64/空音频/错请求归属/错误格式显式失败。

P应在**一次**gateway.invoke中包装synthesizeTencentOnce；注入transport只负责一次原始SDK/HTTP发送，不能再套第二份付费预留。transport要使用固定endpoint/action/version、关闭重试并接受AbortSignal。当前E没有配置真实transport、凭据或音色，没有真实供应商请求。

### P需要实现的保存与授权端口

类型位于`companion/speech-ports.ts`，必须由P审查实现，不能直接接受前端传来的SpeechBinding：

1. **resolveAuthorized**：从真实session cookie/访问组和数据库取固定ResultVersion、CompanionSession、唯一segment及角色绑定音色；构造SpeechInput的text和InvocationContext，拒绝任意客户端朗读文字、跨owner/版本/段落或未核验音色。
2. **prepareSpeechPlan**：调用E纯准备函数，取得owner绑定的cacheKey和全部片段。缓存身份含原文字hash、resultVersion/companion/segment/persona、provider/voiceType/voiceRevision、speed/codec/splitVersion及访问组。不要把WeakMap计划当数据库记录恢复；重启后重新授权并prepare。
3. **acquire**：以cacheKey建立持久single-flight和job lease/epoch；已有ready返回已授权缓存，生成中复用同job而非再次收费。partial复用已有ready块；cachedChunks必须核对index、textHash、音频hash、mime和owner。保存的jobId来自真实记录，不由E编造。
4. **job-scoped services.tts**：每块在gateway中再核owner/持久job epoch、音色配置revision、期限、并发、全局/组/交互池金额及累计TTS字符额度；价格或资金未知时拒绝发送。现有run守卫不能直接假设能验证音频job。可用P的job闭包承载身份，不把未定义的audioJobId塞入shared InvocationContext。估算字符和实际账单必须分开记录。
5. **saveChunk**：合成成功后先写入私有持久存储并提交metadata，再返回真实assetId及audioHash/byteLength/contentType。禁止把audioBytes、磁盘路径或未落盘ID直接放进公开AudioManifest。SDK/HTTP响应大小上限还要考虑base64膨胀，不能把decoded 4MiB简单当同样大小的JSON上限。
6. **finalize**：核lease epoch、保留已保存块，按真实结果返回ready/partial/failed/cancelled并通过AudioManifestSchema。取消后的旧worker只能结算已发费用，不提交新可播放块；未知请求不自动重放。保存回执不确定时先对账，不能重新合成收费。finalize本身不依赖已经取消的网络signal。
7. **HTTP/播放**：接入既定POST音频job/GET状态/取消/受鉴权Range下载；W按块序播放，切段/停止清旧Audio队列并用playbackEpoch丢迟到响应，不假设本地停播就零费用。此部分本次没有实现。

P完成上述端口后，用同签名持久包装器组合experienceTextModule与E的plan/chunk方法；不要把当前故意受阻的synthesizeSegment当作可用的完整合成服务。N3没有为了绕过接口缺口修改shared或制造临时assetId。

### N3实际检查与未验收项

- 开始前旧体验59项通过。先新增34项测试，收紧负面用例后观察34项因缺少实现/安全错误失败，再实现转绿；补更大base64有界处理，现35项专项。
- 当前体验5文件94项、全量36文件400项通过，typecheck/build/git diff --check通过。实际模型/视觉/TTS请求为0；未配置或读取.env/Key，没有音频文件/试听，也没有账单验证。
- 没有主线合并、GitHub推送、向其他对话发消息或改UI。正式持久音频、account音色可用性、真实声音/内容、播放器解码、autoplay/停止不叠音、期限与费用联调、AC10产品验收均未通过，需P/W按明确有限预算继续。

### N3独立审查与最终交付

按requesting-code-review技能派发一次不带会话历史的只读审查，审查范围`0ca87a5..e72ca4f`。审查者独立运行语音35项及typecheck通过，没有Critical/Important代码问题；指出旧交付记录仍写N3未开始的Minor，现已改为本节明确的分段/单块实现、保存端口受阻、代码SHA和P接入提案。没有因该意见虚构持久化能力。

审查未判断项按责任保留：P的持久epoch/授权记录/音频存储/cache single-flight/账本/HTTP在实现提案时联调；W/P播放器、旧epoch不播放、autoplay需浏览器实测；实际账号音色、有限预算调用、解码/真人听音、production transport/部署和完整产品验收均另验。当前可接收的只是受控模块增量和明确的端口方案。

同机P若已接收N1/N2，先取N3代码提交`e72ca4f29cfb3e177b449e37c9155960b7992ac8`及后续本报告提交；若尚未接收，查看完整`2c6b012..codex/experience-next`，不能仅取最后文档。不要直接把受阻的synthesizeSegment开启为成功接口，也不要向客户端返回本测试中的结构样例字节。
