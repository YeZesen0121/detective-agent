import { z } from 'zod';
import { IdSchema, RunSchema, type Run } from '../../shared/contracts.js';
import { EventPageSchema, RunViewSchema, type TaskPort } from '../api/task-port.js';
import { ClientError, parseInput, safeError } from '../api/client.js';
import type { TaskViewState } from '../model/task.js';
import { snapshot } from '../model/snapshot.js';

export interface TaskScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
export interface TaskController {
  /** Resolves after the first read/drain; subsequent polling runs until disconnect or terminal/error. */
  follow(investigationId: string, runId: string): Promise<void>;
  cancel(): Promise<void>;
  disconnect(): void;
  getState(): TaskViewState;
  subscribe(listener: () => void): () => void;
}
const settled = (run: Run | undefined) => !!run && ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(run.status);
// Both GET and cancel can contain a snapshot taken before another response.
// A confirmed terminal run is final and cannot be undone by a delayed acknowledgement.
const mergeRun = (incoming: Run, current: Run | undefined): Run =>
  current && settled(current) ? current : incoming;
const empty = (): TaskViewState => ({ data: null, connection: 'idle', cancelPending: false, events: [], lastSeq: 0, error: null });
const protocol = () => new ClientError('PROTOCOL_ERROR', '任务数据不一致，已停止读取。');
function parsePort<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw protocol();
  return parsed.data;
}
export function createTaskController(port: TaskPort, scheduler: TaskScheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}): TaskController {
  let state = snapshot(empty());
  const listeners = new Set<() => void>();
  let generation = 0;
  let revision = 0;
  let caseId: string | null = null;
  let runId: string | null = null;
  let io: AbortController | null = null;
  let timer: unknown;
  let failures = 0;
  let cancelKey: string | null = null;
  let cancelPromise: Promise<void> | null = null;
  let acknowledgedRun: Run | null = null;

  function update(patch: Partial<TaskViewState>) {
    state = snapshot({ ...state, ...patch });
    for (const listener of [...listeners]) {
      // An observer failure must not turn a server run into a connection failure.
      try { listener(); } catch { /* observer owns its rendering errors */ }
    }
  }
  function stopReads() {
    generation++;
    io?.abort(); io = null;
    if (timer !== undefined) scheduler.clear(timer);
    timer = undefined;
    cancelPromise = null;
  }
  function isCurrent(gen: number) { return gen === generation && !!io && !io.signal.aborted; }
  function checkRun(run: Run) {
    if (run.id !== runId || run.investigationId !== caseId) throw protocol();
  }
  function schedule(gen: number, delay: number) {
    if (!isCurrent(gen)) return;
    timer = scheduler.set(() => { timer = undefined; void poll(gen); }, delay);
  }
  async function poll(gen: number): Promise<void> {
    if (!isCurrent(gen)) return;
    const signal = io!.signal;
    const readRevision = revision;
    try {
      const raw = await port.getRun(runId!, signal);
      if (!isCurrent(gen)) return;
      const data = parsePort(RunViewSchema, raw);
      checkRun(data.run);
      if (data.clarification && data.clarification.runId !== runId) throw protocol();
      data.run = mergeRun(data.run, state.data?.run);
      // An in-flight pre-cancel GET cannot overwrite the server's cancellation acknowledgement.
      if (revision === readRevision) update({ data, cancelPending: state.cancelPending && !settled(data.run) });
      else if (!state.data && acknowledgedRun) update({ data: { ...data, run: acknowledgedRun }, cancelPending: !settled(acknowledgedRun) });
      if (!isCurrent(gen)) return;
      while (isCurrent(gen)) {
        const after = state.lastSeq;
        const rawPage = await port.getEvents(caseId!, after, signal);
        if (!isCurrent(gen)) return;
        const page = parsePort(EventPageSchema, rawPage);
        if (page.nextSeq < after || (page.hasMore && page.nextSeq <= after)
          || page.items.some((event) => event.investigationId !== caseId || event.seq > page.nextSeq)) throw protocol();
        const seen = new Set(state.events.map((event) => event.seq));
        const items = page.items.filter((event) => {
          if (event.seq <= after || seen.has(event.seq) || event.visibility !== 'public' || event.runId !== runId) return false;
          seen.add(event.seq); return true;
        }).sort((a, b) => a.seq - b.seq);
        update({ events: [...state.events, ...items], lastSeq: page.nextSeq });
        if (!isCurrent(gen)) return;
        if (!page.hasMore) break;
      }
      if (!isCurrent(gen)) return;
      failures = 0;
      update({ connection: 'connected', error: null });
      if (!settled(state.data?.run)) schedule(gen, 1000);
    } catch (error) {
      if (!isCurrent(gen)) return;
      const safe = safeError(error);
      const retry = safe.code !== 'UNAUTHENTICATED' && safe.status !== 401 && safe.retryable;
      update({ connection: retry ? 'reconnecting' : 'error', error: safe });
      if (retry) {
        const delay = [1000, 2000, 4000, 8000, 15000][Math.min(failures++, 4)]!;
        schedule(gen, delay);
      }
    }
  }
  return {
    async follow(investigationId, nextRunId) {
      parseInput(IdSchema, investigationId); parseInput(IdSchema, nextRunId);
      const same = caseId === investigationId && runId === nextRunId;
      stopReads();
      caseId = investigationId; runId = nextRunId;
      io = new AbortController(); failures = 0; revision++;
      if (!same) { cancelKey = null; acknowledgedRun = null; state = snapshot(empty()); }
      const gen = generation;
      update({ connection: 'loading', error: null });
      await poll(gen);
    },
    cancel() {
      if (cancelPromise) return cancelPromise;
      if (!runId || !io || io.signal.aborted || settled(state.data?.run)) return Promise.resolve();
      const gen = generation;
      const target = runId;
      const signal = io.signal;
      cancelKey ??= crypto.randomUUID();
      const key = cancelKey;
      revision++;
      update({ cancelPending: true, error: null });
      if (!isCurrent(gen)) return Promise.resolve();
      cancelPromise = (async () => {
        try {
          const raw = await port.cancel(target, key, signal);
          if (!isCurrent(gen)) return;
          const parsed = parsePort(RunSchema, raw); checkRun(parsed);
          const run = mergeRun(parsed, state.data?.run);
          acknowledgedRun = run;
          revision++;
          if (state.data) update({ data: { ...state.data, run }, cancelPending: !settled(run), error: null });
          else update({ cancelPending: !settled(run) });
        } catch (error) {
          if (isCurrent(gen)) {
            const safe = safeError(error);
            if (safe.code === 'UNAUTHENTICATED' || safe.status === 401) {
              stopReads(); update({ cancelPending: false, connection: 'error', error: safe });
            } else update({ cancelPending: false, error: safe });
          }
        } finally {
          if (gen === generation) cancelPromise = null;
        }
      })();
      return cancelPromise;
    },
    disconnect() { stopReads(); update({ connection: 'idle', cancelPending: false }); },
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
