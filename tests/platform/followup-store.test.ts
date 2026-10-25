import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runtimeSeed, later } from '../helpers/runtime.js';
import { FollowupStore, interactionPools } from '../../src/server/platform/followup-store.js';
import { ensureRuntimeFunding } from '../../src/server/platform/runtime-funding.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
const closers: Array<() => void> = []; afterEach(() => { for (const close of closers.splice(0)) close(); });
it('controlled_fixture unrestricted followup still owns its original job after the previous two-minute deadline',()=>{
 const s=seed();new BudgetBook(s.db,undefined,{unrestricted:true});
 s.store.enqueue(s.owner,s.investigationId,'controlled-unrestricted-followup',{resultVersionId:s.version.id,question:'controlled_fixture 解释已有证据'},later(2));
 const job=s.store.claim(later(3))!,ctx=s.store.context(job,later(3));
 expect(()=>s.store.assertContext(ctx,later(603))).not.toThrow();
 expect(s.store.researchBudget(job,later(603))).toMatchObject({unrestricted:true,canSearch:true,canModel:true});
 expect(s.book.inspectPool(job.pool_id).used.activeMs).toBe(600000);
});
function seed() {
  const s = runtimeSeed(); closers.push(() => s.db.close());
  const funds = { ...zeroAmounts(), activeMs: 10000000, searches: 100, reads: 100, modelCalls: 100, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 100000000 };
  ensureRuntimeFunding(s.db, { global: funds, trial: funds, demo: funds });
  s.runs.setScope(s.run.id, s.run.epoch, s.payload.scope, later(1));
  s.runs.saveCheckpoint(s.run.id, s.run.epoch, { sources: s.payload.sources, evidence: s.payload.evidence, claims: s.payload.claims }, later(1));
  const version = s.runs.commitResult(s.run.id, s.run.epoch, s.payload, 'completed', later(1));
  const store = new FollowupStore(s.db, later(3600));
  return { ...s, store, version };
}
it('controlled_fixture followups share the companion interaction pool and never claim both workers on one epoch', () => {
  const s = seed(); const followup = s.store.enqueue(s.owner, s.investigationId, 'controlled-followup', { resultVersionId: s.version.id, question: '解释已有证据' }, later(2));
  const companion = s.store.experience.createCompanion(s.owner, s.version.id, 'controlled-companion', later(2));
  const experience = s.store.experience.claim(later(3))!; expect(experience.companionId).toBe(companion.id); expect(s.store.claim(later(3))).toBeNull();
  s.store.experience.fail(experience.id, experience.epoch, 'controlled_fixture', later(4));
  const job = s.store.claim(later(4))!, ctx = s.store.context(job, later(4)); expect(job.id).toBe(followup.id);
  expect(ctx.interactionPoolId).toBe(s.store.experience.context(experience.id, later(4)).interactionPoolId);
  s.store.experience.createCompanion(s.owner, s.version.id, 'controlled-companion-retry', later(5)); expect(s.store.experience.claim(later(5))).toBeNull();
  const callId = randomUUID(); s.book.reserve(ctx, interactionPools(ctx), { callId, provider: 'controlled_fixture', operation: 'model', purpose: 'followup', attemptNo: 1, priceRevision: 'fixture-v1', estimated: { ...zeroAmounts(), modelCalls: 1, inputTokens: 100, outputTokens: 20, moneyMicros: 10 } }); s.book.markSent(callId); s.book.markUnknown(callId);
  s.store.recover(later(360)); s.book.recoverInFlight();
  expect(s.book.inspectCall(callId).status).toBe('unknown'); expect(s.book.inspectPool(job.pool_id).reserved.moneyMicros).toBe(10);
  expect(s.book.inspectPool(job.pool_id).used.activeMs).toBe(121000); // one second companion + two minute followup cap
  expect(s.store.view(job.id, s.owner).error?.code).toBe('SERVER_RESTART'); expect(s.store.claim(later(361))).toBeNull();
  expect(() => s.store.assertContext(ctx, later(361))).toThrow(); expect(s.store.enqueue(s.owner, s.investigationId, 'controlled-followup', { resultVersionId: s.version.id, question: '解释已有证据' }, later(361)).id).toBe(job.id);
});
it('controlled_fixture rejects a changed deadline/context and never refunds a sent interaction on recovery', () => {
  const s = seed(); s.store.enqueue(s.owner, s.investigationId, 'controlled-followup', { resultVersionId: s.version.id, question: '解释已有证据' }, later(2));
  const job = s.store.claim(later(3))!, ctx = s.store.context(job, later(3));
  expect(() => s.store.assertContext({ ...ctx, deadlineAt: later(1000) }, later(3))).toThrow();
  expect(() => s.store.assertContext({ ...ctx, epoch: ctx.epoch + 1 }, later(3))).toThrow();
  s.store.assertContext(ctx, later(5)); s.store.assertContext(ctx, later(5)); expect(s.book.inspectPool(job.pool_id).used.activeMs).toBe(2000);
  s.store.recover(later(6)); s.store.recover(later(100)); expect(s.book.inspectPool(job.pool_id).used.activeMs).toBe(3000);
});
