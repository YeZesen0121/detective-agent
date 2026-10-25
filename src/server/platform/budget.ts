import type Database from 'better-sqlite3';
import { z } from 'zod';
import { BudgetAmountsSchema, InvocationContextSchema, IdSchema, type AccessGroup, type BudgetAmounts, type BudgetSnapshot, type InvocationContext } from '../../shared/contracts.js';
import { ApiFault, BudgetLimitFault } from './errors.js';
import { PaidCampaign, type PaidCampaignPolicy } from './paid-campaign.js';

export interface PoolDefinition {
  id: string; kind: 'global' | 'access_group' | 'window' | 'interaction';
  accessGroup: AccessGroup | null; sessionId: string | null; investigationId: string | null; limits: BudgetAmounts;
}
export interface Reservation {
  callId: string; provider: string; operation: string; purpose: string; attemptNo: number; estimated: BudgetAmounts;
  priceRevision?: string;
}
export const zeroAmounts = (): BudgetAmounts => ({ activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 });

type PoolRow = { id: string; kind: PoolDefinition['kind']; access_group: AccessGroup | null; session_id: string | null; investigation_id: string | null;
  limits_json: string; used_json: string; reserved_json: string; state: 'active' | 'paused'; revision: number };
type CallRow = { call_id: string; status: string; estimated_json: string; actual_json: string | null };
const dimensions = Object.keys(zeroAmounts()) as (keyof BudgetAmounts)[];
const attempts = ['searches', 'reads', 'modelCalls'] as const;
const combine = (a: BudgetAmounts, b: BudgetAmounts, sign = 1) => BudgetAmountsSchema.parse(Object.fromEntries(dimensions.map((key) => [key, a[key] + sign * b[key]])));
const parseAmounts = (json: string) => BudgetAmountsSchema.parse(JSON.parse(json));
const invalid = (message: string) => new ApiFault(409, 'INVALID_STATE', message);

export class BudgetBook {
  private readonly campaign: PaidCampaign;
  constructor(private readonly db: Database.Database, campaign?: PaidCampaignPolicy, policy?: {unrestricted:boolean}) {
    this.campaign = new PaidCampaign(db, campaign);
    if(policy){const unrestricted=z.boolean().parse(policy.unrestricted);db.prepare('INSERT INTO usage_policy(singleton,unrestricted,updated_at) VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET unrestricted=excluded.unrestricted,updated_at=excluded.updated_at').run(unrestricted?1:0,new Date().toISOString());}
  }
  get unrestricted():boolean{return (this.db.prepare('SELECT unrestricted FROM usage_policy WHERE singleton=1').get() as {unrestricted:number}|undefined)?.unrestricted===1;}

  createPool(pool: PoolDefinition): void {
    const limits = BudgetAmountsSchema.parse(pool.limits);
    z.string().min(1).max(128).parse(pool.id);
    if (pool.kind === 'global' && (pool.accessGroup || pool.sessionId || pool.investigationId)) throw invalid('Global pool scope is invalid');
    if (pool.kind === 'access_group' && (!pool.accessGroup || pool.sessionId || pool.investigationId)) throw invalid('Access group scope is invalid');
    if (['window', 'interaction'].includes(pool.kind) && (!pool.accessGroup || !pool.sessionId || !pool.investigationId)) throw invalid('Invocation pool needs its owner');
    const zero = JSON.stringify(zeroAmounts());
    // Never reset an existing grant when resuming a run.
    this.db.prepare('INSERT INTO budget_pools(id,kind,access_group,session_id,investigation_id,limits_json,used_json,reserved_json) VALUES (?,?,?,?,?,?,?,?)')
      .run(pool.id, pool.kind, pool.accessGroup, pool.sessionId, pool.investigationId, JSON.stringify(limits), zero, zero);
  }

  private pool(id: string): PoolRow {
    const row = this.db.prepare('SELECT * FROM budget_pools WHERE id = ?').get(id) as PoolRow | undefined;
    if (!row) throw invalid('Required budget pool is not configured');
    return row;
  }

