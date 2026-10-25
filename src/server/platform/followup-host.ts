import { z } from 'zod';
import type { InvocationContext } from '../../shared/contracts.js';
import { FollowupDecisionSchema, ModelRequestSchema, type InvestigationServices } from '../../shared/ports.js';
import type { CreateFollowupSchema } from '../../shared/followup-http.js';
import { FollowupStore, interactionPools, type FollowupJob } from './followup-store.js';
import type { InvestigationRuntimeOptions } from './host.js';
import type { PaidGateway } from './gateway.js';
import { bindResearchServices } from './services.js';
import { hashValue } from './snapshots.js';
import { ApiFault, BudgetLimitFault } from './errors.js';
import { ProviderModelTraces } from './model-traces.js';

/** Routes a saved question; only the normal investigation host may execute research. */
export class FollowupHost {
  private closed = false;
  private recovered = false;
  private scheduled: NodeJS.Timeout | null = null;
  private readonly active = new Map<string, { controller: AbortController; task: Promise<void> }>();
  constructor(readonly store: FollowupStore, readonly runtime: InvestigationRuntimeOptions, readonly gateway: PaidGateway, readonly now: () => string,
    readonly admit: (owner: string) => void, readonly wakeResearch: () => void, readonly wakeExperience: () => void) {}
  recover() { this.store.recover(this.now()); this.recovered = true; }
  start(owner: string, inv: string, key: string, input: z.infer<typeof CreateFollowupSchema>) {
    if (this.closed || !this.recovered || this.runtime.enableFollowups !== true) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '追问策略尚未通过接入检查。');
    const job = this.store.enqueue(owner, inv, key, input, this.now()); this.kick(); return job;
  }
  private kick() {
    if (this.closed || this.scheduled) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = null; if (this.closed) return;
      while (this.active.size < 2) {
        const job = this.store.claim(this.now()); if (!job) break;
        const controller = new AbortController();
        const task = Promise.resolve().then(() => this.execute(job, controller)).finally(() => { this.active.delete(job.id); this.wakeExperience(); this.kick(); });
        this.active.set(job.id, { controller, task }); void task.catch(() => {});
      }
      if (this.store.db.prepare("SELECT 1 FROM followup_jobs WHERE status='queued'").get()) this.kick();
    }, 20);
    this.scheduled.unref();
  }
  private async execute(job: FollowupJob, controller: AbortController) {
    let timer: NodeJS.Timeout | undefined, listener: (() => void) | undefined;
    try {
      const context = Object.freeze(this.store.context(job, this.now()));
      const check = () => { controller.signal.throwIfAborted(); this.store.assertContext(context, this.now()); };
      const guard = (ctx: InvocationContext) => { if (hashValue(ctx) !== hashValue(context)) throw new ApiFault(409, 'INVALID_STATE', '追问不能修改调用上下文。'); check(); };
      check();
      if(!this.store.experience.book.unrestricted){timer = setTimeout(() => controller.abort(new BudgetLimitFault('activeMs')), Math.max(1, Date.parse(context.deadlineAt) - Date.parse(this.now()))); timer.unref();}
      const denied = async () => { check(); throw new ApiFault(409, 'INVALID_STATE', '追问路由不能自行搜索、读取或写入调查材料。'); };
      const binding = bindResearchServices(this.runtime.providers, this.runtime.pricing, this.gateway, context, {
        clock: { now: this.now }, checkpoint: { save: denied }, events: { append: denied },
        budget: { snapshot: async ctx => { guard(ctx); return this.store.experience.book.snapshot(context, interactionPools(context)); } },
      },new ProviderModelTraces(this.store.db).observer());
      let modelAttempts = 0, outputRemaining = 2000;
      const services: InvestigationServices = { ...binding, search: denied, read: denied,
        model: async (raw, ctx, child) => {
          guard(ctx); const input = ModelRequestSchema.parse(raw);
          if (input.purpose !== 'followup' || input.messages.some(m => m.attachmentRefs?.length) || !this.store.experience.book.unrestricted&&(modelAttempts >= 2 || input.maxOutputTokens > outputRemaining)) throw new BudgetLimitFault('modelCalls');
          modelAttempts++; outputRemaining -= input.maxOutputTokens;
          try { return await binding.model(input, ctx, AbortSignal.any([controller.signal, child])); }
          catch (error) { controller.abort(error); throw error; }
        },
      };
      const version = this.store.runs.getResult(job.result_version_id, job.session_id)!;
      const stopped = new Promise<never>((_, reject) => { listener = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', listener, { once: true }); if (controller.signal.aborted) listener(); });
      const work = Promise.resolve().then(() => this.runtime.module.routeFollowup({ context, version, question: job.question, remainingBudget: this.store.researchBudget(job, this.now()) }, services, controller.signal));
      const decision = FollowupDecisionSchema.parse(await Promise.race([work, stopped])); check();
      this.store.finish(job, decision, this.now(), () => this.admit(job.session_id)); this.wakeResearch();
    } catch (error) {
      this.store.fail(job, error instanceof z.ZodError ? 'INVALID_OUTPUT' : error instanceof ApiFault ? error.code : 'PROVIDER_ERROR', this.now());
    } finally { if (timer) clearTimeout(timer); if (listener) controller.signal.removeEventListener('abort', listener); }
  }
  async close() {
    if (this.closed) return; this.closed = true; if (this.scheduled) clearTimeout(this.scheduled);
    this.store.recover(this.now()); for (const item of this.active.values()) item.controller.abort(new Error('host stopped'));
    await Promise.allSettled([...this.active.values()].map(item => item.task));
  }
}
