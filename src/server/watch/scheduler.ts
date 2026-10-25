import { IdSchema, TimestampSchema } from '../../shared/contracts.js';
import { executeWatchCheck } from './check.js';
import type { WatchClock, WatchLease, WatchRuntimePort, WatchScheduler, WatchSchedulerOptions, WatchTimer } from './ports.js';

const nativeTimer: WatchTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createWatchScheduler(
  port: WatchRuntimePort, clock: WatchClock, options: WatchSchedulerOptions = {},
): WatchScheduler {
  const timer = options.timer ?? nativeTimer;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0 || heartbeatMs >= 180_000) {
    throw new Error('WATCH_INVALID_HEARTBEAT_INTERVAL');
  }
  const now = () => TimestampSchema.parse(clock.now());
  let stopped = false;
  let active: Promise<void> | null = null;
  let controller: AbortController | null = null;

  async function run(claim: () => Promise<WatchLease | null>, abort: AbortController) {
    if (abort.signal.aborted) return;
    let lease: WatchLease | null;
    try { lease = await claim(); }
    catch { throw new Error('WATCH_CLAIM_FAILED'); }
    if (!lease) return;

    let heartbeatHandle: unknown;
    let deadlineHandle: unknown;
    let heartbeatFlight: Promise<void> | null = null;
    let completing = false;
    const clearHeartbeat = () => {
      if (heartbeatHandle !== undefined) timer.clearTimeout(heartbeatHandle);
      heartbeatHandle = undefined;
    };
    const heartbeat = () => {
      heartbeatHandle = undefined;
      if (completing || abort.signal.aborted) return;
      heartbeatFlight = (async () => {
        try {
          if (!await port.heartbeat(lease, now())) abort.abort('WATCH_LEASE_LOST');
        } catch { abort.abort('WATCH_LEASE_LOST'); }
        finally { if (!completing && !abort.signal.aborted) scheduleHeartbeat(); }
      })();
    };
    const scheduleHeartbeat = () => { heartbeatHandle = timer.setTimeout(heartbeat, heartbeatMs); };
    abort.signal.addEventListener('abort', clearHeartbeat, { once: true });

    try {
      abort.signal.throwIfAborted();
      const deadline = Math.min(Date.parse(lease.context.deadlineAt), Date.parse(lease.watch.expiresAt));
      const assertActive = () => {
        if (Date.parse(now()) >= deadline) abort.abort('WATCH_DEADLINE');
        abort.signal.throwIfAborted();
      };
      const remaining = deadline - Date.parse(now());
      if (!Number.isFinite(remaining) || remaining <= 0) abort.abort('WATCH_DEADLINE');
      abort.signal.throwIfAborted();
      deadlineHandle = timer.setTimeout(() => abort.abort('WATCH_DEADLINE'), remaining);
      scheduleHeartbeat();
      const result = await executeWatchCheck(port, lease, abort.signal, assertActive);
      completing = true;
      clearHeartbeat();
      // A heartbeat already in flight must resolve before requesting a durable commit.
      await heartbeatFlight;
      assertActive();
      // False is a fenced-out commit, never a reason to create a second notification.
      await port.finish(lease, result, now());
    } catch {
      const code = abort.signal.aborted ? String(abort.signal.reason) : 'WATCH_CHECK_FAILED';
      try { await port.fail(lease, code, now()); }
      catch { throw new Error('WATCH_CLEANUP_FAILED'); }
    } finally {
      completing = true;
      clearHeartbeat();
      if (deadlineHandle !== undefined) timer.clearTimeout(deadlineHandle);
      abort.signal.removeEventListener('abort', clearHeartbeat);
      await heartbeatFlight;
    }
  }

  function launch(claim: () => Promise<WatchLease | null>): Promise<void> {
    if (stopped || active) return Promise.resolve();
    const abort = new AbortController();
    controller = abort;
    // Reserve the local slot before calling any asynchronous host operation.
    const work = Promise.resolve().then(() => run(claim, abort));
    const tracked = work.finally(() => { active = null; controller = null; });
    active = tracked;
    return tracked;
  }

  return {
    async tick() {
      if (stopped || active) return;
      const at = now();
      return launch(() => port.claimDue(at));
    },
    async checkNow(sessionId, watchId) {
      if (stopped || active) return;
      IdSchema.parse(sessionId); IdSchema.parse(watchId);
      const at = now();
      return launch(() => port.claimManual(sessionId, watchId, at));
    },
    async stop() {
      stopped = true;
      controller?.abort('WATCH_STOPPED');
      await active;
    },
  };
}
