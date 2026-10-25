# 真实服务联调状态

**23:53新增：** 已完成一次有界真实truth主路径（元宝1＋Fetch1＋模型1，0.10元上限，预算保守计量0.034604元，账单未知）。实际HTTP/宿主/I/账本/快照运行成功，P Agent核对该简单官方自述的来源支持；其他模式和完整产品未验收。见[本轮结果](truth-live-20261024-01-结果.md)。以下首次探针记录保留原时间，不代表新调用授权。

更新：2026-10-24 16:46（北京时间）。**元宝、DeepSeek模型、Fetch均已完成首次真实调用；视觉、TTS尚未真实联调。** 下列是依赖与最小材料链路的验证，完整产品仍待开发及验收。

|服务|真实状态|阻塞与下一步|
|---|---|---|
|元宝 SearchPro|PASS_API_RESPONSE（一次）|腾讯云AK/SK签名；standard；10条有效结果；无坏条目；1093ms；未读原文|
|DeepSeek模型|PASS_STRUCTURED_OUTPUT（一次）|deepseek-flash；JSON结构通过，原文引句逐字匹配；2255 tokens；1463ms|
|DeepSeek Fetch|PASS_FETCH_RESPONSE（一次）|读取元宝选出的Node.js官网历史版本页；2710字符Markdown；5813ms|
|视觉|NOT_RUN|文本接口成功不证明截图理解质量或多图归属正确|
|TTS|NOT_RUN|未验证账号、音色和合成结果|
|部署|NOT_RUN|未配置主机、域名或 HTTPS|

## 用户配置元宝 Key

用户本机已配置腾讯云签名凭据，无需重复提供。新队友/环境支持以下两种路线，不能混用认证方式：

1. 服务API KEY：在本机 `.env` 设置 `YUANBAO_API_KEY`，通过Bear​​er调用服务Key入口。该文件被Git忽略，不经聊天转交明文。
2. 腾讯云AK/SK：设置 `TENCENT_SECRET_ID` 与 `TENCENT_SECRET_KEY`，使用已锁定的官方 `tencentcloud-sdk-nodejs-wsa` SDK进行TC3签名，调用 `wsa.tencentcloudapi.com`、版本 `2025-05-08`。该接口不要求Region。当前采用此路线。若两类凭据同时存在，探针优先使用服务API KEY，并在报告注明authMode。[官方SearchPro说明](https://cloud.tencent.com/document/api/1806/121811)、[官方SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs)
3. 在 `D:\侦探agent` 运行 `npm.cmd run probe:search`，仅检查是否具备配置，不发送请求。
4. 配置完成后，运行 `npm.cmd run probe:search -- --live` 才发送最多一次可能计费的 HTTP 请求。无自动重试；超时视为费用未知。也可以通知主对话“Key已配置”，由主对话执行该最小探针。

探针根据凭据选择官方域名及鉴权方式，查询为公开技术主题。逐项解析返回的Pages JSON字符串，检查可用标题、链接、摘要字段。真实报告写入本机 `.local/probes/yuanbao-latest.json` 并按时间归档；仅配置检查写入 `yuanbao-configuration.json`，不会覆盖实测证据。报告不记录Key或原始错误消息。

`PASS_API_RESPONSE` 仅表示一次鉴权请求及返回字段可解析；`PASS_EMPTY_RESPONSE` 只表示空响应结构合法。两者均不表示三种调查模式、引用支持、原文读取或最终产品已经通过验收。第一次普通查询若为空，还需更换公开主题排查。缺 Key 的执行结果必须是 `BLOCKED`，不是测试通过。

## 本次真实调用记录

- 执行：`npm.cmd run probe:search -- --live`，2026-10-24 16:41:06开始；只调用一次，无自动重试。
- 认证：TC3-HMAC-SHA256；SDK `tencentcloud-sdk-nodejs-wsa@4.1.329`，检查了其实际请求路径；未发现应用层重试循环。
- 查询：`Node.js 24 官方发布`；返回HTTP200、standard、10条有效结果、0条坏格式，1093ms。
- RequestId：`048a2f1a-3f3b-48f2-82a2-4065f76ed7e4`。
- 包含Node.js官网版本归档及版本说明链接；本次仅检查返回字段，不把结果排序或摘要当作最新版本结论。
- 返回内容为 `snippet_only`，未抓取原文；未调用模型、视觉、Fetch或TTS。
- 实际费用未知，等待控制台账单核对；不记录为免费或零成本。

Site/Freshness、空结果、真实错误路径和三种调查模式尚未实测，不能从本次普通查询推断全部可用。

## DeepSeek模型与正文读取首次实测

- 用户提供的DeepSeek Key已保存到本机.env的`DEEPSEEK_API_KEY`；不用再次提供，也不转发给队友。探针`npm.cmd run probe:deepseek -- --live`最多两次HTTP请求，无自动重试；输出上限512 tokens，保守估算预算上限0.10元。
- 16:46:31开始，Fetch请求`POST https://api.deepseek.com/v1/tools/fetch`，读取元宝前次实际返回的`https://nodejs.org/zh-cn/download/archive/v24.16.0`。
- Fetch HTTP200，返回2710字符Markdown，全部保存；耗时5813ms。只确认供应商返回的抓取文本，不声称拿到了页面全部动态内容；供应商未提供重定向链，报告已标记未知。
- 将该次真实抓取材料送入`deepseek-flash`，启用json_object，关闭思考模式用于这次小范围提取探针，最多512输出tokens。**此设置不代表产品调查模式已选定低推理强度。**
- 模型HTTP200，1463ms，返回模型ID `deepseek-flash`；prompt2170、completion85、合计2255 tokens。RequestId `59cd5674-7e7d-4db0-9857-9e9bbbbf7af7`。
- 输出JSON包含事实、原文引句、source_1和局限。schema通过；引句在本次实际读取材料中的偏移为252，逐字匹配。人工查看了相邻上下文；该页面是历史归档，不据此断言当前最新版本。
- 本次实现的程序检查只证明结构、来源ID和引句存在；它不自动证明所有语义都正确，也不等于交叉核验或多轮调查已通过。
- 本次技术链路为：前次元宝真实结果→Fetch读取实际网页→模型据此提取事实。没有使用受控材料回退；若以后Fetch失败，脚本可单独测试模型，但必须明确标记controlled_fixture，不算真实材料链路通过。
- 新增DeepSeek请求共2次，累计本轮项目真实外部请求为元宝1＋Fetch1＋模型1；无自动重试。Fetch按当前官方成功请求价格估算0.005元，模型按高峰价保守估算上界0.00502元；合计估算上界0.01002元。实际账单金额仍未知，未写成实际扣费。

依据：[JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)、[Fetch接口](https://api-docs.deepseek.com/zh-cn/guides/search/)、[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[思考模式开关](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。官方文档与本次账号响应分别核对；不使用DeepSeek Search替代元宝。

脱敏报告：`.local/probes/deepseek-latest.json`及按时间归档；抓取材料只保留在本机`.local/probes/deepseek-source.json`。配置检查使用独立文件，不覆盖实测记录。

## 下一阶段

核心调查所需的搜索、读取、文字模型已有首次实测证据，不再以缺这两家的Key为阻塞。接下来落实统一预算/gateway、任务状态与证据快照，再将这些已验证接口串入可操作的调查路径。仍须验证多轮补查、反证/冲突、取消、费用限制、结果版本、截图、语音及部署。
