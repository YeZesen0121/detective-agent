import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BudgetAmountsSchema, InvocationContextSchema, type BudgetAmounts, type InvocationContext } from '../../shared/contracts.js';
import type { BudgetBook } from './budget.js';
import { ApiFault, BudgetLimitFault } from './errors.js';

export interface CallSpec {
  provider: string; operation: 'search' | 'read' | 'model' | 'tts'; purpose: string;
  attemptNo: number; estimated: BudgetAmounts; priceRevision: string | null; timeoutMs: number;
}
export interface CallReceipt<T> { value: T; actual: BudgetAmounts | null; providerRequestId?: string }
export interface GatewayOptions {
  book: BudgetBook; poolIds(context: InvocationContext): string[];
  assertCurrent(context: InvocationContext): void;
  concurrency: Record<CallSpec['operation'], number>;
  failureDiagnostic?(error:unknown):unknown;
}
export class PaidGateway {
  private readonly active = { search: 0, read: 0, model: 0, tts: 0 };
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly options: GatewayOptions) {
    for (const count of Object.values(options.concurrency)) z.number().int().positive().parse(count);
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.pending]); }

  private assertUsable(context: InvocationContext, signal: AbortSignal) {
    if (signal.aborted) throw new ApiFault(409, 'INVALID_STATE', '调用已取消。');
    if (!this.options.book.unrestricted && Date.now() >= Date.parse(context.deadlineAt)) throw new BudgetLimitFault('activeMs');
    this.options.assertCurrent(context);
  }

  async invoke<T>(context: InvocationContext, spec: CallSpec, send: (signal: AbortSignal,callId:string) => Promise<CallReceipt<T>>, signal: AbortSignal) {
    InvocationContextSchema.parse(context);
    const estimated = BudgetAmountsSchema.parse(spec.estimated);
    z.enum(['search', 'read', 'model', 'tts']).parse(spec.operation);
    z.number().int().positive().max(75000).parse(spec.timeoutMs);
    if (!spec.priceRevision?.trim() || spec.estimated.moneyMicros <= 0) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '未配置可核查价格，不能开始付费调用。');
    if (spec.operation === 'search') estimated.searches = Math.max(1, estimated.searches);
    if (spec.operation === 'read') estimated.reads = Math.max(1, estimated.reads);
    if (spec.operation === 'model') {
      estimated.modelCalls = Math.max(1, estimated.modelCalls);
      z.number().int().min(1).max(24000).parse(estimated.inputTokens);
      z.number().int().min(1).max(2500).parse(estimated.outputTokens);
    }
    this.assertUsable(context, signal);
    if (this.active[spec.operation] >= this.options.concurrency[spec.operation]) throw new ApiFault(429, 'RATE_LIMITED', '该服务当前调用较多，请稍后重试。', true);
    const callId = randomUUID();
    this.options.book.reserve(context, this.options.poolIds(context), {
      callId, provider: spec.provider, operation: spec.operation, purpose: spec.purpose,
      attemptNo: spec.attemptNo, estimated, priceRevision: spec.priceRevision,
    });
    try { this.assertUsable(context, signal); this.options.book.markSent(callId); }
    catch (error) { this.options.book.release(callId); throw error; }

    const controller = new AbortController();
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abort = (reason: ApiFault) => {
      if (controller.signal.aborted) return;
      this.options.book.markUnknown(callId);
      controller.abort(reason); rejectAbort(reason);
    };
    const onParentAbort = () => abort(new ApiFault(409, 'INVALID_STATE', '调用已取消；已发请求仍需结算。'));
    const timeoutMs = this.options.book.unrestricted?spec.timeoutMs:Math.max(1, Math.min(spec.timeoutMs, Date.parse(context.deadlineAt) - Date.now()));
    const timer = setTimeout(() => abort(new ApiFault(503, 'PROVIDER_UNAVAILABLE', '外部服务调用超时，费用待确认。', true)), timeoutMs);
    signal.addEventListener('abort', onParentAbort, { once: true });
    this.active[spec.operation]++;
    let request: Promise<CallReceipt<T>>;
    // Start without an await gap after the last authorization check.
    try { request = Promise.resolve(send(controller.signal,callId)); }
    catch (error) { request = Promise.reject(error); }
    const accounted = request.then((receipt) => {
      if (receipt.actual === null) this.options.book.markUnknown(callId);
      else this.options.book.settle(callId, receipt.actual, receipt.providerRequestId ?? null);
      // Late callbacks may settle costs, never revive a cancelled worker's result.
      this.assertUsable(context, controller.signal);
      return { callId, value: receipt.value, accounting: (receipt.actual === null ? 'unknown' : 'settled') as 'unknown' | 'settled' };
    }).catch((error: unknown) => {
      this.options.book.markUnknown(callId);
      try{const diagnostic=this.options.failureDiagnostic?.(error);if(diagnostic)this.options.book.recordFailureDiagnostic(callId,diagnostic);}catch{/* Diagnostics never replace authoritative accounting or the original failure. */}
      throw error;
    }).finally(() => {
      // If an SDK ignores abort, physical concurrency stays occupied until it ends.
      this.active[spec.operation]--;
    });
    this.pending.add(accounted);
    void accounted.then(() => this.pending.delete(accounted), () => this.pending.delete(accounted));
    try { return await Promise.race([accounted, aborted]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', onParentAbort); }
  }
}
