import type Database from 'better-sqlite3';
import { z } from 'zod';
import { TimestampSchema } from '../../shared/contracts.js';
import { ApiFault } from './errors.js';
import { hashValue } from './snapshots.js';
const operations = ['search', 'read', 'model', 'tts'] as const;
export const PaidCampaignPolicySchema = z.strictObject({
  id: z.string().trim().min(1).max(128), moneyMicros: z.number().int().positive().max(100000000), requestLimit: z.number().int().positive().max(2000),
  operationLimits: z.strictObject({ search: z.number().int().min(0).max(2000), read: z.number().int().min(0).max(2000), model: z.number().int().min(0).max(2000), tts: z.number().int().min(0).max(2000) }),
  expiresAt: TimestampSchema,
});
export type PaidCampaignPolicy = z.infer<typeof PaidCampaignPolicySchema>;
type CampaignRow = { policy_json: string; paused: number };
type Call = { operation: string; status: string; estimated_json: string; actual_json: string | null };
const blocked = () => new ApiFault(409, 'BUDGET_EXHAUSTED', '本次联调累计金额、请求次数或期限已到上限，不能发送新请求。');
// This boundary is below every service, including TTS and interaction-only models.
export class PaidCampaign {
  constructor(readonly db: Database.Database, grant?: PaidCampaignPolicy) {
    if (grant) {
      const policy = PaidCampaignPolicySchema.parse(grant);
      db.transaction(() => {
        const row = this.row();
        if (row && hashValue(JSON.parse(row.policy_json)) !== hashValue(policy)) throw new ApiFault(409, 'INVALID_STATE', '联调授权与已保存上限不一致，需要显式审查迁移。');
        if (!row) db.prepare('INSERT INTO paid_campaign(singleton,policy_json) VALUES (1,?)').run(JSON.stringify(policy));
      }).immediate();
    }
  }
  private row() { return this.db.prepare('SELECT policy_json,paused FROM paid_campaign WHERE singleton=1').get() as CampaignRow | undefined; }
  inspect() {
    const row = this.row(); if (!row) return null;
    const policy = PaidCampaignPolicySchema.parse(JSON.parse(row.policy_json));
    const calls = this.db.prepare("SELECT u.operation,u.status,u.estimated_json,u.actual_json FROM usage_ledger u JOIN paid_campaign_calls c ON c.call_id=u.call_id WHERE u.status<>'released'").all() as Call[];
    const counts = { search: 0, read: 0, model: 0, tts: 0 }; let heldMicros = 0, settledMicros = 0, unknownCount = 0, sentCount = 0;
    for (const call of calls) {
      const operation = z.enum(operations).parse(call.operation); counts[operation]++;
      if (call.status !== 'reserved') sentCount++;
      if (call.status === 'unknown') unknownCount++;
      if (call.actual_json !== null && ['settled', 'failed'].includes(call.status)) settledMicros += Number(JSON.parse(call.actual_json).moneyMicros);
      else heldMicros += Number(JSON.parse(call.estimated_json).moneyMicros);
    }
    const allocatedMicros = heldMicros + settledMicros;
    return { id: policy.id, policy, requestCount: calls.length, sentCount, unknownCount, operations: counts, heldMicros, settledMicros, allocatedMicros,
      remainingMicros: Math.max(0, policy.moneyMicros - allocatedMicros), remainingRequests: Math.max(0, policy.requestLimit - calls.length), paused: row.paused === 1 };
  }
  /** BudgetBook calls this inside the same IMMEDIATE transaction as reserve + link. */
  assertReservation(operation: string, moneyMicros: number) {
    const state = this.inspect(); if (!state) return;
    const op = z.enum(operations).parse(operation);
    if (state.paused || Date.now() >= Date.parse(state.policy.expiresAt) || state.requestCount >= state.policy.requestLimit
      || state.operations[op] >= state.policy.operationLimits[op] || moneyMicros > state.remainingMicros) throw blocked();
  }
  link(callId: string) { if (this.row()) this.db.prepare('INSERT INTO paid_campaign_calls(call_id) VALUES (?)').run(callId); }
  assertSend(callId: string) {
    if (!this.db.prepare('SELECT 1 FROM paid_campaign_calls WHERE call_id=?').get(callId)) return;
    const state = this.inspect()!;
    if (state.paused || Date.now() >= Date.parse(state.policy.expiresAt) || state.allocatedMicros > state.policy.moneyMicros || state.requestCount > state.policy.requestLimit) throw blocked();
  }
  pauseOverrun(callId: string) {
    if (this.db.prepare('SELECT 1 FROM paid_campaign_calls WHERE call_id=?').get(callId)) this.db.prepare('UPDATE paid_campaign SET paused=1 WHERE singleton=1').run();
  }
}
