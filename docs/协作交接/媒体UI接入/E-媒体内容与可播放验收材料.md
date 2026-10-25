# 给 E Agent：媒体内容质量与可播放的离线验收材料

这是可直接执行的开发任务。用户转发即派发给唯一 E 执行者。与 W 并行，不等待 UI；不重新实现已经被 P 接收的 E-N1～N3。

**Goal:** 补齐 W 接入截图、伴读和音频时所需的业务语义验收与可解码材料，发现缺口则在 E 模块修复，使跨层验收能检查“内容正确、打断可返回、音频确实能播放”。

**Architecture:** 复用 extractAttachments/buildCompanion/answerCompanion/createSpeechSynthesizer；P 提供权威resolver、收费gateway、存储、HTTP，W负责渲染/播放。所有素材放测试目录，真实生产不导入。

**Tech Stack:** Node24.19.0、npm11.17.0、TypeScript、Vitest、已有sharp；可用已安装本地媒体工具产生自有短提示音，不安装新依赖/下载素材/调用收费TTS。

**Spec:** README、AGENTS、PRD v1.0 §7/8及AC06/10/15、系统实施设计、公共契约、`docs/伴读角色生成与交互适配.md`、P3/P4接口补充。

## 固定基准与写入边界

- 固定代码 SHA：`1b17cebff761257f174d926488830dcff46d0ccb`，已包含你的完整 f63365a、W/UI acfd9aa 与 P5 恢复接口。只在自己的分支/worktree，建议 `codex/e-media-quality`；先保存自己在途工作，再完整merge。不要重放 N1–N3 或旧返修。
- 可以修改 `src/server/attachments/`、`src/server/companion/`；`tests/experience/`；新增专属 `tests/fixtures/media-e/`；`docs/runtime/E-媒体验收交付.md`。不写 shared/platform/app/migrations、W目录、根配置/依赖、UI稿、其他人的tests/ui。
- 新共享类型/平台缺口只提供给 P；保留现有接口导出。W不等待E完成才开工。你交付有界小增量，P负责合并并通知后续素材可用。
- 真实调用 **0 次 / 0 元**。不读取 `.env`、密钥或真实用户材料。本轮不做供应商联调；旧truth 0.10元/3次授权已结束，交互池5元是工程限制。

## 已完成且必须复用

- `attachments/extract.ts` 的逐图映射与中断；`companion/build.ts`、`turn.ts` 的固定结果引用及prompt v2。
- `companion/module.ts::createExperienceModule(resolveAuthorized)` 与 `speech-persistent.ts::createSpeechSynthesizer(resolveAuthorized)` 已正式导出；P实际HTTP/宿主/resolver测试已通过。不再做第二套音频工厂。
- `ExperienceServices.audio.saveChunk(index, receipt)` 必须收到同一原始receipt对象；bytes/hash/owner/epoch/连续覆盖由P核对。不要克隆receipt或自造assetId。
- 单次伴读/问答最多2模型调用、累计预留输出2000tokens；TTS块最多150个UTF-16 code units，顺序调用，保留否定/限定和正文次序，检查Abort。
- P5恢复与历史已完成：`src/shared/experience-recovery-http.ts`；E无需读HTTP或重写持久化来适配UI。

## E-A：三图归属与伴读/追问语义（最高优先级）

**文件：** 新增 `tests/experience/ui-consumer-quality.test.ts`、`tests/fixtures/media-e/scenarios.ts`、`tests/fixtures/media-e/README.md`；发现真实缺口后才修改相应E生产文件。

**交付接口：** `scenarios.ts` 导出 `MEDIA_SCENARIO_IDS`（字符串数组）和 `createMediaScenario(id)`（返回受控输入、模型回包、逐条expected断言，具体内部type在同文件导出）。每个案例包含 `classification:'controlled_fixture'`、稳定caseId、原始材料与人工预期。不得把预设回包直接接进生产；P/W只在测试adapter使用。模块只含数据/纯函数，无env读取、listen、数据库或网络副作用。

