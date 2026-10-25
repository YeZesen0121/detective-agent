// controlled_fixture: synthetic materials and host doubles, never production data.
import { vi } from 'vitest';
import { successFixture } from '../../src/shared/fixtures/index.js';
import { WatchCheckSchema, WatchSchema } from '../../src/shared/contracts.js';
import type { WatchLease, WatchRuntimePort } from '../../src/server/watch/ports.js';
import type { WatchDecision } from '../../src/shared/ports.js';

export const fixtureType = 'controlled_fixture';
export const NOW = '2026-10-24T12:00:00.000Z';
export const ids = {
  session: '00000000-0000-4000-8000-000000000101',
  watch: '00000000-0000-4000-8000-000000000102',
  check: '00000000-0000-4000-8000-000000000103',
  run: '00000000-0000-4000-8000-000000000104',
  budget: '00000000-0000-4000-8000-000000000105',
};

export function makeLease(): WatchLease {
  const before = structuredClone(successFixture);
  return {
    before,
    watch: WatchSchema.parse({
      id: ids.watch, sessionId: ids.session, investigationId: before.investigationId, scopeVersion: 1,
      targetKind: 'page', targetUrls: ['https://controlled.invalid/notice'], focus: '合成测试：报名截止日期',
      baselineVersionId: before.id, frequencySeconds: 3600, expiresAt: '2026-10-25T12:00:00.000Z',
      status: 'active', nextCheckAt: NOW, lastAttemptAt: null, lastSuccessAt: null,
      periodCostLimitMicros: 1_000_000, usedMicros: 0, reservedMicros: 0,
    }),
    check: WatchCheckSchema.parse({
      id: ids.check, watchId: ids.watch, scheduledFor: NOW, trigger: 'scheduled', status: 'running',
      runId: ids.run, beforeVersionId: before.id, afterVersionId: null, changeKey: null,
      reasonSummary: 'controlled_fixture', startedAt: NOW, endedAt: null,
      leaseEpoch: 1, leaseUntil: '2026-10-24T12:03:00.000Z',
    }),
    context: {
      sessionId: ids.session, accessGroup: 'trial', investigationId: before.investigationId, runId: ids.run,
      budgetWindowId: ids.budget, interactionPoolId: null, watchCheckId: ids.check,
      epoch: 1, watchLeaseEpoch: 1, deadlineAt: '2026-10-24T12:02:00.000Z',
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function makePort(lease = makeLease()) {
  return {
    claimDue: vi.fn<WatchRuntimePort['claimDue']>().mockResolvedValue(lease),
    claimManual: vi.fn<WatchRuntimePort['claimManual']>().mockResolvedValue(lease),
    heartbeat: vi.fn<WatchRuntimePort['heartbeat']>().mockResolvedValue(true),
    execute: vi.fn<WatchRuntimePort['execute']>().mockResolvedValue({ candidate: null, readFailures: [] }),
    compare: vi.fn<WatchRuntimePort['compare']>(),
    finish: vi.fn<WatchRuntimePort['finish']>().mockResolvedValue(true),
    fail: vi.fn<WatchRuntimePort['fail']>().mockResolvedValue(undefined),
  } satisfies WatchRuntimePort;
}

export function candidateFor(lease = makeLease(), state: 'A' | 'B' = 'B') {
  const candidate = structuredClone(lease.before.payload);
  candidate.runId = lease.context.runId!;
  candidate.queryTime = NOW;
  candidate.scope.referenceTime = NOW;
  candidate.delta = null;
  const text = state === 'A' ? '合成活动报名截至十月三十日' : '合成活动报名延期至十月三十一日';
  candidate.summary = text;
  candidate.claims[0]!.statement = text;
  candidate.evidence[0]!.excerpt = text;
  candidate.evidence[0]!.contentHash = (state === 'A' ? 'a' : 'b').repeat(64);
  candidate.answerBlocks[0]!.text = text;
  return candidate;
}

export function decisionFor(lease = makeLease(), kind: WatchDecision['kind'] = 'significant'): WatchDecision {
  return {
    kind, reason: 'controlled_fixture：注入比较器，非真实事实核验', factSignature: 'b'.repeat(64),
    changes: kind === 'significant' ? [{
      kind: 'conclusion', description: '合成公告修改截止日期',
      claimIds: [lease.before.payload.claims[0]!.id], evidenceIds: [lease.before.payload.evidence[0]!.id],
    }] : [],
  };
}
