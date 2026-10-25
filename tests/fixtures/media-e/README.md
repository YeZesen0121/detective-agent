# E 媒体消费测试材料

全部材料为 `controlled_fixture`，由本项目自行编写；没有真实用户图像、声音、互联网音频、付费 API 回包。只允许测试 adapter 显式导入，生产入口不得导入本目录。`scenarios.ts` 只有数据与纯构造函数；无文件、环境变量、数据库、监听端口或网络操作。

## 消费入口

```ts
import { MEDIA_SCENARIO_IDS, createMediaScenario } from './tests/fixtures/media-e/scenarios.js';
import type { MediaScenario, ExtractionScenario, CompanionScenario } from './tests/fixtures/media-e/scenarios.js';

const scenario = createMediaScenario('three-speakers');
// 每次获得独立输入；稳定 caseId、classification、输入和人工预期见同文件类型。
if (scenario.kind === 'extraction') {
  // 测试 adapter 按 request.messages[].attachmentRefs[].id 找对应 modelOutputs。
  // 仍调用真实 extractAttachments；不要让 adapter 直接返回最终业务 batch。
}
```

`MEDIA_SCENARIO_IDS` 共 10 项。截图输入故意逆序排列，期望输出按原 order；PNG 路径相对本目录。`bytesRef` 为测试占位引用，P HTTP 集成时应上传 PNG 取得真实的受控附件 ID/引用，再同步映射模型回包及断言，不能把占位引用当私有路径。

伴读输入是固定的内存样例，沿用共享 fixture 的 UUID/占位 payloadHash；**不能直接写入 P 数据库或当真实授权记录**。P 集成时用正常测试 seed/checkpoint/commitResult 保存其 payload，由 P 重算真实 hash/生成版本与会话 ID，再将 E 模型输出引用对应地映射。真实 `createExperienceModule(resolveAuthorized)`、HTTP、gateway、保存逻辑仍照常运行，不用 fixture 替换 E 工厂。W 的独立 fixture 可以先行，P 后续接入本材料不要求 W 合并整个 E 分支。

## 案例与人工预期

|caseId|输入材料|分支及不可丢失的语义|
|---|---|---|
|three-speakers|3 张 `images/three-speakers-{0,1,2}.png`：甲说 10月30日截止不延期，乙同日说不截止，丙说只是转述|保持三人的 ID/顺序/日期/否定；说法冲突，不等于外部已证实；若第2张失败，仅归给第2张；不要求用户确认清晰文字|
|blurred-year|`images/blurred-year-0.png`：`20?6` 与被截断来源|不能补成2026；两个重要歧义合并为本图一个澄清问题；原 uncertainSpans 完整保留。图片中的问号是人为模拟，不是实际模糊识别结果|
|dense-negation|`images/dense-negation-0.png`：不超过5 mg/L、不等于5 g/L、2026-10-30、仅限样本|不得删除“不”、混淆单位或扩展至所有批次；装饰背景的不确定不触发阻塞问题|
|supported-conditional|原公告：2026届广州校区10月30日截止，其他届别不适用|saved supported 仅支持原定日期；首段呈现整份报告结论；保留地区/届别及后续公告未知|
|mixed-report|原公告与未核实转述日期相反|保留两条证据及 mixed，不能讲成确定延期；两个链接不自动算两份独立证明|
|insufficient-report|缺少后续公告|保留 insufficient、未知、缺口和条件；人设或模型的“电话确认”不得展示|
|ask-why|问“为什么不能确定后来没有延期”|answer 引用固定命题及证据；不用外搜；返回保存 cursor=1|
|ask-faster|问“快一点，只讲关键限制”|本例为 answer，保留限制和 cursor=1；测试语义不宣称自然语言节奏已验收|
|ask-new-fact|问现在有无新公告|research_request 仅待查建议，保留 cursor=1；没有新 run，也未补查|
|ask-finish|要求结束收尾|finish，resumeCursor=段数3，包含旧摘要/未知/下一步；不制造已确认结论|

所有伴读均保持旧 ResultVersion 与会话内容不变。新版 notice 不是 E 输入；P/W 应通过真实 notice 路径额外验证“提示更新但旧正文、引用、游标不换版”。这些案例的旧版本不变断言不能替代 HTTP notice 或浏览器验收。

