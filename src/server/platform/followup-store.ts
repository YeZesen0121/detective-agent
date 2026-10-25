import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { InvestigationSchema, type InvocationContext } from '../../shared/contracts.js';
import { FollowupDecisionSchema, type FollowupDecision } from '../../shared/ports.js';
import { CreateFollowupSchema, FollowupViewSchema } from '../../shared/followup-http.js';
import { ExperienceStore } from './experience-store.js';
import { RunStore } from './runs.js';
import { hashValue } from './snapshots.js';
import { ApiFault, BudgetLimitFault } from './errors.js';

export type FollowupJob = { id: string; session_id: string; investigation_id: string; result_version_id: string; research_run_id: string; pool_id: string; question: string;
  status: 'queued' | 'running' | 'completed' | 'failed'; epoch: number; started_at: string | null; deadline_at: string | null; metered_ms: number;
  decision_json: string | null; new_run_id: string | null; error_code: string | null; latest_version_id: string | null; created_at: string };
const missing = () => new ApiFault(404, 'NOT_FOUND', '未找到该报告或追问。');
const invalid = () => new ApiFault(409, 'INVALID_STATE', '追问提交权已失效。');
export const interactionPools = (ctx: InvocationContext) => ['runtime:global', 'runtime:' + ctx.accessGroup, ctx.interactionPoolId!];
export class FollowupStore {
  readonly experience: ExperienceStore;
  readonly runs: RunStore;
  constructor(readonly db: Database.Database, readonly serviceEndsAt: string) { this.experience = new ExperienceStore(db, serviceEndsAt); this.runs = new RunStore(db); }
  job(id: string, owner?: string) { return (owner ? this.db.prepare('SELECT * FROM followup_jobs WHERE id=? AND session_id=?').get(id, owner) : this.db.prepare('SELECT * FROM followup_jobs WHERE id=?').get(id)) as FollowupJob | undefined; }
  investigation(id: string, owner: string) {
    const row = this.db.prepare('SELECT payload_json FROM investigations WHERE id=? AND session_id=?').get(id, owner) as { payload_json: string } | undefined;
    if (!row) throw missing(); return InvestigationSchema.parse(JSON.parse(row.payload_json));
  }
  enqueue(owner: string, id: string, key: string, raw: z.infer<typeof CreateFollowupSchema>, at: string) {
    const input = CreateFollowupSchema.parse(raw); z.string().min(8).max(128).parse(key);
    return this.db.transaction(() => {
      this.experience.session(owner, at); const inv = this.investigation(id, owner), version = this.runs.getResult(input.resultVersionId, owner);
      if (!version || version.investigationId !== id) throw missing();
      const bodyHash = hashValue({ investigationId: id, ...input });
      const prior = this.db.prepare('SELECT id,body_hash FROM followup_jobs WHERE session_id=? AND submission_key=?').get(owner, key) as { id: string; body_hash: string } | undefined;
      if (prior) { if (prior.body_hash !== bodyHash) throw new ApiFault(409, 'IDEMPOTENCY_CONFLICT', '该标识已提交不同追问。'); return this.job(prior.id)!; }
      if (inv.activeRunId || this.db.prepare("SELECT 1 FROM followup_jobs WHERE investigation_id=? AND status IN ('queued','running')").get(id)) throw new ApiFault(409, 'ACTIVE_RUN', '本案已有调查或追问正在进行。');
      const recent = this.db.prepare('SELECT count(*) n FROM followup_jobs WHERE session_id=? AND created_at>?').get(owner, new Date(Date.parse(at) - 60000).toISOString()) as { n: number };
      const queue = this.db.prepare("SELECT (SELECT count(*) FROM followup_jobs WHERE status='queued')+(SELECT count(*) FROM experience_jobs WHERE status='queued')+(SELECT count(*) FROM runs WHERE status='queued') n").get() as { n: number };
      const own = this.db.prepare("SELECT (SELECT count(*) FROM followup_jobs WHERE session_id=? AND status='queued')+(SELECT count(*) FROM experience_jobs WHERE session_id=? AND status='queued')+(SELECT count(*) FROM runs r JOIN investigations i ON i.id=r.investigation_id WHERE i.session_id=? AND r.status='queued') n").get(owner, owner, owner) as { n: number };
      if (queue.n >= 20) throw new ApiFault(429, 'QUEUE_FULL', '任务队列已满。', true);
      if (recent.n >= 10 || own.n >= 2) throw new ApiFault(429, 'RATE_LIMITED', '追问过于频繁，请稍后继续。', true);
      const research = this.db.prepare("SELECT id FROM runs WHERE investigation_id=? AND json_extract(payload_json,'$.trigger')<>'watch' ORDER BY ordinal DESC LIMIT 1").get(id) as { id: string } | undefined;
      if (!research) throw invalid();
      const pool = this.experience.scope(owner, id, at), jobId = randomUUID();
      this.db.prepare("INSERT INTO followup_jobs(id,session_id,investigation_id,result_version_id,research_run_id,pool_id,submission_key,body_hash,question,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,'queued',?)")
        .run(jobId, owner, id, version.id, research.id, pool, key, bodyHash, input.question, at);
      return this.job(jobId)!;
    }).immediate();
  }
  claim(at: string) { return this.db.transaction(() => {
    const row = this.db.prepare("SELECT f.* FROM followup_jobs f WHERE f.status='queued' AND NOT EXISTS(SELECT 1 FROM experience_jobs e WHERE e.investigation_id=f.investigation_id AND e.status='running') ORDER BY f.ordinal LIMIT 1").get() as FollowupJob | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE experience_scopes SET epoch=epoch+1 WHERE pool_id=?').run(row.pool_id);
    const { epoch } = this.db.prepare('SELECT epoch FROM experience_scopes WHERE pool_id=?').get(row.pool_id) as { epoch: number };
    const deadline = this.experience.book.unrestricted?this.serviceEndsAt:new Date(Math.min(Date.parse(this.serviceEndsAt), Date.parse(at) + 120000)).toISOString();
    this.db.prepare("UPDATE followup_jobs SET status='running',epoch=?,started_at=?,deadline_at=? WHERE id=? AND status='queued'").run(epoch, at, deadline, row.id);
    const remaining = this.experience.book.snapshot(this.context(this.job(row.id)!, at, false), interactionPools(this.context(this.job(row.id)!, at, false))).remaining.activeMs;
    if(!this.experience.book.unrestricted)this.db.prepare('UPDATE followup_jobs SET deadline_at=? WHERE id=?').run(new Date(Math.min(Date.parse(deadline), Date.parse(at) + remaining)).toISOString(), row.id);
    return this.job(row.id)!;
  }).immediate(); }
  context(job: FollowupJob, at: string, live = true): InvocationContext {
    const session = this.experience.session(job.session_id, at, live);
    return { sessionId: session.id, accessGroup: session.accessGroup, investigationId: job.investigation_id, runId: null, budgetWindowId: null, interactionPoolId: job.pool_id,
      epoch: job.epoch, watchCheckId: null, watchLeaseEpoch: null, deadlineAt: job.deadline_at ?? this.serviceEndsAt };
  }
  ownsContext(ctx: InvocationContext) { return !!this.db.prepare("SELECT 1 FROM followup_jobs WHERE pool_id=? AND epoch=? AND status='running'").get(ctx.interactionPoolId, ctx.epoch); }
  assertContext(ctx: InvocationContext, at: string) {
    const job = this.db.prepare("SELECT f.* FROM followup_jobs f JOIN experience_scopes s ON s.pool_id=f.pool_id WHERE f.pool_id=? AND f.epoch=? AND s.epoch=f.epoch AND f.status='running'").get(ctx.interactionPoolId, ctx.epoch) as FollowupJob | undefined;
    if (!job || hashValue(ctx) !== hashValue(this.context(job, at))) throw invalid();
    this.meter(job, at);
    const snapshot = this.experience.book.snapshot(ctx, interactionPools(ctx));
    if (snapshot.blockedBy.includes('accounting_paused')) throw new BudgetLimitFault(null);
    if (!this.experience.book.unrestricted&&(Date.parse(at) >= Date.parse(ctx.deadlineAt) || snapshot.remaining.activeMs === 0)) throw new BudgetLimitFault('activeMs');
    return job;
  }
  meter(job: FollowupJob, at: string) {
    if (job.status !== 'running' || !job.started_at) return;
    this.db.transaction(() => {
      const current = this.job(job.id)!;
      const total = Math.max(0, Math.min(Date.parse(at), Date.parse(current.deadline_at!)) - Date.parse(current.started_at!));
      if (total < current.metered_ms) throw invalid();
      const ctx = this.context(current, at, false);
      this.experience.book.chargeActivity(ctx, interactionPools(ctx), total - current.metered_ms);
      this.db.prepare('UPDATE followup_jobs SET metered_ms=? WHERE id=?').run(total, job.id);
    }).immediate();
  }
  researchBudget(job: FollowupJob, at: string) {
    const run = this.runs.get(job.research_run_id, job.session_id)!;
    const session = this.experience.session(job.session_id, at);
    const ctx: InvocationContext = { sessionId: session.id, accessGroup: session.accessGroup, investigationId: job.investigation_id, runId: run.id, budgetWindowId: run.budgetWindowId, interactionPoolId: null, epoch: run.epoch, watchCheckId: null, watchLeaseEpoch: null, deadlineAt: this.serviceEndsAt };
    return this.experience.book.snapshot(ctx, ['runtime:global', 'runtime:' + ctx.accessGroup, run.budgetWindowId]);
  }
  finish(job: FollowupJob, raw: FollowupDecision, at: string, admit: () => void) { return this.db.transaction(() => {
    this.assertContext(this.context(job, at), at); const decision = FollowupDecisionSchema.parse(raw);
    const version = this.runs.getResult(job.result_version_id, job.session_id)!;
    if (decision.answer && (decision.answer.claimIds.some(id => !version.payload.claims.some(c => c.id === id)) || decision.answer.evidenceIds.some(id => !version.payload.evidence.some(e => e.id === id)))) throw invalid();
    if (decision.route === 'explain' && (!decision.answer || decision.researchPurpose)) throw invalid();
    if (decision.route === 'suggest_new_case' && !decision.suggestedQuestion) throw invalid();
    if (decision.route === 'research_same_scope' || decision.route === 'needs_budget_confirmation') {
      const inv = this.investigation(job.investigation_id, job.session_id);
      if (inv.latestResultVersionId !== version.id) {
        this.db.prepare("UPDATE followup_jobs SET status='failed',error_code='STALE_VERSION',latest_version_id=?,ended_at=? WHERE id=?").run(inv.latestResultVersionId, at, job.id); return;
      }
    }
    if (decision.route === 'research_same_scope') {
      if (!decision.researchPurpose) throw invalid();
      const budget = this.researchBudget(job, at);
      if (!budget.canModel || (!budget.canSearch && !budget.canRead)) decision.route = 'needs_budget_confirmation';
      else { admit(); const run = this.runs.enqueueFollowup(job.session_id, job.id, at);
        this.db.prepare("INSERT INTO task_admissions(session_id,run_id,kind,operation_key,admitted_at) VALUES (?,?,'start',?,?)").run(job.session_id, run.id, 'followup:' + job.id, at);
      }
    }
    this.db.prepare("UPDATE followup_jobs SET status='completed',decision_json=?,ended_at=? WHERE id=? AND epoch=?").run(JSON.stringify(decision), at, job.id, job.epoch);
  }).immediate(); }
  fail(job: FollowupJob, code: string, at: string) {
    this.db.transaction(() => { const current = this.job(job.id); if (!current || current.status !== 'running' || current.epoch !== job.epoch) return;
      this.meter(current, at); this.db.prepare("UPDATE followup_jobs SET status='failed',error_code=?,ended_at=?,epoch=epoch+1 WHERE id=?").run(code, at, job.id);
    }).immediate();
  }
  recover(at: string) {
    this.db.transaction(() => { const rows = this.db.prepare("SELECT * FROM followup_jobs WHERE status IN ('queued','running')").all() as FollowupJob[];
      for (const job of rows) { this.meter(job, at); this.db.prepare("UPDATE followup_jobs SET status='failed',error_code='SERVER_RESTART',epoch=epoch+1,ended_at=? WHERE id=?").run(at, job.id); }
    }).immediate();
  }
  view(id: string, owner: string) {
    const job = this.job(id, owner); if (!job) throw missing(); const decision = job.decision_json ? FollowupDecisionSchema.parse(JSON.parse(job.decision_json)) : null;
    return FollowupViewSchema.parse({ id: job.id, investigationId: job.investigation_id, resultVersionId: job.result_version_id, question: job.question, createdAt: job.created_at, status: job.status,
      turn: decision ? { id: job.id, investigationId: job.investigation_id, resultVersionId: job.result_version_id, question: job.question, route: decision.route, answer: decision.answer?.text ?? null, claimIds: decision.answer?.claimIds ?? [], newRunId: job.new_run_id, createdAt: job.created_at } : null,
      evidenceIds: decision?.answer?.evidenceIds ?? [], researchPurpose: decision?.researchPurpose ?? null, suggestedQuestion: decision?.suggestedQuestion ?? null, activeRunId: job.new_run_id, latestResultVersionId: job.latest_version_id,
      error: job.error_code ? { code: job.error_code, message: job.error_code === 'STALE_VERSION' ? '已有更新报告，请先查看新版本再补查。' : '本次追问未完成，已保留原报告；不会自动重发请求。' } : null });
  }
  submission(id: string, owner: string, key: string) {
    this.investigation(id, owner); z.string().min(8).max(128).parse(key);
    const row = this.db.prepare('SELECT id FROM followup_jobs WHERE investigation_id=? AND session_id=? AND submission_key=?').get(id, owner, key) as { id: string } | undefined;
    return { submission: row ? { followupTurnId: row.id } : null };
  }
  list(id: string, owner: string, after: number) {
    this.investigation(id, owner); z.number().int().nonnegative().parse(after);
    const rows = this.db.prepare('SELECT id,ordinal FROM followup_jobs WHERE investigation_id=? AND session_id=? AND ordinal>? ORDER BY ordinal LIMIT 51').all(id, owner, after) as { id: string; ordinal: number }[];
    return { items: rows.slice(0, 50).map(row => this.view(row.id, owner)), nextAfter: rows.length > 50 ? rows[49]!.ordinal : null };
  }
}
