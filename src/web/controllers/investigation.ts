import { z } from 'zod';
import { IdSchema, type InvestigationPublic } from '../../shared/contracts.js';
import { StartRunSchema, StartedRunSchema, ClarificationAnswerSchema, AnsweredRunSchema, ResultViewSchema } from '../../shared/runtime-http.js';
import { InvestigationViewSchema, type FoundationApi } from '../api/foundation.js';
import { ClientError, parseInput, safeError, type SafeError } from '../api/client.js';
import type { RuntimeApi } from '../api/runtime.js';
import type { TaskViewState } from '../model/task.js';
import { snapshot } from '../model/snapshot.js';
import { createTaskController, type TaskController } from './task.js';
import { RunViewSchema, EventPageSchema } from '../api/task-port.js';

type StartInput = z.infer<typeof StartRunSchema>;
type AnswerInput = z.infer<typeof ClarificationAnswerSchema>;
export interface SubmissionView { kind: StartInput['action'] | 'answer'; key: string | null; outcome: 'pending' | 'unknown' | 'confirmed' | 'failed'; }
export interface InvestigationControllerState {
  investigationId: string | null; investigation: InvestigationPublic | null; task: TaskViewState | null;
  phase: 'idle' | 'loading' | 'ready' | 'submitting' | 'recovering' | 'error';
  submission: SubmissionView | null; error: SafeError | null;
  recoveryIncomplete: boolean;
}
export interface InvestigationController {
  open(investigationId: string): Promise<void>;
  followRun(runId: string): Promise<void>;
  start(action: StartInput['action'], previousRunId: string | null): Promise<void>;
  answer(clarificationId: string, input: AnswerInput): Promise<void>;
  cancel(): Promise<void>;
  disconnect(): void; dispose(): void;
  getState(): InvestigationControllerState; subscribe(listener: () => void): () => void;
}
interface Record extends SubmissionView { promise: Promise<void> | null; }
export function createInvestigationController(options: { foundation: Pick<FoundationApi, 'getInvestigation'>; runtime: RuntimeApi; keyFactory?: () => string; task?: TaskController }): InvestigationController {
  const task = options.task ?? createTaskController(options.runtime);
  let state: InvestigationControllerState = snapshot({ investigationId: null, investigation: null, task: null, phase: 'idle', submission: null, error: null, recoveryIncomplete: false });
  let generation = 0; let revision = 0; let io = new AbortController(); let disposed = false;
  let terminalMetadataKey:string|null=null;
  let following: string | null = null; let busy: Record | null = null;
  const records = new Map<string, Record>(); const listeners = new Set<() => void>();
  const view = (record: Record): SubmissionView => ({ kind: record.kind, key: record.key, outcome: record.outcome });
  function update(patch: Partial<InvestigationControllerState>) { state = snapshot({ ...state, ...patch }); for (const listener of [...listeners]) { try { listener(); } catch { /* observer owns rendering */ } } }
  function fail(error: unknown) { update({ error: safeError(error), ...(busy ? {} : { phase: 'error' as const }) }); }
  const invalid = () => new ClientError('INVALID_STATE', '当前状态不能执行此动作，请先读取服务器状态。');
  const protocol = () => new ClientError('PROTOCOL_ERROR', '响应与当前案件不一致。');
  const current = (g: number, r: number) => !disposed && generation === g && revision === r && !io.signal.aborted;
  const unsubscribe = task.subscribe(() => {
    const next = task.getState();
    if (!following || (next.data && (next.data.run.id !== following || next.data.run.investigationId !== state.investigationId))) return;
    update({ task: next });
    if(next.data&&['completed','partial','failed','cancelled','interrupted'].includes(next.data.run.status))void refreshTerminalMetadata(next.data.run.id,generation,revision);
  });
  async function refreshTerminalMetadata(runId:string,g:number,r:number){
    const terminalRun=state.task?.data?.run;if(!terminalRun)return;
    const key=`${g}:${r}:${runId}:${terminalRun.status}:${terminalRun.createdResultVersionId}`;if(key===terminalMetadataKey)return;terminalMetadataKey=key;
    const caseId=state.investigationId!;
    try{const raw=await options.foundation.getInvestigation(caseId,io.signal);if(!current(g,r)||following!==runId||state.task?.data?.run.id!==runId)return;const data=parseInput(InvestigationViewSchema,raw);if(data.investigation.id!==caseId||(data.activeRun&&(data.activeRun.investigationId!==caseId||data.activeRun.id!==data.investigation.activeRunId)))throw protocol();update({investigation:data.investigation});}
    catch(error){if(current(g,r)&&following===runId)update({error:safeError(error),recoveryIncomplete:true});}
  }
  function invalidate() {
    generation++; revision++; io.abort(); io = new AbortController(); following = null;
    if (busy) { busy.outcome = 'unknown'; busy.promise = null; busy = null; }
    task.disconnect();
  }
  async function follow(runId: string, g: number, r: number) {
    if (!current(g, r)) return;
    following = runId; await task.follow(state.investigationId!, runId);
  }
  async function read(g: number, r: number, baseline: string | null = null) {
    const caseId = state.investigationId!;
    const response = await options.foundation.getInvestigation(caseId, io.signal);
    if (!current(g, r)) return;
    const data = parseInput(InvestigationViewSchema, response);
    if (data.investigation.id !== caseId || (data.activeRun && (data.activeRun.investigationId !== caseId || data.activeRun.id !== data.investigation.activeRunId))) throw protocol();
    update({ investigation: data.investigation, recoveryIncomplete: false });
    if (!current(g, r)) return;
    if (data.activeRun) await follow(data.activeRun.id, g, r);
    else if (['cancelled', 'failed', 'interrupted'].includes(data.investigation.status)) {
      // A report may belong to an older run. P durably emits public queued events in case seq order.
      update({ task: null, recoveryIncomplete: true });
      let afterSeq = 0; let latestRunId: string | null = null; let latestSeq = -1; let drained = false;
      for (let pageNo = 0; pageNo < 100; pageNo++) {
        if (!current(g, r)) return;
        const page = parseInput(EventPageSchema, await options.runtime.getEvents(caseId, afterSeq, io.signal));
        if (!current(g, r)) return;
        if (page.nextSeq < afterSeq || (page.hasMore && page.nextSeq <= afterSeq)
          || page.items.some((event) => event.investigationId !== caseId || event.seq > page.nextSeq)) throw protocol();
        for (const event of page.items) if (event.visibility === 'public' && event.type === 'run.queued' && event.seq > latestSeq) { latestRunId = event.runId; latestSeq = event.seq; }
        if (!page.hasMore) { drained = true; break; }
        afterSeq = page.nextSeq;
      }
      if (drained && latestRunId) {
        const latest = parseInput(RunViewSchema, await options.runtime.getRun(latestRunId, io.signal));
        if (!current(g, r)) return;
        if (latest.run.id !== latestRunId || latest.run.investigationId !== caseId) throw protocol();
        if (latest.run.status === data.investigation.status) { update({ recoveryIncomplete: false }); await follow(latest.run.id, g, r); return true; }
      }
      update({ task: null, recoveryIncomplete: true, phase: 'error', error: safeError(new ClientError('INVALID_STATE', '尚不能从公开记录确认最新终态任务，请重新读取；旧报告仍可查看。')) });
      return false;
    } else if (data.latestResultVersionId && data.latestResultVersionId !== baseline && ['completed', 'partial'].includes(data.investigation.status)) {
      const raw = await options.runtime.getResult(data.latestResultVersionId, io.signal);
      if (!current(g, r)) return;
      const result = parseInput(ResultViewSchema, raw);
      if (result.version.id !== data.latestResultVersionId || result.version.investigationId !== caseId) throw protocol();
      await follow(result.version.runId, g, r);
    }
    return true;
  }
  function submit(record: Record, send: (signal: AbortSignal) => Promise<string>, stillRelevant: () => boolean = () => true): Promise<void> {
    if (record.promise) return record.promise;
    if (record.outcome === 'confirmed') return Promise.resolve();
    if (busy) { fail(invalid()); return Promise.resolve(); }
    const g = generation; const r = ++revision; const signal = io.signal;
    const baseline = state.investigation?.latestResultVersionId ?? null;
    let complete!: () => void;
    const promise = new Promise<void>((resolve) => { complete = resolve; });
    record.promise = promise; record.outcome = 'pending'; busy = record;
    update({ phase: 'submitting', error: null, submission: view(record) });
    void (async () => {
      try {
        if (!current(g, r)) return;
        const runId = await send(signal);
        if (!current(g, r)) return;
        record.outcome = 'confirmed'; update({ submission: view(record) });
        if (stillRelevant()) await follow(runId, g, r);
        if (current(g, r)) update({ phase: 'ready', error: null });
      } catch (error) {
        if (!current(g, r)) return;
        const safe = safeError(error);
        const unknown = ['NETWORK_ERROR', 'INVALID_RESPONSE', 'ABORTED', 'INTERNAL_ERROR'].includes(safe.code);
        record.outcome = unknown ? 'unknown' : 'failed';
        update({ phase: unknown ? 'recovering' : 'error', error: safe, submission: view(record) });
        if (unknown) {
          try { const restored = await read(g, r, baseline); if (current(g, r) && restored !== false) update({ phase: 'ready' }); }
          catch { if (current(g, r)) update({ phase: 'error' }); }
        }
      } finally {
        if (record.promise === promise) record.promise = null;
        if (busy === record && generation === g) busy = null;
        complete();
      }
    })();
    return promise;
  }
  return {
    async followRun(runId) {
      if(disposed||!state.investigationId)return;
      let g=generation,r=revision;
      try{
        const id=parseInput(IdSchema,runId),before=state.task?.data?.run,g0=generation,r0=revision;
        // A turn keeps its original run ID after resume. Preserve a newer descendant.
        if(before&&before.id!==id){let parent=before.previousRunId;const visited=new Set<string>();
          for(let depth=0;parent&&depth<100;depth++){
            if(parent===id)return;if(visited.has(parent))throw protocol();visited.add(parent);
            const view=parseInput(RunViewSchema,await options.runtime.getRun(parent,io.signal));if(!current(g0,r0))return;
            if(view.run.id!==parent||view.run.investigationId!==state.investigationId)throw protocol();parent=view.run.previousRunId;
          }
          if(parent)throw protocol();
        }
        if(!current(g0,r0))return;invalidate();g=generation;r=revision;update({phase:'loading',error:null,recoveryIncomplete:false});await follow(id,g,r);if(current(g,r))update({phase:'ready'});
      }
      catch(error){if(current(g,r))fail(error);}
    },
    async open(investigationId) {
      let g = generation; let r = revision;
      try {
        if (disposed) return;
        const id = parseInput(IdSchema, investigationId); const same = state.investigationId === id;
        invalidate(); if (!same) records.clear();
        g = generation; r = revision;
        update({ investigationId: id, investigation: same ? state.investigation : null, task: same ? state.task : null, submission: same && state.submission?.outcome === 'unknown' ? state.submission : null, error: null, phase: 'loading', recoveryIncomplete: false });
        const restored = await read(g, r);
        if (current(g, r) && restored !== false) update({ phase: 'ready' });
      } catch (error) { if (current(g, r)) update({ phase: 'error', error: safeError(error), recoveryIncomplete: true }); }
    },
    start(action, previousRunId) {
      try {
        if (disposed || !state.investigation || state.recoveryIncomplete) throw invalid();
        const input = parseInput(StartRunSchema.refine((input) => input.action === 'start' ? input.previousRunId === null : input.previousRunId !== null), { action, previousRunId });
        const signature = JSON.stringify([state.investigationId, input]);
        let record = records.get(signature);
        if (!record) {
          const key = parseInput(z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/), (options.keyFactory ?? (() => crypto.randomUUID()))());
          record = { kind: action, key, outcome: 'failed', promise: null }; records.set(signature, record);
        }
        const caseId = state.investigationId!; const fixedKey = record.key!;
        return submit(record, async (signal) => parseInput(StartedRunSchema, await options.runtime.startRun(caseId, input, fixedKey, signal)).runId);
      } catch (error) { fail(error); return Promise.resolve(); }
    },
    answer(clarificationId, input) {
      try {
        if (disposed) return Promise.resolve();
        const questionId = parseInput(IdSchema, clarificationId); const body = parseInput(ClarificationAnswerSchema, input);
        const data = state.task?.data;
        if (!data) throw invalid();
        const signature = JSON.stringify([state.investigationId, data.run.id, questionId, body]);
        const prior = records.get(signature);
        if (prior?.outcome === 'confirmed' || prior?.promise) return prior.promise ?? Promise.resolve();
        if (data.run.status !== 'waiting_for_user' || data.clarification?.id !== questionId || data.clarification.answeredAt !== null) throw invalid();
        const record = prior ?? { kind: 'answer' as const, key: null, outcome: 'failed' as const, promise: null }; records.set(signature, record);
        const runId = data.run.id;
        return submit(record, async (signal) => {
          const ack = parseInput(AnsweredRunSchema, await options.runtime.answerClarification(runId, questionId, body, signal));
          if (ack.runId !== runId) throw protocol(); return runId;
        }, () => { const latest = state.task?.data; return latest?.run.id === runId && (!latest.clarification || latest.clarification.id === questionId); });
      } catch (error) { fail(error); return Promise.resolve(); }
    },
    async cancel() { if (!disposed && following) await task.cancel(); },
    disconnect() { invalidate(); update({ phase: 'idle', task: state.task ? { ...state.task, connection: 'idle', cancelPending: false } : null }); },
    dispose() { if (disposed) return; disposed = true; invalidate(); unsubscribe(); listeners.clear(); },
    getState: () => state,
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
