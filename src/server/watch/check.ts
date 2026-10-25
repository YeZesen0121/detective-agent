import { z } from 'zod';
import {
  IdSchema, InvocationContextSchema, ResultPayloadSchema, ResultVersionSchema, WatchCheckSchema, WatchSchema,
} from '../../shared/contracts.js';
import { WatchComparisonInputSchema, WatchDecisionSchema } from '../../shared/ports.js';
import type { WatchFinish, WatchLease, WatchRuntimePort } from './ports.js';

const LeaseSchema = z.strictObject({
  watch: WatchSchema, check: WatchCheckSchema, context: InvocationContextSchema, before: ResultVersionSchema,
}).refine(({ watch, check, context, before }) =>
  watch.status === 'active' && check.status === 'running'
  && watch.sessionId === context.sessionId
  && watch.investigationId === context.investigationId && before.investigationId === context.investigationId
  && watch.id === check.watchId && check.id === context.watchCheckId
  && watch.baselineVersionId === before.id && check.beforeVersionId === before.id
  && check.leaseEpoch === context.watchLeaseEpoch
  && context.runId !== null && check.runId === context.runId && context.budgetWindowId !== null
  && check.leaseUntil !== null, 'Inconsistent watch lease');

const ExecutionSchema = z.strictObject({
  candidate: ResultPayloadSchema.nullable(),
  readFailures: z.array(z.strictObject({
    sourceId: IdSchema, errorCode: z.string().trim().min(1).max(128),
  })).max(120),
});

function unknown(reason: string): WatchFinish {
  return { kind: 'unknown', candidate: null, decision: null, reason };
}

// Scope may advance the observation time, but not the object, goal, mode or conditions.
function scopeKey(scope: WatchLease['before']['payload']['scope']): string {
  const { referenceTime: _referenceTime, ...identity } = scope;
  return JSON.stringify(identity);
}

/** No prompts, network calls or persistence: I compares facts; P commits atomically. */
export async function executeWatchCheck(
  port: WatchRuntimePort, lease: WatchLease, signal: AbortSignal,
  assertActive: () => void = () => signal.throwIfAborted(),
): Promise<WatchFinish> {
  assertActive();
  const validatedLease = LeaseSchema.parse(lease);
  const execution = ExecutionSchema.parse(await port.execute(structuredClone(validatedLease), signal));
  assertActive();
  if (!execution.candidate) {
    return unknown('WATCH_NO_CANDIDATE');
  }
  const input = WatchComparisonInputSchema.parse({
    context: validatedLease.context, before: validatedLease.before, candidate: execution.candidate,
    focus: validatedLease.watch.focus, readFailures: execution.readFailures,
  });
  if (input.candidate.runId !== input.context.runId
    || scopeKey(input.candidate.scope) !== scopeKey(input.before.payload.scope)
    || (input.candidate.delta !== null && input.candidate.delta.previousVersionId !== input.before.id)) {
    throw new Error('WATCH_INVALID_CANDIDATE');
  }
  if (!['answered', 'no_useful_direction'].includes(input.candidate.stopReason)) {
    return unknown('WATCH_INCOMPLETE_EXECUTION');
  }
  // Keep validated snapshots separate from objects supplied to the injected module.
  const decision = WatchDecisionSchema.parse(await port.compare(structuredClone(input), signal));
  assertActive();
  if (execution.readFailures.length > 0) return unknown('WATCH_READ_FAILED');
  if (decision.kind === 'unknown') return { ...unknown(decision.reason), decision };

  const claims = new Set(input.candidate.claims.map((claim) => claim.id));
  const evidence = new Set(input.candidate.evidence.map((item) => item.id));
  if (decision.kind === 'unchanged' && decision.changes.length > 0) throw new Error('WATCH_INVALID_DECISION');
  for (const change of decision.changes) {
    if (change.evidenceIds.length === 0 || change.claimIds.some((id) => !claims.has(id))
      || change.evidenceIds.some((id) => !evidence.has(id))) {
      throw new Error('WATCH_INVALID_CHANGE_EVIDENCE');
    }
  }
  return {
    kind: decision.kind === 'significant' ? 'changed' : decision.kind,
    candidate: input.candidate, decision, reason: decision.reason,
  };
}
