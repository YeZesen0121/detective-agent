// controlled_fixture: strict in-memory host contract, NOT SQLite atomicity tests.
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createWatchScheduler } from '../../src/server/watch/index.js';
import { updatedVersionFixture } from '../../src/shared/fixtures/index.js';
import type { ResultVersion } from '../../src/shared/contracts.js';
import type { WatchFinish, WatchLease } from '../../src/server/watch/ports.js';
import { candidateFor, decisionFor, deferred, makeLease, makePort, NOW } from './fixtures.js';

function controlledHost() {
  const initial = makeLease();
  const port = makePort(initial);
  const snapshots = [structuredClone(initial.before)];
  const companion = structuredClone(updatedVersionFixture.oldCompanion);
  const notifications: Array<{ previousVersionId: string; targetResultVersionId: string; changeKey: string }> = [];
  const records: WatchFinish[] = [];
  let latest = initial.before;
  let epoch = 1;
  let scopeVersion = 1;
  let active = true;
  let state: 'A' | 'B' = 'A';
  let nextState: 'A' | 'B' = 'B';
  let lastSuccessAt: string | null = null;

  port.claimDue.mockImplementation(async () => {
    if (!active) return null;
    const lease = makeLease();
    lease.before = structuredClone(latest);
    lease.watch.baselineVersionId = latest.id;
    lease.watch.scopeVersion = scopeVersion;
    lease.context.runId = randomUUID();
    lease.check.runId = lease.context.runId;
    lease.check.id = randomUUID();
    lease.context.watchCheckId = lease.check.id;
    lease.check.beforeVersionId = latest.id;
    lease.check.leaseEpoch = epoch;
    lease.context.watchLeaseEpoch = epoch;
    return lease;
  });
  port.execute.mockImplementation(async (lease) => ({ candidate: candidateFor(lease, nextState), readFailures: [] }));
  port.compare.mockImplementation(async () => {
    const decision = decisionFor(initial, nextState === state ? 'unchanged' : 'significant');
    decision.factSignature = (nextState === 'A' ? 'a' : 'b').repeat(64);
    return decision;
  });
  port.finish.mockImplementation(async (lease: WatchLease, result: WatchFinish) => {
    // P must implement this CAS transaction. This double accepts only the exact claimed identity.
    if (!active || lease.check.leaseEpoch !== epoch || lease.watch.scopeVersion !== scopeVersion
      || lease.before.id !== latest.id || lease.watch.baselineVersionId !== latest.id
      || lease.check.beforeVersionId !== latest.id) return false;
    records.push(structuredClone(result));
    if (result.kind === 'unknown') return true;
    lastSuccessAt = NOW;
    if (result.kind === 'unchanged') return true;
    if (!result.candidate || result.decision?.kind !== 'significant') throw new Error('Invalid changed finish');
    const key = `${state}->${nextState}:${lease.watch.focus.trim()}`;
    if (notifications.some((item) => item.changeKey === key)) return false;
    const payload = structuredClone(result.candidate);
    payload.delta = { previousVersionId: latest.id, changes: result.decision.changes, checkedAt: NOW };
    const version: ResultVersion = {
      id: randomUUID(), investigationId: latest.investigationId, runId: payload.runId,
      previousVersionId: latest.id, createdAt: NOW,
      payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), payload,
    };
    snapshots.push(version);
    notifications.push({ previousVersionId: latest.id, targetResultVersionId: version.id, changeKey: key });
    latest = version; state = nextState;
    return true;
  });
  return {
    port, snapshots, companion, notifications, records,
    scheduler: createWatchScheduler(port, { now: () => NOW }),
    setNext: (value: 'A' | 'B') => { nextState = value; },
    successAt: () => lastSuccessAt,
    invalidate: (kind: 'pause' | 'delete' | 'scope' | 'followup') => {
      if (kind === 'pause' || kind === 'delete') { active = false; epoch++; }
      if (kind === 'scope') scopeVersion++;
      if (kind === 'followup') latest = { ...structuredClone(latest), id: randomUUID() };
    },
  };
}

describe('watch versions through controlled_fixture host', () => {
  it('forwards A→B→A checks without a local new-hash cache suppressing the return to A', async () => {
    const host = controlledHost();
    const oldReport = JSON.stringify(host.snapshots[0]);
    const oldCompanion = JSON.stringify(host.companion);
    await host.scheduler.tick(); // A→B
    await host.scheduler.tick(); // B→B
    host.setNext('A');
    await host.scheduler.tick(); // B→A
    expect(host.port.execute).toHaveBeenCalledTimes(3);
    expect(host.port.compare).toHaveBeenCalledTimes(3);
    expect(host.records.map((record) => record.kind)).toEqual(['changed', 'unchanged', 'changed']);
    expect(host.notifications).toHaveLength(2);
    expect(host.notifications[0]!.previousVersionId).toBe(host.snapshots[0]!.id);
    expect(host.notifications[0]!.targetResultVersionId).toBe(host.snapshots[1]!.id);
    expect(host.notifications[1]!.previousVersionId).toBe(host.snapshots[1]!.id);
    expect(host.notifications[1]!.targetResultVersionId).toBe(host.snapshots[2]!.id);
    expect(host.snapshots[2]!.payload.delta?.previousVersionId).toBe(host.snapshots[1]!.id);
    expect(JSON.stringify(host.snapshots[0])).toBe(oldReport);
    expect(JSON.stringify(host.companion)).toBe(oldCompanion);
  });

  it.each(['pause', 'delete', 'scope', 'followup'] as const)(
    'does not retry a late finish rejected after %s', async (reason) => {
      const host = controlledHost();
      const output = deferred<ReturnType<typeof decisionFor>>();
      host.port.compare.mockReturnValueOnce(output.promise);
      const work = host.scheduler.tick();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      host.invalidate(reason);
      output.resolve(decisionFor());
      await work;
      expect(host.port.finish).toHaveBeenCalledTimes(1);
      expect(host.port.fail).not.toHaveBeenCalled();
      expect(host.records).toHaveLength(0);
      expect(host.notifications).toHaveLength(0);
      expect(host.snapshots).toHaveLength(1);
    },
  );

  it('a repeated stale lease produces only one accepted change, without retrying the rejected commit', async () => {
    const host = controlledHost();
    const lease = (await host.port.claimDue(NOW))!;
    host.port.claimDue.mockResolvedValue(lease);
    await host.scheduler.tick();
    await host.scheduler.tick();
    expect(host.port.execute).toHaveBeenCalledTimes(2);
    expect(host.port.finish).toHaveBeenCalledTimes(2);
    expect(host.notifications).toHaveLength(1);
    expect(host.port.fail).not.toHaveBeenCalled();
  });

  it('unknown does not advance the baseline or success time; unchanged updates success without notification', async () => {
    const host = controlledHost();
    host.port.compare.mockResolvedValueOnce(decisionFor(makeLease(), 'unknown'));
    await host.scheduler.tick();
    expect(host.records[0]!.kind).toBe('unknown');
    expect(host.snapshots).toHaveLength(1);
    expect(host.successAt()).toBeNull();
    host.setNext('A');
    await host.scheduler.tick();
    expect(host.records[1]!.kind).toBe('unchanged');
    expect(host.successAt()).toBe(NOW);
    expect(host.snapshots).toHaveLength(1);
    expect(host.notifications).toHaveLength(0);
  });
});
