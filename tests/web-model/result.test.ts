import { describe, expect, it } from 'vitest';
import { successFixture, conflictFixture, insufficientFixture, updatedVersionFixture, providerFailureFixture, fixtureMetadata } from '../../src/shared/fixtures/index.js';
import type { ResultVersion } from '../../src/shared/contracts.js';
import { projectResult, findEvidence, createResultState, reduceResult } from '../../src/web/model/result.js';
import { id, at } from './fixtures.js';

describe('fixed result projection (controlled_fixture)', () => {
  it.each([successFixture, conflictFixture, insufficientFixture, updatedVersionFixture.after])('keeps facts/limitations/citations for every presentation of version $id', (version) => {
    expect(fixtureMetadata.fixtureType).toBe('controlled_fixture');
    const view = projectResult(version);
    expect(view.versionId).toBe(version.id);
    expect(view.summary).toBe(version.payload.summary);
    expect(view.conditions).toEqual(version.payload.conditions);
    expect(view.unknowns).toEqual(version.payload.unknowns);
    expect(view.queryTime).toBe(version.payload.queryTime);
    expect(view.claims).toEqual(version.payload.claims);
    expect(view.conflicts).toEqual(version.payload.conflicts);
    expect(view.sources).toEqual(version.payload.sources);
    expect(view.evidence).toEqual(version.payload.evidence);
    expect(view.answerBlocks).toEqual(version.payload.answerBlocks);
    expect(view.claimsByStatus[version.payload.claims[0]!.status]).toContainEqual(version.payload.claims[0]);
    const evidenceId = version.payload.claims[0]!.links[0]?.evidenceId;
    if (evidenceId) expect(findEvidence(version, evidenceId)?.id).toBe(evidenceId);
  });
  it('does not fabricate a report after provider failure or repair unresolved references', () => {
    expect(() => projectResult(providerFailureFixture.version as unknown as ResultVersion)).toThrow();
    const broken = structuredClone(successFixture); broken.payload.claims[0]!.links[0]!.evidenceId = id(999);
    expect(() => projectResult(broken)).toThrow();
    expect(findEvidence(successFixture, id(999))).toBeNull();
  });
  it('preserves snippet-only read status and freezes a detached snapshot', () => {
    const version = structuredClone(successFixture);
    version.payload.sources[0]!.readStatus = 'snippet_only';
    version.payload.evidence[0]!.representation = 'snippet';
    version.payload.conditions.push('仅摘要，未读全文');
    const view = projectResult(version);
    version.payload.summary = '后来输入变动';
    expect(view.sources[0]!.readStatus).toBe('snippet_only');
    expect(view.conditions).toContain('仅摘要，未读全文');
    expect(view.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(() => { view.conditions.push('改写'); }).toThrow();
  });
  it('an independent update notice never replaces selected content; opening the new version is explicit', () => {
    const { before, after } = updatedVersionFixture;
    const initial = createResultState(before);
    const notice = { latestResultVersionId: after.id, createdAt: after.createdAt };
    const notified = reduceResult(initial, { type: 'notice', notice });
    expect(notified.selectedVersionId).toBe(before.id);
    expect(notified.result.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(notified.updateNotice).toEqual(notice);
    const merelyFetched = projectResult(after);
    expect(merelyFetched.previousVersionId).toBe(before.id);
    expect(notified.result.versionId).toBe(before.id);
    const opened = reduceResult(notified, { type: 'open', version: after });
    expect(opened.selectedVersionId).toBe(after.id);
    expect(opened.result.summary).toBe('受控新版：报名截止日已修订为十月三十一日。');
    expect(opened.updateNotice).toBeNull();
    expect(initial.result.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(reduceResult(opened, { type: 'open', version: before }).selectedVersionId).toBe(before.id);
  });
  it('rejects cross-investigation explicit open and invalid notices', () => {
    const initial = createResultState(successFixture);
    const other = structuredClone(successFixture); other.investigationId = id(888); other.payload.investigationId = id(888);
    expect(() => reduceResult(initial, { type: 'open', version: other })).toThrow();
    expect(() => reduceResult(initial, { type: 'notice', notice: { latestResultVersionId: 'invalid', createdAt: at } })).toThrow();
  });
});
