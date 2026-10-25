import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createExperiencePricing, createLiveExperienceRuntime } from '../../src/server/platform/experience-runtime.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
const now = () => '2026-10-25T00:00:00.000Z';
const model = { purpose: 'extract' as const, schemaId: 'experience.extraction.v1', promptVersion: 'controlled_fixture', maxOutputTokens: 1800, messages: [{ role: 'user' as const, content: '受控图像中的日期和否定词' }] };
const image = () => ({ id: randomUUID(), mime: 'image/png' as const, width: 800, height: 600 });
const funds = { ...zeroAmounts(), activeMs: 1200000, searches: 12, reads: 6, modelCalls: 30, inputTokens: 200000, outputTokens: 30000, moneyMicros: 20000000 };
const funding = { global: funds, trial: funds, demo: zeroAmounts() };
it('quotes text plus the official 1024-token image upper bound and fixed 1800-token output', () => {
  const price = createExperiencePricing(now), images = [image(), image(), image()], quote = price.quote('model', model, images);
  expect(price.visionInputTokens!(images)).toBe(3072);
  expect(quote.estimated.inputTokens).toBe(Buffer.byteLength(JSON.stringify(model.messages), 'utf8') + 512 + 3072);
  expect(quote.estimated.outputTokens).toBe(1800); expect(quote.estimated.modelCalls).toBe(1);
  expect(quote.estimated.moneyMicros).toBe(quote.estimated.inputTokens * 2 + 1800 * 8); expect(quote.purpose).toBe('experience.extract');
});
it('counts all TTS text conservatively including punctuation, whitespace and surrogate pairs, with no free-package assumption', () => {
  const price = createExperiencePricing(now), text = '仍不确定。 A\n🕵', quote = price.quote('tts', { text, voiceId: 'zh-male-zhike', speed: 0, codec: 'mp3' });
  expect(quote.estimated.moneyMicros).toBe(text.length * 30); expect(quote.provider).toBe('tencent-tts');
  const receipt = { audioBytes: new Uint8Array([1]), contentType: 'audio/mpeg' as const, providerRequestId: 'controlled_fixture', billedCharacters: text.length, usage: null };
  expect(price.actual('tts', receipt)?.moneyMicros).toBe(text.length * 30); expect(price.actual('tts', { ...receipt, billedCharacters: null })).toBeNull();
});
it('refuses expired pricing and impossible image metadata before quoting a paid request', () => {
  const expired = createExperiencePricing(() => '2026-10-26T00:00:00.000Z'); expect(() => expired.quote('model', model)).toThrow();
  const price = createExperiencePricing(now); expect(() => price.visionInputTokens!([{ ...image(), width: 8193 }])).toThrow(); expect(() => price.visionInputTokens!([image(), image(), image(), image()])).toThrow();
});
it('creates the real E module with vision pricing and leaves unconfigured audio unavailable', () => {
  const runtime = createLiveExperienceRuntime({ deepseekKey: 'controlled_fixture_key', funding, now });
  expect(typeof runtime.module.extractAttachments).toBe('function'); expect(typeof runtime.module.buildCompanion).toBe('function'); expect(runtime.providers.tts).toBeUndefined(); expect(runtime.voices).toEqual([]); expect(runtime.pricing.visionInputTokens!([image()])).toBe(1024);
});
it('allows only the two reviewed preset voices and creates E persistent speech through P authorization', () => {
  const runtime = createLiveExperienceRuntime({ deepseekKey: 'controlled_fixture_key', funding, now, tts: { secretId: 'controlled_fixture_id', secretKey: 'controlled_fixture_key', voiceIds: ['zh-male-zhike', 'zh-female-zhifu'] } });
  expect(runtime.voices?.map(v => v.id)).toEqual(['zh-male-zhike', 'zh-female-zhifu']); expect(runtime.speechVoices?.map(v => v.voiceType)).toEqual([101030, 101055]); expect(typeof runtime.createSpeechSynthesizer).toBe('function'); expect(typeof runtime.providers.tts).toBe('function');
  expect(() => createLiveExperienceRuntime({ deepseekKey: 'controlled_fixture_key', funding, now, tts: { secretId: 'controlled_fixture_id', secretKey: 'controlled_fixture_key', voiceIds: ['custom-clone'] } })).toThrow();
});