  private scopedPools(context: InvocationContext, poolIds: string[]) {
    InvocationContextSchema.parse(context);
    z.array(z.string().min(1).max(128)).min(3).max(8).parse(poolIds);
    if (new Set(poolIds).size !== poolIds.length) throw invalid('Duplicate budget pool');
    let periodId: string | null = null;
    if (context.watchCheckId !== null) {
      const link=this.db.prepare('SELECT c.period_id,c.budget_window_id,c.run_id,c.lease_epoch,w.session_id,w.investigation_id FROM watch_checks c JOIN watches w ON w.id=c.watch_id WHERE c.id=?').get(context.watchCheckId) as {period_id:string;budget_window_id:string;run_id:string;lease_epoch:number;session_id:string;investigation_id:string}|undefined;
      if(!link || link.budget_window_id!==context.budgetWindowId || link.run_id!==context.runId || link.lease_epoch!==context.watchLeaseEpoch || link.session_id!==context.sessionId || link.investigation_id!==context.investigationId || context.interactionPoolId!==null) throw invalid('Invalid watch budget hierarchy');
      periodId=link.period_id;
    } else if(context.watchLeaseEpoch!==null) throw invalid('Unexpected watch lease');
    if (Boolean(context.budgetWindowId) === Boolean(context.interactionPoolId)) throw invalid('Choose one window or interaction pool');
    const pools = poolIds.map((id) => this.pool(id));
    const invocationId = context.budgetWindowId ?? context.interactionPoolId;
    const invocationKind = context.budgetWindowId ? 'window' : 'interaction';
    if (pools.filter((pool) => pool.kind === 'global').length !== 1 || pools.filter((pool) => pool.kind === 'access_group').length !== 1
      || pools.filter((pool) => pool.kind === invocationKind && pool.id === invocationId).length !== 1 || pools.length !== (periodId?4:3)
      || (periodId && pools.filter(pool=>pool.kind==='window' && pool.id===periodId).length!==1)) throw invalid('Incomplete budget hierarchy');
    for (const pool of pools) {
      if (pool.kind !== 'global' && pool.access_group !== context.accessGroup) throw invalid('Budget access group mismatch');
      if (['window', 'interaction'].includes(pool.kind)
        && ((pool.id !== invocationId && pool.id!==periodId) || pool.session_id !== context.sessionId || pool.investigation_id !== context.investigationId)) throw invalid('Budget owner mismatch');
    }
    return pools;
  }

  private updatePool(pool: PoolRow, used: BudgetAmounts, reserved: BudgetAmounts, pause = false) {
    const updated = this.db.prepare('UPDATE budget_pools SET used_json=?,reserved_json=?,state=?,revision=revision+1 WHERE id=? AND revision=?')
      .run(JSON.stringify(used), JSON.stringify(reserved), pause ? 'paused' : pool.state, pool.id, pool.revision);
    if (updated.changes !== 1) throw invalid('Budget pool changed concurrently');
  }

