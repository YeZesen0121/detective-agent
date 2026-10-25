# P接入M：持久化、调度宿主和HTTP
2026-10-24。P基准a2e258d，分支codex/platform-lifecycle。
M输入为G0..448c776三个提交f4c525c/9f4adf3/448c776，全量复核后依序cherry-pick为aa02d12/1b5f34c/c67689d。未改原M分支或重写M模块。

## 审查与实现范围
requesting-code-review独立只读审查确认M无Critical/Important/Minor；M53项与typecheck复跑通过。
P新增006迁移、WatchStore、WatchHost、目标页机械捕获、watch-http schema及app/RunStore/BudgetBook接入；不改UI和I的事实比较。
- 新建监测从本会话最新同scope结果开始，默认3600秒、24h，到期不超过服务/会话结束；首次无通知；同案1个/同会话最多3个未结束监测。
- start/立即检查分别持久幂等。立即检查先保存queued WatchCheck并返回202/watchCheckId；M busy时票据不丢，后续scan领取，void不等于成功。
- 单宿主初始化SQLite后，两个独立Node进程的claim竞争只产生一个running check。事务同时限制全局2运行任务、watch1、同案件与同会话活动锁。
- claim持久run/单次预算window/period关系；180秒租约、30秒心跳，120秒单次活动期限；scopeVersion、run epoch、watch lease epoch、旧基线、状态和期限共同围栏。
- 普通预算仍3层；watch为全局/访问组/单次window/周期window四层，通过检查映射核验归属。单次1元/周期5元；120秒、搜索3/读取3/模型8、48k输入/8k输出。周期池每项显式续期才新建，旧账和unknown预留仍保留并可结算。
- 周期池其他数量上限为24h内24次每小时+最多288次手动检查的保守上界；每次/全局各限制取最小，不能借周期池扩大全局资金。公开used/reserved从账本读取。
- changed：原子生成delta、ResultVersion、VersionLink、推进latest/成功基线、Notification和check状态；旧报告触发器禁止UPDATE/DELETE。unchanged只更新lastSuccess；unknown/failed不推进基线。
- 前台同scope补查提交时原子同步watch基线、提升watch epoch、撤销旧queued check，不为用户刚查到的新结果另发通知。
- 暂停/删除/续期撤销旧检查提交权；每次活动计量幂等，正常关闭先停扫描接单并await M.stop，旧检查中断。启动恢复不重放未知收费调用。
- 后台30秒timer与I.runInvestigation/compareWatchResult经过现有InvestigationHost的同一PaidGateway，包含search/read/model物理并发和正常任务费用池。没有直接网络调用。
- 固定网页先经有界reader机械捕获最多3页，再把来源/原文证据作为checkpoint交I；不作事实裁决。目标超过单次3读预算的未读项明确READ_LIMIT，因此M保守unknown，不假装已检查全部20个URL。开放问题由I按watch intent有界搜索。
- URL输入筛除回环、私网字面IP及localhost/internal等主机名。这是初始地址筛查；真实HTTP适配器仍必须核验DNS和重定向，不能把此parser说成完整SSRF验证。

## W可用接口
公共补充schema：src/shared/watch-http.ts，原contracts/ports 0.1.0不变。
- POST /api/v1/watches（Idempotency-Key）→201 WatchPublic；
- GET /watches →{items}；PATCH /watches/:id {action:pause/resume/renew}→WatchPublic；DELETE→204软删除；
- POST /watches/:id/checks（Idempotency-Key）→202 {watchCheckId}；GET /watches/:id/checks?cursor=N→{items,nextCursor,hasMore}；
- GET /notifications?cursor=N→{items,nextCursor,hasMore,unreadCount}；PATCH /notifications/:id {read:true}→NotificationPublic。
所有路径前缀/api/v1；沿用Origin、HttpOnly会话、跨会话404和envelope。通知/监测响应不含sessionId。
默认main尚未注入I/原始adapter/价格/资金，创建/检查仍503；查询持久历史不需要假模块。生产不能导入测试fixture。

## 验证及证据边界
- WatchStore首7项因缺实现失败后转绿：通知事务、不可变旧版、unknown、暂停删除、错误证据全回滚、续期旧费用、A→B→A。
- HTTP首2项因404失败后转绿；私网目标4反例201而非400后补筛查转绿。
- 跨进程首轮在两子进程同时把备份DB从初始journal切WAL时遇锁；测试修正为项目单宿主先初始化/迁移，再让两进程竞争claim。此测试证明claim事务，不宣称多实例启动/部署。
- 已测全局运行锁、五元周期真实账本（受控数字）、queued票据/前台更新撤销、过期重启、后台timer、保守读取失败、幂等/隐私/已读。无浏览器对象参与后台timer测试。
- 当前增量预计完整181项；最终实际数量和审查结果以下续记为准。所有内容controlled_fixture；真实供应商新增0次、费用0。
- AC11/15的真实页面修改→关浏览器→来源核验→通知→新旧报告及旧伴读，以及有界元宝开放问题检查、部署/手机/听音未运行。

