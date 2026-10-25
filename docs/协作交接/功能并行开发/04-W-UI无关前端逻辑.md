# W：UI 定稿前的前端逻辑实施计划

版本 1.0｜2026-10-24｜状态：可转交的实施任务，尚未执行本文件新增任务。

**Goal：** 先做好将来页面可直接调用的数据、任务状态、证据查询和声音控制，保留完整视觉设计空间。
**Architecture：** 纯 TypeScript controller/reducer + 注入 API/Audio driver；不生成 JSX 页面或 CSS。设计确认后唯一 W 在其上实现视图。
**Tech Stack：** Node 24、TypeScript、现有 Fastify/SQLite/React/Vitest，保持锁文件。
**Spec：** PRD v1.0 + 系统实施设计 + 实施接口契约；本文件细化分工，不改产品需求。

执行方式：接收 Agent 在自己的隔离工作树逐项实施。本机 writing-plans 技能用于组织任务；可用 executing-plans 辅助，但技能未安装不能阻塞，按本文步骤即可，不要求另开子 Agent。

## 接收 Agent：开工协议

这是一份可由用户直接转交的新对话任务书；用户转交本文件并要求执行，即可在指定范围内编码。不因看到同目录其他任务书而领取其他角色。角色 W，建议分支 codex/web-headless。同一角色只交给一个执行者；已有执行者时在原对话续接。
本文件允许领取列出的模块，不能领取 P 平台或其他业务目录。

- 代码源：同机 D:\侦探agent；异机使用已发出的侦探Agent-队友启动包-G0.zip 内 detective-agent-g0.bundle。不是空目录重新造工程。
- 代码起点：1aaf2d197bdeb7f9987338b6ea6aa2fffc489835；contractVersion=0.1.0。G0 标签 g0-parallel-v1 保持不变，不要求追随主分支后续平台提交。
- 本任务书晚于代码基线，必须随代码一起提供；本文件在旧 G0 工作树中不存在是正常的。全文保留为外部任务输入，不要为它切换主目录分支。
- 同机：在自己的对话使用原生 create_worktree，以指定 SHA 创建并绑定隔离工作树，再创建上述分支。没有工具可用时，以 git worktree add -b <上述分支> <独立新目录> <基准SHA> 达到同样隔离。分支或目录已存在时检查归属，不能重置别人工作。以后所有命令明确用新目录。
- 异机：先 git clone <G0-bundle绝对路径> <新的项目目录>，再 git switch -c <上述分支> 1aaf2d197bdeb7f9987338b6ea6aa2fffc489835。完整克隆后核对 git rev-parse HEAD 与指定起点一致。
- 检查 git status --short、实际 cwd、HEAD、分支。Node 24.19.0 / npm 11.17.0，按 .node-version 和锁文件安装。先 npm ci、npm run typecheck、npm test、npm run build，记真实退出码；不要关闭 engine 校验或改 allowScripts 绕过安装错误。
- 允许写入：src/web/api/、src/web/model/、src/web/controllers/、tests/web-model/、docs/runtime/W-交付.md。不改 main.tsx、CSS、页面组件、tests/ui、DESIGN.md 或 docs/ui。。只提交明确文件；公共 schema、根依赖、迁移和 app.ts 归 P。新增依赖必须给 P 具体用途和替代方案，本轮优先已有依赖。
- 不读主目录 .env，不索要或转发 Key，不自动执行任何 --live 探针。用 injected services 和 controlled_fixture 完成本轮；真实验证由 P 配置明确调用数与金额上限后执行。
- 先读 README.md、AGENTS.md、docs/AI开发需求文档.md v1.0、docs/系统实施设计.md、docs/实施接口契约.md、docs/并行开发任务包.md、docs/验收追踪矩阵.md，以及实际 src/shared/contracts.ts、ports.ts。文档中的路线不等于已经存在的 HTTP。
- 本轮不冻结颜色、字体、页面布局，不创建另一套 UI 设计稿。无新需求，不扩大到可选关系图、角色自定义或 Markdown 下载。

