import { randomUUID } from 'node:crypto';
import {newInvestigationAvailability} from './research-availability.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  BrowserSessionSchema, BudgetAmountsSchema, InvestigationSchema, type BudgetAmounts, type InvocationContext, type Run, type StopReason,
} from '../../shared/contracts.js';
import {
  InvestigationInputSchema, InvestigationOutcomeSchema, PreparationOutcomeSchema, WatchDecisionSchema, type InvestigationModule, type InvestigationServices, type ExtractionBatch,
} from '../../shared/ports.js';
import { StartRunSchema, ClarificationAnswerSchema } from '../../shared/runtime-http.js';
import { FollowupDecisionSchema } from '../../shared/ports.js';
import { BudgetBook } from './budget.js';
import { RunStore } from './runs.js';
import { PaidGateway } from './gateway.js';
import { bindResearchServices, type RawResearchProviders, type ResearchPricing } from './services.js';
import { hashValue } from './snapshots.js';
import { ApiFault, BudgetLimitFault } from './errors.js';
import type { TaskHost } from './runtime-ports.js';
import { WatchStore } from './watch-store.js';
import { WatchHost } from './watch-host.js';
import { readWatchTargets } from './watch-material.js';
import type { WatchLease } from '../watch/ports.js';
import { ensureRuntimeFunding } from './runtime-funding.js';
import type { PrivateAssets } from './private-assets.js';
import { ScopeModelReceipts } from './scope-model-receipts.js';
import { ProviderModelTraces } from './model-traces.js';
import { ProviderTransportFault } from './provider-transports.js';

export const RESEARCH_LIMITS: BudgetAmounts = Object.freeze({
  activeMs: 420000, searches: 12, reads: 6, modelCalls: 24, inputTokens: 160000, outputTokens: 24000, moneyMicros: 5000000,
});
export interface InvestigationRuntimeOptions {
  module: InvestigationModule; providers: RawResearchProviders; pricing: ResearchPricing;
  funding: { global: BudgetAmounts; trial: BudgetAmounts; demo: BudgetAmounts };
  supportedBasicModes?: import('../../shared/contracts.js').BasicMode[];
  enableWatches?: boolean;
  enableFollowups?: boolean;
  supportsAttachments?: boolean;
}
type HostOptions = InvestigationRuntimeOptions & { serviceEndsAt: string; now(): string; gateway?:PaidGateway; assets?:PrivateAssets;
 extractAttachments?(context:InvocationContext,core:InvestigationServices,signal:AbortSignal,assertCurrent:()=>void):Promise<ExtractionBatch> };
type Row = { payload_json: string };
const missing = () => new ApiFault(404, 'NOT_FOUND', '未找到该资源。');
const invalid = (message: string) => new ApiFault(409, 'INVALID_STATE', message);
const poolIds = (ctx: InvocationContext) => ['runtime:global', 'runtime:' + ctx.accessGroup, ctx.budgetWindowId!];

