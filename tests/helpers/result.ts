import type { ResultPayload } from '../../src/shared/contracts.js';

// Hand-written controlled material. example.invalid is deliberately not a real source.
export const ids = {
  investigation: '00000000-0000-4000-8000-000000000001',
  run: '00000000-0000-4000-8000-000000000002',
  source: '00000000-0000-4000-8000-000000000003',
  evidence: '00000000-0000-4000-8000-000000000004',
  claim: '00000000-0000-4000-8000-000000000005',
};
export const at = '2026-10-24T08:00:00.000Z';
export function samplePayload(): ResultPayload {
  return {
    schemaVersion: '0.1.0', investigationId: ids.investigation, runId: ids.run,
    scope: {
      objectText: '受控样例活动', goal: '核对截止日期', basicMode: 'truth',
      knownClues: [], uncertainClues: [], claimsToCheck: ['报名截至十月三十日'],
      timeScope: null, region: null, referenceTime: at, userConfirmed: true,
    },
    queryTime: at, summary: '受控材料中的报名截止日期为十月三十日。',
    conditions: ['仅用于契约测试'], unknowns: [], nextSteps: [], stopReason: 'answered',
    sources: [{
      id: ids.source, url: 'https://example.invalid/notice',
      canonicalUrl: 'https://example.invalid/notice', title: '受控公告', publisher: null,
      publishedAt: null, eventAt: null, fetchedAt: at, readStatus: 'full',
      originGroup: null, originReason: null, queryIds: [], snippet: null,
      contentHash: 'a'.repeat(64), diagnostic: null,
    }],
    evidence: [{
      id: ids.evidence, origin: { kind: 'source', id: ids.source },
      representation: 'verbatim', excerpt: '报名截至十月三十日',
      locator: { kind: 'paragraph', value: '1' }, capturedAt: at,
      contentHash: 'b'.repeat(64), limitations: [],
    }],
    claims: [{
      id: ids.claim, statement: '报名截至十月三十日', conditions: [], status: 'supported',
      links: [{ evidenceId: ids.evidence, relation: 'supports', rationale: '受控公告直接说明' }],
      gaps: [], reasonSummary: '受控材料直接支持',
    }],
    candidates: [], conflicts: [],
    answerBlocks: [{ id: 'conclusion', text: '报名截至十月三十日', claimIds: [ids.claim], evidenceIds: [ids.evidence] }],
    attachments: [], delta: null,
  };
}
