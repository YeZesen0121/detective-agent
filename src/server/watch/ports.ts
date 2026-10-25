import type { InvocationContext, ResultPayload, ResultVersion, Watch, WatchCheck } from '../../shared/contracts.js';
import type { WatchComparisonInput, WatchDecision } from '../../shared/ports.js';

export type WatchLease = {
  watch: Watch; check: WatchCheck; context: InvocationContext; before: ResultVersion;
};
export type WatchExecution = {
  candidate: ResultPayload | null;
  readFailures: Array<{ sourceId: string; errorCode: string }>;
};
export type WatchFinish = {
  kind: 'changed' | 'unchanged' | 'unknown';
  candidate: ResultPayload | null; decision: WatchDecision | null; reason: string;
};

/** P owns all durable authorization, fencing, accounting and snapshot transactions. */
export interface WatchRuntimePort {
  claimDue(now: string): Promise<WatchLease | null>;
  claimManual(sessionId: string, watchId: string, now: string): Promise<WatchLease | null>;
  heartbeat(lease: WatchLease, now: string): Promise<boolean>;
  execute(lease: WatchLease, signal: AbortSignal): Promise<WatchExecution>;
  compare(input: WatchComparisonInput, signal: AbortSignal): Promise<WatchDecision>;
  finish(lease: WatchLease, result: WatchFinish, now: string): Promise<boolean>;
  fail(lease: WatchLease, safeCode: string, now: string): Promise<void>;
}

export interface WatchClock { now(): string }
/** One-shot timers; callbacks are synchronous, asynchronous work is owned by the scheduler. */
export interface WatchTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
export type WatchSchedulerOptions = { timer?: WatchTimer; heartbeatMs?: number };
export interface WatchScheduler {
  tick(): Promise<void>;
  checkNow(sessionId: string, watchId: string): Promise<void>;
  stop(): Promise<void>;
}