## 每个增量的交付方法

每步按“失败断言 → 确认失败原因 → 最小实现 → 相关测试 → typecheck/build → 独立小提交”推进。结束时运行完整 npm test、npm run typecheck、npm run build；有浏览器改动才加对应浏览器验证。0 tests/跳过/受阻不能记通过。缺公共能力时交私有接口说明与可运行受控模块，不把缺口藏在生产假数据里。

交付报告放在本角色获准的报告路径。逐项写：任务ID、基准SHA、最终SHA、分支、文件清单、实际命令/退出码/测试数量、对应AC、参考文件及采用/舍弃机制、真实/受控边界、未完成项、P需接入的导出/接口、费用（本轮应为0次真实调用）。代码与报告一起提交。

同机交完整 SHA；异机还须在完成提交后运行 git bundle create <新交付文件绝对路径> g0-parallel-v1..HEAD，把 bundle 和完整 SHA 一起交用户。只有 SHA 不能传输代码。不要发送 .env、数据库、node_modules 或整份工作目录。P 核对 bundle、diff、范围并在集成后重跑检查；模块自测不等于产品验收。不要自行合并主分支，不自动给其他人或对话发消息。

## 当前边界与唯一 W

这是用户本轮授权的“先功能、后 UI”例外：W 现在可写上述非视觉子目录。UI设计对话只写设计资料；页面实现等设计确认后由同一 W 或明确交接后的继任者承担，不另开第二个前端写入者。
当前服务仅 health、sessions、session、POST investigations、GET investigations/:id；其余路由是契约计划，不冒称可用。不引入状态管理库，现有 TypeScript/Zod 足够。

## W1：HTTP客户端和会话/草稿

**文件：** api/client.ts、api/foundation.ts；tests/web-model/client.test.ts。
**导出：**
    request<T>(path: string, options: RequestInit,
      schema: z.ZodType<T>, transport?: typeof fetch): Promise<T>
    createFoundationApi(transport: typeof fetch): FoundationApi
FoundationApi 方法：createSession(code,signal)、getSession(signal)、createInvestigation(input,key,signal)、getInvestigation(id,signal)。参数/返回复用实际 app.ts 与 schemas；缺导出 response schema 先在 api/foundation.ts 定义本地 parser，不改 shared。key 是一次逻辑创建的固定值。
- [ ] 写失败测试：非法JSON、非预期contractVersion、401、429、网络断开；错误保留 safe code/message/requestId；不能泄露 cookie。
- [ ] 使用相对同源路径/credentials；前端不读或保存 HttpOnly cookie、不写Key、不在 localStorage 放案件历史。
- [ ] POST不自动重试；用户明确重试同次创建复用原key。取消fetch不等于取消服务器任务。
- [ ] npm test -- tests/web-model/client.test.ts；typecheck/build后交首个增量。

## W2：任务状态与事件，独立于 HTTP 是否完成

**文件：** model/task.ts、controllers/task.ts、api/task-port.ts；tests/web-model/task.test.ts。
**私有接入端口：**
    type RunView = { run: Run; remainingBudget: BudgetSnapshot;
      clarification: Clarification | null; partialMaterialSummary: string | null };
    interface TaskPort {
      getRun(runId: string, signal: AbortSignal): Promise<RunView>;
      getEvents(investigationId: string, afterSeq: number, signal: AbortSignal):
        Promise<{ items: ProgressEvent[]; nextSeq: number; hasMore: boolean }>;
      cancel(runId: string, key: string, signal: AbortSignal): Promise<Run>;
    }
这是 W 模块内部归一化类型，不是新 HTTP 契约。P最终HTTP若部分材料是对象，由adapter转摘要；cancel HTTP的短响应随后GET完整Run再归一化。将来HTTP映射集中在 api/task-http.ts；当前未实现路由先不导出可用生产adapter，用测试注入端口。

    createTaskController(port: TaskPort): {
      follow(investigationId: string, runId: string): Promise<void>;
      cancel(): Promise<void>; disconnect(): void;
      getState(): TaskViewState; subscribe(listener: () => void): () => void;
    }
