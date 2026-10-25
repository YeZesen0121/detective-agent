# E 媒体内容与可播放验收交付

- 任务：`docs/协作交接/媒体UI接入/E-媒体内容与可播放验收材料.md` E-A～E-C，加 I-N1 捕获存档兼容修补。
- 基准：`c77408b004782732b81fac5e406446eabae6ea57`；原 E 工作区干净，从 `19893b2` 完整 fast-forward，沿用 `codex/experience-next`。
- 顺序：长报告输入回归/最小修补 → E-A 受控材料与语义回归 → E-B 离线提示音/工厂回归 → E-C 全量检查与独立审查。
- 共同接口：E-A 的 scenarios 由 E-C 说明供 P/W 测试 adapter 使用；E-B 复用既有音频工厂与原 receipt 身份，不另建平台。
- Ruling：本任务已限定写入目录，使用此交付报告记录进展，不另建技能脚本的根目录工作空间；代价是测试输出用工具记录与本报告摘要复核。
- Ruling：不能在有限输入内完整放入必要引用/否定/条件时受控拒绝；不以关键字猜测删除必要事实。代价是极长报告可能仍须阅读原报告。
- 真实 API 0 次 / 0 元；未读取凭据或私人材料。

## 提交与写入范围

在原隔离工作树 `C:\Users\111\.codex\worktrees\experience-next\侦探agent`、分支 `codex/experience-next` 交付，不合主目录、不推远程。

1. `c10e83b8d6baa247991908326f438660d4e304c9`：I-N1完整捕获存档过滤、必要引用闭包、权威预算预检；新增20项预算/存档回归；旧单测补上真实形状的受控 budget.snapshot。
2. `bbb8e78bfc4215bea4ec37d60bdf6e95e3b5801b`：10类可消费场景、11项业务语义测试；首段始终呈现固定报告整体结论。
3. `fb666fa4e2391a929fe599421af4c1cb1f195615`：保存确认与取消边界修补、10项音频材料回归、5张自有PNG、1个可解码MP3、生成程序/manifest/使用说明。

最终源码 SHA 为 `fb666fa4e2391a929fe599421af4c1cb1f195615`。以上三提交是本轮代码与素材范围；后续文档提交只更新本记录。P可完整merge此分支，已接收N1～N3/f63365a无须重放。

生产改动只有：`src/server/companion/{material,guards,turn,build,speech-persistent}.ts`。
新增/修改测试与材料只有 `tests/experience/`、`tests/fixtures/media-e/`；记录只有本文件。`src/server/attachments`无需生产改动；不改shared/platform/app/migrations、W/UI、根配置或依赖。

## I-N1兼容结果

- 不再把整个 `payload.evidence` 送入模型。保留全部saved claims，以及结论块、冲突、当前段落的必要证据引用闭包；保留条件、缺口、未知、时间、版本ID。
- 未引用普通片段和`raw_capture_only`存档不进入模型。若旧报告的必要引用依赖raw存档，受控报`COMPANION_RAW_CAPTURE_DEPENDENCY`，模型0调用；模型回包也不能把省略的档案作为独立证据重新引用。
- 来源只投影必要元信息，保留originGroup/originReason/readStatus与时间；同origin或同originGroup不可视作独立信源。不改旧报告正文、hash或数据库档案。
- turn只携带当前段落/游标/段数/会话版本身份，不重复序列化全部已保存段落；当前问题完整保留，解释/补查建议/结束仍用原契约。
- 每次模型前读取P budget.snapshot，检查整份JSON(messages)的UTF8字节数+512 ≤ min(24000, remaining.inputTokens)，并检查canModel/modelCalls/outputTokens。预算读取失败或余额不足受控报错，0模型调用；不提高配额、不绕gateway。
- 仍每次build/turn只有1次模型调用，分别最多预留1800/1200输出token；不自动修正或重试。P累计2000输出、2次模型的门禁继续生效。
- Ruling：首段加入完整overview，而非仅靠外部UI显示摘要。代价是含很多必要条件的报告更易触及原1200字符单段上限；仍明确失败而不删限定。这比依赖模型选择局部命题保证总体结论更可靠。

## E-A～E-C结果

- E-A已交付：三图相反说法、模糊年份/被裁来源、密集否定/数值单位、supported附条件、mixed/insufficient、为什么/快一点/新事实/结束共10类。逐图错误归属与最小澄清无需改生产提取器；新增测试保持固定结果/会话/游标不变。
- 实测发现首段引用局部命题时缺总体结论：7项失败 → 首段overview最小修补 → 11项全部通过。引用渲染仍取原报告，不展示模型“已致电”等虚构动作或确定结论。
- E-B已交付：顺序≤150 UTF-16块、emoji、换行、日期、否定及尾部限定逐字保留；原始receipt对象交原saveChunk，无新工厂。第2块失败为partial；空failed/cancelled安全错误；unknown保存/供应商失败均不由E重发。
- 实测保存回执到达同时取消会丢失清单中的已保存块：1失败/9通过 → 校验并保留已确认块后检查Abort → 10项通过。未发送下一块；迟到合成仍不会保存成新资产。
- E-C已交付：`tests/fixtures/media-e/README.md`包括逐案例预期、导出示例、P真实受控存储seed与ID映射边界、W使用方式、素材身份及解码复验命令。测试只在adapter提供回包，不接入生产入口。

## 素材与可解码证据

