import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { extractAttachments } from '../../src/server/attachments/extract.js';
import { ExtractionBatchSchema } from '../../src/shared/ports.js';
import { ModelRequestSchema, type ExtractionInput, type ModelResponse } from '../../src/shared/ports.js';
import { companionCase, controlledModel } from './companion-fixture.js';

// controlled_fixture: hand-written OCR outputs only, never actual vision API evidence.
const extraction = (visibleText = 'controlled_fixture：不是2027届，不要忽略“不”。') => ({ visibleText,
  speakerClues: ['甲'], visibleDates: ['2026-10-25'], claimSuggestions: [], uncertainSpans: [], warnings: [] });
function images(): ExtractionInput {
  return { context: companionCase().input.context, attachments: [2, 0, 1].map(order => ({
    id: randomUUID(), order, mime: 'image/png', bytesRef: `private-ref-${order}`, width: 300, height: 600,
  })) };
}
function oncePerInput(input: ExtractionInput, batch: Awaited<ReturnType<typeof extractAttachments>>) {
  const ids = [...batch.items.map(x => x.attachmentId), ...batch.failed.map(x => x.attachmentId)];
  expect(ids).toHaveLength(input.attachments.length);
  expect([...ids].sort()).toEqual(input.attachments.map(x => x.id).sort());
  expect(new Set(ids).size).toBe(ids.length);
  expect(ExtractionBatchSchema.safeParse(batch).success).toBe(true);
}

it('keeps three images, dates, speakers and negation isolated in original input order', async () => {
  const input = images(); const before = structuredClone(input);
  const outputs = new Map(input.attachments.map(a => [a.id, {
    ...extraction(), visibleText: ['甲：不是2027届，是2026届。', '乙：不在10月25日截止。', '丙：尚未确认11月1日。'][a.order]!,
    speakerClues: [['甲'], ['乙'], ['丙']][a.order]!, visibleDates: [['2026年'], ['10月25日'], ['11月1日']][a.order]!,
  }]));
  const { services, requests } = controlledModel(request => outputs.get(request.messages[0]?.attachmentRefs?.[0]?.id ?? request.messages[1]?.attachmentRefs?.[0]?.id ?? '')!);
  const batch = await extractAttachments(input, services, new AbortController().signal);
  oncePerInput(input, batch); expect(batch.failed).toHaveLength(0);
  const expected = [...input.attachments].sort((a,b) => a.order-b.order);
  expect(batch.items.map(x => x.attachmentId)).toEqual(expected.map(x => x.id));
  expect(batch.items.map(x => x.visibleText)).toEqual(['甲：不是2027届，是2026届。', '乙：不在10月25日截止。', '丙：尚未确认11月1日。']);
  expect(batch.items.map(x => x.speakerClues)).toEqual([['甲'], ['乙'], ['丙']]);
  expect(batch.items.map(x => x.visibleDates)).toEqual([['2026年'], ['10月25日'], ['11月1日']]);
  for (const [i, request] of requests.entries()) {
    expect(ModelRequestSchema.safeParse(request).success).toBe(true);
    const refs = request.messages.flatMap(m => m.attachmentRefs ?? []);
    expect(refs).toEqual([{ id: expected[i]!.id, bytesRef: expected[i]!.bytesRef, mime: expected[i]!.mime }]);
  }
  expect(input).toEqual(before); expect(batch.blockingQuestions).toEqual([]);
});

it.each(['provider', 'malformed', 'wrong-id', 'incomplete'] as const)('isolates a single %s failure without discarding other images or retrying', async type => {
  const input = images(); let calls = 0; const { services } = controlledModel(extraction());
  services.model = async () => {
    calls++;
    if (calls === 2 && type === 'provider') throw new Error('PRIVATE_RAW_ERROR');
    const value = calls !== 2 ? extraction() : type === 'malformed' ? { ...extraction(), visibleText: ['wrong type'] }
      : type === 'wrong-id' ? { ...extraction(), attachmentId: input.attachments.find(a => a.order === 0)!.id } : extraction();
    return { value, usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: calls === 2 && type === 'incomplete' ? 'length' : 'stop' };
  };
  const batch = await extractAttachments(input, services, new AbortController().signal);
  oncePerInput(input, batch); expect(calls).toBe(3); expect(batch.items).toHaveLength(2);
  expect(batch.failed).toHaveLength(1); expect(batch.failed[0]!.attachmentId).toBe(input.attachments.find(a => a.order === 1)!.id);
  expect(JSON.stringify(batch)).not.toContain('PRIVATE_RAW_ERROR');
});

