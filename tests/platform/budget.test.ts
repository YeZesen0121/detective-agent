import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/platform/database.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import { BudgetSnapshotSchema, type InvocationContext } from '../../src/shared/contracts.js';

let db: ReturnType<typeof openDatabase>;
let book: BudgetBook;
let context: InvocationContext;
let poolIds: string[];
const limits = (moneyMicros: number) => ({ activeMs: 420000, searches: 12, reads: 6, modelCalls: 24, inputTokens: 160000, outputTokens: 24000, moneyMicros });
const reservation = (moneyMicros = 10) => ({ callId: randomUUID(), provider: 'controlled', operation: 'search', purpose: '核对公开材料', attemptNo: 1, estimated: { ...zeroAmounts(), searches: 1, moneyMicros } });

beforeEach(() => {
  db = openDatabase(':memory:'); book = new BudgetBook(db);
  context = { sessionId: randomUUID(), accessGroup: 'trial', investigationId: randomUUID(), runId: randomUUID(),
    budgetWindowId: randomUUID(), interactionPoolId: null, watchCheckId: null, epoch: 1, watchLeaseEpoch: null, deadlineAt: '2026-10-25T00:00:00.000Z' };
  poolIds = ['global', 'trial', context.budgetWindowId!];
  book.createPool({ id: 'global', kind: 'global', accessGroup: null, sessionId: null, investigationId: null, limits: limits(100) });
  book.createPool({ id: 'trial', kind: 'access_group', accessGroup: 'trial', sessionId: null, investigationId: null, limits: limits(20) });
  book.createPool({ id: context.budgetWindowId!, kind: 'window', accessGroup: 'trial', sessionId: context.sessionId, investigationId: context.investigationId, limits: limits(20) });
});
afterEach(() => db.close());

it('does not let two in-flight reservations each spend the same remaining balance', () => {
  book.reserve(context, poolIds, reservation(15));
  expect(() => book.reserve(context, poolIds, reservation(15))).toThrow();
});
it('reserves all layers, not just the individual window', () => {
  book.reserve(context, poolIds, reservation(15));
  expect(book.inspectPool('global').reserved.moneyMicros).toBe(15);
  expect(book.inspectPool('trial').reserved.moneyMicros).toBe(15);
});
it('cannot charge a demo pool from a trial context', () => {
  book.createPool({ id: 'demo', kind: 'access_group', accessGroup: 'demo', sessionId: null, investigationId: null, limits: limits(100) });
  expect(() => book.reserve(context, ['global', 'demo', context.budgetWindowId!], reservation())).toThrow();
});
it('requires global, access-group and invocation pools; duplicate pool IDs cannot bypass accounting', () => {
  expect(() => book.reserve(context, [context.budgetWindowId!], reservation())).toThrow();
  expect(() => book.reserve(context, ['global', 'trial', 'trial', context.budgetWindowId!], reservation())).toThrow();
});
it('rejects a reservation owned by another browser session', () => {
  expect(() => book.reserve({ ...context, sessionId: randomUUID() }, poolIds, reservation())).toThrow();
});
it('settles exactly once and retains the actual cost', () => {
  const call = reservation(15); book.reserve(context, poolIds, call); book.markSent(call.callId);
  expect(book.settle(call.callId, { ...zeroAmounts(), searches: 1, moneyMicros: 7 }).changed).toBe(true);
  expect(book.settle(call.callId, { ...zeroAmounts(), searches: 1, moneyMicros: 7 }).changed).toBe(false);
  expect(book.inspectPool('trial').used.moneyMicros).toBe(7);
  expect(book.inspectPool('trial').reserved.moneyMicros).toBe(0);
});
it('retains unknown calls and does not refund sent/unknown costs on cancellation', () => {
  const call = reservation(15); book.reserve(context, poolIds, call); book.markSent(call.callId); book.markUnknown(call.callId);
  expect(() => book.release(call.callId)).toThrow();
  expect(book.inspectPool('trial').reserved.moneyMicros).toBe(15);
  expect(() => book.reserve(context, poolIds, reservation(10))).toThrow();
});
it('releases an unsent reservation without consuming a call attempt', () => {
  const call = reservation(15); book.reserve(context, poolIds, call); book.release(call.callId);
  expect(book.inspectPool('trial').reserved.moneyMicros).toBe(0);
  expect(book.inspectPool('trial').used.searches).toBe(0);
  expect(() => book.reserve(context, poolIds, reservation(15))).not.toThrow();
});
it('counts a sent attempt even if the supplied settlement omits its attempt count', () => {
  const call = reservation(); book.reserve(context, poolIds, call); book.markSent(call.callId);
  book.settle(call.callId, zeroAmounts());
  expect(book.inspectPool('trial').used.searches).toBe(1);
});
it('records an overrun honestly and pauses the affected pools instead of clipping the bill', () => {
  const call = reservation(5); book.reserve(context, poolIds, call); book.markSent(call.callId);
  expect(book.settle(call.callId, { ...zeroAmounts(), searches: 1, moneyMicros: 25 }).overrun).toBe(true);
  expect(book.inspectPool('trial').used.moneyMicros).toBe(25);
  expect(book.inspectPool('trial').state).toBe('paused');
  expect(() => book.reserve(context, poolIds, reservation(1))).toThrow();
});
it('keeps a fully exhausted three-layer snapshot inside the public contract', () => {
  const windowId = randomUUID(); const empty = zeroAmounts();
  book.createPool({ id: 'global-disabled', kind: 'global', accessGroup: null, sessionId: null, investigationId: null, limits: empty });
  book.createPool({ id: 'trial-disabled', kind: 'access_group', accessGroup: 'trial', sessionId: null, investigationId: null, limits: empty });
  book.createPool({ id: windowId, kind: 'window', accessGroup: 'trial', sessionId: context.sessionId, investigationId: context.investigationId, limits: empty });
  const snapshot = book.snapshot({ ...context, budgetWindowId: windowId }, ['global-disabled', 'trial-disabled', windowId]);
  expect(snapshot.canSearch).toBe(false); expect(snapshot.canRead).toBe(false); expect(snapshot.canModel).toBe(false);
  expect(BudgetSnapshotSchema.safeParse(snapshot).success).toBe(true);
});
it('keeps a fully reserved three-layer snapshot inside the same public contract', () => {
  const windowId = randomUUID();
  const one = { activeMs: 1, searches: 1, reads: 1, modelCalls: 1, inputTokens: 1, outputTokens: 1, moneyMicros: 1 };
  book.createPool({ id: 'global-full', kind: 'global', accessGroup: null, sessionId: null, investigationId: null, limits: one });
  book.createPool({ id: 'trial-full', kind: 'access_group', accessGroup: 'trial', sessionId: null, investigationId: null, limits: one });
  book.createPool({ id: windowId, kind: 'window', accessGroup: 'trial', sessionId: context.sessionId, investigationId: context.investigationId, limits: one });
  const scoped = { ...context, budgetWindowId: windowId }; const ids = ['global-full', 'trial-full', windowId];
  book.reserve(scoped, ids, { ...reservation(1), estimated: one });
  const snapshot = book.snapshot(scoped, ids);
  expect(snapshot.canSearch).toBe(false); expect(snapshot.canRead).toBe(false); expect(snapshot.canModel).toBe(false);
  expect(BudgetSnapshotSchema.safeParse(snapshot).success).toBe(true);
});
