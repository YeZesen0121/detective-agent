# context-manifest.md · 上下文来源

只收录与本项目有关、可共享的内容。不含队友全量记忆、密钥、会话数据库或私人文件。

## 1. 本轮输入

协作包 `Hermes-UI协作包-v2-2026-10-24.zip`，9 个文件，解压到 `~/Projects/hermes-ui-collab-v2/pack/`，逐个比对 `manifest.json` 的 SHA-256，**9/9 一致**。

| 文件 | 字节 | SHA-256（前 16） |
|---|---|---|
| 00-协作说明.md | 24,277 | `a367a13a9b17c0c0` |
| 01-发给Hermes.txt | 4,655 | `758f79a1cbab096d` |
| 02-文件来源与使用.md | 4,135 | `ba35ddbcd2b32a14` |
| 03-最终交付给Codex.md | 8,029 | `83ced78868e35427` |
| 04-发回Codex时的提示词.txt | 1,417 | `3efee9450f94b359` |
| README-先读.md | 2,428 | `33083280bfd32a7e` |
| references/AI开发需求文档.md | 24,427 | `258d0be982329d7e` |
| skills/grill-me/LICENSE | 1,068 | `0e7ac423bf2c6e22` |
| skills/grill-me/SKILL.md | 2,297 | `760a6026cb4cc635` |

## 2. 设计基准

| 项 | 值 |
|---|---|
| 候选基准源码 | `~/Projects/detective-agent/ui/workbench.html`，43,740 字节 |
| SHA-256 | `aa6470b97aba1dd6006889e84fc9a9a9dbf00dcf00c1b4f0ed2d270593177fe3` |
| 与交付包一致性 | 与 `~/Downloads/detective-agent-ui-delivery.zip` 内 `source/workbench.html` 的 MD5 相同（`6e3c8607…`） |
| 基准截图 | 8 张，取自该交付包 `checks/screenshots/` |
| 版本控制 | 该项目**不是** Git 仓库，无提交可回退；以整文件快照作恢复点（`baseline/baseline-v0/`） |

## 3. 技能与工具

| 名称 | 版本/来源 | 证据等级 |
|---|---|---|
| `claude-design` | 随 Hermes 技能库分发，MIT，v1.1.0，25,117 字节 | **已证实使用**：2026-10-24 的基准页面生成会话加载过（Surface-First / Anti-Slop / Content Discipline 三节） |
| `grill-me` + `grilling` | 上游 `mattpocock/skills@5beb35b040e3`（MIT），本机已装为 `grill-me` / `grilling` 两个技能 | **已证实使用**：本轮分轮提问按该协议执行（前沿 + 分轮 + 推荐答案格式） |
| `popular-web-designs` / `design-md` / `sketch` | 本机已装 | **存在但未证实使用**：基准页面生成会话中未加载 |
| Chrome DevTools Protocol :9222 | Chrome 155.0.8059.82 | **已证实使用**：全部截图与交互断言均由此产生 |

## 4. 参考资料

| 资料 | 用途 | 证据等级 |
|---|---|---|
| 协作包内 `references/AI开发需求文档.md`（PRD v1.0，274 行） | 产品行为真源；四种模式的字段与规则 | **已证实使用**：本轮通读，盯梢/异常状态的设计直接引用 §9 / §11 / Q40 |
| `~/Projects/ai-detective/明察侦探事务所.md` | 「印章 / 一屏一案 / 四态人话 / 说不知道不扣分」的隐喻来源 | **已证实使用**（基准页面生成会话读过前 60 行） |
| `~/Projects/ai-detective/demo-cards.html` | 语义色与宋体标题的参考（配色方向与其相反） | **已证实使用**（读过前 2,500 字节） |
| `~/Projects/ai-detective/demo.html`、`demo-plain.html` | 更早原型 | **存在但未证实使用**（本轮未读，仅存档于 `baseline/baseline-v0/reference-earlier/`） |

## 5. 缺失

- 队友机器上的 `docs/ui/prototype/`（协作包提到，未随包附带，本机没有）。
- 原设计会话的导出记录与当时的推理过程。
- 正式项目的接口契约、shared schema、真实错误码。
- 真实检索结果、真实盯梢记录、真实 TTS 输出：原型里的对应内容**全部为合成示例**。