  reserve(context: InvocationContext, poolIds: string[], reservation: Reservation): void {
    const estimated = BudgetAmountsSchema.parse(reservation.estimated);
    z.uuid().parse(reservation.callId);
    z.number().int().positive().parse(reservation.attemptNo);
    for (const field of [reservation.provider, reservation.operation, reservation.purpose]) z.string().trim().min(1).max(1000).parse(field);
    this.db.transaction(() => {
      const pools = this.scopedPools(context, poolIds);
      if (this.db.prepare('SELECT 1 FROM usage_ledger WHERE call_id=?').get(reservation.callId)) throw invalid('Call ID already exists');
      if(!this.unrestricted)this.campaign.assertReservation(reservation.operation, estimated.moneyMicros);
      for (const pool of pools) {
        const total = combine(combine(parseAmounts(pool.used_json), parseAmounts(pool.reserved_json)), estimated);
        const limits = parseAmounts(pool.limits_json);
        const exceeded=dimensions.find((key)=>total[key]>limits[key]);
        if (!this.unrestricted && (pool.state !== 'active' || exceeded)) throw new BudgetLimitFault(exceeded??null);
      }
      this.db.prepare('INSERT INTO usage_ledger(call_id,context_json,provider,operation,purpose,price_revision,attempt_no,status,estimated_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(reservation.callId, JSON.stringify(context), reservation.provider, reservation.operation, reservation.purpose, reservation.priceRevision ?? null, reservation.attemptNo, 'reserved', JSON.stringify(estimated), new Date().toISOString());
      this.campaign.link(reservation.callId);
      for (const pool of pools) {
        this.updatePool(pool, parseAmounts(pool.used_json), combine(parseAmounts(pool.reserved_json), estimated));
        this.db.prepare('INSERT INTO call_pool_reservations(call_id,pool_id) VALUES (?,?)').run(reservation.callId, pool.id);
      }
    }).immediate();
  }

  private call(callId: string): CallRow {
    const row = this.db.prepare('SELECT * FROM usage_ledger WHERE call_id=?').get(callId) as CallRow | undefined;
    if (!row) throw invalid('Call not found');
    return row;
  }

  inspectCall(callId: string) {
    const call = this.call(callId);
    return { status: call.status, estimated: parseAmounts(call.estimated_json), actual: call.actual_json ? parseAmounts(call.actual_json) : null };
  }

  markSent(callId: string): void {
    this.db.transaction(() => {
      if(!this.unrestricted)this.campaign.assertSend(callId);
      const changed = this.db.prepare("UPDATE usage_ledger SET status='sent',sent_at=? WHERE call_id=? AND status='reserved'").run(new Date().toISOString(), callId);
      if (changed.changes !== 1) throw invalid('Call is not an unsent reservation');
    }).immediate();
  }

  markUnknown(callId: string): void {
    this.db.prepare("UPDATE usage_ledger SET status='unknown' WHERE call_id=? AND status='sent'").run(callId);
  }

  /** Optional private diagnostics cannot change money, status, or an existing settlement. */
  recordFailureDiagnostic(callId:string,raw:unknown):boolean{
    try{
      const parsed=z.strictObject({providerErrorCode:z.string().max(128).regex(/^[A-Za-z]+(?:\.[A-Za-z][A-Za-z0-9]{0,63}){0,3}$/).optional(),providerRequestId:IdSchema.optional()}).safeParse(raw);
      if(!parsed.success||!parsed.data.providerErrorCode&&!parsed.data.providerRequestId)return false;
      return this.db.prepare("UPDATE usage_ledger SET error_code=COALESCE(error_code,?),provider_request_id=COALESCE(provider_request_id,?) WHERE call_id=? AND status='unknown'").run(parsed.data.providerErrorCode??null,parsed.data.providerRequestId??null,callId).changes===1;
    }catch{return false;}
  }

  private associatedPools(callId: string) {
    return this.db.prepare('SELECT budget_pools.* FROM budget_pools JOIN call_pool_reservations ON budget_pools.id=call_pool_reservations.pool_id WHERE call_id=?').all(callId) as PoolRow[];
  }

  release(callId: string): void {
    this.db.transaction(() => {
      const call = this.call(callId);
      if (call.status === 'released') return;
      if (call.status !== 'reserved') throw invalid('Sent or unknown calls cannot be refunded as unsent');
      for (const pool of this.associatedPools(callId)) this.updatePool(pool, parseAmounts(pool.used_json), combine(parseAmounts(pool.reserved_json), parseAmounts(call.estimated_json), -1));
      this.db.prepare("UPDATE usage_ledger SET status='released',settled_at=? WHERE call_id=?").run(new Date().toISOString(), callId);
    }).immediate();
  }

  settle(callId: string, actualInput: BudgetAmounts, providerRequestId: string | null = null) {
    return this.db.transaction(() => {
      const call = this.call(callId); const estimated = parseAmounts(call.estimated_json);
      const actual = BudgetAmountsSchema.parse(actualInput);
      for (const key of attempts) actual[key] = Math.max(actual[key], estimated[key]);
      if (['settled', 'failed'].includes(call.status)) {
        if (JSON.stringify(actual) !== JSON.stringify(parseAmounts(call.actual_json!))) throw invalid('Conflicting second settlement');
        return { changed: false, overrun: dimensions.some((key) => actual[key] > estimated[key]) };
      }
      if (!['sent', 'unknown'].includes(call.status)) throw invalid('Only sent calls can be settled');
      const overrun = dimensions.some((key) => actual[key] > estimated[key]);
      if (overrun&&!this.unrestricted) this.campaign.pauseOverrun(callId);
      for (const pool of this.associatedPools(callId)) {
        const used = combine(parseAmounts(pool.used_json), actual);
        const reserved = combine(parseAmounts(pool.reserved_json), estimated, -1);
        this.updatePool(pool, used, reserved, overrun&&!this.unrestricted);
      }
      if (call.status === 'unknown') this.db.prepare('INSERT INTO usage_reconciliations(call_id,previous_status,actual_json,provider_request_id,created_at) VALUES (?,?,?,?,?)')
        .run(callId, 'unknown', JSON.stringify(actual), providerRequestId, new Date().toISOString());
      this.db.prepare("UPDATE usage_ledger SET status='settled',actual_json=?,provider_request_id=?,settled_at=? WHERE call_id=?")
        .run(JSON.stringify(actual), providerRequestId, new Date().toISOString(), callId);
      return { changed: true, overrun };
    }).immediate();
  }

  inspectPool(id: string) {
    const row = this.pool(id);
    return { limits: parseAmounts(row.limits_json), used: parseAmounts(row.used_json), reserved: parseAmounts(row.reserved_json), state: row.state };
  }
  /** Elapsed task time is measured by the host, not billed by providers. */
  chargeActivity(context: InvocationContext, poolIds: string[], milliseconds: number): void {
    z.number().int().nonnegative().parse(milliseconds);
    this.db.transaction(() => {
      for (const pool of this.scopedPools(context, poolIds)) {
        const used = parseAmounts(pool.used_json); used.activeMs += milliseconds;
        const reserved = parseAmounts(pool.reserved_json);
        this.updatePool(pool, used, reserved, !this.unrestricted&&used.activeMs + reserved.activeMs > parseAmounts(pool.limits_json).activeMs);
      }
    }).immediate();
  }

  snapshot(context: InvocationContext, poolIds: string[]): BudgetSnapshot {
    const pools = this.scopedPools(context, poolIds);
    const invocation = pools.find((pool) => pool.id===(context.budgetWindowId ?? context.interactionPoolId))!;
    if(this.unrestricted){
      // Legacy numeric fields remain wire-compatible. The explicit flag, not this
      // representational sentinel, controls enforcement; actual usage is unchanged.
      const unlimited=Object.fromEntries(dimensions.map(key=>[key,Number.MAX_SAFE_INTEGER])) as BudgetAmounts;
      return{unrestricted:true,limits:unlimited,remaining:{...unlimited},used:parseAmounts(invocation.used_json),reserved:parseAmounts(invocation.reserved_json),canSearch:true,canRead:true,canModel:true,blockedBy:[]};
    }
    const remaining = zeroAmounts(); const blockedDimensions = new Map<string, string[]>();
    for (const key of dimensions) {
      remaining[key] = Math.min(...pools.map((pool) => {
        const available = Math.max(0, parseAmounts(pool.limits_json)[key] - parseAmounts(pool.used_json)[key] - parseAmounts(pool.reserved_json)[key]);
        if (available === 0) blockedDimensions.set(pool.id, [...(blockedDimensions.get(pool.id) ?? []), key]);
        return available;
      }));
    }
    const blockedBy = [...blockedDimensions].map(([poolId, exhausted]) => `${poolId}:${exhausted.join(',')}`);
    // Planning and presentation must see the same persistent ceiling as reserve().
    // This is only an upper bound; reserve/send still recheck atomically before billing.
    const campaign=this.campaign.inspect();
    if(campaign){
      remaining.moneyMicros=Math.min(remaining.moneyMicros,campaign.remainingMicros);
      const operations=[['search','searches'],['read','reads'],['model','modelCalls']] as const;
      for(const [operation,dimension] of operations){
        const available=Math.min(campaign.remainingRequests,Math.max(0,campaign.policy.operationLimits[operation]-campaign.operations[operation]));
        remaining[dimension]=Math.min(remaining[dimension],available);
        if(available===0)blockedBy.push(`paid_campaign:${operation}_limit`);
      }
      if(campaign.remainingRequests===0)blockedBy.push('paid_campaign:request_limit');
      if(campaign.remainingMicros===0)blockedBy.push('paid_campaign:money_limit');
      if(campaign.paused){remaining.moneyMicros=0;blockedBy.push('paid_campaign:accounting_paused');}
      if(Date.now()>=Date.parse(campaign.policy.expiresAt)){remaining.moneyMicros=0;blockedBy.push('paid_campaign:expired');}
    }
    const paused = pools.some((pool) => pool.state !== 'active');
    if (paused) blockedBy.push('accounting_paused');
    const mayCall = !paused && remaining.activeMs > 0 && remaining.moneyMicros > 0;
    return { limits: parseAmounts(invocation.limits_json), used: parseAmounts(invocation.used_json), reserved: parseAmounts(invocation.reserved_json), remaining,
      canSearch: mayCall && remaining.searches > 0, canRead: mayCall && remaining.reads > 0,
      canModel: mayCall && remaining.modelCalls > 0 && remaining.inputTokens > 0 && remaining.outputTokens > 0, blockedBy };
  }

  recoverInFlight() {
    const calls = this.db.prepare("SELECT call_id,status FROM usage_ledger WHERE status IN ('reserved','sent')").all() as { call_id: string; status: string }[];
    let released = 0; let unknown = 0;
    for (const call of calls) {
      if (call.status === 'reserved') { this.release(call.call_id); released++; }
      else { this.markUnknown(call.call_id); unknown++; }
    }
    return { released, unknown };
  }
}