- [ ] 先为至少6类案例加失败条件或扩展已有语义回归：①三图中两个人对同日期说相反的话；②年份模糊/来源被截断；③密集字带否定与数值单位；④真实材料范围内supported且有条件；⑤mixed/insufficient不能被伴读讲成确定结论；⑥用户“为什么/快一点/结束”保留引用、游标及finish含义。
- [ ] 三图必须保留每张bytesRef/attachmentId/顺序，逐图失败不能整批归给第一张；不把截图中的说法当外部已证实事实。关键模糊才请求最小澄清。截图正文hash与原图byteshash不是一个身份。
- [ ] 伴读3–5段、首段不藏结论，段落claim/evidence只能来自固定ResultVersion；旧报告遇到新版notice仍不改内容。450–800字/80–160字是文案起点，不能为字数删限定；不把schema通过当蕴含关系正确。
- [ ] 追问answer/research_request/finish分别有案例；已有材料能回答则不用外搜；research_request只是建议，不能伪造已补查结果/新run。resumeCursor不得越界，不要求W编造字段来通过schema。
- [ ] 若现有实现已经满足，明确记录“生产模块无需改动”，交付有意义的新增语义测试/材料即可；禁止为了有diff重构已关闭模块。若发现问题，给出红→绿回归再最小修复。

## E-B：音频切块完整性与真实可解码的离线 MP3

**文件：** 新增 `tests/experience/ui-audio-material.test.ts`；`tests/fixtures/media-e/audio/` 下1个短MP3及生成说明/哈希/时长/预期格式。禁止真实声音、个人文件、互联网不明授权音频。

- [ ] 保留/扩展切块回归：150边界、emoji代理对、换行、日期、否定、末尾限定。用原E工厂走services.tts→原receipt→saveChunk；连接后逐字还原允许的空白规范化正文，不因切块删字/漏块。
- [ ] 补业务终态样例：第2块前abort不继续发送；第2块失败保留第1块但不是ready；空failed/cancelled安全错误；unknown不由E重发。资金对账逻辑不写进E。
- [ ] 产生**离线自有短提示音MP3**，用途仅验证浏览器解码/播放/停止，不冒充中文TTS。可以使用已安装本地编码器，记录确切生成命令和工具版本；若没有工具，可提供合法授权且仓库已有的测试文件，需注明来源。禁止仅拼MP3头+零字节来宣称可播放。
- [ ] 使用真正解码器或浏览器 `loadedmetadata`/有限duration/播放ended证明有效。验证应可离线重复，记录平台/工具与实际结果。若当前环境无解码器，则如实交付blocked的该子项和具体需要，由P补验；E-A和切块测试照常完成。
- [ ] 在README注明音频是提示音，不是语义听感样本；W可把同一字节作为controlled_fixture TTS回执，P仍验证receipt原身份/保存关系。正常/partial/取消的服务回包在测试adapter构造，不能污染生产factory。

## E-C：给P/W的可消费说明与验收

- [ ] README列每个case：输入图片/文本、预期逐图归属/命题/条件/未知、预期伴读与追问类型、触发分支、哪些内容绝不能省略，方便P把原始E module接HTTP而不是替换掉E。
- [ ] 测试文件必须注明controlled_fixture，提供明确的export使用示例；W可以先用自己的fixture，P整合时再替换验证。不要要求W整分支等你。
- [ ] 设计依据：PRD固定事实/游标/旧版本；伴读研究借“结论先出现、证据按需展开、人物表达与任务节奏分离”，不做教学测验/世界编辑；源码审查P07只借OCR逐图不确定项，不把识别置信度当事实概率；P08引用评价区分“有引用”和“引用支持”，不引入重型NLI依赖。
- [ ] 定向 `npm test -- tests/experience`，再全量 `npm test`、`npm run typecheck`、`npm run build`、`git diff --check`。报告当前实际数字，不复用f63365a旧结果。必要浏览器解码可单独进行，勿占用/关闭W正在使用的测试服务。

提交 `docs/runtime/E-媒体验收交付.md`：基准/最终SHA和全部提交范围；生产代码改变/未改变；素材路径与hash/生成方法；先红后绿证据；真实API0次/费用0；未做真实视觉/TTS音色听感/手机/部署，不代表完整AC06/AC10通过。提交分支给P审查，不直接合主目录、不推远程。
