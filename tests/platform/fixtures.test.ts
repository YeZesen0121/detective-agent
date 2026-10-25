import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  fixtureMetadata, successFixture, conflictFixture, insufficientFixture,
  providerFailureFixture, updatedVersionFixture,
} from '../../src/shared/fixtures/index.js';
import { ResultVersionSchema, apiSuccessSchema } from '../../src/shared/contracts.js';
import { CompanionTurnInputSchema, ExtractionBatchSchema, InvestigationOutcomeSchema, SearchResponseSchema, TTSRequestSchema } from '../../src/shared/ports.js';

describe('controlled provider/consumer examples', () => {
  it('labels every shared group as synthetic and excludes real source claims', () => {
    expect(fixtureMetadata.fixtureType).toBe('controlled_fixture');
    for (const version of [successFixture, conflictFixture, insufficientFixture, updatedVersionFixture.after]) {
      expect(ResultVersionSchema.safeParse(version).success).toBe(true);
      expect(createHash('sha256').update(JSON.stringify(version.payload)).digest('hex')).toBe(version.payloadHash);
      for (const source of version.payload.sources) expect(new URL(source.url).hostname).toBe('example.invalid');
    }
  });
  it('lets an HTTP consumer trace a supported claim through evidence to a source', () => {
    const response = apiSuccessSchema(ResultVersionSchema).parse({
      data: successFixture, meta: { requestId: 'controlled-response', contractVersion: '0.1.0' },
    });
    const { payload } = response.data;
    const link = payload.claims[0]!.links[0]!;
    const evidence = payload.evidence.find((item) => item.id === link.evidenceId)!;
    const source = payload.sources.find((item) => item.id === evidence.origin.id)!;
    expect(link.relation).toBe('supports');
    expect(evidence.excerpt).toBe('报名截至十月三十日');
    expect(source.url).toBe('https://example.invalid/notice');
  });
  it('preserves conflict and insufficient states independently of technical failure', () => {
    expect(conflictFixture.payload.claims[0]!.status).toBe('mixed');
    expect(conflictFixture.payload.claims[0]!.links.map((item) => item.relation)).toEqual(['supports', 'contradicts']);
    expect(insufficientFixture.payload.claims[0]!.status).toBe('insufficient');
    expect(providerFailureFixture.run.status).toBe('failed');
    expect(providerFailureFixture.run.createdResultVersionId).toBeNull();
    expect(providerFailureFixture.version).toBeNull();
  });
  it('keeps the old companion on the old version and directs the notification to the new version', () => {
    const { before, after, oldCompanion, notification, link } = updatedVersionFixture;
    expect(before.payload.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(after.payload.summary).toBe('受控新版：报名截止日已修订为十月三十一日。');
    expect(oldCompanion.resultVersionId).toBe(before.id);
    expect(notification.targetResultVersionId).toBe(after.id);
    expect(notification.previousVersionId).toBe(before.id);
    expect(link.fromVersionId).toBe(before.id); expect(link.toVersionId).toBe(after.id);
    expect(after.previousVersionId).toBe(before.id);
  });
});

describe('module port boundary failures', () => {
  it('does not allow a result and a clarification to be finalized at once', () => {
    expect(InvestigationOutcomeSchema.safeParse({
      stopReason: 'needs_user', completion: 'waiting_for_user', draft: successFixture.payload,
      clarification: null,
    }).success).toBe(false);
  });
  it('does not move an old companion onto the latest version silently', () => {
    const { oldCompanion, before, after } = updatedVersionFixture;
    const context = {
      sessionId: '00000000-0000-4000-8000-000000000020', accessGroup: 'trial', investigationId: before.investigationId,
      runId: null, budgetWindowId: null, interactionPoolId: null, watchCheckId: null,
      epoch: 1, watchLeaseEpoch: null, deadlineAt: '2026-10-24T10:00:00.000Z',
    };
    expect(CompanionTurnInputSchema.safeParse({ context, session: oldCompanion, version: before, question: '这是什么意思？' }).success).toBe(true);
    expect(CompanionTurnInputSchema.safeParse({ context, session: oldCompanion, version: after, question: '这是什么意思？' }).success).toBe(false);
  });
  it('does not mark one attachment both extracted and failed', () => {
    const id = '00000000-0000-4000-8000-000000000030';
    expect(ExtractionBatchSchema.safeParse({
      items: [{ attachmentId: id, visibleText: '', speakerClues: [], visibleDates: [], claimSuggestions: [], uncertainSpans: [], warnings: [] }],
      failed: [{ attachmentId: id, errorCode: 'blurred' }], blockingQuestions: [],
    }).success).toBe(false);
  });
  it('accepts a genuine empty search result without inventing a source', () => {
    expect(SearchResponseSchema.safeParse({ items: [], providerRequestId: null, invalidItemCount: 0, warnings: [], usage: null }).success).toBe(true);
  });
  it('enforces the provider chunk boundary and fixed initial speed', () => {
    expect(TTSRequestSchema.safeParse({ text: '字'.repeat(151), voiceId: 'controlled', speed: 0, codec: 'mp3' }).success).toBe(false);
    expect(TTSRequestSchema.safeParse({ text: '可读文字', voiceId: 'controlled', speed: 1, codec: 'mp3' }).success).toBe(false);
  });
});
