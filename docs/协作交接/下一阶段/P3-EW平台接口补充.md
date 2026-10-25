# P3 平台接口补充：供正在开发的 E / W 接续

最新状态（2026-10-25）：E完整f63365a与W/UI返修acfd9aa已经P完整接收，见 [W/UI及最新P/E复验](../../runtime/P-WUI完整接收与复验-20261025.md)。已关闭任务不要重做；本文HTTP/媒体端口继续供尚未实现的附件、伴读/音频消费使用。接续基准使用P新批准固定SHA/标签，不追旧启动包的HEAD。真实视觉/TTS、手机/播放和部署仍未验收。

2026-10-25。用户已派发 I/W/E，本文件补充现有任务，不重新领取模块，也不冻结 UI。P 基于 `c21bf628bb18e4a6fdaf07d2efd9c006c23c3476` 增加平台持久化、私有文件、伴读/音频宿主；代码发布 `ed71f83d5c808f72673af21ba5e7b86b4de471af` / 标签 `p-experience-platform-v1`。具体可转交源码见 [P3 交付记录](../../runtime/P3-平台交付.md)。旧的 `2c6b012` 任务基准和完整 bundle 保留。

先保留并提交自己的已完成增量，再从 P 发布的分支/补充 bundle **merge 完整历史**；不要覆盖目录、reset、改写旧标签。只写原任务拥有的目录。公共缺口交 P，不让 E/W 自建数据库、文件存储或收费网关。先运行 npm ci、定向测试、全量测试、typecheck、build。

异机已有旧任务 `2c6b012` 源码仓库时，解压 P3 补充包后在自己的仓库执行（替换为 bundle 实际绝对路径）：

```powershell
git bundle verify 'C:\实际目录\detective-agent-p3-platform-api.bundle'
git fetch 'C:\实际目录\detective-agent-p3-platform-api.bundle' refs/tags/p-experience-platform-v1
git merge FETCH_HEAD
```

此包是约100KiB增量，必须有旧基准，不能直接 git clone；若尚无仓库，先用旧完整启动包建立 `2c6b012` 仓库。同机已共享对象的自己的工作树直接 `git merge p-experience-platform-v1` 即可；不要在 P 或别人的 checkout 切分支。

## 给 E Agent 的可直接执行补充

继续原 `E-伴读与视觉接续.md`，特别是 E-N1 质量与 E-N2 逐图归属。平台已实际调用现有 `attachments/extract.ts` 和 `companion/briefing.ts` 跑过 controlled_fixture 集成测试；你仍负责业务内容质量，不重写平台。

新增 **可选** `ExperienceServices.audio`（`src/shared/ports.ts`）：

```ts
audio?: {
  readonly jobId: string;
  saveChunk(index: number, receipt: TTSResponse): Promise<{index: number; assetId: string}>;
}
```

E-N3 不再因缺保存端口阻塞，按下面流程实现正式 `synthesizeSegment`：

1. 缺少 `services.audio` 时受控报 unavailable，不制造 assetId。输入身份、保存段落、voice 仍按原 SpeechInput 校验。
2. 只把 `input.text` 按句切为连续块，每块符合现有 TTSRequestSchema 的 **150 个 UTF-16 code units** 上限（保守使用 `.length`；不要切开代理对）。保留否定、限定和文字次序，不生成改写文本。首尾/块间空白可省，不能省正文。
3. 顺序调用 `services.tts({text,voiceId:input.voiceId,speed:0,codec:'mp3'}, input.context, signal)`，再把**同一个、未改动的原始 receipt 对象**交给 `services.audio.saveChunk(index, receipt)`。不复制/重建 receipt、不修改字节、不自行写磁盘、不绕过 gateway。
4. `index` 从 0 连续递增；返回 AudioManifest 的 `jobId=services.audio.jobId`，chunk assetId 只来自 saveChunk。只有完整段落都已合成并保存才返回 ready；中止/失败不得自动重发、补假块或返回假成功。已有保存块由平台保留，显式新请求可补缺块。
5. 每次外部动作前后检查 Abort；平台也会核对 epoch、原始回执、文字连续覆盖和 manifest。同缓存请求可能返回缓存 receipt，saveChunk 仍照常调用，不因此额外计费。
6. 伴读/问答只用 `model/budget/clock` 等交互能力；交互 job 不是调查 run，不能调用 checkpoint/events 伪造调查进度。图片提取在真实调查 run 下仍获得原调查 checkpoint/events。

平台单次伴读/问答共计最多 2 次模型调用，**累计预留输出 2000 tokens**；已知较少的实际输出释放差额，unknown 不释放。修正请求必须符合剩余额度。跨报告版本仍共用每案交互池，不能假定新版本或重试获得新额度。

视觉引用继续使用输入的 bytesRef，E 不读路径。P 校验归属后向真实 model transport 第四参数注入原始 `ResolvedImage[]`；视觉 token 上界和价格由 P 配置。当前生产 truth profile 未声明截图能力，带图 start 明确 503，不会静默忽略图。

新增回归建议：原始 receipt、保存索引/manifest、缺端口、取消后不开始下一块、partial 不伪 ready、UTF-16/句末限定、不丢输入正文。所有受控字节标 `controlled_fixture`；本任务仍 0 真实请求，不读取凭据、不试听收费供应商。交付导出和完整提交范围给 P。

## 给 W Agent 的可直接执行补充