## 依赖更新与裁决
另一结束P分支b963178的报告已确认第三轮I/E交付34e4ff8与reader hash修复44a9754在该分支离线接收，不再沿用旧返修阻塞描述。该分支尚未并入本P宿主；真实transport/计价及followup/compareWatch等业务完整性不由本轮M测试证明。本次仅按注入签名组装，后续取入完整业务范围与复验。
Ruling：period复用既有window池类型，由006映射区分单次/周期；不改公共BudgetAmounts或伪造watch调用为普通3层，旧账可追溯。
Ruling：M.finish无AbortSignal，P以短事务开始时围栏判定提交权；提交和暂停/删除线性化，已提交事务不由晚到stop撤回。
Ruling：P规范化事实签名只为去重，I决定是否显著，不拿全文hash替代语义；I提供factSignature不假设与P签名算法相同。

## P接入独立审查与最终修复
审查范围c67689d..7eae05c，只读、未读凭据或调用外部API；Critical 0、Important 4、Minor 0。
1. 通用resume可把watch run恢复成三层普通调用，绕过周期池：新增回归先观察普通cancel成功，再观察watch中断run仍可resume，分别修复为INVALID_STATE。watch通过暂停/删除/监测恢复管理；用户明确add_budget仍可新开普通前台研究窗口，必须新窗口并受全局/组余额约束，不能复用watch窗口。
2. A→B→A→B重复前后事实被永久抑制：扩展原用例观察第3次提交INVALID_STATE，再把基线版本ID与前后事实签名、规范化focus一起组成changeKey，转绿。相同基线同次提交仍受围栏/唯一键保护。
3. P签名投影相同会否决I significant：增加新证据/引用合法、投影事实相同的回归，观察被拒，再移除签名相等的语义否决。P继续检查scope/归属/schema/引用和checkpoint，但显著性仍由I判断。
4. 旧watch续期未复核数量/同案占用：分别观察可变成4项active与SQLite唯一约束500，改为同事务在授新pool之前复核，返回429/409并保留原状态。到期旧watch不能通过pause/resume重新占用已被替代的slot。
以上回归及完整最终npm test：19文件185项全部通过；npm run typecheck/build、git diff --check通过；Edge基础3项通过，未改UI源码。

审查未判定项由P保留：
- I真实语义/引用支持：仍须真实来源人工验收，签名不作语义裁决；忽略该门会误报变化。
- 真实供应商/用量/费用：当前受控transport和虚拟账本，本轮0真实调用；接实际价格和资金后另做有限探针。
- 部署与恢复：已验证本地SQLite持久claim、重启围栏与后台timer，不把它当Linux/多实例/云常驻演练。
- 完整SSRF：本轮只筛初始字面地址/主机名；真实读取适配器的DNS和重定向核验仍是接线门禁。
- AC11/15：真实页面修改、浏览器关闭、开放元宝、旧新报告/伴读全旅程尚未执行，不能标产品验收通过。

本次P与M输入分支均保留；发布标签p-watch-runtime-v1用于指向最终接入提交，G0和之前平台标签不移动。W按watch-http schema消费票据状态和通知；无需M再改提示词或打包。

## 主分支发布
平台代码检查点0a9a6f26541b332b995c29cc451468b925e667ce，标签p-watch-runtime-v1；已fast-forward到D:\侦探agent的feat/foundation。
合入后在主目录再次实际运行185项测试、typecheck、build，全部通过。M原工作树仍干净，UI/Hermes协作文件和.gitignore在途改动保持原样。
可转发增量包：D:\侦探agent\.local\dispatch\detective-agent-watch-runtime-v1.bundle；
SHA256：274C0DE0EEE093982695C6CD4D7E5DC2AD065201224D1E965A6CFAD5A6EDDEC7。
依赖G0完整SHA，头refs/heads/codex/platform-lifecycle为上述代码检查点；bundle verify通过，并在已有G0接收副本实际fetch/核对FETCH_HEAD成功。
W可阅读src/shared/watch-http.ts及本记录接口表，按202票据→checks分页→notifications更新对接。无需重派M；I/E的原G0开发基准不移动，真实联调另行接线。
