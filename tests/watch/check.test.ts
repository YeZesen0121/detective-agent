import { describe, expect, it } from 'vitest';
import { executeWatchCheck } from '../../src/server/watch/check.js';
import { createWatchScheduler } from '../../src/server/watch/scheduler.js';
import { candidateFor, decisionFor, deferred, ids, makeLease, makePort, NOW } from './fixtures.js';

describe('watch checks (controlled_fixture, injected I comparison)', () => {
  const signal = () => new AbortController().signal;

  it('executes before comparing with the leased baseline, context, focus and failures', async () => {
    const lease = makeLease();
    const port = makePort(lease);
    const candidate = candidateFor(lease);
    port.execute.mockResolvedValue({ candidate, readFailures: [] });
    port.compare.mockResolvedValue(decisionFor(lease));
    const result = await executeWatchCheck(port, lease, signal());
    expect(port.execute.mock.invocationCallOrder[0]).toBeLessThan(port.compare.mock.invocationCallOrder[0]!);
    expect(port.compare).toHaveBeenCalledWith({
      context: lease.context, before: lease.before, candidate, focus: lease.watch.focus, readFailures: [],
    }, expect.any(AbortSignal));
    expect(result.kind).toBe('changed');
    expect(result.decision?.changes[0]!.evidenceIds).toEqual([lease.before.payload.evidence[0]!.id]);
  });

  it('returns unknown without comparing when no candidate was produced', async () => {
    const port = makePort();
    const result = await executeWatchCheck(port, makeLease(), signal());
    expect(result).toEqual({ kind: 'unknown', candidate: null, decision: null, reason: 'WATCH_NO_CANDIDATE' });
    expect(port.compare).not.toHaveBeenCalled();
  });

  it.each(['unchanged', 'significant'] as const)('keeps a failed read unknown despite a %s decision', async (kind) => {
    const lease = makeLease();
    const port = makePort(lease);
    const failures = [{ sourceId: lease.before.payload.sources[0]!.id, errorCode: 'READ_TIMEOUT' }];
    port.execute.mockResolvedValue({ candidate: candidateFor(lease), readFailures: failures });
    port.compare.mockResolvedValue(decisionFor(lease, kind));
    const result = await executeWatchCheck(port, lease, signal());
    expect(port.compare.mock.calls[0]![0].readFailures).toEqual(failures);
    expect(result).toMatchObject({ kind: 'unknown', candidate: null, reason: 'WATCH_READ_FAILED' });
  });

  it.each(['provider_error', 'invalid_output', 'cancelled', 'server_restart'] as const)(
    'does not treat a %s partial candidate as successful comparison', async (stopReason) => {
      const lease = makeLease();
      const port = makePort(lease);
      const candidate = candidateFor(lease);
      candidate.stopReason = stopReason;
      port.execute.mockResolvedValue({ candidate, readFailures: [] });
      port.compare.mockResolvedValue(decisionFor(lease, 'unchanged'));
      const result = await executeWatchCheck(port, lease, signal());
      expect(result.kind).toBe('unknown');
      expect(result.candidate).toBeNull();
      expect(port.compare).not.toHaveBeenCalled();
    },
  );

  it.each(['page_footer', 'open_ranking', 'open_reprint', 'open_new_announcement'] as const)(
    'defers the factual decision for %s to I rather than comparing whole-text hashes', async (scenario) => {
      const lease = makeLease();
      if (scenario.startsWith('open')) { lease.watch.targetKind = 'open_question'; lease.watch.targetUrls = []; }
      const port = makePort(lease);
      const candidate = candidateFor(lease, scenario === 'open_new_announcement' ? 'B' : 'A');
      candidate.sources[0]!.contentHash = 'f'.repeat(64); // all scenarios change raw content
      candidate.sources[0]!.diagnostic = `controlled_fixture:${scenario}`;
      if (scenario === 'page_footer') candidate.sources[0]!.snippet = 'controlled_fixture：页脚更新时间变化，报名日期不变';
      if (scenario === 'open_ranking' || scenario === 'open_reprint') {
        const reprint = structuredClone(candidate.sources[0]!);
        reprint.id = ids.watch;
        reprint.url = reprint.canonicalUrl = 'https://controlled.invalid/reprint';
        reprint.originGroup = candidate.sources[0]!.originGroup = 'controlled_fixture:same-notice';
        candidate.sources.unshift(reprint); // source rank/URL changes, same underlying notice
      }
      const kind = scenario === 'open_new_announcement' ? 'significant' : 'unchanged';
      port.execute.mockResolvedValue({ candidate, readFailures: [] });
      port.compare.mockResolvedValue(decisionFor(lease, kind));
      const result = await executeWatchCheck(port, lease, signal());
      expect(result.kind).toBe(kind === 'significant' ? 'changed' : 'unchanged');
      expect(port.compare).toHaveBeenCalledTimes(1);
      expect(port.execute.mock.calls[0]![0].watch.targetKind).toBe(lease.watch.targetKind);
    },
  );

  it.each(['investigation', 'run', 'scope', 'delta', 'bad_reference'] as const)(
    'rejects a candidate with invalid %s before comparison', async (field) => {
      const lease = makeLease();
      const port = makePort(lease);
      const candidate = candidateFor(lease);
      if (field === 'investigation') candidate.investigationId = ids.watch;
      if (field === 'run') candidate.runId = ids.check;
      if (field === 'scope') candidate.scope.goal = '另一个调查目的';
      if (field === 'delta') candidate.delta = { previousVersionId: ids.check, changes: [], checkedAt: NOW };
      if (field === 'bad_reference') candidate.claims[0]!.links[0]!.evidenceId = ids.check;
      port.execute.mockResolvedValue({ candidate, readFailures: [] });
      port.compare.mockResolvedValue(decisionFor(lease));
      await expect(executeWatchCheck(port, lease, signal())).rejects.toThrow();
      expect(port.compare).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'check', 'baseline', 'epoch', 'run', 'inactive'] as const)(
    'rejects inconsistent lease %s before execute', async (field) => {
      const lease = makeLease();
      if (field === 'owner') lease.context.sessionId = ids.watch;
      if (field === 'check') lease.context.watchCheckId = ids.watch;
      if (field === 'baseline') lease.watch.baselineVersionId = ids.watch;
      if (field === 'epoch') lease.context.watchLeaseEpoch = 2;
      if (field === 'run') lease.context.runId = null;
      if (field === 'inactive') lease.watch.status = 'paused';
      const port = makePort(lease);
      await expect(executeWatchCheck(port, lease, signal())).rejects.toThrow();
      expect(port.execute).not.toHaveBeenCalled();
    },
  );

  it.each(['missing_claim', 'missing_evidence', 'no_evidence', 'no_changes'] as const)(
    'does not accept significant with %s', async (field) => {
      const lease = makeLease();
      const port = makePort(lease);
      const decision = decisionFor(lease);
      if (field === 'missing_claim') decision.changes[0]!.claimIds = [ids.check];
      if (field === 'missing_evidence') decision.changes[0]!.evidenceIds = [ids.check];
      if (field === 'no_evidence') decision.changes[0]!.evidenceIds = [];
      if (field === 'no_changes') decision.changes = [];
      port.execute.mockResolvedValue({ candidate: candidateFor(lease), readFailures: [] });
      port.compare.mockResolvedValue(decision);
      await expect(executeWatchCheck(port, lease, signal())).rejects.toThrow();
    },
  );

  it('does not hand a candidate to the host for an unknown comparison', async () => {
    const lease = makeLease();
    const port = makePort(lease);
    port.execute.mockResolvedValue({ candidate: candidateFor(lease), readFailures: [] });
    port.compare.mockResolvedValue(decisionFor(lease, 'unknown'));
    const result = await executeWatchCheck(port, lease, signal());
    expect(result.kind).toBe('unknown');
    expect(result.candidate).toBeNull();
  });

  it('does not let injected comparison rewrite the old snapshot or the candidate it validated', async () => {
    const lease = makeLease();
    const before = JSON.stringify(lease.before);
    const candidate = candidateFor(lease);
    const originalCandidate = structuredClone(candidate);
    const port = makePort(lease);
    port.execute.mockResolvedValue({ candidate, readFailures: [] });
    port.compare.mockImplementation(async (input) => {
      input.before.payload.summary = 'rewritten';
      input.candidate.runId = ids.watch;
      return decisionFor(lease);
    });
    const result = await executeWatchCheck(port, lease, signal());
    expect(JSON.stringify(lease.before)).toBe(before);
    expect(result.candidate).toEqual(originalCandidate);
  });

  it('a model exception fails safely and never commits a result or retries the model', async () => {
    const lease = makeLease();
    const port = makePort(lease);
    port.execute.mockResolvedValue({ candidate: candidateFor(lease), readFailures: [] });
    port.compare.mockRejectedValue(new Error('private model diagnostic'));
    await createWatchScheduler(port, { now: () => NOW }).tick();
    expect(port.finish).not.toHaveBeenCalled();
    expect(port.compare).toHaveBeenCalledTimes(1);
    expect(port.fail).toHaveBeenCalledWith(expect.anything(), 'WATCH_CHECK_FAILED', NOW);
  });

  it('does not finish after heartbeat loss while comparison is in flight', async () => {
    const lease = makeLease();
    const port = makePort(lease);
    const compare = deferred<ReturnType<typeof decisionFor>>();
    port.execute.mockResolvedValue({ candidate: candidateFor(lease), readFailures: [] });
    port.compare.mockReturnValue(compare.promise);
    let beat!: () => void;
    const scheduler = createWatchScheduler(port, { now: () => NOW }, {
      timer: { setTimeout: (callback, delay) => { if (delay === 30_000) beat = callback; return callback; }, clearTimeout: () => {} },
    });
    const work = scheduler.tick();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    port.heartbeat.mockResolvedValue(false);
    beat();
    await Promise.resolve();
    expect(port.compare.mock.calls[0]![1].aborted).toBe(true);
    compare.resolve(decisionFor(lease));
    await work;
    expect(port.finish).not.toHaveBeenCalled();
  });
});
