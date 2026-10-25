import { BudgetSnapshotSchema, RunSchema, type ProgressEvent } from '../../src/shared/contracts.js';
import { providerFailureFixture } from '../../src/shared/fixtures/index.js';

export const fixtureType = 'controlled_fixture';
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const at = '2026-10-24T08:00:00.000Z';
export function run(n = 1) {
  return RunSchema.parse({ ...providerFailureFixture.run, id: id(n), investigationId: id(10), status: 'running', stopReason: null, endedAt: null });
}
const amounts = { activeMs: 420000, searches: 12, reads: 6, modelCalls: 24, inputTokens: 160000, outputTokens: 24000, moneyMicros: 5000000 };
const zero = Object.fromEntries(Object.keys(amounts).map((key) => [key, 0]));
export function runView(n = 1) {
  return {
    run: run(n), remainingBudget: BudgetSnapshotSchema.parse({ limits: amounts, remaining: amounts, used: zero, reserved: zero, canSearch: true, canRead: true, canModel: true, blockedBy: [] }),
    clarification: null, partialMaterialSummary: 'controlled_fixture：已保存部分来源',
  };
}
export function event(seq: number, runId = id(1)): ProgressEvent {
  return { id: id(1000 + seq), investigationId: id(10), runId, seq, at, type: 'source.read', message: `controlled_fixture 来源 ${seq}`, queryId: null, sourceIds: [], visibility: 'public' };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