export class InvestigationHost implements TaskHost {
  readonly runs: RunStore;
  readonly book: BudgetBook;
  readonly watches: WatchHost;
  readonly watchStore: WatchStore;
  private readonly gateway: PaidGateway;
  private readonly active = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private recovered = false;
  private closed = false;
  private scheduled: NodeJS.Immediate | null = null;
  constructor(private readonly db: Database.Database, private readonly options: HostOptions) {
    this.runs = new RunStore(db); this.book = new BudgetBook(db);
    ensureRuntimeFunding(db,options.funding);
    this.watchStore=new WatchStore(db,{serviceEndsAt:options.serviceEndsAt});
    this.gateway = options.gateway??new PaidGateway({ book: this.book, poolIds:ctx=>this.budgetPools(ctx), assertCurrent: ctx => this.assertUsable(ctx),
      concurrency: { search: 2, read: 2, model: 2, tts: 1 } });
    this.watches=new WatchHost(this.watchStore,(lease,signal)=>this.executeWatch(lease,signal),async(input,signal)=>{
      const lease=this.watchStore.authorizedLease(input.context,this.options.now());
      if(input.before.payloadHash!==lease.before.payloadHash||input.before.id!==lease.before.id||input.focus!==lease.watch.focus)throw invalid('监测比较基线不一致。');
      return WatchDecisionSchema.parse(await this.options.module.compareWatchResult(input,this.servicesFor(input.context,signal),signal));
    },options.now);
  }
  private budgetPools(ctx:InvocationContext) {return ctx.watchCheckId?this.watchStore.poolIds(ctx):poolIds(ctx);}
  assertContext(ctx:InvocationContext){this.assertUsable(ctx);}
  private session(id: string, requireLive = true) {
    const row = this.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(id) as Row | undefined;
    if (!row) throw missing();
    const session = BrowserSessionSchema.parse(JSON.parse(row.payload_json));
    const now = Date.parse(this.options.now());
    if (requireLive && (session.revokedAt || now >= Date.parse(session.expiresAt) || now >= Date.parse(this.options.serviceEndsAt))) throw new ApiFault(401, 'UNAUTHENTICATED', '会话已过期或服务已结束。');
    return session;
  }
  private investigation(id: string, owner: string) {
    const row = this.db.prepare('SELECT payload_json FROM investigations WHERE id=? AND session_id=?').get(id, owner) as Row | undefined;
    if (!row) throw missing();
    return InvestigationSchema.parse(JSON.parse(row.payload_json));
  }
  private context(run: Run, requireLive = true): InvocationContext {
    if(run.trigger==='watch')return this.watchStore.contextForRun(run.id);
    const row = this.db.prepare('SELECT session_id FROM investigations WHERE id=?').get(run.investigationId) as { session_id: string };
    const session = this.session(row.session_id, requireLive);
    const remaining = this.book.inspectPool(run.budgetWindowId);
    return { sessionId: session.id, accessGroup: session.accessGroup, investigationId: run.investigationId, runId: run.id,
      budgetWindowId: run.budgetWindowId, interactionPoolId: null, watchCheckId: null, epoch: run.epoch, watchLeaseEpoch: null,
      deadlineAt: this.book.unrestricted?this.options.serviceEndsAt:new Date(Math.min(Date.parse(this.options.serviceEndsAt), Date.parse(this.options.now()) + Math.max(0, remaining.limits.activeMs - remaining.used.activeMs - remaining.reserved.activeMs))).toISOString() };
  }
  private meter(run: Run, ctx: InvocationContext) {
    if(ctx.watchCheckId){this.watchStore.meter(ctx,this.options.now());return;}
    const interval = run.activeIntervals.at(-1);
    const current = run.status === 'running' && interval?.endedAt === null ? Date.parse(this.options.now()) - Date.parse(interval.startedAt) : 0;
    if (current < 0) throw invalid('活动时间不能倒退。');
    const total = run.activeMs + current;
    this.db.transaction(() => {
      const previous = this.db.prepare('SELECT metered_ms FROM run_activity_meter WHERE run_id=?').get(run.id) as { metered_ms: number } | undefined;
      const used = previous?.metered_ms ?? 0;
      if (total < used) throw invalid('活动时间计量不能倒退。');
      this.book.chargeActivity(ctx, this.budgetPools(ctx), total - used);
      this.db.prepare('INSERT INTO run_activity_meter(run_id,metered_ms) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET metered_ms=excluded.metered_ms').run(run.id, total);
    }).immediate();
  }
  private assertUsable(ctx: InvocationContext) {
    this.session(ctx.sessionId); if(ctx.watchCheckId)this.watchStore.assertContext(ctx,this.options.now());else this.runs.assertCurrent(ctx);
    const run = this.runs.get(ctx.runId!, ctx.sessionId)!;
    this.meter(run, ctx);
    if (!this.book.unrestricted&&(Date.parse(this.options.now()) >= Date.parse(ctx.deadlineAt) || this.book.snapshot(ctx, this.budgetPools(ctx)).remaining.activeMs === 0)) throw new BudgetLimitFault('activeMs');
  }
  async recover() {
    if (this.recovered) return;
    if (this.closed) throw invalid('任务宿主已关闭。');
    this.watchStore.recover(this.options.now(),true);
    const rows = this.db.prepare("SELECT r.payload_json FROM runs r WHERE r.status IN ('running','queued')").all() as Row[];
    for (const row of rows) {
      const run = JSON.parse(row.payload_json) as Run;
      // Recovery uses persisted ownership even if the service has since expired.
      const owner = this.db.prepare('SELECT payload_json FROM sessions WHERE id=(SELECT session_id FROM investigations WHERE id=?)').get(run.investigationId) as Row;
      const session = BrowserSessionSchema.parse(JSON.parse(owner.payload_json));
      const ctx: InvocationContext = { sessionId: session.id, accessGroup: session.accessGroup, investigationId: run.investigationId, runId: run.id,
        budgetWindowId: run.budgetWindowId, interactionPoolId: null, watchCheckId: null, epoch: run.epoch, watchLeaseEpoch: null, deadlineAt: this.options.serviceEndsAt };
      this.meter(run, ctx);
    }
    this.runs.interruptOnStartup(this.options.now()); this.book.recoverInFlight(); this.recovered = true;
    if(this.options.enableWatches!==false)this.watches.start();
  }
  async start(sessionId: string, investigationId: string, key: string, raw: z.infer<typeof StartRunSchema>): Promise<Run> {
    if (this.closed || !this.recovered) throw invalid('任务宿主尚未就绪。');
    z.string().min(8).max(128).parse(key); const input = StartRunSchema.parse(raw);
    const session = this.session(sessionId); const investigation=this.investigation(investigationId, sessionId);
    if(this.options.supportedBasicModes&&!this.options.supportedBasicModes.includes(investigation.basicMode))throw new ApiFault(503,'PROVIDER_UNAVAILABLE','该调查模式尚未接入当前运行配置。');
    if(investigation.attachmentIds.length&&(!this.options.supportsAttachments||!this.options.assets||!this.options.extractAttachments))throw new ApiFault(503,'PROVIDER_UNAVAILABLE','截图调查模块与视觉计价尚未接入。');
    const run = this.db.transaction(() => {
      const bodyHash = hashValue({ investigationId, ...input });
      const prior = this.db.prepare("SELECT body_hash,run_id FROM host_submissions WHERE session_id=? AND operation='start' AND key=?").get(sessionId, key) as { body_hash: string; run_id: string } | undefined;
      if (prior) {
        if (prior.body_hash !== bodyHash) throw new ApiFault(409, 'IDEMPOTENCY_CONFLICT', '该提交标识已用于不同请求。');
        return this.runs.get(prior.run_id, sessionId)!;
      }
      if(input.action==='start'){const available=newInvestigationAvailability(this.db,true,this.options.now());if(!available.available)throw new ApiFault(409,'BUDGET_EXHAUSTED',available.message!);}
      this.assertAdmission(sessionId);
      let windowId: string;
      if (input.action === 'resume') {
        const priorRun = input.previousRunId ? this.runs.get(input.previousRunId, sessionId) : null;
        if (!priorRun || priorRun.investigationId !== investigationId) throw missing();
        windowId = priorRun.budgetWindowId;
      } else {
        windowId = randomUUID();
        this.book.createPool({ id: windowId, kind: 'window', accessGroup: session.accessGroup, sessionId, investigationId, limits: RESEARCH_LIMITS });
      }
      const { followupTurnId, ...runRequest } = input;
      const created = this.runs.enqueue({ ...runRequest, sessionId, investigationId, budgetWindowId: windowId, key, at: this.options.now() });
      if (followupTurnId) {
        if (this.options.enableFollowups !== true) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '追问策略尚未开放。');
        const job = this.db.prepare('SELECT * FROM followup_jobs WHERE id=? AND session_id=? AND investigation_id=?').get(followupTurnId, sessionId, investigationId) as { status: string; decision_json: string | null; result_version_id: string; question: string; new_run_id: string | null } | undefined;
        if (!job) throw missing();
        const decision=job.decision_json?FollowupDecisionSchema.parse(JSON.parse(job.decision_json)):null;
        if (job.status !== 'completed' || decision?.route !== 'needs_budget_confirmation' || job.new_run_id) throw invalid('该追问不能重复追加调查。');
        if(!decision.researchPurpose)throw invalid('尚未确认该追问属于当前调查范围，不能直接追加研究额度。');
        if (job.result_version_id !== investigation.latestResultVersionId) throw new ApiFault(409, 'STALE_VERSION', '请从最新报告继续补查。');
        this.db.prepare('DELETE FROM followup_run_inputs WHERE run_id=?').run(created.id);
        this.db.prepare('INSERT INTO followup_run_inputs VALUES (?,?,?,?)').run(created.id, followupTurnId, job.result_version_id, job.question);
        this.db.prepare('UPDATE followup_jobs SET new_run_id=? WHERE id=?').run(created.id, followupTurnId);
        created.trigger = 'followup'; this.db.prepare('UPDATE runs SET payload_json=? WHERE id=?').run(JSON.stringify(created), created.id);
      }
      const ctx = this.context(created); const budget = this.book.snapshot(ctx, poolIds(ctx));
      if (!budget.canModel && !budget.canSearch && !budget.canRead) throw new ApiFault(409, 'BUDGET_EXHAUSTED', '没有足够剩余额度，需要明确追加或稍后再试。');
      this.db.prepare("INSERT INTO host_submissions(session_id,operation,key,body_hash,run_id) VALUES (?,'start',?,?,?)").run(sessionId, key, bodyHash, created.id);
      this.db.prepare("INSERT INTO task_admissions(session_id,run_id,kind,operation_key,admitted_at) VALUES (?,?,'start',?,?)").run(sessionId, created.id, key, this.options.now());
      return created;
    }).immediate();
    this.kick(); return run;
  }
  private assertAdmission(sessionId: string) {
    const queued = this.db.prepare("SELECT count(*) AS n FROM runs WHERE status='queued'").get() as { n: number };
    const ownQueued = this.db.prepare("SELECT count(*) AS n FROM runs r JOIN investigations i ON i.id=r.investigation_id WHERE r.status='queued' AND i.session_id=?").get(sessionId) as { n: number };
    if (queued.n >= 20) throw new ApiFault(429, 'QUEUE_FULL', '任务队列已满，请稍后重试。', true);
    if (ownQueued.n >= 2) throw new ApiFault(429, 'RATE_LIMITED', '本会话已有两个排队任务。', true);
    const cutoff = new Date(Date.parse(this.options.now()) - 60000).toISOString();
    const recent = this.db.prepare('SELECT count(*) AS n FROM task_admissions WHERE session_id=? AND admitted_at>?').get(sessionId, cutoff) as { n: number };
    if (recent.n >= 5) throw new ApiFault(429, 'RATE_LIMITED', '开始或继续过于频繁，请稍后重试。', true);
  }
  admitFollowup(sessionId: string) { this.session(sessionId); this.assertAdmission(sessionId); }
  wake() { this.kick(); }
  async cancel(sessionId: string, runId: string): Promise<Run> {
    const run = this.runs.get(runId, sessionId); if (!run) throw missing();
    if (run.status === 'running') this.meter(run, this.context(run));
    const result = this.runs.cancel(runId, sessionId, this.options.now());
    this.active.get(runId)?.controller.abort(); this.kick(); return result;
  }
  answer(sessionId: string, runId: string, questionId: string, raw: z.infer<typeof ClarificationAnswerSchema>) {
    this.session(sessionId);
    const run = this.db.transaction(() => {
      const current = this.runs.get(runId, sessionId); if (!current) throw missing();
      const question = this.runs.getClarification(runId, sessionId);
      const admits = current.status === 'waiting_for_user' && question?.id === questionId && question.answeredAt === null;
      if (admits) this.assertAdmission(sessionId);
      const answered = this.runs.answerClarification(runId, questionId, sessionId, ClarificationAnswerSchema.parse(raw), this.options.now());
      if (admits) this.db.prepare("INSERT INTO task_admissions(session_id,run_id,kind,operation_key,admitted_at) VALUES (?,?,'answer',?,?)").run(sessionId, runId, questionId, this.options.now());
      return answered;
    }).immediate();
    this.kick(); return run;
  }
  view(sessionId: string, runId: string) {
    const run = this.runs.get(runId, sessionId); if (!run) throw missing();
    const ctx = this.context(run); this.meter(run, ctx);
    const material = this.runs.getCheckpoint(run.id, sessionId);
    return { run, remainingBudget: this.book.snapshot(ctx, this.budgetPools(ctx)), clarification: this.runs.getClarification(run.id, sessionId),
      partialMaterialSummary: material ? '已保存' + material.sources.length + '个来源、' + material.evidence.length + '条证据。' : null };
  }
  private kick() {
    if (this.closed || this.scheduled) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = null;
      if (this.closed) return;
      while (this.active.size < 2) {
        const run = this.runs.claimNext(this.options.now()); if (!run) break;
        const controller = new AbortController();
        const task = Promise.resolve().then(() => this.execute(run, controller)).finally(() => { this.active.delete(run.id); this.kick(); });
        this.active.set(run.id, { controller, task });
        // execute handles operational failures; never leave a rejected detached task.
        void task.catch(() => {});
      }
    });
  }
  private stopWithMaterial(run: Run, ctx: InvocationContext, reason: StopReason) {
    const current = this.runs.get(run.id, ctx.sessionId);
    if (!current || current.status !== 'running' || current.epoch !== run.epoch) return;
    this.meter(current, ctx);
    const investigation = this.investigation(run.investigationId, ctx.sessionId);
    const material = this.runs.getCheckpoint(run.id, ctx.sessionId);
    const attachments=this.options.assets?.snapshots(investigation.id,ctx.sessionId)??[];
    if (investigation.scope && ((material&&(material.sources.length || material.evidence.length))||attachments.length)) {
      const sources = material?.sources??[];
      const evidence = (material?.evidence??[]).filter(item => item.origin.kind === 'source' ? sources.some(source => source.id === item.origin.id):attachments.some(a=>a.id===item.origin.id&&a.extraction));
      const claims = (material?.claims??[]).map(claim => ({ ...claim, status: 'insufficient' as const, links: claim.links.filter(link => evidence.some(e => e.id === link.evidenceId)),
        gaps: [...claim.gaps, '本轮未完成事实裁决。'].slice(0, 80) }));
      this.runs.commitResult(run.id, run.epoch, { schemaVersion: '0.1.0', investigationId: run.investigationId, runId: run.id,
        scope: investigation.scope, queryTime: this.options.now(), summary: '本轮未完成核验，已保存取得的来源与证据，请结合未知和限制阅读。',
        conditions: [...new Set(claims.flatMap(claim => claim.conditions))].slice(0, 80), unknowns: ['停止原因：' + reason, ...new Set(claims.flatMap(claim => claim.gaps))].slice(0, 80), nextSteps: ['可查看已保存材料；继续前请核对剩余额度。'],
        stopReason: reason, sources, evidence, claims, candidates: [], conflicts: [], answerBlocks: [], attachments,
        delta: investigation.latestResultVersionId ? { previousVersionId: investigation.latestResultVersionId, changes: [], checkedAt: this.options.now() } : null,
      }, 'partial', this.options.now());
    } else this.runs.finishFailed(run.id, run.epoch, reason, this.options.now());
  }

  private servicesFor(context:InvocationContext,signal:AbortSignal):InvestigationServices {
    const check=()=>{signal.throwIfAborted();this.assertUsable(context);};
    return bindResearchServices(this.options.providers,this.options.pricing,this.gateway,context,{
      budget:{snapshot:async input=>{if(hashValue(input)!==hashValue(context))throw invalid('任务上下文不一致。');check();return this.book.snapshot(context,this.budgetPools(context));}},
      checkpoint:{save:async(id,epoch,patch)=>{check();if(id!==context.runId||epoch!==context.epoch)throw invalid('材料归属错误。');this.runs.saveCheckpoint(id,epoch,patch,this.options.now());}},
      events:{append:async(id,epoch,event)=>{check();if(id!==context.runId||epoch!==context.epoch)throw invalid('事件归属错误。');this.runs.appendEvent(id,epoch,event,this.options.now());}},
      clock:{now:this.options.now},
    },new ProviderModelTraces(this.db).observer());
  }
  private async executeWatch(lease:WatchLease,signal:AbortSignal) {
    this.watchStore.assertContext(lease.context,this.options.now());
    const services=this.servicesFor(lease.context,signal),readFailures:Array<{sourceId:string;errorCode:string}>=[];
    const read=services.read;
    services.read=async(input,ctx,abort)=>{
      try {const response=await read(input,ctx,abort);if(response.failureCode||response.readStatus==='inaccessible')readFailures.push({sourceId:input.sourceId,errorCode:'READ_FAILED'});return response;}
      catch(error){readFailures.push({sourceId:input.sourceId,errorCode:'READ_FAILED'});throw error;}
    };
    let checkpoint=null;
    if(lease.watch.targetKind==='page') {
      const targets=await readWatchTargets(lease,services,signal);checkpoint=targets.material;readFailures.push(...targets.readFailures);
      await services.checkpoint.save(lease.context.runId!,lease.context.epoch,checkpoint);
    }
    const run=this.runs.get(lease.context.runId!,lease.context.sessionId)!;
    const attachmentSnapshots=this.options.assets?.snapshots(run.investigationId,lease.context.sessionId)??[];
    const input=InvestigationInputSchema.parse({context:lease.context,run,scope:{...lease.before.payload.scope,referenceTime:this.options.now()},basicMode:lease.before.payload.scope.basicMode,
      attachments:attachmentSnapshots.flatMap(a=>a.extraction?[a.extraction]:[]),checkpoint,baseline:lease.before,intent:'watch',followupQuestion:('只检查已确认范围中的关注条件：'+lease.watch.focus).slice(0,2000)});
    const outcome=InvestigationOutcomeSchema.parse(await this.options.module.runInvestigation(input,services,signal));
    this.watchStore.assertContext(lease.context,this.options.now());
    if(outcome.draft){if(outcome.draft.attachments.length&&hashValue(outcome.draft.attachments)!==hashValue(attachmentSnapshots))throw invalid('监测附件快照不一致。');outcome.draft={...outcome.draft,attachments:attachmentSnapshots};}
    return {candidate:outcome.draft,readFailures};
  }
  private async execute(run: Run, controller: AbortController) {
    let ctx: InvocationContext | null = null;
    let timer: NodeJS.Timeout | null = null;
    let preparing = true;
    try {
      ctx = this.context(run); const context = ctx;
      this.assertUsable(context);
      if(!this.book.unrestricted){timer = setTimeout(() => {
        try { this.stopWithMaterial(run, context, 'time_limit'); }
        catch { const current = this.runs.get(run.id, context.sessionId); if (current?.status === 'running' && current.epoch === run.epoch) this.runs.finishFailed(run.id, run.epoch, 'invalid_output', this.options.now()); }
        finally { controller.abort(); }
      }, Math.max(1, Date.parse(ctx.deadlineAt) - Date.parse(this.options.now())));
      timer.unref();}
      const check = () => { if (controller.signal.aborted) throw invalid('任务已停止。'); this.assertUsable(context); };
      const core = {
        budget: { snapshot: async (input: InvocationContext) => { if (hashValue(input) !== hashValue(context)) throw invalid('上下文不一致。'); check(); return this.book.snapshot(context, poolIds(context)); } },
        checkpoint: { save: async (id: string, epoch: number, patch: Parameters<RunStore['saveCheckpoint']>[2]) => {
          check(); if (id !== run.id || epoch !== run.epoch) throw invalid('工作材料归属错误。'); this.runs.saveCheckpoint(id, epoch, patch, this.options.now());
        } },
        events: { append: async (id: string, epoch: number, event: Parameters<RunStore['appendEvent']>[2]) => {
          check(); if (id !== run.id || epoch !== run.epoch) throw invalid('事件归属错误。'); this.runs.appendEvent(id, epoch, event, this.options.now());
        } },
        clock: { now: this.options.now },
      };
      const modelTraces=new ProviderModelTraces(this.db);
      const services = bindResearchServices(this.options.providers, this.options.pricing, this.gateway, context, core,modelTraces.observer());
      const investigation = this.investigation(run.investigationId, ctx.sessionId);
      const followup = this.db.prepare('SELECT followup_id,result_version_id,question FROM followup_run_inputs WHERE run_id=?').get(run.id) as { followup_id:string;result_version_id: string; question: string } | undefined;
      if (run.trigger === 'followup' && !followup) throw invalid('补查问题未持久化。');
      if (followup && followup.result_version_id !== investigation.latestResultVersionId) throw new ApiFault(409, 'STALE_VERSION', '补查基线已有变化。');
      const previousQuestion=this.runs.getClarification(run.id,ctx.sessionId);
      if(previousQuestion?.answeredAt&&previousQuestion.missingFields.includes('attachments'))this.options.assets?.confirm(investigation.id,ctx.sessionId);
      const extraction=investigation.attachmentIds.length?await this.options.extractAttachments!(context,services,controller.signal,check):{items:[],failed:[],blockingQuestions:[]};
      check();
      if(extraction.blockingQuestions.length){this.meter(run,context);this.runs.requestClarification(run.id,run.epoch,{id:randomUUID(),runId:run.id,prompt:extraction.blockingQuestions.join('\n').slice(0,4000),missingFields:['attachments'],options:[],canProceedWithUnknown:true,answer:null,answeredAt:null},this.options.now());return;}
      const preparationFollowup=this.runs.preparationFollowup(run.id,ctx.sessionId);
      const clarificationAnswer=this.runs.clarificationAnswer(run.id,ctx.sessionId);
      // Rebudgeting/rebasing is not a new user input and cannot reopen an unknown scope stage.
      const preparationKey=hashValue({investigationId:investigation.id,question:investigation.originalQuestion,basicMode:investigation.basicMode,attachments:extraction.items,followup:preparationFollowup?{turnId:preparationFollowup.turnId,question:preparationFollowup.question}:null,clarificationAnswer});
      const scopeReceipts=new ScopeModelReceipts(this.db);
      const preparationServices:InvestigationServices={...services,model:(request,input,child)=>{
        if(request.purpose!=='scope')return services.model(request,input,child);
        const signal=AbortSignal.any([controller.signal,child]);
        return scopeReceipts.invoke(preparationKey,request,input,signal,()=>{if(hashValue(input)!==hashValue(context))throw invalid('上下文不一致。');check();},observer=>bindResearchServices(this.options.providers,this.options.pricing,this.gateway,context,core,modelTraces.observer(observer)).model(request,input,signal));
      }};
      const preparation = PreparationOutcomeSchema.parse(await this.options.module.prepareInvestigation({
        context, originalQuestion: investigation.originalQuestion, basicMode: investigation.basicMode, attachments: extraction.items,
        previousScope: investigation.scope, clarificationAnswer,
        ...(preparationFollowup?{followup:preparationFollowup}:{}),
      }, preparationServices, controller.signal));
      check();
      preparing = false;
      if (!preparation.canInvestigate) {
        const budget=await core.budget.snapshot(context),remaining=budget.remaining;
        if(!budget.canModel)throw new BudgetLimitFault(remaining.modelCalls<=0?'modelCalls':remaining.inputTokens<=0||remaining.outputTokens<=0?'inputTokens':remaining.moneyMicros<=0?'moneyMicros':null);
        this.meter(run, context); this.runs.requestClarification(run.id, run.epoch, preparation.clarification!, this.options.now()); return;
      }
      const queryAt=this.options.now(),refreshLatest=investigation.basicMode==='latest';
      const scope=refreshLatest?{...preparation.scope!,referenceTime:queryAt}:preparation.scope!;
      const preparedRun = this.runs.setScope(run.id, run.epoch, preparation.scope!, queryAt,refreshLatest);
      const baseline = investigation.latestResultVersionId ? this.runs.getResult(investigation.latestResultVersionId, ctx.sessionId) : null;
      const input = InvestigationInputSchema.parse({ context, run: preparedRun, scope, basicMode: investigation.basicMode, attachments: extraction.items,
        checkpoint: this.runs.getCheckpoint(run.id, ctx.sessionId), baseline, intent: baseline ? 'followup' : 'initial', followupQuestion: followup?.question ?? null });
      const outcome = InvestigationOutcomeSchema.parse(await this.options.module.runInvestigation(input, services, controller.signal));
      if(outcome.draft){const verified=this.options.assets?.snapshots(investigation.id,ctx.sessionId)??[];
        if(outcome.draft.attachments.length&&hashValue(outcome.draft.attachments)!==hashValue(verified))throw invalid('附件快照与已保存捕获不一致。');outcome.draft={...outcome.draft,attachments:verified};
        if(extraction.failed.length){outcome.draft.unknowns=[...outcome.draft.unknowns,'部分截图未完成提取，不能据此作完整判断。'].slice(0,80);if(outcome.completion==='completed')outcome.completion='partial';}
      }
      check(); this.meter(preparedRun, context);
      if (outcome.completion === 'waiting_for_user') this.runs.requestClarification(run.id, run.epoch, outcome.clarification!, this.options.now());
      else if (outcome.draft) this.runs.commitResult(run.id, run.epoch, outcome.draft, outcome.completion === 'completed' ? 'completed' : 'partial', this.options.now());
      else this.stopWithMaterial(preparedRun, context, outcome.stopReason);
    } catch (error) {
      if (ctx) {
        // Preparation precedes the investigation adapter's provider event handling.
        // Only publish the safe category for a still-current task, never raw provider text.
        const current = this.runs.get(run.id, ctx.sessionId);
        if(preparing && error instanceof ProviderTransportFault && !controller.signal.aborted && current?.status==='running' && current.epoch===run.epoch){
          const category={auth:'鉴权失败',balance:'余额不足',rate_limit:'服务限流',network:'网络调用未完成',invalid_response:'返回格式无法使用',invalid_request:'请求目标无法使用'}[error.kind];
          this.runs.appendEvent(run.id,run.epoch,{type:'provider.failed',message:category+'，已停止本轮；未自动重发。',queryId:null,sourceIds:[],visibility:'public'},this.options.now());
        }
        if (error instanceof ApiFault && error.code === 'STALE_VERSION') {
          const current = this.runs.get(run.id, ctx.sessionId);
          if (current?.status === 'running' && current.epoch === run.epoch) this.runs.finishFailed(run.id, run.epoch, 'invalid_output', this.options.now());
          return;
        }
        try { this.stopWithMaterial(run, ctx, error instanceof BudgetLimitFault ? error.stopReason : error instanceof ApiFault && error.code === 'BUDGET_EXHAUSTED' ? 'cost_limit' : error instanceof z.ZodError ? 'invalid_output' : 'provider_error'); }
        catch { const current = this.runs.get(run.id, ctx.sessionId); if (current?.status === 'running' && current.epoch === run.epoch) this.runs.finishFailed(run.id, run.epoch, 'invalid_output', this.options.now()); }
      } else {
        // No provider was sent if startup failed before constructing the context.
        const row = this.db.prepare('SELECT session_id FROM investigations WHERE id=?').get(run.investigationId) as { session_id: string };
        const current = this.runs.get(run.id, row.session_id);
        if (current?.status === 'running') this.runs.finishFailed(run.id, run.epoch, 'provider_error', this.options.now());
      }
    } finally { if (timer) clearTimeout(timer); }
  }
  async close() {
    if (this.closed) return;
    this.closed = true; if (this.scheduled) clearImmediate(this.scheduled);
    await this.watches.stop();this.watchStore.recover(this.options.now(),true);
    for (const id of this.active.keys()) {
      const row = this.db.prepare('SELECT session_id FROM investigations WHERE id=(SELECT investigation_id FROM runs WHERE id=?)').get(id) as { session_id: string };
      const run = this.runs.get(id, row.session_id)!;
      if (run.status === 'running') this.meter(run, this.context(run, false));
    }
    this.runs.interruptOnStartup(this.options.now());
    for (const entry of this.active.values()) entry.controller.abort();
    await Promise.allSettled([...this.active.values()].map(entry => entry.task));
    await this.gateway.drain();
  }
}
