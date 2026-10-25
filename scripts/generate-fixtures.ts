import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  CONTRACT_VERSION, CompanionSessionSchema, NotificationSchema, ProviderFailureSchema,
  ResultPayloadSchema, ResultVersionSchema, RunSchema, VersionLinkSchema, type ResultPayload,
} from '../src/shared/contracts.js';
import { at, ids, samplePayload } from '../tests/helpers/result.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function version(payload: ResultPayload, versionId: string, previousVersionId: string | null = null) {
  return ResultVersionSchema.parse({
    id: versionId, investigationId: payload.investigationId, runId: payload.runId,
    previousVersionId, createdAt: payload.queryTime, payloadHash: hash(payload), payload,
  });
}
const success = version(ResultPayloadSchema.parse(samplePayload()), id(10));
const mixed = structuredClone(success.payload);
mixed.sources.push({ ...mixed.sources[0]!, id: id(11), url: 'https://example.invalid/correction', canonicalUrl: 'https://example.invalid/correction', title: '受控修订材料' });
mixed.evidence.push({ ...mixed.evidence[0]!, id: id(12), origin: { kind: 'source', id: id(11) }, excerpt: '报名改至十月二十九日', contentHash: 'd'.repeat(64) });
mixed.claims[0]!.status = 'mixed';
mixed.claims[0]!.links.push({ evidenceId: id(12), relation: 'contradicts', rationale: '受控材料给出不同日期' });
mixed.summary = '两份受控材料日期冲突，尚不能确定适用的截止日。';
mixed.conflicts = [{ description: '截止日期不一致', claimIds: [ids.claim], evidenceIds: [ids.evidence, id(12)] }];
mixed.answerBlocks[0]!.text = mixed.summary;
const conflict = version(ResultPayloadSchema.parse(mixed), id(13));
const gap = structuredClone(success.payload);
gap.sources = []; gap.evidence = [];
gap.claims[0]!.status = 'insufficient'; gap.claims[0]!.links = [];
gap.claims[0]!.gaps = ['未找到可核对的受控公告']; gap.claims[0]!.reasonSummary = '没有可判断的材料';
gap.summary = '现有材料不足，无法确认报名截止日期。';
gap.unknowns = ['截止日期']; gap.nextSteps = ['提供主办方公告或活动名称'];
gap.stopReason = 'no_useful_direction'; gap.answerBlocks[0]!.text = gap.summary; gap.answerBlocks[0]!.evidenceIds = [];
const insufficient = version(ResultPayloadSchema.parse(gap), id(14));
const updatedPayload = structuredClone(success.payload);
updatedPayload.runId = id(15); updatedPayload.queryTime = '2026-10-24T09:00:00.000Z';
updatedPayload.summary = '受控新版：报名截止日已修订为十月三十一日。';
updatedPayload.sources[0]!.fetchedAt = updatedPayload.queryTime; updatedPayload.sources[0]!.contentHash = 'e'.repeat(64);
updatedPayload.evidence[0]!.excerpt = '报名截至十月三十一日'; updatedPayload.evidence[0]!.contentHash = 'f'.repeat(64);
updatedPayload.evidence[0]!.capturedAt = updatedPayload.queryTime;
updatedPayload.claims[0]!.statement = '报名截至十月三十一日'; updatedPayload.answerBlocks[0]!.text = updatedPayload.summary;
updatedPayload.delta = {
  previousVersionId: success.id, changes: [{ kind: 'conclusion', description: '受控截止日延长一天', claimIds: [ids.claim], evidenceIds: [ids.evidence] }], checkedAt: updatedPayload.queryTime,
};
const newer = version(ResultPayloadSchema.parse(updatedPayload), id(16), success.id);
const link = VersionLinkSchema.parse({ fromVersionId: success.id, toVersionId: newer.id, reason: '受控截止日变更', createdAt: newer.createdAt });
const oldCompanion = CompanionSessionSchema.parse({
  id: id(17), investigationId: ids.investigation, resultVersionId: success.id, personaVersion: 'default-v1', status: 'ready',
  segments: [{ id: id(18), text: '这份旧版材料写明截止日为十月三十日。', action: null, claimIds: [ids.claim], evidenceIds: [ids.evidence] }], cursor: 0, deliveredClaimIds: [], createdAt: at,
});
const notification = NotificationSchema.parse({
  id: id(19), sessionId: id(20), watchId: id(21), watchCheckId: id(22), changeKey: 'a'.repeat(64),
  targetResultVersionId: newer.id, previousVersionId: success.id, reason: '受控截止日变更', createdAt: newer.createdAt, readAt: null,
});
const failedRun = RunSchema.parse({
  id: id(23), investigationId: ids.investigation, trigger: 'initial', previousRunId: null, budgetWindowId: id(24),
  scopeVersion: 1, status: 'failed', stage: 'searching', epoch: 1, queuedAt: at, startedAt: at, endedAt: at,
  activeIntervals: [{ startedAt: at, endedAt: at }], activeMs: 0, stopReason: 'provider_error',
  cancelRequestedAt: null, checkpointRef: null, createdResultVersionId: null,
});
const fixture = {
  fixtureType: 'controlled_fixture', contractVersion: CONTRACT_VERSION,
  disclaimer: '合成契约样例；example.invalid 不是真实检索来源；禁止作为生产调查结果。',
  success: { version: success }, conflict: { version: conflict }, insufficient: { version: insufficient },
  'provider-failure': { run: failedRun, failure: ProviderFailureSchema.parse({ kind: 'auth', retryable: false, requestId: null, usageKnown: false, safeMessage: '受控鉴权失败' }), version: null },
  'updated-version': { before: success, after: newer, link, oldCompanion, notification },
};
mkdirSync('src/shared/fixtures', { recursive: true });
writeFileSync('src/shared/fixtures/cases.json', JSON.stringify(fixture, null, 2) + '\n');
console.log('Generated five controlled fixture groups; no network calls.');