继续原 `W-交互编排与接入测试.md`，新增 headless API/控制模型即可，视觉布局交 UI 独立推进。实际公共 schema：`src/shared/experience-http.ts`；已有 `runtime-http.ts` 和契约版本 0.1.0 保持。所有 JSON 继续 `{data,meta}` envelope；二进制/204 除外。

|方法与路径（前缀 `/api/v1`）|请求 / 返回|说明|
|---|---|---|
|POST `/investigations/:id/attachments`|multipart **仅 file 一个文件**；201 AttachmentPublic|携带 Idempotency-Key；不手设 multipart boundary；真实解码后绑定案件|
|GET 同路径|`{items: AttachmentPublic[]}`|恢复附件列表，不生成内容|
|DELETE `/investigations/:id/attachments/:attachmentId`|204|删除天然幂等；调查运行中/历史引用拒绝修改|
|GET `/attachments/:id/content`|原图字节|cookie 鉴权，private/no-store；JSON 不含 storageKey/服务器路径|
|POST `/results/:id/companions`|`{personaId:'default'}` →202 `{companionSessionId,status}`|同版本/人物复用；key 必需；异步轮询状态|
|GET `/companions/:id`|`{session,voiceId,updateNotice}`|session 永远固定旧 resultVersion；notice 只提示显式打开新版本|
|PATCH `/companions/:id`|`{cursor?,ended?}` →CompanionSession|持久游标；ended 停止该会话生成/问答/音频，不删已有段落|
|POST `/companions/:id/turns`|`{question}` →202 `{turnId}`|key 必需，不自动重试 POST|
|GET `/companions/:id/turns/:turnId`|TurnViewSchema|reply 可为 research_request；`newRunId:null`，没有偷偷搜索；补查要走用户显式研究动作|
|GET `/investigations/:id/interaction-budget`|`{configured,snapshot,ttsCharacters}`|只读；没有池时后两者 null，GET 不建池；关闭生成也可读已存余额|
|GET `/voices`|`{items:[{id,label,available}]}`|只列可用配置；无真实配置返回 []，不要补假音色|
|POST `/companions/:id/audio`|`{segmentId,voiceId,speed:0}` →202 `{audioJobId}`|key 必需；文字取已存段落，不接受客户端 text|
|GET `/audio-jobs/:id`|AudioManifest|queued/generating/ready/partial/failed/cancelled；只有 ready chunk 才有可读 assetId|
|POST `/audio-jobs/:id/cancel`|202 AudioManifest|天然幂等取消，不重发生成；已保存块保留|
|GET `/audio-assets/:id`|MP3；200/206/416|cookie 鉴权，单 Range/suffix/If-Range；private/no-store、nosniff|

写请求继续同源 Origin/cookie；不同 session 即使同体验码也不可互读。同一逻辑动作保存原 key；POST 超时只读查询恢复，不能自动换 key 重试。音频同缓存 single-flight；只有用户明确重试失败/partial/过期缓存时才生成**新** key，平台只补缺块。7 天缓存期满返回 partial/AUDIO_CACHE_UNAVAILABLE，不会 GET 自动收费重建。

后续P音频修复补充：新key仍须先核对该段历史在途/unknown请求，字符或金额任一未对账返回409/INVALID_STATE，不能以显式重试替代对账；已保存的完整授权缓存仍可读且不收费。合法failed/cancelled空清单会持久保存安全错误码，partial保留已存块。具体回归和发布边界见 [P3音频修复](../../runtime/P3-音频终态与对账门禁修复.md)；接收者需要合入该后续提交，旧p-experience-platform-v1标签保持原位置。

P4进一步提供私有 `createSpeechSynthesizer(resolveAuthorized)` 宿主组装入口及可信voiceType/revision固化；E工厂可直接接入该resolver，W的公开VoicesSchema不变。详见 [P4结果与配置形状](../../runtime/P4-语音授权绑定-计划.md)。这不是已开启真实生成；缺可信metadata时不列出可用factory音色并返回503。

预算是全局/组/每案交互池三层交集；TTS 字符另有预留。`configured:false` 不是可调用，剩余工程限额不是新增付费授权。健康能力 `attachments` 表示可存原图，**不保证当前调查 profile 支持视觉**；companions/audio 只有正式配置才列入 capability。默认 main 没有注入体验模块/价格/真实视觉与 TTS，不装 fixture，生成 POST 503，已存历史和鉴权内容仍可读。

请补 headless 测试：重复点击/旧 key、跨会话 404、轮询迟到不覆盖新会话、cursor 保存、取消后 GET 恢复、voice 空列表、partial chunk、Range 失败、旧报告新 notice 只显式切换。浏览器播放/手机自动播放/真实听感与 UI 验收分别记录，不用纯模型测试宣称通过。

## 公共语义补充

- 原图 SHA256 是 `Attachment.sha256` / `AttachmentSnapshot.sha256`，代表原始二进制捕获；图片 Evidence 的 `contentHash` 是冻结 `extraction.visibleText` 的 SHA256，excerpt 必须逐字包含于该文本。两种 hash 不能混用。
- 每案最多 3 图，每图 8MiB/总24MiB、8192 单边/3200万像素，JPEG/PNG/WebP 单帧；动态 PNG/WebP、SVG/GIF/伪图拒绝。等待澄清前可删除，已开始后不允许改附件，历史引用受不可变约束。
- 真实视觉/TTS transport、音色授权和价格仍需 P 有界联调；本补充和平台单测不代表 AC06/10/15 或部署通过。
