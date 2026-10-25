import type { ExperiencePricing, ExperienceRuntimeOptions } from './experience-ports.js';
import type { RuntimeFunding } from './runtime-funding.js';
import { z } from 'zod';
import { BudgetAmountsSchema } from '../../shared/contracts.js';
import { ModelRequestSchema, TTSRequestSchema } from '../../shared/ports.js';
import { zeroAmounts } from './budget.js';
import { createProviderPricing, PRICE_20261024 } from './provider-pricing.js';
import { createExperienceModelProvider } from './provider-transports.js';
import { createTencentSpeechProvider } from './experience-tts-provider.js';
import { ApiFault } from './errors.js';
import { experienceTextModule } from '../companion/module.js';
import { createSpeechSynthesizer } from '../companion/speech-persistent.js';
import { SPEECH_SPLIT_VERSION } from '../companion/speech.js';
export const BASIC_SPEECH_VOICES = [{ id: 'zh-male-zhike', label: '智柯（男声）', voiceType: 101030 }, { id: 'zh-female-zhifu', label: '智付（女声）', voiceType: 101055 }] as const;
export interface LiveExperienceOptions { deepseekKey: string; funding: RuntimeFunding; fetch?: typeof fetch; now?: () => string; tts?: { secretId: string; secretKey: string; voiceIds: string[]; region?: string } }
const priceId = '2026-10-25-media-cny-request-upper-v1';
const imageMetadata = z.array(z.strictObject({ id: z.uuid(), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) }).refine(image => image.width * image.height <= 32000000)).max(3);
export function createExperiencePricing(now: () => string): ExperiencePricing {
  const base = createProviderPricing({ ...PRICE_20261024, id: priceId }, now);
  const visionInputTokens = (images: Parameters<NonNullable<ExperiencePricing['visionInputTokens']>>[0]) => imageMetadata.parse(images).length * 1024;
  return {
    visionInputTokens,
    quote(operation, raw, images = []) {
      if (Date.parse(now()) >= Date.parse(PRICE_20261024.validUntil)) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '媒体价格版本已到期，请先核对配置。');
      if (operation === 'model') {
        const input = ModelRequestSchema.parse(raw), quote = base.quote('model', input), additional = visionInputTokens(images);
        quote.estimated.inputTokens += additional; quote.estimated.moneyMicros += additional * PRICE_20261024.inputMicrosPerToken;
        return { ...quote, purpose: 'experience.' + input.purpose };
      }
      const input = TTSRequestSchema.parse(raw);
      if (!BASIC_SPEECH_VOICES.some(voice => voice.id === input.voiceId)) throw new ApiFault(503, 'PROVIDER_UNAVAILABLE', '未配置该音色的已核查价格。');
      return { provider: 'tencent-tts', purpose: 'experience.tts', attemptNo: 1, estimated: { ...zeroAmounts(), moneyMicros: input.text.length * 30 }, priceRevision: priceId, timeoutMs: 20000 };
    },
    actual(operation, response) {
      if (operation === 'model') return 'value' in response ? base.actual('model', response) : null;
      if (!('billedCharacters' in response) || response.billedCharacters === null || response.billedCharacters <= 0) return null;
      return { ...zeroAmounts(), moneyMicros: response.billedCharacters * 30 };
    },
  };
}
export function createLiveExperienceRuntime(options: LiveExperienceOptions): ExperienceRuntimeOptions {
  const key = z.string().trim().min(1).parse(options.deepseekKey);
  z.strictObject({ global: BudgetAmountsSchema, trial: BudgetAmountsSchema, demo: BudgetAmountsSchema }).parse(options.funding);
  const now = options.now ?? (() => new Date().toISOString());
  const runtime: ExperienceRuntimeOptions = { module: experienceTextModule, funding: options.funding, pricing: createExperiencePricing(now), voices: [],
    providers: { model: createExperienceModelProvider({ deepseekKey: key, ...(options.fetch ? { fetch: options.fetch } : {}) }) } };
  if (options.tts) {
    const ids = z.array(z.string()).min(1).max(2).parse(options.tts.voiceIds);
    if (new Set(ids).size !== ids.length || ids.some(id => !BASIC_SPEECH_VOICES.some(voice => voice.id === id))) throw Error('Only reviewed preset speech voices are available');
    const selected = ids.map(id => BASIC_SPEECH_VOICES.find(voice => voice.id === id)!);
    runtime.speechVoices = selected.map(voice => ({ id: voice.id, provider: 'tencent-tts', voiceType: voice.voiceType, revision: 'tencent-basic-2026-10-09', available: true }));
    runtime.voices = selected.map(voice => ({ id: voice.id, label: voice.label, available: true }));
    runtime.providers.tts = createTencentSpeechProvider({ secretId: options.tts.secretId, secretKey: options.tts.secretKey, voices: runtime.speechVoices,
      ...(options.tts.region ? { region: options.tts.region } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) });
    runtime.createSpeechSynthesizer = createSpeechSynthesizer;
    runtime.ttsProviderVersion = 'tencent-basic-2019-08-23-request-upper-v1'; runtime.splitVersion = SPEECH_SPLIT_VERSION;
  }
  return runtime;
}
