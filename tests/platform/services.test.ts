import { afterEach, beforeEach, expect, it } from 'vitest';
import { budgetScenario } from '../helpers/budget-scenario.js';
import { bindResearchServices, type RawResearchProviders, type ResearchPricing } from '../../src/server/platform/services.js';
import { PaidGateway } from '../../src/server/platform/gateway.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
let s: ReturnType<typeof budgetScenario>;
beforeEach(() => { s = budgetScenario(); }); afterEach(() => s.db.close());
const request = { query: 'controlled_fixture', purpose: '核对日期', claimIds: [], site: null, freshness: null, limit: 3 };
const response = { items: [], providerRequestId: 'controlled-id', invalidItemCount: 0, warnings: [], usage: { inputTokens: 0, outputTokens: 0, characters: 0, searches: 1, reads: 0 } };
function services(search: RawResearchProviders['search'], model?: RawResearchProviders['model']) {
  const unavailable = async (): Promise<never> => { throw Error('unused'); };
  const pricing: ResearchPricing = {
    quote: () => ({ provider: 'controlled', purpose: 'controlled', attemptNo: 1, estimated: { ...zeroAmounts(), moneyMicros: 10 }, priceRevision: 'fixture', timeoutMs: 1000 }),
    actual: () => ({ ...zeroAmounts(), searches: 1, moneyMicros: 6 }),
  };
  const gateway = new PaidGateway({ book: s.book, poolIds: () => s.poolIds, assertCurrent: () => {}, concurrency: { search: 1, read: 1, model: 1, tts: 1 } });
  return bindResearchServices({ search, read: unavailable, model: model ?? unavailable }, pricing, gateway, s.context, {
    budget: { snapshot: async () => s.book.snapshot(s.context, s.poolIds) }, checkpoint: { save: unavailable }, events: { append: unavailable }, clock: { now: () => new Date().toISOString() },
  });
}
it('accounts an actual raw-provider call through the shared gateway and rejects forged context before sending', async () => {
  let calls = 0;
  const api = services(async () => { calls++; return response; });
  const result = await api.search(request, s.context, new AbortController().signal);
  expect(result.providerRequestId).toBe('controlled-id');
  expect(s.book.inspectPool('trial')).toMatchObject({ used: { searches: 1, moneyMicros: 6 }, reserved: { moneyMicros: 0 } });
  await expect(api.search(request, { ...s.context, epoch: 2 }, new AbortController().signal)).rejects.toThrow();
  expect(calls).toBe(1);
});
it('retains an unknown reservation when a malformed provider response fails normalization', async () => {
  const api = services(async () => ({ ...response, items: [{ url: 'invalid-url' }] }) as never);
  await expect(api.search(request, s.context, new AbortController().signal)).rejects.toThrow();
  expect(s.book.inspectPool('trial').reserved.moneyMicros).toBe(10);
});
it('rejects underestimated model reservations and image refs before invoking the provider', async () => {
  let sends = 0;
  const api = services(async () => response, async () => { sends++; throw Error('must not send'); });
  await expect(api.model({ purpose: 'plan', promptVersion: 'fixture', schemaId: 'fixture', messages: [{ role: 'user', content: '你好' }], maxOutputTokens: 10 }, s.context, new AbortController().signal)).rejects.toThrow();
  expect(sends).toBe(0); expect(s.book.inspectPool('trial').reserved.moneyMicros).toBe(0);
});