it.each(['id', 'order', 'dimensions', 'empty', 'mime'] as const)('rejects invalid input %s before model calls', async type => {
  const input = images();
  if (type === 'id') input.attachments[0]!.id = input.attachments[1]!.id;
  if (type === 'order') input.attachments[0]!.order = input.attachments[1]!.order;
  if (type === 'dimensions') input.attachments[0]!.width = 0;
  if (type === 'empty') input.attachments = [];
  if (type === 'mime') Object.assign(input.attachments[0]!, { mime: 'image/gif' });
  const { services, requests } = controlledModel(extraction());
  await expect(extractAttachments(input, services, new AbortController().signal)).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

it('accounts for every image as cancelled when aborted before dispatch', async () => {
  const input = images(); const controller = new AbortController(); controller.abort();
  const { services, requests } = controlledModel(extraction());
  const batch = await extractAttachments(input, services, controller.signal);
  oncePerInput(input, batch); expect(batch.items).toHaveLength(0); expect(requests).toHaveLength(0);
  expect(batch.failed.every(x => x.errorCode === 'extraction_cancelled')).toBe(true);
  expect(batch.blockingQuestions).toEqual([]);
});

it('does not start the second image after an abort during the first image response', async () => {
  const input = images(); const controller = new AbortController(); let calls = 0;
  const { services } = controlledModel(extraction());
  services.model = async () => { calls++; controller.abort(); return { value: extraction(), usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' }; };
  const batch = await extractAttachments(input, services, controller.signal);
  oncePerInput(input, batch); expect(calls).toBe(1); expect(batch.items).toHaveLength(0);
  expect(batch.failed.every(x => x.errorCode === 'extraction_cancelled')).toBe(true);
});

it('preserves a completed first image and cancels in-flight and unstarted images', async () => {
  const input = images(); const controller = new AbortController(); let calls = 0;
  const { services } = controlledModel(extraction());
  services.model = async () => { calls++; if (calls === 2) { controller.abort(); throw new Error('PRIVATE_ABORT'); }
    return { value: extraction(), usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' }; };
  const batch = await extractAttachments(input, services, controller.signal);
  oncePerInput(input, batch); expect(calls).toBe(2); expect(batch.items).toHaveLength(1);
  expect(batch.items[0]!.attachmentId).toBe(input.attachments.find(a => a.order === 0)!.id);
  expect(batch.failed.every(x => x.errorCode === 'extraction_cancelled')).toBe(true);
});

it('returns on cancellation even when the model ignores abort, without accepting its late output', async () => {
  const input = images(); const controller = new AbortController();
  let resolveModel!: (value: ModelResponse) => void; let started!: () => void;
  const didStart = new Promise<void>(resolve => { started = resolve; });
  const { services } = controlledModel(extraction()); let calls = 0;
  services.model = () => { calls++; started(); return new Promise(resolve => { resolveModel = resolve; }); };
  const pending = extractAttachments(input, services, controller.signal);
  await didStart; controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([pending, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 200); })]);
    expect(result).not.toBeNull();
    if (result) {
      oncePerInput(input, result); expect(result.items).toHaveLength(0);
      const beforeLate = JSON.stringify(result);
      resolveModel({ value: extraction('LATE_OUTPUT'), usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' });
      await Promise.resolve(); await Promise.resolve();
      expect(JSON.stringify(result)).toBe(beforeLate);
    }
    expect(calls).toBe(1);
  } finally {
    clearTimeout(timer);
    resolveModel({ value: extraction('LATE_OUTPUT'), usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' });
    void pending.catch(() => {});
  }
});

it('keeps uncertain dates unknown and asks only about conclusion-affecting ambiguity with image provenance', async () => {
  const input = images(); const object = input.attachments.find(a => a.order === 1)!;
  const { services } = controlledModel(request => {
    const id = request.messages.flatMap(m => m.attachmentRefs ?? [])[0]!.id;
    return { ...extraction(), uncertainSpans: id === object.id ? [{ text: '调查对象/主办方', reason: '关键名称被遮挡', affectsConclusion: true }]
      : [{ text: '年份', reason: '年份模糊，不能写成已知2026年', affectsConclusion: false }], visibleDates: [] };
  });
  const batch = await extractAttachments(input, services, new AbortController().signal);
  oncePerInput(input, batch); expect(batch.items.every(x => x.visibleDates.length === 0)).toBe(true);
  expect(batch.items.every(x => x.uncertainSpans.length === 1)).toBe(true);
  expect(batch.blockingQuestions).toHaveLength(1); expect(batch.blockingQuestions[0]).toContain(object.id);
  expect(batch.blockingQuestions[0]).toContain('第2张'); expect(batch.blockingQuestions[0]).toContain('调查对象/主办方');
});

it('does not silently turn an empty image into a successfully identified investigation object', async () => {
  const input = images(); input.attachments = [input.attachments.find(a => a.order === 0)!];
  const { services } = controlledModel({ visibleText: '', speakerClues: [], visibleDates: [], claimSuggestions: [], uncertainSpans: [], warnings: [] });
  const batch = await extractAttachments(input, services, new AbortController().signal);
  oncePerInput(input, batch); expect(batch.items[0]!.warnings.length).toBeGreaterThan(0);
  expect(batch.items[0]!.uncertainSpans.some(x => x.affectsConclusion)).toBe(true);
  expect(batch.blockingQuestions).toHaveLength(1);
});

it('keeps many long critical uncertainties intact without overflowing batch questions', async () => {
  const input = images();
  const uncertainSpans = Array.from({length:80}, (_, i) => ({text:`待确认${i}`+'字'.repeat(1000),reason:'原因'.repeat(1000),affectsConclusion:true}));
  const { services } = controlledModel({ ...extraction(), uncertainSpans });
  const batch = await extractAttachments(input, services, new AbortController().signal);
  oncePerInput(input, batch); expect(batch.items).toHaveLength(3); expect(batch.failed).toHaveLength(0);
  expect(batch.items.every(x => x.uncertainSpans.length === 80)).toBe(true);
  expect(batch.items[0]!.uncertainSpans[0]!.text).toBe(uncertainSpans[0]!.text);
  expect(batch.blockingQuestions).toHaveLength(3);
  expect(batch.blockingQuestions.every(q => q.length <= 4000)).toBe(true);
});

it.each(['warnings', 'uncertainties', 'both'] as const)('retains a blank extraction at %s capacity without dropping existing entries', async capacity => {
  const input = images(); input.attachments = [input.attachments.find(a => a.order === 0)!];
  const warnings = capacity === 'uncertainties' ? [] : Array.from({length:80}, (_, i) => `已有警告${i}`);
  const uncertainSpans = capacity === 'warnings' ? [] : Array.from({length:80}, (_, i) => ({text:`不影响结论的未知${i}`,reason:'装饰文字不清',affectsConclusion:false}));
  const { services } = controlledModel({ ...extraction(''), warnings, uncertainSpans });
  const batch = await extractAttachments(input, services, new AbortController().signal);
  oncePerInput(input, batch); expect(batch.failed).toHaveLength(0);
  expect(batch.items[0]!.warnings.slice(0, warnings.length)).toEqual(warnings);
  expect(batch.items[0]!.uncertainSpans.slice(0, uncertainSpans.length)).toEqual(uncertainSpans);
  if (warnings.length === 80) expect(batch.items[0]!.warnings).toHaveLength(80);
  if (uncertainSpans.length === 80) expect(batch.items[0]!.uncertainSpans).toHaveLength(80);
  expect(batch.blockingQuestions).toHaveLength(1); expect(batch.blockingQuestions[0]).toContain('调查对象');
  expect(batch.blockingQuestions[0]).toContain(input.attachments[0]!.id);
});

it('does not dispatch a scheduled model when cancelled before its send microtask', async () => {
  const input = images(); const controller = new AbortController(); const { services, requests } = controlledModel(extraction());
  const pending = extractAttachments(input, services, controller.signal);
  controller.abort();
  const batch = await pending;
  oncePerInput(input, batch); expect(requests).toHaveLength(0); expect(batch.items).toHaveLength(0);
  expect(batch.failed.every(x => x.errorCode === 'extraction_cancelled')).toBe(true);
});
