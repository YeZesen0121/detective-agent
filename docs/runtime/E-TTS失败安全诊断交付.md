# E：TTS失败安全诊断交付

## 基准与边界

2026-10-25。工作树`C:\Users\111\.codex\worktrees\experience-next\侦探agent`，分支`codex/experience-next`。先确认干净`c44dbb14a7ff899a5a38c8f7b41ff61e1dc91f03`，完整fast-forward到P指定`c0f111c85865cacd971cc3bbfdca997e3d3f04e7`，保留原E历史，不重开伴读返修。

本轮写入：`src/server/companion/speech-errors.ts`、`src/server/providers/tts/{diagnostic,tencent,attempt}.ts`、`tests/experience/speech-diagnostic.test.ts`和本记录。shared/platform/app/迁移/根配置/I/W/UI均未修改；公共契约0.1.0不变。不合main、不推远端。

源码SHA：`17aac15d6d3ca0c5f04507d5ba0835030f58dc46`，5文件，新增172/删除3行；后续文档提交仅保存本记录。P接收基准`c0f111c85865cacd971cc3bbfdca997e3d3f04e7`之后完整两提交即可，不重放此前E伴读历史。

真实供应商调用0次、费用0元，不读取真实DB/.env/access/cookie或旧unknown响应，不重放旧TTS。官方网页文档只作错误码格式参考，不是供应商合成调用。首段历史TTS只有failed/PROVIDER_ERROR和费用unknown，原回包丢失；本轮**不能诊断其权限、套餐或其他真实原因**，不制造历史元数据。

## 私有形状与P接线

现有3参数构造继续有效，新增可选第4参数；`code/publicMessage/mayHaveProviderCost`语义保持：

```ts
new SpeechError(code, publicMessage, mayHaveProviderCost, diagnostic?);
// 仅服务端显式读取；默认JSON.stringify / 对象展开均不包含此属性。
error.privateDiagnostic?: Readonly<{
  providerErrorCode?: string;
  providerRequestId?: string;
}>;
```

构造器重新验证第4参数，复制且冻结有效字段，以non-enumerable、不可写/不可重配属性保存。两项可以只保留一项，全部无效时无属性；不保存任何其他字段。P未来应仅显式选择这两个字段接到私有账本，不把整异常、raw或响应Message写入公开HTTP/事件/日志。本轮没有接P账本、数据库或HTTP，默认JSON不会自动带诊断，P必须显式读取。

`mayHaveProviderCost`仍是“已调用下游服务、可能产生费用”的保守标记，不证明实际发送、收费成功/免费或可重试；P继续根据网关/账本对账，不因得到错误码释放旧unknown或重发。

## 处理流程与白名单

- `normalizeTextToVoiceResponse`只在已知Response.Error存在时，从`Response.Error.Code`与`Response.RequestId`取值；兼容既有SDK去Response包裹后的同一对象，不搜索任意嵌套字段。
- `providerErrorCode`不超过128字符；大类严格匹配已知Tencent TTS公共/业务错误族；子码1–64个ASCII字母数字、首字符为字母，最多3级点分子码。禁止未知大类、空白/换行、下划线、HTML/URL、非ASCII或超长值；不trim或修补非法字段。
- `providerRequestId`必须恰好36字符且通过既有IdSchema UUID校验；不接受URL、任意字符串、超长或尾随空白。缺失/无效字段各自丢弃。
- 错误族真源为私有`diagnostic.ts`集合；读取仅限自身数据属性，不读取Error.Message或访问器、不从原型链捞值；诊断对象只保存已检查的两个字符串。
- `speechAttempt`包装已知SpeechError时传递并重新验证诊断，费用标记仍为`invoked || 原mayHaveProviderCost`。普通Error即使伪造同名属性也不转抄。
- 没有已知响应的Abort/timeout不生成Code/RequestId。发送前中止/过期仍false，发送后取消/超时仍true；迟到供应商诊断不会回填已结束的取消结果。仍一次send、有限超时与清理，无自动重试。
- 成功音频、MP3检查、原始receipt身份、实际RequestId返回、文字/音色/UUID归属门均沿用原路径，无资产/音频伪造。

参考依据：[腾讯TTS错误码](https://cloud.tencent.com/document/api/1073/37996)明确Error.Code/Message分开，并列出公共及业务大类；[TextToVoice](https://cloud.tencent.com/document/api/1073/37995)说明RequestId用于定位请求、未抵达服务端时可能没有。仅据其制定语法白名单，不将任何文档中的失败原因推定为本次历史失败。新的未知错误族安全丢弃，需另核实后有意更新集合。

## 红绿与检查

- 最初46项：36失败/10通过，失败均为应保留的诊断丢失；修补后46项全绿。再补3项访问器/原型拒绝、包装重验、发送前过期，最终49项诊断回归。
- 合法完整/单项元数据、缺字段、数组/对象/非字符串、超长/换行/非ASCII/注入文本、敏感Message、默认序列化、冻结/复制、3参数兼容、嵌套包装、原成本标记、未知异常、Abort/超时/迟到、成功音频均覆盖；fixtures明确controlled_fixture。
- `npm test -- tests/experience`：14文件227项通过；`npm test`：99文件999项通过；`npm run typecheck`、`npm run build`、`git diff --check`通过。
- fresh-context独立只读审查`review_e_tts_diagnostic`：Critical 0 / Important 0 / Minor 0，Ready。独立实跑49项诊断测试及提交差异检查通过；确认过滤/复制/冻结/不可枚举、三参数兼容、包装重验、成本/取消/超时和成功路径符合要求。全量999/typecheck/build为执行者本轮实际结果，审查者未重复执行。

独审未判断历史TTS失败原因、真实权限/套餐/收费、听感、部署/产品验收或未来P私有账本接线。以上仍属明确未完成项，P在新的逻辑请求中接入诊断并独立验证，不使用本轮受控错误样例解释旧unknown。

不把这些受控检查等同真实TTS权限、套餐、中文听感、可播放、部署或产品验收。仅未来另行明确的新逻辑请求可能留下诊断；旧失败与费用unknown保留。
