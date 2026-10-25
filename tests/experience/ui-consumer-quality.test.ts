import { expect, it } from 'vitest';
import { extractAttachments } from '../../src/server/attachments/extract.js';
import { buildCompanion, answerCompanion } from '../../src/server/companion/briefing.js';
import { CompanionInputSchema, CompanionTurnInputSchema } from '../../src/shared/ports.js';
import { createMediaScenario, MEDIA_SCENARIO_IDS } from '../fixtures/media-e/scenarios.js';
import { controlledModel } from './companion-fixture.js';

// controlled_fixture: hand-reviewed expected meanings; no OCR/TTS provider or browser acceptance claim.
for (const caseId of MEDIA_SCENARIO_IDS) {
  it(`controlled_fixture ${caseId}: preserves material identity, meaning and saved reading position`, async () => {
    const f = createMediaScenario(caseId), original = structuredClone(f);
    if (f.kind === 'extraction') {
      const { services, requests } = controlledModel(request => {
        const ref = request.messages.flatMap(m => m.attachmentRefs ?? [])[0]!;
        return f.modelOutputs.find(o => o.attachmentId === ref.id)!;
      });
      const result = await extractAttachments(f.input, services, new AbortController().signal);
      expect(result.failed).toEqual([]); expect(result.items.map(i => i.attachmentId)).toEqual(f.expected.attachmentIds);
      expect(result.items.map(i => i.visibleText)).toEqual(f.expected.visibleTexts); expect(result.items.map(i => i.speakerClues)).toEqual(f.expected.speakers);
      expect(result.items.map(i => i.visibleDates)).toEqual(f.expected.dates);
      expect(result.items.map(i => i.uncertainSpans)).toEqual(f.modelOutputs.map(i => i.uncertainSpans));
      expect(result.blockingQuestions).toHaveLength(f.expected.blockingImageIds.length);
      f.expected.blockingImageIds.forEach(id => expect(result.blockingQuestions.join('\n')).toContain(id));
      for (const [order, request] of requests.entries()) {
        const image = f.input.attachments.find(a => a.order === order)!;
        expect(request.messages.flatMap(m => m.attachmentRefs ?? [])).toEqual([{ id: image.id, bytesRef: image.bytesRef, mime: image.mime }]);
        expect(JSON.parse(request.messages[1]!.content)).toMatchObject({ attachmentId: image.id, order });
      }
      f.expected.mustKeep.forEach(text => expect(result.items.map(i => i.visibleText).join('\n')).toContain(text));
    } else {
      CompanionInputSchema.parse(f.input); CompanionTurnInputSchema.parse(f.turn);
      const build = controlledModel(f.modelDraft), draft = await buildCompanion(f.input, build.services, new AbortController().signal);
      expect(draft.segments).toHaveLength(3); expect(draft.resultVersionId).toBe(f.input.version.id);
      // A supporting subclaim alone must not hide the overall conflict/uncertainty until later.
      expect(draft.summary).toContain(f.expected.summary);
      const text = draft.summary + '\n' + draft.segments.map(s => s.text).join('\n');
      f.expected.mustKeep.forEach(s => expect(text).toContain(s)); f.forbidden.forEach(s => expect(text).not.toContain(s));
      expect(draft.segments[0]!.claimIds).toEqual(f.expected.claimIds); expect(draft.segments[0]!.evidenceIds).toEqual(f.expected.evidenceIds);
      const answer = controlledModel(f.modelReply), reply = await answerCompanion(f.turn, answer.services, new AbortController().signal);
      expect(reply.kind).toBe(f.expected.replyKind); expect(reply.resumeCursor).toBe(f.expected.resumeCursor); expect(reply.followupQuestion).toBe(f.expected.followupQuestion);
      f.forbidden.forEach(s => expect(reply.text).not.toContain(s));
      if (reply.kind === 'answer') {
        f.expected.mustKeep.forEach(s => expect(reply.text).toContain(s)); expect(reply.claimIds).toEqual(f.expected.claimIds); expect(reply.evidenceIds).toEqual(f.expected.evidenceIds);
      } else if (reply.kind === 'finish') { expect(reply.text).toContain(f.expected.summary); expect(reply.text).toContain('请核对主办方后续公告'); }
      else { expect(reply.text).toContain('不是当前报告的新结论'); expect(reply).not.toHaveProperty('newRunId'); }
      expect(build.requests).toHaveLength(1); expect(answer.requests).toHaveLength(1);
    }
    expect(f).toEqual(original);
  });
}
it('controlled_fixture: a failure in the second conflicting image belongs only to that image', async () => {
  const f = createMediaScenario('three-speakers'); if (f.kind !== 'extraction') throw Error('scenario type');
  const { services, requests } = controlledModel(request => {
    const id = request.messages.flatMap(m => m.attachmentRefs ?? [])[0]!.id;
    if (id === f.expected.attachmentIds[1]) throw Error('PRIVATE_PROVIDER_ERROR');
    return f.modelOutputs.find(o => o.attachmentId === id)!;
  });
  const result = await extractAttachments(f.input, services, new AbortController().signal);
  expect(result.items.map(i => i.attachmentId)).toEqual([f.expected.attachmentIds[0], f.expected.attachmentIds[2]]);
  expect(result.failed).toEqual([{ attachmentId: f.expected.attachmentIds[1], errorCode: 'extraction_failed' }]); expect(requests).toHaveLength(3);
});