TaskViewState 在 model/task.ts 定义：data: RunView|null，connection: idle/loading/connected/reconnecting/error，cancelPending:boolean，events:ProgressEvent[]，lastSeq:number，error:安全错误|null。运行状态直接来自 Run.status；不能用网络错误覆盖成 run.failed。
- [ ] 测100条事件分页、重复seq、迟到旧run响应、断线后从lastSeq恢复、internal事件过滤；hasMore立即续取但检测nextSeq不前进并报协议错。
- [ ] 正常轮询间隔1秒（可注入调度器供假时钟测试），失败退避1/2/4/8/15秒并明确断线状态；401停止轮询。disconnect取消本地读取，不调用服务端cancel；follow换run取消旧读取且generation递增。
- [ ] cancelPending只表示已请求；必须以服务器确认状态为准。完成/取消/失败/部分结果/等待用户均保留已取证据，不能弹出伪成功。
- [ ] 不计算假进度、不展示内部推理；“耗尽”与“技术错误”分开。以fake clock/Promise控制乱序，不能靠sleep凑通过。

## W3：版本、来源和伴读读取模型

**文件：** model/result.ts、model/companion.ts；tests/web-model/result.test.ts、companion.test.ts。
**导出：**
    projectResult(version: ResultVersion): ResultViewModel
    findEvidence(version: ResultVersion, evidenceId: string): Evidence | null
    projectCompanion(session: CompanionSession, version: ResultVersion): CompanionViewModel
ViewModel只做数据选择/分组，至少保留versionId、summary、conditions、unknowns、queryTime、claims、readStatus、sources和引用ID，不另造事实结论。
- [ ] fixture测试成功/冲突/不足/提供方失败/新版；三呈现同固定证据，不删关键限定。来源只有摘要时不能标“已读全文”。
- [ ] 旧报告固定 selectedVersionId；独立 updateNotice 不修改当前payload或伴读；通知跳转是明确动作。读取新版不能隐式覆盖旧页面state。
- [ ] 伴读cursor来自保存会话，resumeCursor合法；打断答案和主线分开，收尾不触发新研究。模型层不决定卡片排列/颜色。

## W4：声音控制，不等待音色或UI

**文件：** controllers/audio.ts；tests/web-model/audio.test.ts。
    interface AudioDriver {
      play(assetId: string, signal: AbortSignal): Promise<void>;
      stop(): void;
    }
    createAudioController(driver: AudioDriver): {
      play(manifest: AudioManifest): Promise<void>; stop(): void;
      dispose(): void; getState(): AudioPlaybackState;
    }
AudioPlaybackState含epoch、jobId|null、chunkIndex|null、status:idle/playing/stopped/failed、error|null。driver负责字节/实际Audio；控制器管理切段顺序、epoch、取消。
- [ ] 测必须显式play、连续点击只一条播放链、stop立即调用driver.stop、迟到manifest/Promise不复活旧音频、失败保留文字。
- [ ] 本轮使用严格fake driver；浏览器Audio和objectURL释放由后续W实现，云TTS费用取消由P负责。不能因为headless测试通过而宣称真实不叠音/试听通过。

## 验收与接回

npm test -- tests/web-model；完整测试/typecheck/build。交给后续UI的清单包含：每个controller导出、订阅/销毁方法、状态字段、真实可用HTTP/仅注入测试HTTP、设计要展示的异常状态。禁止提交演示页作为视觉定稿。

**Review Focus：** 重复POST收费、迟到响应串案、网络断开误取消、旧版被新结果覆盖、声音停止后复活。
**参考与取舍：** 实施设计D04/D08/D10，R07/R08，Vane来源/过程组件只借字段和事件思路，不搬整套页面；ui-ux-pro-max 本轮定向检索 loading cancellation feedback，匹配 Feedback/Loading Indicators：等待须有状态反馈。只采数据状态要求，不从搜索结果擅定spinner、动画或页面风格。该技能没有证明后台取消机制，取消竞态按本项目契约测试。
