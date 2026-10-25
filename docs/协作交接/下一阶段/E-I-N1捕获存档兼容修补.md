# 转交现有 E Agent：I-N1 原始捕获存档的模型输入兼容

2026-10-25。仅补充当前 E 工作，不新建第二个 E，不接管 UI，不运行真实 API。

## 已确认的问题与基准

- I-N1 来源 `09ea6913a557f2ce1289ce0be87dfdd18302b9de`，代码 `ac4ee6063bd0ce8972b8711665e3edf3e184e00a`。I 把完整捕获作为 `limitations` 以 `raw_capture_only` 开头的 Evidence 存档，普通片段仍用于判断。该存档不是额外信源，也不应重复进入模型上下文。
- P 基准为 `fd51ff6177fb09a456d40b43758dafb3e8c0029c`。本次接收候选分支为 `codex/p-i-n1-regression`，写入记录见 `docs/runtime/P-I-N1接收与平台回归.md`；在原 P 给出干净已提交基准前，不自行猜测并合入其它 P 在途实现。
- 检查 E 最新 `codex/experience-next` 的 `19893b2`：`src/server/companion/material.ts::material()` 仍序列化全部 `version.payload.evidence`，旧 briefing 实现也有同样问题。此问题目前**未修复**；本轮 P 没有修改 E 目录，也没有合并 E。

独立只读审查用 controlled_fixture 三份各24000汉字捕获，得到12条Evidence（含3条原始存档）。旧伴读请求 JSON(messages) 为257029 bytes，已经超过每案200000输入总额；即使仅过滤存档，仍必须另外满足 P 单次模型24000输入预留上限。不能靠调高配额或换 key 解决。

## 可直接执行的修补任务

写入范围：原 E 工作树的 `src/server/companion/` 与 `tests/experience/`、E 自己的交付报告。不得修改 shared/platform/app/根依赖、I、W、UI。沿用原分支及所有已做工作。

1. 先写失败回归：报告同时有普通引用片段与 raw_capture_only 存档，build 与 turn 的实际 model request 均不得把存档当独立材料重复发送。引用闭包、适用条件、未知、冲突、时间和版本ID仍保留；原 ResultVersion 不可变，不删数据库档案、不伪造新 hash。
2. 模型上下文筛选跳过 `evidence.limitations.some(s=>s.startsWith('raw_capture_only'))`。以 claims/当前问题/段落必要的引用闭包选择普通片段，而不是简单先截掉末尾；不把相同捕获多段或转载当多份独立证明。
3. 预算读取平台 snapshot；整份 JSON(messages) UTF8 字节数加512余量须不超过 `min(24000, remaining.inputTokens)`，同时遵守已有累计输出/调用上限。若必要限定无法容纳，受控拒绝或有明确限制的回退，不能无声截掉否定/条件或绕过 gateway。
4. 如果旧报告确有 claim 引用 raw 存档，保守处理引用依赖或说明无法安全压缩，不简单删掉引用后继续断言。页面证据卡/原文定位可保留档案访问；禁止改写旧报告正文。
5. 增加实际3×24000汉字及小余额、普通短报告、问答、旧版本/游标不变的测试。测试材料标 controlled_fixture，模型用注入受控服务，不跑真实供应商。
6. 执行定向→全量→typecheck→build，交完整提交 SHA、实际文件、测试证据和未完成项给 P；不自行合主目录或推远程。

这是 I/E 接线所需修补，不代表要求重做已交付 E-N1/N2/N3，也不把离线模型上下文通过等同真实伴读/音频/产品验收通过。
