import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/server/platform/database.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import type { InvocationContext } from '../../src/shared/contracts.js';

export function budgetScenario(path = ':memory:') {
  const db = openDatabase(path); const book = new BudgetBook(db);
  const context: InvocationContext = {
    sessionId: randomUUID(), accessGroup: 'trial', investigationId: randomUUID(), runId: randomUUID(), budgetWindowId: randomUUID(),
    interactionPoolId: null, watchCheckId: null, epoch: 1, watchLeaseEpoch: null, deadlineAt: new Date(Date.now() + 60000).toISOString(),
  };
  const limits = { activeMs: 420000, searches: 12, reads: 6, modelCalls: 24, inputTokens: 160000, outputTokens: 24000, moneyMicros: 20 };
  book.createPool({ id: 'global', kind: 'global', accessGroup: null, sessionId: null, investigationId: null, limits: { ...limits, moneyMicros: 100 } });
  book.createPool({ id: 'trial', kind: 'access_group', accessGroup: 'trial', sessionId: null, investigationId: null, limits });
  book.createPool({ id: context.budgetWindowId!, kind: 'window', accessGroup: 'trial', sessionId: context.sessionId, investigationId: context.investigationId, limits });
  return { db, book, context, poolIds: ['global', 'trial', context.budgetWindowId!],
    reservation: (moneyMicros = 10) => ({ callId: randomUUID(), provider: 'controlled', operation: 'search', purpose: '核对公开资料', attemptNo: 1, estimated: { ...zeroAmounts(), searches: 1, moneyMicros } }),
  };
}
