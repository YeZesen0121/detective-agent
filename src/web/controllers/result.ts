import { IdSchema } from '../../shared/contracts.js';
import { ResultViewSchema, CopyResultSchema } from '../../shared/runtime-http.js';
import { ClientError, parseInput, safeError, type SafeError } from '../api/client.js';
import type { RuntimeApi } from '../api/runtime.js';
import { createResultState, reduceResult, type ResultViewState } from '../model/result.js';
import { snapshot } from '../model/snapshot.js';

export interface VersionCopy { versionId: string; text: string; }
export interface ResultControllerState {
  data: ResultViewState | null; phase: 'idle' | 'loading' | 'ready' | 'error';
  selectionPending: string | null; noticeRefreshing: boolean; copying: boolean;
  requestedVersionId: string | null;
  copy: VersionCopy | null; error: SafeError | null;
}
export interface ResultController {
  select(versionId: string, expectedInvestigationId?: string): Promise<void>; retrySelection(): Promise<void>; refreshNotice(): Promise<void>; openLatest(): Promise<void>;
  copy(): Promise<VersionCopy | null>; disconnect(): void; dispose(): void;
  getState(): ResultControllerState; subscribe(listener: () => void): () => void;
}
export function createResultController(options: { runtime: Pick<RuntimeApi, 'getResult' | 'copyResult'>; onVersionChange?: (previousVersionId: string, nextVersionId: string) => void }): ResultController {
  let state: ResultControllerState = snapshot({ data: null, phase: 'idle', selectionPending: null, requestedVersionId: null, noticeRefreshing: false, copying: false, copy: null, error: null });
  let requestedCaseId: string | null = null;
  let generation = 0; let noticeSeq = 0; let appliedNoticeSeq = 0; let copySeq = 0; let disposed = false;
  let selectionIO = new AbortController(); let noticeIO = new AbortController(); let copyIO = new AbortController();
  const listeners = new Set<() => void>();
  function update(patch: Partial<ResultControllerState>) { state = snapshot({ ...state, ...patch }); for (const listener of [...listeners]) { try { listener(); } catch { /* observer owns rendering */ } } }
  const protocol = () => new ClientError('PROTOCOL_ERROR', '报告版本、归属或快照与当前选择不一致。');
  const current = (g: number) => !disposed && generation === g;
  function invalidate() { generation++; noticeSeq++; copySeq++; selectionIO.abort(); noticeIO.abort(); copyIO.abort(); selectionIO = new AbortController(); }
  async function select(versionId: string, expectedInvestigationId?: string): Promise<void> {
    let g = generation;
    try {
      if (disposed) return;
      const id = parseInput(IdSchema, versionId);
      const caseId = expectedInvestigationId === undefined ? state.data?.result.investigationId ?? requestedCaseId : parseInput(IdSchema, expectedInvestigationId);
      invalidate(); g = generation; requestedCaseId = caseId;
      const noticeAtSelection = noticeSeq;
      const signal = selectionIO.signal;
      update({ phase: 'loading', selectionPending: id, requestedVersionId: id, noticeRefreshing: false, copying: false, copy: null, error: null });
      if (!current(g)) return;
      const raw = await options.runtime.getResult(id, signal);
      if (!current(g)) return;
      const response = parseInput(ResultViewSchema, raw);
      if (response.version.id !== id || (caseId && response.version.investigationId !== caseId) || (state.data && response.version.investigationId !== state.data.result.investigationId)) throw protocol();
      let data = state.data ? reduceResult(state.data, { type: 'open', version: response.version }) : createResultState(response.version);
      const fresherNotice = appliedNoticeSeq > noticeAtSelection ? state.data?.updateNotice ?? null : response.updateNotice;
      data = reduceResult(data, { type: 'notice', notice: fresherNotice });
      const previous = state.data?.selectedVersionId;
      if (previous && previous !== id) options.onVersionChange?.(previous, id);
      if (!current(g)) return;
      copySeq++; copyIO.abort(); noticeSeq++; noticeIO.abort();
      update({ data, phase: 'ready', selectionPending: null, noticeRefreshing: false, copying: false, copy: null, error: null });
    } catch (error) { if (current(g)) update({ phase: 'error', selectionPending: null, error: safeError(error) }); }
  }
  return {
    select,
    retrySelection() { return state.requestedVersionId ? select(state.requestedVersionId, requestedCaseId ?? undefined) : Promise.resolve(); },
    async refreshNotice() {
      if (disposed || !state.data) return;
      const g = generation; const seq = ++noticeSeq; const versionId = state.data.selectedVersionId;
      const hash = state.data.result.payloadHash;
      noticeIO.abort(); noticeIO = new AbortController(); const signal = noticeIO.signal;
      const relevant = () => current(g) && seq === noticeSeq && state.data?.selectedVersionId === versionId;
      update({ noticeRefreshing: true, error: null });
      try {
        if (!relevant()) return;
        const raw = await options.runtime.getResult(versionId, signal);
        if (!relevant()) return;
        const response = parseInput(ResultViewSchema, raw);
        if (response.version.id !== versionId || response.version.investigationId !== state.data!.result.investigationId || response.version.payloadHash !== hash) throw protocol();
        appliedNoticeSeq = seq;
        update({ data: reduceResult(state.data!, { type: 'notice', notice: response.updateNotice }), noticeRefreshing: false });
      } catch (error) { if (relevant()) update({ noticeRefreshing: false, error: safeError(error) }); }
    },
    openLatest() { const latest = state.data?.updateNotice?.latestResultVersionId; return latest ? select(latest) : Promise.resolve(); },
    async copy() {
      if (disposed || !state.data) return null;
      const versionId = state.data.selectedVersionId; const g = generation; const seq = ++copySeq;
      copyIO.abort(); copyIO = new AbortController(); const signal = copyIO.signal;
      const relevant = () => current(g) && copySeq === seq && state.data?.selectedVersionId === versionId;
      update({ copying: true, copy: null, error: null });
      try {
        if (!relevant()) return null;
        const raw = await options.runtime.copyResult(versionId, signal);
        if (!relevant()) return null;
        const result = { versionId, ...parseInput(CopyResultSchema, raw) };
        update({ copying: false, copy: result }); return snapshot(result);
      } catch (error) { if (relevant()) update({ copying: false, error: safeError(error) }); return null; }
    },
    disconnect() { invalidate(); requestedCaseId = null; update({ phase: 'idle', selectionPending: null, requestedVersionId: null, noticeRefreshing: false, copying: false, copy: null }); },
    dispose() { if (disposed) return; disposed = true; invalidate(); listeners.clear(); },
    getState: () => state,
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
