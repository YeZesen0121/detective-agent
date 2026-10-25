import type { z } from 'zod';
import { IdSchema, ResultVersionSchema, type Claim, type Evidence, type FactStatus, type ResultPayload, type ResultVersion } from '../../shared/contracts.js';
import { UpdateNoticeSchema } from '../../shared/runtime-http.js';
import { ClientError, parseInput } from '../api/client.js';
import { snapshot } from './snapshot.js';

export type ResultViewModel = ResultPayload & {
  versionId: string; previousVersionId: string | null; createdAt: string; payloadHash: string;
  claimsByStatus: Record<FactStatus, Claim[]>;
};
export function projectResult(version: ResultVersion): ResultViewModel {
  const parsed = parseInput(ResultVersionSchema, version);
  const claimsByStatus: Record<FactStatus, Claim[]> = { supported: [], refuted: [], mixed: [], insufficient: [] };
  for (const claim of parsed.payload.claims) claimsByStatus[claim.status].push(claim);
  return snapshot({ ...parsed.payload, versionId: parsed.id, previousVersionId: parsed.previousVersionId, createdAt: parsed.createdAt, payloadHash: parsed.payloadHash, claimsByStatus });
}
export function findEvidence(version: ResultVersion, evidenceId: string): Evidence | null {
  const parsed = parseInput(ResultVersionSchema, version);
  const id = parseInput(IdSchema, evidenceId);
  return snapshot(parsed.payload.evidence.find((evidence) => evidence.id === id) ?? null);
}
// Re-export the released wire shape; no private rename at the model boundary.
export { UpdateNoticeSchema };
export type UpdateNotice = z.infer<typeof UpdateNoticeSchema>;
export interface ResultViewState {
  selectedVersionId: string;
  result: ResultViewModel;
  updateNotice: UpdateNotice | null;
}
export function createResultState(version: ResultVersion): ResultViewState {
  const result = projectResult(version);
  return snapshot({ selectedVersionId: result.versionId, result, updateNotice: null });
}
export type ResultAction = { type: 'notice'; notice: UpdateNotice | null } | { type: 'open'; version: ResultVersion };
export function reduceResult(state: ResultViewState, action: ResultAction): ResultViewState {
  switch (action.type) {
    case 'notice': {
      const notice = parseInput(UpdateNoticeSchema.nullable(), action.notice);
      return snapshot({ ...state, updateNotice: notice?.latestResultVersionId === state.selectedVersionId ? null : notice });
    }
    case 'open': {
      const result = projectResult(action.version);
      if (result.investigationId !== state.result.investigationId) throw new ClientError('PROTOCOL_ERROR', '不能将另一案件的版本替换到当前报告。');
      return snapshot({ selectedVersionId: result.versionId, result, updateNotice: null });
    }
  }
}
