# E 接续开发任务：固定版本伴读、逐图失败与语音

用户转交并要求执行即领取 E；原队友继续即可，不另开第二个 E。UI 独立设计，P 负责正式持久化/私有文件/HTTP/预算。不要重做已关闭第三轮返修或重新问需求。

**Goal:** 补齐可注入 ExperienceModule，先固定版本文字伴读，再提取边界和 TTS 单次模块，交 P 实际接线。
**Architecture:** 只调用 ExperienceServices.model/tts 和注入 clock/events；数据始终绑定 ResultVersion。E 不读磁盘私有路径、不创建预算或数据库、不暴露供应商原始错误。
**Spec / Tech:** PRD v1.0、伴读角色生成与交互适配.md、系统实施设计、实际 shared/ports.ts / contracts.ts；Node 24.19.0、npm 11.17.0、TypeScript/Vitest。

## 起点与权限

- 基准 `2c6b0127591a76adc0341f8d217aa580784c7c08`，contractVersion0.1.0。同机 D:\侦探agent，建议独立工作树/分支 codex/experience-next；原 E 工作保留后 merge 基准，不能 reset。异机配 `detective-agent-next-base-full.bundle`，先 `git clone -b codex/next-stage-base <full.bundle绝对路径> <新目录>` 后进入新目录建角色分支；完整历史不要求旧G0仓库，只有本文不含源码。
- 先读 README/AGENTS/PRD/系统实施设计/实施接口契约，以及现有 attachments/extract.ts、companion/briefing.ts、tests/experience/modules.test.ts、P-truth主路径接入.md；先 npm ci/test/typecheck/build。
- 已接收的提取、固定版本材料序列化、伴读引用检查和 reply 路由都保留；当前不是正式完整 ExperienceModule，TTS 尚无实现，不把只有这些函数称整个体验完成。
- 可写 src/server/attachments/、companion/、providers/tts/、tests/experience/、docs/runtime/E-下一阶段交付.md。不得写 platform/shared/app/migrations/web/UI/根依赖，不读取.env/Key/用户文件，不跑 --live。缺公共接口只在报告给 P。

## E-N1，先交：伴读质量与状态

**Files:** companion/{module,build,turn,speech}.ts 可拆分，保留 briefing.ts 现有调用兼容或在交付明确 re-export；tests/experience/{companion-next,turn-next}.test.ts。

- [ ] 先测正文已有 conditions/unknowns/claim gaps，在讲解和回答中不得丢失或改成确定事实；人物口气不改变裁决。段落 action 只能朗读/展开/跳证据等说明，不能偷偷发起研究。
- [ ] 先测 model 返回跨版本 ID、空引用事实断言、坏格式、<3 段、超长段落：受控失败或最多一次有额度的修正，不无限重试；最终失败给可读错误，旧报告不受影响。
- [ ] 先测 answerCompanion 的 explain/research_request/finish：补查建议返回 followupQuestion 交 P，不直接 search 或更换版本；cursor 在 0..segments.length，非法数字不能 silently 变 NaN。
- [ ] 只依赖固定 ResultVersion 和会话游标，输出用现有 schemas；短案文字主线 450–800 字、段落约80–160字作为起点，重要限定优先于凑长度，不用演员表演盖过证据。阅读所列伴读参考，报告采用/舍弃的具体机制。
- [ ] 导出可组合 ExperienceModule 的已有方法，保持实际 ports 签名；定向→全量→typecheck/build，先交 E-N1。

## E-N2：多图提取的失败归属

**Files:** attachments/extract.ts 或同目录拆分，tests/experience/extraction-next.test.ts。

- [ ] 先测三图不同日期/发言人/否定语、单图失败、Abort 在第一图后触发、重复附件 ID/顺序；一个输入 ID 恰好成功或失败一次，不能混归属，取消后不开始第二张调用。
- [ ] visibleText 仅来自输入图，未知保留 uncertainSpans/warnings；必要缺对象给 blockingQuestions；bytesRef 仅传注入服务，不自行读本机文件或编码密钥。
- [ ] 出入口使用 ExtractionInputSchema/ExtractionBatchSchema；图片数/体积和私有访问控制仍 P 负责，不以 fixture 宣称真实视觉识别/隐私边界通过。
- [ ] 定向→全量→typecheck/build 后独立提交。

## E-N3：单次语音与分段

**Files:** companion/speech.ts、providers/tts/ 下单次 raw normalizer/transport 边界、tests/experience/speech-next.test.ts。

- [ ] 先测按现有 TTSRequestSchema 每次最多150字、speed=0/mp3；长段按句子切块，不截掉否定和限定；每块音频非空、mime正确才返回可用结果。
- [ ] 先测 Abort、提供商错误、超时/未知、voiceId 不匹配、结果/会话/segment 不属于同版本：不自动重试、不用哔声或假音频冒充成功。
- [ ] `synthesizeSegment(input,services,signal)` 沿用 SpeechInput/AudioManifest 返回类型；services.tts 返回私有 audioBytes，写入与 assetId/cacheKey 由 P 持久音频能力负责。若现有 services 无保存端口，不编造可播放 assetId：交付有类型的私有接入提案/受控实现，并在报告标记正式持久音频受阻。
- [ ] 原始供应商代码只做一次调用/归一化和安全错误，禁止模块自行绕过 gateway 付费。真实音色选择、费用/试听由 P 明确新上限后运行，本任务 0 真实请求。
- [ ] 全量/typecheck/build，报告 schema/声音实际播放/产品验收分别状态，不能以单测代替听音和浏览器 autoplay 测试。

## 交付

docs/runtime/E-下一阶段交付.md 写基准/完整最终 SHA、所有小提交、工作树、写入范围、真实检查结果、导出、参考取舍、P 必需端口及未完成边界。先交可独立接入的增量，不等附件和声音全部完成才反馈。

同机交完整 SHA；异机 commit 后 `git bundle create <交付文件> 2c6b0127591a76adc0341f8d217aa580784c7c08..HEAD` 并交 bundle+报告。不得合主线、推 GitHub、发消息或传 .env/上传/音频/数据库/node_modules。
