import { expect, it } from 'vitest';
import { experienceRuntimeFromEnvironment } from '../../src/server/platform/experience-configuration.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { truthRuntimeFromEnvironment } from '../../src/server/platform/truth-configuration.js';
const amounts = { ...zeroAmounts(), activeMs: 1200000, searches: 12, reads: 6, modelCalls: 30, inputTokens: 200000, outputTokens: 30000, moneyMicros: 20000000 };
const env = { EXPERIENCE_RUNTIME_ENABLED: '1', DEEPSEEK_API_KEY: 'controlled_fixture_key', RUNTIME_FUNDING_JSON: JSON.stringify({ global: amounts, trial: amounts, demo: zeroAmounts() }) };
it('stays disabled by default and rejects inconsistent or incomplete opt-ins with safe errors', () => {
  expect(experienceRuntimeFromEnvironment({})).toBeUndefined();
  for (const input of [{ ...env, EXPERIENCE_RUNTIME_ENABLED: 'yes' }, { ...env, DEEPSEEK_API_KEY: '' }, { ...env, RUNTIME_FUNDING_JSON: '' }, { TTS_RUNTIME_ENABLED: '1' }]) expect(() => experienceRuntimeFromEnvironment(input)).toThrow();
});
it('enables real vision and text without requiring or inventing Tencent speech settings', () => {
  const runtime = experienceRuntimeFromEnvironment(env)!; expect(typeof runtime.module.extractAttachments).toBe('function'); expect(runtime.pricing.visionInputTokens!([])).toBe(0); expect(runtime.voices).toEqual([]);
});
it('requires explicit speech opt-in, credentials and reviewed preset ids instead of public provider parameters', () => {
  const speech = { ...env, TTS_RUNTIME_ENABLED: '1', TENCENT_SECRET_ID: 'controlled_fixture_id', TENCENT_SECRET_KEY: 'controlled_fixture_key', TTS_VOICE_IDS: 'zh-male-zhike,zh-female-zhifu' };
  const runtime = experienceRuntimeFromEnvironment(speech)!; expect(runtime.voices?.map(v => v.id)).toEqual(['zh-male-zhike', 'zh-female-zhifu']);
  for (const input of [{ ...speech, TTS_VOICE_IDS: '' }, { ...speech, TTS_VOICE_IDS: '200000000' }, { ...speech, TENCENT_SECRET_KEY: '' }]) expect(() => experienceRuntimeFromEnvironment(input)).toThrow();
});
it('supports explicit Bearer search alongside Tencent speech without silently choosing ambiguous search credentials', () => {
  const combined = { ...env, TRUTH_RUNTIME_ENABLED: '1', SEARCH_AUTH_KIND: 'bearer', YUANBAO_API_KEY: 'controlled_fixture_bearer', TTS_RUNTIME_ENABLED: '1', TENCENT_SECRET_ID: 'controlled_fixture_id', TENCENT_SECRET_KEY: 'controlled_fixture_key', TTS_VOICE_IDS: 'zh-male-zhike' };
  expect(truthRuntimeFromEnvironment(combined)).toBeDefined(); expect(experienceRuntimeFromEnvironment(combined)?.providers.tts).toBeDefined();
  expect(() => truthRuntimeFromEnvironment({ ...combined, SEARCH_AUTH_KIND: '' })).toThrow();
  expect(() => truthRuntimeFromEnvironment({ ...combined, SEARCH_AUTH_KIND: 'bearer', YUANBAO_API_KEY: '' })).toThrow();
  expect(() => truthRuntimeFromEnvironment({ ...combined, SEARCH_AUTH_KIND: 'invalid' })).toThrow();
});
