import { afterEach, beforeEach, expect, it } from 'vitest';
import { PaidGateway, type CallSpec } from '../../src/server/platform/gateway.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { budgetScenario } from '../helpers/budget-scenario.js';

let scenario: ReturnType<typeof budgetScenario>;
let validEpoch = 1;
let gateway: PaidGateway;
const spec: CallSpec = { provider: 'controlled', operation: 'search', purpose: '核验公开日期', attemptNo: 1,
  estimated: { ...zeroAmounts(), searches: 1, moneyMicros: 10 }, priceRevision: 'controlled-v1', timeoutMs: 1000 };
beforeEach(() => {
  scenario = budgetScenario(); validEpoch = 1;
  gateway = new PaidGateway({ book: scenario.book, poolIds: () => scenario.poolIds,
    assertCurrent: (context) => { if (context.epoch !== validEpoch) throw new Error('Stale epoch'); },
    concurrency: { search: 1, read: 1, model: 1, tts: 1 } });
});
afterEach(() => scenario.db.close());

it('blocks a paid send when pricing is unknown', async () => {
  let sends = 0;
  await expect(gateway.invoke(scenario.context, { ...spec, priceRevision: null }, async () => { sends++; return { value: 'bad', actual: zeroAmounts() }; }, new AbortController().signal)).rejects.toThrow();
  expect(sends).toBe(0);
});
it('blocks a stale worker before its network send', async () => {
  let sends = 0; validEpoch = 2;
  await expect(gateway.invoke(scenario.context, spec, async () => { sends++; return { value: 'bad', actual: zeroAmounts() }; }, new AbortController().signal)).rejects.toThrow();
  expect(sends).toBe(0);
});
it('settles known usage and returns a bounded successful result', async () => {
  const result = await gateway.invoke(scenario.context, spec, async () => ({ value: 'actual-result', actual: { ...zeroAmounts(), searches: 1, moneyMicros: 6 } }), new AbortController().signal);
  expect(result.value).toBe('actual-result'); expect(result.accounting).toBe('settled');
  expect(scenario.book.inspectPool('trial').used.moneyMicros).toBe(6);
  expect(scenario.book.inspectCall(result.callId).status).toBe('settled');
});
it('rejects an exhausted reservation without calling the provider', async () => {
  scenario.book.reserve(scenario.context, scenario.poolIds, scenario.reservation(20));
  let sends = 0;
  await expect(gateway.invoke(scenario.context, spec, async () => { sends++; return { value: 'bad', actual: zeroAmounts() }; }, new AbortController().signal)).rejects.toThrow();
  expect(sends).toBe(0);
});
it('rejects an already-aborted call without reserving or sending', async () => {
  const abort = new AbortController(); abort.abort(); let sends = 0;
  await expect(gateway.invoke(scenario.context, spec, async () => { sends++; return { value: 'bad', actual: zeroAmounts() }; }, abort.signal)).rejects.toThrow();
  expect(sends).toBe(0); expect(scenario.book.inspectPool('trial').reserved.moneyMicros).toBe(0);
});
it('accounts a late response after cancellation without delivering the old worker result', async () => {
  let resolve!: (value: { value: string; actual: ReturnType<typeof zeroAmounts> }) => void;
  const response = new Promise<{ value: string; actual: ReturnType<typeof zeroAmounts> }>((done) => { resolve = done; });
  const abort = new AbortController();
  const pending = gateway.invoke(scenario.context, spec, () => response, abort.signal);
  validEpoch = 2; abort.abort();
  await expect(pending).rejects.toThrow();
  expect(scenario.book.inspectPool('trial').reserved.moneyMicros).toBe(10);
  resolve({ value: 'late-not-delivered', actual: { ...zeroAmounts(), searches: 1, moneyMicros: 7 } });
  await new Promise((done) => setImmediate(done));
  expect(scenario.book.inspectPool('trial').used.moneyMicros).toBe(7);
  expect(scenario.book.inspectPool('trial').reserved.moneyMicros).toBe(0);
});
it('holds unknown costs after provider failure and never retries implicitly', async () => {
  let sends = 0;
  await expect(gateway.invoke(scenario.context, spec, async () => { sends++; throw new Error('controlled network failure'); }, new AbortController().signal)).rejects.toThrow();
  expect(sends).toBe(1); expect(scenario.book.inspectPool('trial').reserved.moneyMicros).toBe(10);
});
it('enforces physical provider concurrency and times out even when send ignores abort', async () => {
  let finish!: (value: { value: string; actual: null }) => void;
  const response = new Promise<{ value: string; actual: null }>((done) => { finish = done; });
  const pending = gateway.invoke(scenario.context, { ...spec, timeoutMs: 25 }, () => response, new AbortController().signal);
  let secondSends = 0;
  await expect(gateway.invoke(scenario.context, spec, async () => { secondSends++; return { value: 'bad', actual: null }; }, new AbortController().signal)).rejects.toThrow();
  expect(secondSends).toBe(0);
  await expect(pending).rejects.toThrow();
  expect(scenario.book.inspectPool('trial').reserved.moneyMicros).toBe(10);
  finish({ value: 'late', actual: null });
  await new Promise((done) => setImmediate(done));
});
it('counts a search attempt even when its caller omitted that reservation counter', async () => {
  await gateway.invoke(scenario.context, { ...spec, estimated: { ...zeroAmounts(), moneyMicros: 10 } }, async () => ({ value: 'ok', actual: zeroAmounts() }), new AbortController().signal);
  expect(scenario.book.inspectPool('trial').used.searches).toBe(1);
});
it('does not send model input without bounded input/output token reservations', async () => {
  let sends = 0;
  await expect(gateway.invoke(scenario.context, { ...spec, operation: 'model', estimated: { ...zeroAmounts(), modelCalls: 1, moneyMicros: 10 } }, async () => { sends++; return { value: 'bad', actual: zeroAmounts() }; }, new AbortController().signal)).rejects.toThrow();
  expect(sends).toBe(0);
});

it('keeps the database settlement lifetime open until a cancelled physical send has ended', async () => {
  let finish!: (value: { value: string; actual: ReturnType<typeof zeroAmounts> }) => void;
  const response = new Promise<{ value: string; actual: ReturnType<typeof zeroAmounts> }>(r => { finish = r; });
  const abort = new AbortController();
  const pending = gateway.invoke(scenario.context, spec, () => response, abort.signal);
  abort.abort(); await expect(pending).rejects.toThrow();
  let drained = false;
  const waiting = gateway.drain().then(() => { drained = true; });
  await new Promise<void>(r => setImmediate(r));
  expect(drained).toBe(false);
  finish({ value: 'late', actual: { ...zeroAmounts(), searches: 1, moneyMicros: 7 } });
  await waiting;
  expect(scenario.book.inspectPool('trial').used.moneyMicros).toBe(7);
});
