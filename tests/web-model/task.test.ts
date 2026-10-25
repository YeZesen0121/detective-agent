import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskController } from '../../src/web/controllers/task.js';
import type { TaskPort, RunView } from '../../src/web/api/task-port.js';
import { ClientError } from '../../src/web/api/client.js';
import { at, deferred, event, id, run, runView } from './fixtures.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function port(overrides: Partial<TaskPort> = {}): TaskPort {
  return { getRun: async () => runView(), getEvents: async (_caseId, after) => ({ items: [], nextSeq: after, hasMore: false }), cancel: async () => ({ ...run(), status: 'cancelled', stopReason: 'cancelled' }), ...overrides };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('task controller (controlled_fixture)', () => {
  it('drains 100-event pages immediately, deduplicates seq, hides internal events, then polls at one second', async () => {
    const cursors: number[] = [];
    const controller = createTaskController(port({ getEvents: async (_id, after) => {
      cursors.push(after);
      return after === 0
        ? { items: Array.from({ length: 100 }, (_, n) => event(n + 1)), nextSeq: 100, hasMore: true }
        : after === 100
          ? { items: [event(100), { ...event(101), visibility: 'internal' }, event(102)], nextSeq: 102, hasMore: false }
          : { items: [], nextSeq: after, hasMore: false };
    } }));
    let notices = 0;
    const unsubscribe = controller.subscribe(() => notices++);
    await controller.follow(id(10), id(1));
    expect(cursors).toEqual([0, 100]);
    expect(controller.getState()).toMatchObject({ lastSeq: 102, connection: 'connected' });
    expect(controller.getState().events.map((e) => e.seq)).toEqual([...Array.from({ length: 100 }, (_, n) => n + 1), 102]);
    await vi.advanceTimersByTimeAsync(999); expect(cursors).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(cursors).toEqual([0, 100, 102]);
    expect(notices).toBeGreaterThan(1);
    unsubscribe(); const before = notices; controller.disconnect(); expect(notices).toBe(before);
  });
  it('backs off 1/2/4/8/15/15 seconds, preserves run and resumes from lastSeq', async () => {
    const reads: number[] = [];
    let failed = false;
    let count = 0;
    const cursors: number[] = [];
    const controller = createTaskController(port({
      getRun: async () => { reads.push(Date.now()); if (failed && count++ < 6) throw Error('private-network-detail'); return runView(); },
      getEvents: async (_id, after) => { cursors.push(after); return { items: [event(1)], nextSeq: 1, hasMore: false }; },
    }));
    await controller.follow(id(10), id(1)); failed = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getState()).toMatchObject({ connection: 'reconnecting', data: { run: { status: 'running' } }, lastSeq: 1, error: { code: 'NETWORK_ERROR' } });
    for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) await vi.advanceTimersByTimeAsync(delay);
    expect(reads.slice(1).map((value, n) => n === 0 ? 0 : value - reads[n]!)).toEqual([0, 1000, 2000, 4000, 8000, 15000, 15000]);
    expect(cursors).toEqual([0, 1]);
    expect(controller.getState()).toMatchObject({ connection: 'connected', error: null });
    controller.disconnect();
  });
  it('stops polling on 401 without replacing the server run status', async () => {
    let reads = 0;
    const controller = createTaskController(port({ getRun: async () => { if (reads++ > 0) throw new ClientError('UNAUTHENTICATED', '请登录', 'safe-id', 401); return runView(); } }));
    await controller.follow(id(10), id(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60000);
    expect(reads).toBe(2);
    expect(controller.getState()).toMatchObject({ connection: 'error', data: { run: { status: 'running' } }, error: { code: 'UNAUTHENTICATED' } });
    controller.disconnect();
  });
  it.each([
    { items: [], nextSeq: 0, hasMore: true },
    { items: [event(2)], nextSeq: 1, hasMore: false },
    { items: [{ ...event(1), investigationId: id(99) }], nextSeq: 1, hasMore: false },
  ])('rejects unsafe event pagination instead of looping or mixing cases', async (page) => {
    const controller = createTaskController(port({ getEvents: async () => page }));
    await controller.follow(id(10), id(1));
    expect(controller.getState()).toMatchObject({ connection: 'error', error: { code: 'PROTOCOL_ERROR' }, events: [] });
    expect(vi.getTimerCount()).toBe(0);
    controller.disconnect();
  });
  it('ignores late old-run reads and aborts old signals when follow switches run', async () => {
    const old = deferred<RunView>();
    let signal: AbortSignal | undefined;
    const controller = createTaskController(port({ getRun: async (runId, currentSignal) => {
      if (runId === id(1)) { signal = currentSignal; return old.promise; }
      return runView(2);
    } }));
    const first = controller.follow(id(10), id(1));
    await controller.follow(id(10), id(2));
    expect(signal?.aborted).toBe(true);
    old.resolve(runView()); await first;
    expect(controller.getState().data?.run.id).toBe(id(2));
    controller.disconnect();
  });
  it('disconnect aborts local IO, keeps evidence/cursor, never cancels the server, and reconnect only reads', async () => {
    const cursors: number[] = [];
    let cancels = 0;
    const controller = createTaskController(port({
      getEvents: async (_id, after) => { cursors.push(after); return { items: [event(1)], nextSeq: 1, hasMore: false }; },
      cancel: async () => { cancels++; return run(); },
    }));
    await controller.follow(id(10), id(1)); controller.disconnect();
    expect(controller.getState()).toMatchObject({ connection: 'idle', lastSeq: 1 });
    await vi.advanceTimersByTimeAsync(10000); expect(cursors).toEqual([0]);
    await controller.follow(id(10), id(1));
    expect(cursors).toEqual([0, 1]); expect(cancels).toBe(0);
    controller.disconnect();
  });
  it('deduplicates cancel, waits for server state, and late poll cannot resurrect cancelled run', async () => {
    const pendingRead = deferred<RunView>();
    const pendingCancel = deferred<ReturnType<typeof run>>();
    let reads = 0; const keys: string[] = [];
    const controller = createTaskController(port({
      getRun: async () => ++reads === 1 ? runView() : pendingRead.promise,
      cancel: async (_id, key) => { keys.push(key); return pendingCancel.promise; },
    }));
    await controller.follow(id(10), id(1));
    await vi.advanceTimersByTimeAsync(1000);
    const cancelling = controller.cancel(); const duplicate = controller.cancel();
    expect(controller.getState()).toMatchObject({ cancelPending: true, data: { run: { status: 'running' } } });
    pendingCancel.resolve({ ...run(), status: 'cancelled', cancelRequestedAt: at, stopReason: 'cancelled' });
    await Promise.all([cancelling, duplicate]);
    pendingRead.resolve(runView()); await flush();
    expect(keys).toHaveLength(1);
    expect(controller.getState()).toMatchObject({ cancelPending: false, data: { run: { status: 'cancelled' } } });
    controller.disconnect();
  });
  it('keeps one cancel key for explicit retries and separates cancel errors from run state', async () => {
    const keys: string[] = [];
    const controller = createTaskController(port({ cancel: async (_id, key) => {
      keys.push(key); if (keys.length === 1) throw Error('network');
      return { ...run(), cancelRequestedAt: at };
    } }));
    await controller.follow(id(10), id(1)); await controller.cancel();
    expect(controller.getState()).toMatchObject({ cancelPending: false, error: { code: 'NETWORK_ERROR' }, data: { run: { status: 'running' } } });
    await controller.cancel(); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    expect(controller.getState()).toMatchObject({ cancelPending: true, data: { run: { status: 'running' } } });
    controller.disconnect();
  });
  it.each(['completed', 'cancelled', 'failed', 'partial', 'waiting_for_user', 'interrupted'] as const)('retains saved evidence/partial material for %s', async (status) => {
    const view = runView(); view.run.status = status;
    view.run.stopReason = status === 'partial' ? 'cost_limit' : status === 'failed' ? 'provider_error' : null;
    const controller = createTaskController(port({ getRun: async () => view, getEvents: async () => ({ items: [event(1)], nextSeq: 1, hasMore: false }) }));
    await controller.follow(id(10), id(1));
    expect(controller.getState().events).toHaveLength(1);
    expect(controller.getState().data).toMatchObject({ partialMaterialSummary: 'controlled_fixture：已保存部分来源', run: { status, stopReason: view.run.stopReason } });
    controller.disconnect();
  });
  it('rejects wrong-run snapshots and malformed data safely', async () => {
    const controller = createTaskController(port({ getRun: async () => runView(9) }));
    await controller.follow(id(10), id(1));
    expect(controller.getState()).toMatchObject({ data: null, connection: 'error', error: { code: 'PROTOCOL_ERROR' } });
    controller.disconnect();
  });
  it('retains the server cancel acknowledgement even before the initial run GET finishes', async () => {
    const first = deferred<RunView>();
    const controller = createTaskController(port({ getRun: async () => first.promise }));
    const following = controller.follow(id(10), id(1));
    await controller.cancel();
    first.resolve(runView()); await following;
    expect(controller.getState()).toMatchObject({ data: { run: { status: 'cancelled' } }, cancelPending: false });
    controller.disconnect();
  });
  it('retries final event delivery even when the run is already terminal', async () => {
    let reads = 0;
    const controller = createTaskController(port({
      getRun: async () => ({ ...runView(), run: { ...run(), status: 'completed' } }),
      getEvents: async () => { if (reads++ === 0) throw Error('offline'); return { items: [event(1)], nextSeq: 1, hasMore: false }; },
    }));
    await controller.follow(id(10), id(1));
    expect(controller.getState().connection).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getState()).toMatchObject({ connection: 'connected', lastSeq: 1 });
    expect(vi.getTimerCount()).toBe(0);
    controller.disconnect();
  });
  it('a cancellation 401 stops background reads as well', async () => {
    let reads = 0;
    const controller = createTaskController(port({ getRun: async () => { reads++; return runView(); }, cancel: async () => { throw new ClientError('UNAUTHENTICATED', '请登录', null, 401); } }));
    await controller.follow(id(10), id(1)); await controller.cancel();
    await vi.advanceTimersByTimeAsync(60000);
    expect(reads).toBe(1);
    expect(controller.getState()).toMatchObject({ connection: 'error', error: { code: 'UNAUTHENTICATED' } });
    controller.disconnect();
  });
  it('ignores a late cancellation acknowledgement after switching runs', async () => {
    const pending = deferred<ReturnType<typeof run>>();
    const controller = createTaskController(port({ getRun: async (runId) => runView(runId === id(1) ? 1 : 2), cancel: async () => pending.promise }));
    await controller.follow(id(10), id(1)); const cancelled = controller.cancel();
    await controller.follow(id(10), id(2));
    pending.resolve({ ...run(), status: 'cancelled' }); await cancelled;
    expect(controller.getState()).toMatchObject({ data: { run: { id: id(2), status: 'running' } }, cancelPending: false });
    controller.disconnect();
  });
  it('does not publish malformed run data or allow mutation of retained snapshots', async () => {
    let reads = 0;
    const controller = createTaskController(port({ getRun: async () => ++reads === 1 ? runView() : ({ ...runView(), run: { ...run(), status: 'invented' } } as unknown as RunView) }));
    await controller.follow(id(10), id(1));
    const saved = controller.getState();
    expect(() => { saved.data!.run.status = 'failed'; }).toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getState()).toMatchObject({ data: { run: { status: 'running' } }, error: { code: 'PROTOCOL_ERROR' } });
    controller.disconnect();
  });
  it('a late pending-cancel response cannot undo a terminal state already confirmed by polling', async () => {
    let reads = 0;
    const ack = deferred<ReturnType<typeof run>>();
    const controller = createTaskController(port({
      getRun: async () => ++reads === 1 ? runView() : { ...runView(), run: { ...run(), status: 'cancelled', stopReason: 'cancelled' } },
      cancel: async () => ack.promise,
    }));
    await controller.follow(id(10), id(1)); const cancelling = controller.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getState()).toMatchObject({ data: { run: { status: 'cancelled' } }, cancelPending: false });
    ack.resolve({ ...run(), cancelRequestedAt: at }); await cancelling;
    expect(controller.getState()).toMatchObject({ data: { run: { status: 'cancelled' } }, cancelPending: false });
    expect(vi.getTimerCount()).toBe(0);
    controller.disconnect();
  });
});