- 5张PNG由自有虚构文字通过已有sharp渲染，非真实用户截图/视觉识别样本；检查过密集文字图，中文可见。完整路径、图像hash与提取正文hash分列于`tests/fixtures/media-e/manifest.json`，单测分别核验。
- `tests/fixtures/media-e/audio/offline-tone.mp3`：660Hz正弦提示音，输入PCM 0.6秒，MP3 64kbps/24kHz/mono；文件5420字节，ffprobe duration 0.622042秒。
- SHA256：`8fbdbe0b411253967b4962ae1cd0a1171866ac209f7be1265b5ed6c961698b2b`。
- 已安装FFmpeg/FFprobe `N-126404-g818e5d965b-20260904`，Windows。实际 `ffmpeg -hide_banner -loglevel error -xerror -i tests/fixtures/media-e/audio/offline-tone.mp3 -f null -` 完整解码退出0；非拼头或仅签名检查。
- 生成方法/完整参数见README和manifest，显式`npx --no-install tsx tests/fixtures/media-e/generate.ts`可离线复验。不安装依赖、不下载素材、不调用TTS；音频非中文朗读、非音色验收样本。
- 根AGENTS禁止提交音频，本轮任务单E-B明确要求在专属测试目录提交1个自有短MP3；本次仅按该具体派发交付此受控例外，不提交真实合成音频或用户音频。

## 验证与红绿证据

- Node24.19.0/npm11.17.0；`npm ci`成功，锁文件/根依赖不变。
- 长报告第一轮12项全部红，修补后12绿；增加预算门禁与模型重新引用存档的回归，其中重新引用2项红→绿，最终20项绿。3×24000汉字实测构造，必要引用/条件/冲突完整保留，原报告与游标未改。
- 全量第一次发现`tests/experience/modules.test.ts`的3个旧服务桩没有budget端口，按新预检契约补受控snapshot，保留原断言；最终无遗留失败。
- 当前全量`npm test`：56文件555项通过；`npm test -- tests/experience`：10文件157项通过。`npm run typecheck`、`npm run build`、`git diff --check`通过。
- 独立审查：fresh-context `review_e_media` 检查基准至`fb666fa`的20个文件和本记录；Critical 0、Important 0，可进入P集成。独立复跑10文件157项体验测试、FFprobe/FFmpeg完整解码、范围diff检查均通过；未重复全量/typecheck/build，后者是执行者本轮实际检查。
- Final: minor (deferred)：长报告回归尚未独立隔离“仅由answerBlock/conflict/当前段落引用的证据”与source.originGroup保留；现有生产逻辑经审查正确，测试目前主要由claim引用闭包覆盖。后续可补专门案例，非本轮阻塞。
- Final: Ruling：审查未评判真实视觉/TTS、中文听感、浏览器/手机、部署、完整AC06/10/15，以及P资金/授权/HTTP与W整体播放恢复；这些仍需各所有者验收。代价是本轮不能推导跨层或真实产品已经可用。
- 审查者只验证当前绿态，未回退重演红态；以上红→绿数字来自执行者本轮实际工具输出，不称为独立复现历史。

## 依据、限制与P/W后续

依据为PRD §7/8、AC06/10/15；伴读研究采用结论先出现、证据按需展开、人物表达与任务节奏分离，不加教学测验或世界编辑。P07仅借逐图不确定项，不把OCR得分当事实概率；P08区分“有引用”和“支持断言”，以人工预期回归验证，不引入重型NLI。

P继续负责真实授权/预算/HTTP/私有音频资产/unknown对账；W负责notice、播放器停止/切段/自动播放及恢复。现有公开接口无修改，无新增平台端口需求。必要闭包仍超输入预算时请显示安全失败与原报告入口，不让W编造字段或追加额度。

Ruling：浏览器和手机播放器验收由P/W完成；E本轮用真实解码器证明所交付音频字节有效。代价是解码通过尚不能证明浏览器自动播放、停止或切段无叠音。

未执行真实视觉/TTS音色听感、手机、生产部署、浏览器播放或完整AC06/AC10/AC15验收；不把结构/受控语义/离线解码通过等同真实产品验收。真实API仍0次、费用0元。

## 审查建议补充：独立必要证据与来源身份回归

本增量基准 `d0fddbc7e884b2e51d5a279b92296edd18dba4b4`。P明确无需先merge其新接收提交`1fcf6c87b24e2098f8ef4bcdb0746a7aae1a0cc5`，本增量也无新公共依赖。沿用原E分支，生产代码无需改动；仅新增`tests/experience/necessary-references.test.ts`和更新本记录，不合主线/推远程。

- 上述minor覆盖建议已关闭：新增10项，build/turn各自验证answerBlock-only、conflict-only；turn另验证current-segment-only。每个专用证据明确不在claim.links中，其他依赖入口为空，避免被命题闭包或另一个入口间接覆盖。
- 逐项断言实际model request中必要证据的原文、origin、limitations完整保留，未引用证据及来源被排除；原公告与转载保留同一originGroup、不同originReason及原readStatus/canonicalUrl，不能因丢身份字段被当作独立确认。
- 每种必要依赖分别包含raw_capture_only反例：受控错误`COMPANION_RAW_CAPTURE_DEPENDENCY`、模型0调用，原报告/会话不变。正常turn保持cursor=1，messages+512仍≤24000。
- 当前逻辑本来正确，因此没有伪称先前生产缺陷。采用可复验的临时缺陷验证测试灵敏度：依次删除answerBlock入口（4红）、conflict入口（4红）、当前段落入口（1红）、originGroup（5红）、originReason（5红）、raw拒绝（5红）。每次仅本工作树临时变异同一E文件，最后finally按原始字节完整恢复，`git diff --exit-code -- src/server/companion/material.ts`退出0；这些变异不提交。
- 恢复后定向`npm test -- tests/experience`：11文件167项通过；`npm run typecheck`、`npm run build`通过。本测试补充未重跑全量；上方555项属于前一交付，不能当成本增量全量结果。
- 真实调用0次/费用0元，无凭据读取，无素材或生产功能变更。交付提交即包含本节记录与该测试文件的独立提交。
