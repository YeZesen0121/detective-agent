import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWatchScheduler } from '../../src/server/watch/scheduler.js';
import { candidateFor, decisionFor, deferred, ids, makeLease, makePort, NOW } from './fixtures.js';

describe('watch scheduler (controlled_fixture)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterEach(() => { vi.useRealTimers(); });
  const clock = { now: () => new Date().toISOString() };

  it('does not claim on import/construction and can tick without a browser', async () => {
    const port = makePort();
    const scheduler = createWatchScheduler(port, clock);
    expect(port.claimDue).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await scheduler.tick();
    expect(port.claimDue).toHaveBeenCalledExactlyOnceWith(NOW);
    expect(port.execute).toHaveBeenCalledTimes(1);
    expect(port.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'unknown' }), NOW);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not execute when host says nothing is due, and does not catch up missed periods', async () => {
    const port = makePort();
    port.claimDue.mockResolvedValue(null);
    const scheduler = createWatchScheduler(port, clock);
    vi.setSystemTime(new Date('2026-10-24T18:00:00.000Z'));
    await scheduler.tick();
    expect(port.claimDue).toHaveBeenCalledTimes(1);
    expect(port.execute).not.toHaveBeenCalled();
    expect(port.finish).not.toHaveBeenCalled();
  });

  it('single-flights scheduled and manual claims even while a claim is pending', async () => {
    const port = makePort();
    const claim = deferred<ReturnType<typeof makeLease> | null>();
    port.claimDue.mockReturnValue(claim.promise);
    const scheduler = createWatchScheduler(port, clock);
    const first = scheduler.tick();
    await scheduler.tick();
    await scheduler.checkNow(ids.session, ids.watch);
    expect(port.claimDue).toHaveBeenCalledTimes(1);
    expect(port.claimManual).not.toHaveBeenCalled();
    claim.resolve(makeLease());
    await first;
    await scheduler.checkNow(ids.session, ids.watch);
    expect(port.claimManual).toHaveBeenCalledExactlyOnceWith(ids.session, ids.watch, NOW);
  });

  it('never overlaps execute and reopens the local slot after completion', async () => {
    const port = makePort();
    const execution = deferred<{ candidate: null; readFailures: [] }>();
    port.execute.mockReturnValueOnce(execution.promise);
    const scheduler = createWatchScheduler(port, clock);
    const first = scheduler.tick();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.tick();
    expect(port.execute).toHaveBeenCalledTimes(1);
    execution.resolve({ candidate: null, readFailures: [] });
    await first;
    await scheduler.tick();
    expect(port.execute).toHaveBeenCalledTimes(2);
  });

  it.each(['false', 'reject'] as const)('aborts on heartbeat %s and discards a late result', async (mode) => {
    const port = makePort();
    const execution = deferred<{ candidate: null; readFailures: [] }>();
    port.execute.mockReturnValue(execution.promise);
    if (mode === 'false') port.heartbeat.mockResolvedValue(false);
    else port.heartbeat.mockRejectedValue(new Error('private provider diagnostic'));
    const scheduler = createWatchScheduler(port, clock);
    const work = scheduler.tick();
    await vi.advanceTimersByTimeAsync(30_000);
    const signal = port.execute.mock.calls[0]![1];
    expect(signal.aborted).toBe(true);
    execution.resolve({ candidate: null, readFailures: [] });
    await work;
    expect(port.compare).not.toHaveBeenCalled();
    expect(port.finish).not.toHaveBeenCalled();
    expect(port.fail).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'WATCH_LEASE_LOST', clock.now());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses injected one-shot timers without overlapping heartbeat calls', async () => {
    const port = makePort();
    const execution = deferred<{ candidate: null; readFailures: [] }>();
    const beat = deferred<boolean>();
    port.execute.mockReturnValue(execution.promise);
    port.heartbeat.mockReturnValue(beat.promise);
    const timer = {
      setTimeout: vi.fn((callback: () => void, ms: number) => setTimeout(callback, ms)),
      clearTimeout: vi.fn((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
    };
    const scheduler = createWatchScheduler(port, clock, { timer, heartbeatMs: 1000 });
    const work = scheduler.tick();
    await vi.advanceTimersByTimeAsync(3000);
    expect(timer.setTimeout).toHaveBeenCalled();
    expect(port.heartbeat).toHaveBeenCalledTimes(1);
    execution.resolve({ candidate: null, readFailures: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.finish).not.toHaveBeenCalled();
    beat.resolve(false);
    await work;
    expect(port.finish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop aborts active work, waits for cleanup, and permanently prevents new claims', async () => {
    const port = makePort();
    const execution = deferred<{ candidate: null; readFailures: [] }>();
    port.execute.mockReturnValue(execution.promise);
    const scheduler = createWatchScheduler(port, clock);
    const work = scheduler.tick();
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    expect(port.execute.mock.calls[0]![1].aborted).toBe(true);
    await scheduler.tick();
    await scheduler.checkNow(ids.session, ids.watch);
    expect(stopped).toBe(false);
    execution.resolve({ candidate: null, readFailures: [] });
    await Promise.all([work, stopping, scheduler.stop()]);
    expect(port.claimDue).toHaveBeenCalledTimes(1);
    expect(port.claimManual).not.toHaveBeenCalled();
    expect(port.finish).not.toHaveBeenCalled();
    expect(port.fail).toHaveBeenCalledWith(expect.anything(), 'WATCH_STOPPED', NOW);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a claim arriving after stop without executing it', async () => {
    const port = makePort();
    const claim = deferred<ReturnType<typeof makeLease> | null>();
    port.claimDue.mockReturnValue(claim.promise);
    const scheduler = createWatchScheduler(port, clock);
    const work = scheduler.tick();
    await vi.advanceTimersByTimeAsync(0); // claim has started, its response is still pending
    const stopping = scheduler.stop();
    claim.resolve(makeLease());
    await Promise.all([work, stopping]);
    expect(port.execute).not.toHaveBeenCalled();
    expect(port.fail).toHaveBeenCalledWith(expect.anything(), 'WATCH_STOPPED', NOW);
  });

  it('does not start a queued claim if stop wins before its microtask runs', async () => {
    const port = makePort();
    const scheduler = createWatchScheduler(port, clock);
    const work = scheduler.tick();
    await Promise.all([work, scheduler.stop()]);
    expect(port.claimDue).not.toHaveBeenCalled();
    expect(port.execute).not.toHaveBeenCalled();
  });

  it.each(['execute', 'compare'] as const)('rechecks wall-clock deadline after %s without relying on timer delivery', async (stage) => {
    const lease = makeLease();
    const port = makePort(lease);
    port.execute.mockImplementation(async () => {
      if (stage === 'execute') vi.setSystemTime(new Date('2026-10-24T12:03:00.000Z'));
      return { candidate: candidateFor(lease), readFailures: [] };
    });
    port.compare.mockImplementation(async () => {
      if (stage === 'compare') vi.setSystemTime(new Date('2026-10-24T12:03:00.000Z'));
      return decisionFor(lease);
    });
    await createWatchScheduler(port, clock).tick();
    if (stage === 'execute') expect(port.compare).not.toHaveBeenCalled();
    expect(port.finish).not.toHaveBeenCalled();
    expect(port.fail).toHaveBeenCalledWith(expect.anything(), 'WATCH_DEADLINE', clock.now());
  });

  it('aborts at the invocation deadline even when execute ignores cancellation', async () => {
    const port = makePort();
    const execution = deferred<{ candidate: null; readFailures: [] }>();
    port.execute.mockReturnValue(execution.promise);
    const work = createWatchScheduler(port, clock).tick();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(port.execute.mock.calls[0]![1].aborted).toBe(true);
    execution.resolve({ candidate: null, readFailures: [] });
    await work;
    expect(port.finish).not.toHaveBeenCalled();
    expect(port.fail).toHaveBeenCalledWith(expect.anything(), 'WATCH_DEADLINE', clock.now());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leak exception messages, retry failed execute, or retry finish=false', async () => {
    const port = makePort();
    port.execute.mockRejectedValueOnce(new Error('secret-token'));
    const scheduler = createWatchScheduler(port, clock);
    await scheduler.tick();
    expect(port.fail).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'WATCH_CHECK_FAILED', NOW);
    expect(port.execute).toHaveBeenCalledTimes(1);
    port.finish.mockResolvedValue(false);
    await scheduler.tick();
    expect(port.finish).toHaveBeenCalledTimes(1);
    expect(port.fail).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed manual IDs and clock values before contacting the host', async () => {
    const port = makePort();
    const scheduler = createWatchScheduler(port, clock);
    await expect(scheduler.checkNow('not-an-owner', ids.watch)).rejects.toThrow();
    expect(port.claimManual).not.toHaveBeenCalled();
    await expect(createWatchScheduler(port, { now: () => 'invalid' }).tick()).rejects.toThrow();
    expect(port.claimDue).not.toHaveBeenCalled();
  });
});
