import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runtimeSeed, later } from '../helpers/runtime.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { ensureRuntimeFunding } from '../../src/server/platform/runtime-funding.js';
import { FollowupStore } from '../../src/server/platform/followup-store.js';
import { SearchQuerySchema } from '../../src/shared/contracts.js';
import { WorkingMaterialSchema } from '../../src/shared/ports.js';

it('controlled_fixture preserves history beyond one 12-search window through explicit grants and followups', () => {
  const s = runtimeSeed();
  try {
    const funds = { ...zeroAmounts(), activeMs: 10000000, searches: 100, reads: 100, modelCalls: 100, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 100000000 };
    ensureRuntimeFunding(s.db, { global: funds, trial: funds, demo: funds });
    const queries = Array.from({ length: 12 }, (_, i) => ({ id: randomUUID(), runId: s.run.id, query: `controlled_fixture 原方向 ${i}`, purpose: '核验原始材料', claimIds: [], site: null, freshness: null, limit: 1, scopeVersion: 1, batchNo: Math.floor(i / 3) + 1, attemptCount: i + 1 }));
    s.runs.setScope(s.run.id, s.run.epoch, s.payload.scope, later(1));
    s.runs.saveCheckpoint(s.run.id, s.run.epoch, { sources: s.payload.sources, evidence: s.payload.evidence, claims: s.payload.claims, queries }, later(1));
    s.runs.commitResult(s.run.id, s.run.epoch, s.payload, 'partial', later(1));
    const nextWindow = randomUUID(); s.book.createPool({ id: nextWindow, kind: 'window', sessionId: s.owner, investigationId: s.investigationId, accessGroup: 'trial', limits: funds });
    const queued = s.runs.enqueue({ sessionId: s.owner, investigationId: s.investigationId, budgetWindowId: nextWindow, key: 'controlled-explicit-grant', action: 'add_budget', previousRunId: s.run.id, at: later(2) });
    const run = s.runs.claimNext(later(2))!; expect(run.id).toBe(queued.id);
    const fresh = { ...queries[0]!, id: randomUUID(), runId: run.id, query: 'controlled_fixture 新方向', attemptCount: 1, batchNo: 1 };
    s.runs.saveCheckpoint(run.id, run.epoch, { queries: [...queries, fresh] }, later(3));
    expect(s.runs.getCheckpoint(run.id, s.owner)!.queries).toHaveLength(13);
    const tagged = s.runs.getCheckpoint(run.id, s.owner)!.queries;
    expect(tagged.slice(0, 12).every(q => q.budgetWindowId === s.windowId)).toBe(true);
    expect(tagged[12]!.budgetWindowId).toBe(nextWindow);
    expect(() => s.runs.saveCheckpoint(run.id, run.epoch, { queries: [{ ...fresh, budgetWindowId: s.windowId }] }, later(3))).toThrow();
    expect(() => s.runs.saveCheckpoint(run.id, run.epoch, { queries: [fresh] }, later(3))).toThrow();
    const baseline = s.runs.getResult(s.runs.get(s.run.id, s.owner)!.createdResultVersionId!, s.owner)!;
    const version = s.runs.commitResult(run.id, run.epoch, { ...s.payload, runId: run.id, queryTime: later(3), delta: { previousVersionId: baseline.id, changes: [], checkedAt: later(3) } }, 'partial', later(3));
    const followups = new FollowupStore(s.db, later(3600));
    followups.enqueue(s.owner, s.investigationId, 'controlled-followup-history', { resultVersionId: version.id, question: '继续核对新证据' }, later(4));
    const job = followups.claim(later(4))!;
    followups.finish(job, { route: 'research_same_scope', answer: null, researchPurpose: '补充缺口', suggestedQuestion: null }, later(4), () => {});
    const followup = followups.job(job.id)!;
    const inherited = s.runs.getCheckpoint(followup.new_run_id!, s.owner)!.queries;
    expect(inherited.map(q => q.id)).toEqual([...queries, fresh].map(q => q.id));
    expect(SearchQuerySchema.safeParse({ ...fresh, attemptCount: 13 }).success).toBe(true);
    expect(SearchQuerySchema.safeParse({ ...fresh, batchNo: 5 }).success).toBe(true);
    expect(WorkingMaterialSchema.safeParse({ sources: [], evidence: [], claims: [], candidates: [], queries: Array.from({ length: 1025 }, () => fresh) }).success).toBe(true);
  } finally { s.db.close(); }
});
