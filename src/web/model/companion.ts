import type { z } from 'zod';
import { CompanionSessionSchema, CompanionTurnSchema, type CompanionSegment, type CompanionSession, type ResultVersion } from '../../shared/contracts.js';
import { ClientError, parseInput } from '../api/client.js';
import { projectResult, type ResultViewModel } from './result.js';
import { snapshot } from './snapshot.js';

export type CompanionTurn = z.infer<typeof CompanionTurnSchema>;
export interface CompanionViewModel {
  sessionId: string; investigationId: string; resultVersionId: string; personaVersion: string;
  status: CompanionSession['status']; cursor: number; segments: CompanionSegment[];
  currentSegment: CompanionSegment | null; deliveredClaimIds: string[];
  result: ResultViewModel; interruption: CompanionTurn | null;
}
const invalidBinding = () => new ClientError('PROTOCOL_ERROR', '伴读版本、游标或引用与保存的报告不一致。');
function checkRefs(result: ResultViewModel, claimIds: string[], evidenceIds: string[]) {
  if (claimIds.some((id) => !result.claims.some((claim) => claim.id === id))
    || evidenceIds.some((id) => !result.evidence.some((evidence) => evidence.id === id))) throw invalidBinding();
}
export function projectCompanion(session: CompanionSession, version: ResultVersion): CompanionViewModel {
  const saved = parseInput(CompanionSessionSchema, session);
  const result = projectResult(version);
  if (saved.resultVersionId !== result.versionId || saved.investigationId !== result.investigationId) throw invalidBinding();
  if (new Set(saved.segments.map((segment) => segment.id)).size !== saved.segments.length) throw invalidBinding();
  checkRefs(result, saved.deliveredClaimIds, []);
  for (const segment of saved.segments) checkRefs(result, segment.claimIds, segment.evidenceIds);
  return snapshot({ sessionId: saved.id, investigationId: saved.investigationId, resultVersionId: saved.resultVersionId, personaVersion: saved.personaVersion, status: saved.status, cursor: saved.cursor, segments: saved.segments, currentSegment: saved.status === 'ready' ? saved.segments[saved.cursor] ?? null : null, deliveredClaimIds: saved.deliveredClaimIds, result, interruption: null });
}
export function withCompanionTurn(view: CompanionViewModel, turn: CompanionTurn): CompanionViewModel {
  const saved = parseInput(CompanionTurnSchema, turn);
  if (saved.companionSessionId !== view.sessionId || saved.resumeCursor > view.segments.length) throw invalidBinding();
  checkRefs(view.result, saved.claimIds, saved.evidenceIds);
  return snapshot({ ...view, interruption: saved });
}
export function resumeCompanion(view: CompanionViewModel): CompanionViewModel {
  if (!view.interruption || view.status !== 'ready') return view;
  const cursor = view.interruption.resumeCursor;
  return snapshot({ ...view, cursor, currentSegment: view.segments[cursor] ?? null, interruption: null });
}
/** Local intent only. UI adapter must persist ended/cursor through P's eventual PATCH route. */
export function finishCompanion(view: CompanionViewModel): CompanionViewModel {
  return snapshot({ ...view, status: 'ended', cursor: view.segments.length, currentSegment: null, interruption: null });
}
