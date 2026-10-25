import { randomUUID, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { pendingScopeInputs,followupPreparation,validateClueRefinement,recordScopeInputs } from './scope-refinements.js';
import { z } from 'zod';
import { BrowserSessionSchema, ClarificationSchema, CountSchema, IdSchema, InvestigationSchema, InvocationContextSchema, ScopeSchema,
  ProgressEventSchema, RunSchema, TimestampSchema, type InvocationContext, type ProgressEvent, type Run } from '../../shared/contracts.js';
import { WorkingMaterialSchema, type WorkingMaterial } from '../../shared/ports.js';
import { insertSnapshot, readSnapshot, copySnapshot, stableJson } from './snapshots.js';
import type { Scope, ResultPayload, Clarification, StopReason } from '../../shared/contracts.js';
import { advanceWatchBaselines,pauseWatchesForScopeRefinement } from './watch-state.js';
import { ApiFault } from './errors.js';

const invalid = (message: string) => new ApiFault(409, 'INVALID_STATE', message);
const missing = () => new ApiFault(404, 'NOT_FOUND', '任务不存在。');
const active = new Set(['queued', 'running', 'waiting_for_user']);
const emptyMaterial = (): WorkingMaterial => ({ sources: [], evidence: [], claims: [], candidates: [], queries: [] });
const EnqueueSchema = z.strictObject({ sessionId: IdSchema, investigationId: IdSchema,
  key: z.string().min(8).max(128), action: z.enum(['start', 'resume', 'add_budget']), previousRunId: IdSchema.nullable(), budgetWindowId: IdSchema, at: TimestampSchema });
type Enqueue = z.infer<typeof EnqueueSchema>;
type EventInput = Omit<ProgressEvent, 'id' | 'seq' | 'at' | 'investigationId' | 'runId'>;
type JsonRow = { payload_json: string };

/** Storage only: no dispatch, automatic grants or constructor recovery side effects. */
export class RunStore {
  constructor(private readonly db: Database.Database) {}
  private investigation(id: string, owner: string) {
    IdSchema.parse(id); IdSchema.parse(owner);
    const row = this.db.prepare('SELECT payload_json FROM investigations WHERE id=? AND session_id=?').get(id, owner) as JsonRow | undefined;
    if (!row) throw missing();
    return InvestigationSchema.parse(JSON.parse(row.payload_json));
  }
  private read(id: string): Run {
    IdSchema.parse(id);
    const row = this.db.prepare('SELECT payload_json FROM runs WHERE id=?').get(id) as JsonRow | undefined;
    if (!row) throw missing();
    return RunSchema.parse(JSON.parse(row.payload_json));
  }
  get(id: string, owner: string): Run | null {
    IdSchema.parse(id); IdSchema.parse(owner);
    const row = this.db.prepare('SELECT r.payload_json FROM runs r JOIN investigations i ON i.id=r.investigation_id WHERE r.id=? AND i.session_id=?').get(id, owner) as JsonRow | undefined;
    return row ? RunSchema.parse(JSON.parse(row.payload_json)) : null;
  }
  private persist(run: Run, at: string) {
    RunSchema.parse(run); TimestampSchema.parse(at);
    this.db.prepare('UPDATE runs SET status=?,epoch=?,payload_json=? WHERE id=?').run(run.status, run.epoch, JSON.stringify(run), run.id);
    const row = this.db.prepare('SELECT session_id FROM investigations WHERE id=?').get(run.investigationId) as { session_id: string };
    const investigation = this.investigation(run.investigationId, row.session_id);
    investigation.status = run.status === 'queued' ? 'running' : run.status;
    if(run.trigger==='watch' && !active.has(run.status) && !run.createdResultVersionId && investigation.latestResultVersionId) {
      const prior=this.db.prepare('SELECT r.status FROM result_versions v JOIN runs r ON r.id=v.run_id WHERE v.id=?').get(investigation.latestResultVersionId) as {status:string}|undefined;
      investigation.status=prior?.status==='partial'?'partial':'completed';
    }
    investigation.activeRunId = active.has(run.status) ? run.id : null; investigation.updatedAt = at;
    this.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify(InvestigationSchema.parse(investigation)), investigation.id);
  }
  private event(run: Run, input: EventInput, at: string) {
    const row = this.db.prepare('SELECT coalesce(max(seq),0)+1 AS seq FROM progress_events WHERE investigation_id=?').get(run.investigationId) as { seq: number };
    const event = ProgressEventSchema.parse({ ...input, id: randomUUID(), investigationId: run.investigationId, runId: run.id, seq: row.seq, at });
    this.db.prepare('INSERT INTO progress_events(investigation_id,run_id,seq,visibility,payload_json) VALUES (?,?,?,?,?)').run(event.investigationId, run.id, event.seq, event.visibility, JSON.stringify(event));
  }
  private lifecycle(run: Run, type: ProgressEvent['type'], message: string, at: string) {
    this.event(run, { type, message, queryId: null, sourceIds: [], visibility: 'public' }, at);
  }
  private current(id: string, epoch: number): Run {
    CountSchema.parse(epoch); const run = this.read(id);
    if (run.epoch !== epoch || run.status !== 'running' || run.cancelRequestedAt !== null) throw invalid('任务已停止或工作者版本过期。');
    return run;
  }
  setScope(id: string, epoch: number, raw: Scope, at: string, refreshLatestReferenceTime=false): Run {
    let scope = ScopeSchema.parse(raw);
    return this.db.transaction(() => {
      const run = this.current(id, epoch);
      const owner = this.db.prepare('SELECT session_id FROM investigations WHERE id=?').get(run.investigationId) as { session_id: string };
      const investigation = this.investigation(run.investigationId, owner.session_id);
      const before=investigation.scope,beforeVersion=investigation.scopeVersion,sources=pendingScopeInputs(this.db,run,investigation);
      if(scope.basicMode!==investigation.basicMode)throw invalid('不能静默改变已确认的调查模式。');
      if(before&&stableJson(scope)!==stableJson(before))validateClueRefinement(before,scope,sources);
      if(!before||stableJson(scope)!==stableJson(before)){investigation.scope=scope;investigation.scopeVersion++;}
      // Only the platform may advance a latest query's clock, after exact scope validation.
      // This is not a new object/goal/timeScope, and stored ResultVersions remain immutable.
      if(refreshLatestReferenceTime){
        if(investigation.basicMode!=='latest')throw invalid('只有查最新可以刷新本轮查询时刻。');
        scope=ScopeSchema.parse({...scope,referenceTime:at});investigation.scope=scope;
      }
      recordScopeInputs(this.db,sources,run,before,scope,beforeVersion,investigation.scopeVersion,at);
      if(before&&beforeVersion!==investigation.scopeVersion)pauseWatchesForScopeRefinement(this.db,investigation.id,investigation.scopeVersion,at);
      run.scopeVersion = investigation.scopeVersion;
      this.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify(investigation), investigation.id);
      this.persist(run, at); return run;
    }).immediate();
  }
  commitResult(id: string, epoch: number, payload: ResultPayload, status: 'completed' | 'partial', at: string) {
    TimestampSchema.parse(at); z.enum(['completed', 'partial']).parse(status);
    return this.db.transaction(() => {
      const run = this.current(id, epoch);
      const owner = this.db.prepare('SELECT session_id FROM investigations WHERE id=?').get(run.investigationId) as { session_id: string };
      const investigation = this.investigation(run.investigationId, owner.session_id);
      const version = insertSnapshot(this.db, run, investigation, payload, this.getCheckpoint(id, owner.session_id), at);
      this.closeInterval(run, at); run.status = status; run.stage = null; run.stopReason = version.payload.stopReason;
      run.createdResultVersionId = version.id; run.endedAt = at; run.epoch++;
      this.persist(run, at);
      const updated = this.investigation(investigation.id, owner.session_id);
      updated.latestResultVersionId = version.id;
      this.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify(updated), updated.id);
      if (version.previousVersionId) this.db.prepare('INSERT INTO version_links(from_version_id,to_version_id,reason,created_at) VALUES (?,?,?,?)').run(version.previousVersionId,version.id,run.trigger==='watch'?'后台检查确认事实变化。':'用户继续调查生成新版本。',at);
      if (run.trigger !== 'watch') advanceWatchBaselines(this.db, version, run.scopeVersion, at);
      this.lifecycle(run, 'run.finalized', status === 'partial' ? '已保存部分结果与未解决问题。' : '调查结果已保存。', at);
      return version;
    }).immediate();
  }
  getResult(id: string, owner: string) { IdSchema.parse(id); IdSchema.parse(owner); return readSnapshot(this.db, id, owner); }
  startWatch(owner: string, investigationId: string, windowId: string, at: string): Run {
    return this.db.transaction(() => {
      const investigation=this.investigation(investigationId,owner);
      if(!investigation.scope || !investigation.latestResultVersionId || investigation.activeRunId) throw invalid('调查已有活动任务或缺少基线。');
      const run=RunSchema.parse({id:randomUUID(),investigationId,trigger:'watch',previousRunId:null,budgetWindowId:windowId,scopeVersion:investigation.scopeVersion,
        status:'running',stage:'planning',epoch:1,queuedAt:at,startedAt:at,endedAt:null,activeIntervals:[{startedAt:at,endedAt:null}],activeMs:0,stopReason:null,cancelRequestedAt:null,checkpointRef:null,createdResultVersionId:null});
      this.db.prepare('INSERT INTO runs(id,investigation_id,status,epoch,payload_json) VALUES (?,?,?,?,?)').run(run.id,investigationId,run.status,run.epoch,JSON.stringify(run));
      this.persist(run,at);this.lifecycle(run,'run.started','后台检查已开始。',at);return run;
    }).immediate();
  }
  finishWatch(id:string,epoch:number,status:'completed'|'failed'|'interrupted',reason:StopReason,at:string):Run {
    return this.db.transaction(()=>{
      const run=this.current(id,epoch); if(run.trigger!=='watch') throw invalid('不是后台检查任务。');
      this.closeInterval(run,at);run.status=status;run.stopReason=reason;run.stage=null;run.endedAt=at;run.epoch++;
      this.persist(run,at);this.lifecycle(run,'run.stopped','后台本轮检查已结束，检查记录保留具体状态。',at);return run;
    }).immediate();
  }
  copyResult(id: string, owner: string) { const version = this.getResult(id, owner); return version ? copySnapshot(version) : null; }
  finishFailed(id: string, epoch: number, reason: StopReason, at: string): Run {
    return this.db.transaction(() => {
      const run = this.current(id, epoch); this.closeInterval(run, at);
      run.status = 'failed'; run.stage = null; run.stopReason = reason; run.endedAt = at; run.epoch++;
      this.persist(run, at); this.lifecycle(run, 'run.stopped', '本轮未能完成，已保留取得的工作材料。', at); return run;
    }).immediate();
  }
  requestClarification(id: string, epoch: number, raw: Clarification, at: string): Run {
    const question = ClarificationSchema.parse(raw);
    return this.db.transaction(() => {
      this.current(id, epoch);
      if (question.runId !== id || question.answer !== null || question.answeredAt !== null) throw invalid('澄清问题归属或状态无效。');
      this.db.prepare('INSERT INTO clarifications(id,run_id,payload_json) VALUES (?,?,?)').run(question.id, id, JSON.stringify(question));
      return this.waitForUser(id, epoch, at);
    }).immediate();
  }
  getClarification(id: string, owner: string): Clarification | null {
    if (!this.get(id, owner)) throw missing();
    const row = this.db.prepare('SELECT payload_json FROM clarifications WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(id) as JsonRow | undefined;
    return row ? ClarificationSchema.parse(JSON.parse(row.payload_json)) : null;
  }
  answerClarification(id: string, questionId: string, owner: string, raw: { answer: string | null; proceedWithUnknown: boolean }, at: string): Run {
    TimestampSchema.parse(at); IdSchema.parse(questionId);
    const input = z.strictObject({ answer: z.string().trim().min(1).max(2000).nullable(), proceedWithUnknown: z.boolean() }).parse(raw);
    return this.db.transaction(() => {
      const run = this.get(id, owner); if (!run) throw missing();
      const q = this.getClarification(id, owner);
      if (!q || q.id !== questionId) throw missing();
      const row = this.db.prepare('SELECT proceeded_unknown FROM clarifications WHERE id=?').get(q.id) as { proceeded_unknown: number | null };
      if (q.answeredAt !== null) {
        if (q.answer !== input.answer || row.proceeded_unknown !== Number(input.proceedWithUnknown)) throw new ApiFault(409, 'IDEMPOTENCY_CONFLICT', '该问题已收到不同回答。');
        return run;
      }
      if (run.status !== 'waiting_for_user' || (!input.answer && !input.proceedWithUnknown) || (input.proceedWithUnknown && !q.canProceedWithUnknown)) throw invalid('当前不能用该回答继续。');
      if (Date.parse(at) < Date.parse(run.activeIntervals.at(-1)?.endedAt ?? run.queuedAt)) throw invalid('任务时钟不能倒退。');
      q.answer = input.answer; q.answeredAt = at;
      this.db.prepare('UPDATE clarifications SET payload_json=?,proceeded_unknown=? WHERE id=?').run(JSON.stringify(q), Number(input.proceedWithUnknown), q.id);
      run.status = 'queued'; run.epoch++; run.stage = null;
      this.persist(run, at); this.lifecycle(run, 'run.queued', '补充线索已保存，等待继续。', at); return run;
    }).immediate();
  }
  clarificationAnswer(id: string, owner: string) {
    const run=this.get(id,owner);if(!run)throw missing();
    const source=pendingScopeInputs(this.db,run,this.investigation(run.investigationId,owner)).find(item=>item.kind==='clarification');
    return source?{clarificationId:source.id,answer:source.question||null,proceedWithUnknown:source.proceedWithUnknown}:null;
  }
  preparationFollowup(id:string,owner:string){const run=this.get(id,owner);if(!run)throw missing();return followupPreparation(pendingScopeInputs(this.db,run,this.investigation(run.investigationId,owner)).find(source=>source.kind==='saved_followup'));}
  private closeInterval(run: Run, at: string) {
    const interval = run.activeIntervals.at(-1);
    if (interval?.endedAt === null) {
      const delta = Date.parse(at) - Date.parse(interval.startedAt);
      if (delta < 0) throw invalid('任务时钟不能倒退。');
      interval.endedAt = at; run.activeMs = CountSchema.parse(run.activeMs + delta);
    }
  }
  enqueue(raw: Enqueue): Run {
    const input = EnqueueSchema.parse(raw);
    return this.db.transaction(() => {
      const investigation = this.investigation(input.investigationId, input.sessionId);
      const hash = createHash('sha256').update(JSON.stringify({ investigationId: input.investigationId, action: input.action, previousRunId: input.previousRunId, budgetWindowId: input.budgetWindowId })).digest('hex');
      const prior = this.db.prepare('SELECT body_hash,run_id FROM run_submissions WHERE session_id=? AND key=?').get(input.sessionId, input.key) as { body_hash: string; run_id: string } | undefined;
      if (prior) {
        if (prior.body_hash !== hash) throw new ApiFault(409, 'IDEMPOTENCY_CONFLICT', '此提交标识已用于不同任务。');
        return this.read(prior.run_id);
      }
      const sessionRow = this.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(input.sessionId) as JsonRow;
      const session = BrowserSessionSchema.parse(JSON.parse(sessionRow.payload_json));
      if (session.revokedAt !== null || Date.parse(session.expiresAt) <= Date.parse(input.at)) throw new ApiFault(401, 'UNAUTHENTICATED', '会话已过期。');
      if (this.db.prepare("SELECT 1 FROM runs WHERE investigation_id=? AND status IN ('queued','running','waiting_for_user')").get(investigation.id)) throw new ApiFault(409, 'ACTIVE_RUN', '此调查已有活动任务。');
      const pool = this.db.prepare('SELECT kind,session_id,investigation_id,access_group,state FROM budget_pools WHERE id=?').get(input.budgetWindowId) as { kind: string; session_id: string; investigation_id: string; access_group: string; state: string } | undefined;
      if (!pool || pool.kind !== 'window' || pool.session_id !== input.sessionId || pool.investigation_id !== input.investigationId || pool.access_group !== session.accessGroup || pool.state !== 'active') throw invalid('缺少属于本调查的有效预算窗口。');
      let previous: Run | null = null;
      if (input.action === 'start') {
        if (input.previousRunId !== null || investigation.status !== 'draft') throw invalid('只能从草稿开始初次任务。');
      } else {
        if (!input.previousRunId) throw invalid('恢复必须指定上次任务。');
        previous = this.get(input.previousRunId, input.sessionId);
        const last = this.db.prepare('SELECT id FROM runs WHERE investigation_id=? ORDER BY ordinal DESC LIMIT 1').get(investigation.id) as { id: string } | undefined;
        if (!previous || previous.investigationId !== investigation.id || last?.id !== previous.id) throw invalid('只能继续本案最近的任务。');
        if(input.action==='resume'&&previous.trigger==='watch')throw invalid('后台检查只能通过监测接口继续，不能恢复成普通调查。');
        if (input.action === 'resume' && (!['cancelled', 'interrupted'].includes(previous.status) || previous.budgetWindowId !== input.budgetWindowId)) throw invalid('恢复必须复用停止任务的原预算窗口。');
        if (input.action === 'add_budget' && (!['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(previous.status) || previous.budgetWindowId === input.budgetWindowId)) throw invalid('追加必须显式使用新的预算窗口。');
        if (!previous.endedAt || Date.parse(input.at) < Date.parse(previous.endedAt)) throw invalid('恢复时间不能早于上次任务停止时间。');
      }
      const run = RunSchema.parse({ id: randomUUID(), investigationId: investigation.id, trigger: input.action === 'start' ? 'initial' : 'resume', previousRunId: previous?.id ?? null,
        budgetWindowId: input.budgetWindowId, scopeVersion: investigation.scopeVersion, status: 'queued', stage: null, epoch: 1, queuedAt: input.at, startedAt: null, endedAt: null,
        activeIntervals: [], activeMs: 0, stopReason: null, cancelRequestedAt: null, checkpointRef: null, createdResultVersionId: null });
      this.db.prepare('INSERT INTO runs(id,investigation_id,status,epoch,payload_json) VALUES (?,?,?,?,?)').run(run.id, investigation.id, run.status, run.epoch, JSON.stringify(run));
      if (previous?.checkpointRef) {
        this.db.prepare('INSERT INTO run_checkpoints(run_id,payload_json) VALUES (?,?)').run(run.id, JSON.stringify(this.getCheckpoint(previous.id, input.sessionId)));
        run.checkpointRef = run.id;
      }
      if (previous) {
        const followup = this.db.prepare('SELECT followup_id,result_version_id,question FROM followup_run_inputs WHERE run_id=?').get(previous.id) as { followup_id: string; result_version_id: string; question: string } | undefined;
        if (followup) this.db.prepare('INSERT INTO followup_run_inputs VALUES (?,?,?,?)').run(run.id, followup.followup_id,
          input.action === 'add_budget' ? investigation.latestResultVersionId : followup.result_version_id, followup.question);
      }
      this.db.prepare('INSERT INTO run_submissions(session_id,key,body_hash,run_id) VALUES (?,?,?,?)').run(input.sessionId, input.key, hash, run.id);
      this.persist(run, input.at); this.lifecycle(run, 'run.queued', '任务已排队。', input.at); return run;
    }).immediate();
  }
  claimNext(at: string): Run | null {
    TimestampSchema.parse(at);
    return this.db.transaction(() => {
      const count = this.db.prepare("SELECT count(*) AS n FROM runs WHERE status='running'").get() as { n: number };
      if (count.n >= 2) return null;
      const row = this.db.prepare("SELECT r.id FROM runs r JOIN investigations i ON i.id=r.investigation_id WHERE r.status='queued' AND NOT EXISTS (SELECT 1 FROM runs a JOIN investigations ai ON ai.id=a.investigation_id WHERE a.status='running' AND ai.session_id=i.session_id AND a.id<>r.id) ORDER BY r.ordinal LIMIT 1").get() as { id: string } | undefined;
      if (!row) return null;
      const run = this.read(row.id);
      if (Date.parse(at) < Date.parse(run.queuedAt)) throw invalid('任务时钟不能倒退。');
      run.status = 'running'; run.stage = 'planning'; run.startedAt ??= at; run.activeIntervals.push({ startedAt: at, endedAt: null });
      this.persist(run, at); this.lifecycle(run, 'run.started', '任务已开始。', at); return run;
    }).immediate();
  }
  /** Called only after a persisted followup decision, inside the admission transaction. */
  enqueueFollowup(owner: string, followupId: string, at: string): Run {
    IdSchema.parse(owner); IdSchema.parse(followupId); TimestampSchema.parse(at);
    return this.db.transaction(() => {
      const job = this.db.prepare('SELECT * FROM followup_jobs WHERE id=? AND session_id=?').get(followupId, owner) as { investigation_id: string; result_version_id: string; research_run_id: string; question: string; status: string; new_run_id: string | null } | undefined;
      if (!job) throw missing();
      if (job.new_run_id) return this.get(job.new_run_id, owner)!;
      if (job.status !== 'running') throw invalid('追问已停止。');
      const investigation = this.investigation(job.investigation_id, owner);
      if (investigation.latestResultVersionId !== job.result_version_id) throw new ApiFault(409, 'STALE_VERSION', '已有更新报告，请在新版本继续补查。');
      if (investigation.activeRunId) throw new ApiFault(409, 'ACTIVE_RUN', '本案已有活动任务。');
      const previous = this.get(job.research_run_id, owner);
      const baseline = this.getResult(job.result_version_id, owner);
      if (!previous || previous.investigationId !== investigation.id || previous.trigger === 'watch' || active.has(previous.status) || !baseline) throw invalid('补查没有可复用的研究窗口。');
      const pool = this.db.prepare('SELECT state,session_id,investigation_id,kind FROM budget_pools WHERE id=?').get(previous.budgetWindowId) as { state: string; session_id: string; investigation_id: string; kind: string };
      if (pool.state !== 'active' || pool.kind !== 'window' || pool.session_id !== owner || pool.investigation_id !== investigation.id) throw invalid('原研究窗口不可用。');
      const run = RunSchema.parse({ id: randomUUID(), investigationId: investigation.id, trigger: 'followup', previousRunId: previous.id, budgetWindowId: previous.budgetWindowId,
        scopeVersion: investigation.scopeVersion, status: 'queued', stage: null, epoch: 1, queuedAt: at, startedAt: null, endedAt: null,
        activeIntervals: [], activeMs: 0, stopReason: null, cancelRequestedAt: null, checkpointRef: null, createdResultVersionId: null });
      this.db.prepare('INSERT INTO runs(id,investigation_id,status,epoch,payload_json) VALUES (?,?,?,?,?)').run(run.id, investigation.id, run.status, run.epoch, JSON.stringify(run));
      // The saved baseline carries the full captured evidence; old queries prevent replay.
      const captured = this.getCheckpoint(baseline.runId, owner), prior = this.getCheckpoint(previous.id, owner);
      const queries = [...new Map([...(prior?.queries ?? []), ...(captured?.queries ?? [])].map(q => [q.id, q])).values()];
      const material = WorkingMaterialSchema.parse({ sources: baseline.payload.sources, evidence: baseline.payload.evidence, claims: baseline.payload.claims, candidates: baseline.payload.candidates, queries });
      this.db.prepare('INSERT INTO run_checkpoints(run_id,payload_json) VALUES (?,?)').run(run.id, JSON.stringify(material)); run.checkpointRef = run.id;
      this.db.prepare('INSERT INTO followup_run_inputs VALUES (?,?,?,?)').run(run.id, followupId, baseline.id, job.question);
      this.db.prepare('UPDATE followup_jobs SET new_run_id=? WHERE id=?').run(run.id, followupId);
      this.persist(run, at); this.lifecycle(run, 'run.queued', '已按追问方向排队补查，复用本案剩余额度。', at); return run;
    }).immediate();
  }
  assertCurrent(raw: InvocationContext): void {
    const ctx = InvocationContextSchema.parse(raw);
    if (!ctx.runId || ctx.interactionPoolId || ctx.watchCheckId || ctx.watchLeaseEpoch !== null) throw invalid('此守卫只处理普通调查任务。');
    const run = this.current(ctx.runId, ctx.epoch);
    const investigation = this.investigation(run.investigationId, ctx.sessionId);
    const session = this.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(ctx.sessionId) as JsonRow;
    if (run.investigationId !== ctx.investigationId || run.budgetWindowId !== ctx.budgetWindowId || investigation.activeRunId !== run.id || investigation.scopeVersion !== run.scopeVersion
      || BrowserSessionSchema.parse(JSON.parse(session.payload_json)).accessGroup !== ctx.accessGroup) throw invalid('任务上下文不匹配。');
  }
  waitForUser(id: string, epoch: number, at: string): Run {
    TimestampSchema.parse(at);
    return this.db.transaction(() => {
      const run = this.current(id, epoch); this.closeInterval(run, at);
      run.status = 'waiting_for_user'; run.stage = null; run.epoch++;
      this.persist(run, at); this.lifecycle(run, 'clarification.requested', '任务暂停，等待补充线索。', at); return run;
    }).immediate();
  }
  continueAfterUser(id: string, owner: string, at: string): Run {
    TimestampSchema.parse(at);
    return this.db.transaction(() => {
      const run = this.get(id, owner); if (!run) throw missing();
      if (run.status !== 'waiting_for_user') throw invalid('任务没有等待用户。');
      if (Date.parse(at) < Date.parse(run.activeIntervals.at(-1)?.endedAt ?? run.queuedAt)) throw invalid('任务时钟不能倒退。');
      run.status = 'running'; run.stage = 'planning'; run.epoch++; run.activeIntervals.push({ startedAt: at, endedAt: null });
      this.persist(run, at); this.lifecycle(run, 'run.started', '任务已继续。', at); return run;
    }).immediate();
  }
  cancel(id: string, owner: string, at: string): Run {
    TimestampSchema.parse(at);
    return this.db.transaction(() => {
      const run = this.get(id, owner); if (!run) throw missing();
      if(run.trigger==='watch')throw invalid('后台检查请通过监测暂停或删除操作停止。');
      if (!active.has(run.status)) return run;
      const last = run.activeIntervals.at(-1)?.endedAt ?? run.queuedAt;
      if (Date.parse(at) < Date.parse(last)) throw invalid('任务时钟不能倒退。');
      this.closeInterval(run, at); run.status = 'cancelled'; run.stage = null; run.epoch++;
      run.cancelRequestedAt = at; run.endedAt = at; run.stopReason = 'cancelled';
      this.persist(run, at); this.lifecycle(run, 'run.stopped', '任务已停止；已发请求仍需结算。', at); return run;
    }).immediate();
  }
  /** Single host calls this before dispatch; never on ordinary database connection creation. */
  interruptOnStartup(at: string): number {
    TimestampSchema.parse(at);
    return this.db.transaction(() => {
      // Queued user tasks have never started or sent a provider call. Preserve
      // that authorization and window; running and lease-bound watch work stop.
      const rows = this.db.prepare("SELECT id FROM runs WHERE status='running' OR (status='queued' AND (json_extract(payload_json,'$.trigger')='watch' OR json_extract(payload_json,'$.startedAt') IS NOT NULL))").all() as { id: string }[];
      for (const row of rows) {
        const run = this.read(row.id);
        if (Date.parse(at) < Date.parse(run.queuedAt)) throw invalid('任务时钟不能倒退。');
        this.closeInterval(run, at); run.status = 'interrupted'; run.stage = null; run.epoch++;
        run.endedAt = at; run.stopReason = 'server_restart';
        this.persist(run, at); this.lifecycle(run, 'run.stopped', '服务重启，任务已中断；需要手动继续。', at);
      }
      return rows.length;
    }).immediate();
  }
  saveCheckpoint(id: string, epoch: number, patch: Partial<WorkingMaterial>, at: string): void {
    TimestampSchema.parse(at); const parsed = WorkingMaterialSchema.partial().parse(patch);
    this.db.transaction(() => {
      const run = this.current(id, epoch);
      const old = this.db.prepare('SELECT payload_json FROM run_checkpoints WHERE run_id=?').get(id) as JsonRow | undefined;
      const before = WorkingMaterialSchema.parse(old ? JSON.parse(old.payload_json) : emptyMaterial());
      const material = WorkingMaterialSchema.parse({ ...before, ...parsed });
      before.queries = this.tagQueries(before.queries, run.investigationId);
      material.queries = this.tagQueries(material.queries, run.investigationId);
      if (before.queries.some(query => !material.queries.some(next => next.id === query.id && stableJson(next) === stableJson(query)))) throw invalid('不能删除或改写已有查询历史。');
      if (material.queries.some(query => !before.queries.some(oldQuery => oldQuery.id === query.id) && query.runId !== run.id)) throw invalid('新查询必须属于当前任务。');
      const json = JSON.stringify(material);
      if (Buffer.byteLength(json, 'utf8') > 2 * 1024 * 1024) throw invalid('工作材料超过存储上限。');
      this.db.prepare('INSERT INTO run_checkpoints(run_id,payload_json) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET payload_json=excluded.payload_json').run(id, json);
      run.checkpointRef = id; this.persist(run, at);
    }).immediate();
  }
  getCheckpoint(id: string, owner: string): WorkingMaterial | null {
    const run = this.get(id, owner); if (!run) throw missing();
    const row = this.db.prepare('SELECT payload_json FROM run_checkpoints WHERE run_id=?').get(id) as JsonRow | undefined;
    if (!row) return null;
    const material = WorkingMaterialSchema.parse(JSON.parse(row.payload_json));
    material.queries = this.tagQueries(material.queries, run.investigationId); return material;
  }
  private tagQueries(queries: WorkingMaterial['queries'], investigationId: string): WorkingMaterial['queries'] {
    if (new Set(queries.map(query => query.id)).size !== queries.length) throw invalid('查询记录不能重复。');
    return queries.map(query => {
      const original = this.read(query.runId);
      if (original.investigationId !== investigationId || (query.budgetWindowId !== undefined && query.budgetWindowId !== original.budgetWindowId)) throw invalid('查询的案件或预算窗口归属无效。');
      return { ...query, budgetWindowId: original.budgetWindowId };
    });
  }
  appendEvent(id: string, epoch: number, input: EventInput, at: string): void {
    TimestampSchema.parse(at);
    if (['run.queued', 'run.started', 'run.finalized', 'run.stopped', 'clarification.requested'].includes(input.type)) throw invalid('生命周期事件只能由平台状态转换生成。');
    this.db.transaction(() => { this.event(this.current(id, epoch), input, at); }).immediate();
  }
  listEvents(investigationId: string, owner: string, afterSeq = 0, limit = 100) {
    this.investigation(investigationId, owner); CountSchema.parse(afterSeq); z.number().int().min(1).max(100).parse(limit);
    const rows = this.db.prepare("SELECT payload_json FROM progress_events WHERE investigation_id=? AND seq>? AND visibility='public' ORDER BY seq LIMIT ?").all(investigationId, afterSeq, limit + 1) as JsonRow[];
    const items = rows.slice(0, limit).map(row => ProgressEventSchema.parse(JSON.parse(row.payload_json)));
    return { items, nextSeq: items.at(-1)?.seq ?? afterSeq, hasMore: rows.length > limit };
  }
}
