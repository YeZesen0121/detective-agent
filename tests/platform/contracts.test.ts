import { describe, expect, it } from 'vitest';
import { CreateInvestigationSchema, ResultPayloadSchema } from '../../src/shared/contracts.js';
import { ids, samplePayload } from '../helpers/result.js';

describe('public input boundary', () => {
  it('accepts the two independent modes and a nonempty question', () => {
    expect(CreateInvestigationSchema.safeParse({ originalQuestion: '报名时间？', basicMode: 'latest', presentationMode: 'brief' }).success).toBe(true);
  });
  it.each([
    { originalQuestion: ' ', basicMode: 'truth', presentationMode: 'brief' },
    { originalQuestion: '问题', basicMode: 'fast', presentationMode: 'brief' },
    { originalQuestion: '问题', basicMode: 'truth', presentationMode: 'fast' },
    { originalQuestion: '问题', basicMode: 'truth', presentationMode: 'brief', sessionId: ids.run },
    { originalQuestion: '问'.repeat(4001), basicMode: 'truth', presentationMode: 'brief' },
  ])('rejects empty/oversized input, owner injection and mode confusion: case %#', (input) => {
    expect(CreateInvestigationSchema.safeParse(input).success).toBe(false);
  });
});

describe('result reference closure', () => {
  it('accepts a complete traceable payload', () => expect(ResultPayloadSchema.safeParse(samplePayload()).success).toBe(true));
  it('allows an explicit insufficient claim when no usable material exists', () => {
    const payload = samplePayload();
    payload.sources = []; payload.evidence = [];
    payload.claims[0]!.status = 'insufficient'; payload.claims[0]!.links = [];
    payload.claims[0]!.gaps = ['没有可核对的正式材料'];
    payload.answerBlocks[0]!.evidenceIds = [];
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(true);
  });
  it('rejects a missing source', () => {
    const payload = samplePayload(); payload.sources = [];
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it('rejects a claim reference into another version', () => {
    const payload = samplePayload(); payload.claims[0]!.links[0]!.evidenceId = ids.run;
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it('rejects a conclusion with only background evidence', () => {
    const payload = samplePayload(); payload.claims[0]!.links[0]!.relation = 'background';
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it('rejects full quotations attached to snippet-only sources', () => {
    const payload = samplePayload(); payload.sources[0]!.readStatus = 'snippet_only';
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it('rejects unsafe source URLs', () => {
    const payload = samplePayload(); payload.sources[0]!.url = 'javascript:alert(1)';
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it('rejects impossible calendar dates', () => {
    const payload = samplePayload(); payload.queryTime = '2026-02-30T08:00:00.000Z';
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(false);
  });
  it('rejects duplicate evidence identifiers', () => {
    const payload = samplePayload(); payload.evidence.push(structuredClone(payload.evidence[0]!));
    expect(ResultPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
