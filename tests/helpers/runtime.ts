import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/server/platform/database.js';
import { RunStore } from '../../src/server/platform/runs.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import { samplePayload } from './result.js';
export const time = '2026-10-24T14:00:00.000Z';
export const later = (seconds: number) => new Date(Date.parse(time) + seconds * 1000).toISOString();
export function runtimeSeed(path=':memory:') {
  const db = openDatabase(path); const owner = randomUUID(); const investigationId = randomUUID(); const windowId = randomUUID();
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(owner, owner, JSON.stringify({ id: owner, tokenHash: 'a'.repeat(64), accessGroup: 'trial', createdAt: time, expiresAt: later(3600), revokedAt: null }));
  db.prepare('INSERT INTO investigations VALUES (?,?,?,?)').run(investigationId, owner, time, JSON.stringify({ id: investigationId, sessionId: owner, originalQuestion: 'controlled_fixture：查询日期', basicMode: 'truth', presentationMode: 'evidence', scope: null, scopeVersion: 0, status: 'draft', attachmentIds: [], activeRunId: null, latestResultVersionId: null, createdAt: time, updatedAt: time }));
  const book = new BudgetBook(db);
  book.createPool({ id: windowId, kind: 'window', sessionId: owner, investigationId, accessGroup: 'trial', limits: { ...zeroAmounts(), activeMs: 420000, searches: 12, reads: 6, modelCalls: 24, inputTokens: 160000, outputTokens: 24000, moneyMicros: 5000000 } });
  const runs = new RunStore(db);
  const queued = runs.enqueue({ sessionId: owner, investigationId, budgetWindowId: windowId, key: 'controlled-start', action: 'start', previousRunId: null, at: time });
  const run = runs.claimNext(time)!;
  const payload = { ...samplePayload(), investigationId, runId: run.id, queryTime: time };
  return { db, book, runs, owner, investigationId, windowId, queued, run, payload };
}