截图 PNG 由虚构文字离线绘制，不是实际 OCR 精度验收。`manifest.json` 分开记录原 PNG 字节 SHA256 与 `visibleText` SHA256。图片 Evidence 的 contentHash 应取后者；图像上传身份取前者，不得混用。

## 可解码提示音

`audio/offline-tone.mp3` 是本地数学正弦波生成的 660Hz 提示音，输入 PCM 时长0.6秒、24kHz单声道、MP3 64kbps。**不是中文 TTS，不是音色听感样本，也不能证明朗读语义或真实服务可用。** FFprobe 容器时长0.622042秒（含编码延迟/填充）；5420字节。

SHA256：`8fbdbe0b411253967b4962ae1cd0a1171866ac209f7be1265b5ed6c961698b2b`。

本轮 Windows 上已实际完整解码通过，未只检查 MP3 头：

```powershell
ffprobe -v error -show_entries format=duration,format_name:stream=codec_name,sample_rate,channels -of json tests/fixtures/media-e/audio/offline-tone.mp3
ffmpeg -hide_banner -loglevel error -xerror -i tests/fixtures/media-e/audio/offline-tone.mp3 -f null -
```

返回 MP3 / 24000 Hz / mono / 有限 duration；完整解码退出0。工具：FFmpeg/FFprobe `N-126404-g818e5d965b-20260904`，本机已有 `C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin`；未安装新工具/依赖。所有参数、工具版本、素材哈希及 sharp 版本都在 `manifest.json`。

明确执行以下命令才会重新生成本目录素材（不同字体/编码器版本可能产生不同哈希，需一并更新 manifest 并复验）：

```powershell
npx --no-install tsx tests/fixtures/media-e/generate.ts
```

音频的确切生成命令：

```powershell
ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=660:sample_rate=24000:duration=0.6" -af "afade=t=in:st=0:d=0.03,afade=t=out:st=0.5:d=0.1" -ac 1 -c:a libmp3lame -b:a 64k -map_metadata -1 -y tests/fixtures/media-e/audio/offline-tone.mp3
```

P/W 可在测试 transport 把同一 MP3 字节构成 `TTSResponse`，以 `providerRequestId:'controlled_fixture'` 明示。E 必须将收到的**原 receipt 对象**交给 `services.audio.saveChunk`；assetId 由 P 的真实受控存储产生。`ui-audio-material.test.ts` 中的临时 UUID 仅是内存测试 adapter 的存储回执，不是生产资源，不导出为可用资产。正常/partial/failed/cancelled由测试 transport/存储的故障注入触发，不能污染生产工厂。

## 已执行验证与边界

- `tests/experience/ui-consumer-quality.test.ts`：逐图身份/失败归属，固定事实、首段结论、3段、引用、answer/research_request/finish 与游标。
- `tests/experience/ui-audio-material.test.ts`：原 E 工厂与原 receipt、150 UTF-16 边界/emoji/换行/日期/否定/末尾限定、逐字还原、已保存块取消、partial、empty failed/cancelled、unknown 不重发；PNG/MP3 哈希校验。
- `tests/experience/material-budget.test.ts`：3×24000汉字捕获不重复入模型、普通引用闭包/条件/冲突/时间保留、旧引用依赖档案受控失败、全 JSON(messages) UTF8字节+512余额边界、模型输出不能重新把存档当独立证据。
- 默认 Vitest 不依赖 FFmpeg，不联网；哈希检查仅确认验证过的字节未变化。完整解码复验用上述独立命令。
- 浏览器 `loadedmetadata/play/ended`、暂停切段不叠音、手机自动播放、真实音色/中文朗读、真实视觉和部署仍待 P/W 联调；离线解码不代表这些项目通过。

依据：PRD §7/8、AC06/10/15 的固定事实与自由打断；`docs/伴读角色生成与交互适配.md` 的结论先呈现、证据按需展开、人物表达不改判断；P07借逐图不确定项而不把OCR置信度当事实概率；P08借区分“有引用”与“引用支持”，本轮用人工预期和受控回归，不引入大型 NLI 模型。P3/P4端口负责授权/保存，P5负责恢复，E不重写这些平台机制。
