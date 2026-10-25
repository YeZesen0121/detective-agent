import { describe, expect, it } from 'vitest';
import { CompanionTurnSchema } from '../../src/shared/contracts.js';
import { updatedVersionFixture } from '../../src/shared/fixtures/index.js';
import { projectCompanion, withCompanionTurn, resumeCompanion, finishCompanion } from '../../src/web/model/companion.js';
import { at, id } from './fixtures.js';

function fixture() {
  const { before } = updatedVersionFixture;
  const session = structuredClone(updatedVersionFixture.oldCompanion);
  session.segments = [0, 1, 2].map((n) => ({ ...session.segments[0]!, id: id(500 + n), text: `controlled_fixture 主线 ${n}` }));
  session.cursor = 1;
  const turn = CompanionTurnSchema.parse({ id: id(600), companionSessionId: session.id, question: 'controlled_fixture 解释限定', answer: '仅是受控材料。', claimIds: [before.payload.claims[0]!.id], evidenceIds: [before.payload.evidence[0]!.id], resumeCursor: 1, followupTurnId: null, createdAt: at });
  return { version: before, session, turn };
}
describe('saved companion projection (controlled_fixture)', () => {
  it('starts from the persisted cursor with the same conclusion, limitations and references', () => {
    const { session, version } = fixture();
    const view = projectCompanion(session, version);
    expect(view.cursor).toBe(1);
    expect(view.currentSegment?.text).toBe('controlled_fixture 主线 1');
    expect(view.result.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(view.result.conditions).toEqual(['仅用于契约测试']);
    expect(view.resultVersionId).toBe(version.id);
    expect(view.interruption).toBeNull();
    session.segments[1]!.text = 'caller mutation';
    expect(view.currentSegment?.text).toBe('controlled_fixture 主线 1');
  });
  it('keeps an interruption separate and resumes at the saved return position without repeating mainline', () => {
    const { session, version, turn } = fixture();
    const view = projectCompanion(session, version);
    const interrupted = withCompanionTurn(view, turn);
    expect(interrupted.cursor).toBe(1);
    expect(interrupted.interruption?.answer).toBe('仅是受控材料。');
    expect(interrupted.segments).toEqual(view.segments);
    expect(resumeCompanion(interrupted)).toMatchObject({ cursor: 1, currentSegment: { text: 'controlled_fixture 主线 1' }, interruption: null });
    expect(view.interruption).toBeNull();
  });
  it('finish is a local model action with no research port and leaves fixed facts intact', () => {
    const { session, version, turn } = fixture();
    const view = finishCompanion(withCompanionTurn(projectCompanion(session, version), turn));
    expect(view).toMatchObject({ status: 'ended', cursor: 3, currentSegment: null, interruption: null });
    expect(view.result.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    session.cursor = 3;
    expect(projectCompanion(session, version).currentSegment).toBeNull();
  });
  it('does not bind an old companion to a new version or another investigation', () => {
    const { session, version } = fixture();
    expect(() => projectCompanion(session, updatedVersionFixture.after)).toThrow();
    session.investigationId = id(999);
    expect(() => projectCompanion(session, version)).toThrow();
  });
  it('validates saved/return cursors, references, and turn ownership', () => {
    const { session, version, turn } = fixture();
    const view = projectCompanion(session, version);
    expect(() => withCompanionTurn(view, { ...turn, resumeCursor: 4 })).toThrow();
    expect(() => withCompanionTurn(view, { ...turn, companionSessionId: id(999) })).toThrow();
    expect(() => withCompanionTurn(view, { ...turn, evidenceIds: [id(999)] })).toThrow();
    expect(() => projectCompanion({ ...session, cursor: 4 }, version)).toThrow();
    session.segments[0]!.claimIds = [id(999)];
    expect(() => projectCompanion(session, version)).toThrow();
  });
});
