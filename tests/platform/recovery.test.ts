import { expect, it } from 'vitest';
import { InvestigationHost, type InvestigationRuntimeOptions } from '../../src/server/platform/host.js';
import { runtimeSeed, later } from '../helpers/runtime.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { randomUUID } from 'node:crypto';
const funding = { ...zeroAmounts(), activeMs: 10000000, searches: 100, reads: 100, modelCalls: 100, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 50000000 };
function options(): InvestigationRuntimeOptions {
  const unavailable = async (): Promise<never> => { throw Error('no network'); };
  return {
    module: { prepareInvestigation: unavailable, runInvestigation: unavailable, routeFollowup: unavailable, compareWatchResult: unavailable },
    providers: { search: unavailable, model: unavailable, read: unavailable },
    funding: { global: funding, trial: funding, demo: funding },
    pricing: { quote: () => ({ provider: 'controlled_fixture', purpose: 'controlled', attemptNo: 1, timeoutMs: 1000, priceRevision: 'fixture', estimated: { ...zeroAmounts(), moneyMicros: 10 } }), actual: () => null },
  };
}
it('recovers a running task once, meters downtime conservatively and does not replay unknown calls', async () => {
  const s = runtimeSeed(); const config = options(); let sends = 0;
  config.providers.search = async () => { sends++; throw Error('must not replay'); };
  const host = new InvestigationHost(s.db, { ...config, now: () => later(10), serviceEndsAt: later(3600) });
  const ctx = { sessionId: s.owner, accessGroup: 'trial' as const, investigationId: s.investigationId, runId: s.run.id, budgetWindowId: s.windowId, interactionPoolId: null, watchCheckId: null, epoch: s.run.epoch, watchLeaseEpoch: null, deadlineAt: later(420) };
  const sent = randomUUID(), reserved = randomUUID();
  for (const callId of [sent, reserved]) s.book.reserve(ctx, ['runtime:global', 'runtime:trial', s.windowId], { callId, provider: 'controlled', operation: 'search', purpose: 'controlled', attemptNo: 1, estimated: { ...zeroAmounts(), searches: 1, moneyMicros: 10 } });
  s.book.markSent(sent);
  await host.recover(); await host.recover();
  expect(s.runs.get(s.run.id, s.owner)).toMatchObject({ status: 'interrupted', activeMs: 10000 });
  expect(s.book.inspectPool(s.windowId).used.activeMs).toBe(10000);
  expect(s.book.inspectCall(sent).status).toBe('unknown');
  expect(s.book.inspectCall(reserved).status).toBe('released');
  expect(sends).toBe(0);
  await host.close(); s.db.close();
});
it('marks work interrupted before graceful shutdown aborts its worker', async () => {
  const s = runtimeSeed(); const config = options();
  let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  config.module.prepareInvestigation = async (_input, _services, signal) => {
    entered();
    await new Promise<void>(r => signal.addEventListener('abort', () => r(), { once: true }));
    throw Error('aborted for shutdown');
  };
  const host = new InvestigationHost(s.db, { ...config, now: () => later(10), serviceEndsAt: later(3600) });
  await host.recover();
  const run = await host.start(s.owner, s.investigationId, 'resume-for-shutdown', { action: 'resume', previousRunId: s.run.id });
  await started; await host.close();
  expect(s.runs.get(run.id, s.owner)?.status).toBe('interrupted');
  s.db.close();
});
