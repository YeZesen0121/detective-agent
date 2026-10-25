import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { SpeechVoiceBindingSchema, type ExperienceRuntimeOptions, type SpeechVoiceBinding } from './experience-ports.js';
import { synthesizeTencentOnce, TEXT_TO_VOICE_API } from '../providers/tts/tencent.js';
import { boundedProviderJson, ProviderTransportFault } from './provider-transports.js';
import { TTSRequestSchema } from '../../shared/ports.js';
import { SpeechError } from '../companion/speech-errors.js';
import { ASSET_LIMITS } from './private-assets.js';
export interface TencentSpeechOptions { secretId: string; secretKey: string; voices: SpeechVoiceBinding[]; fetch?: typeof fetch; now?: () => number; region?: string }
/** One bounded HTTP POST; TC3 algorithm verified against the locked official SDK in offline tests. */
export function createTencentSpeechProvider(options: TencentSpeechOptions): NonNullable<ExperienceRuntimeOptions['providers']['tts']> {
  const credentials = z.object({ secretId: z.string().trim().min(1), secretKey: z.string().trim().min(1) }).parse(options);
  const voices = z.array(SpeechVoiceBindingSchema).min(1).max(3).parse(options.voices);
  if (new Set(voices.map(voice => voice.id)).size !== voices.length) throw Error('Duplicate configured speech voice');
  const send = options.fetch ?? fetch, now = options.now ?? Date.now;
  const hmac = (key: string | Buffer, text: string) => createHmac('sha256', key).update(text).digest();
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  return async (raw, _ctx, signal) => {
    signal.throwIfAborted(); const input = TTSRequestSchema.parse(raw), voice = voices.find(voice => voice.id === input.voiceId);
    if (!voice) throw new SpeechError('SPEECH_VOICE_MISMATCH', '请选择已配置的音色。');
    const receipt = await synthesizeTencentOnce(input, voice, { send: async (request, child) => {
      child.throwIfAborted(); const payload = JSON.stringify(request), timestamp = Math.floor(now() / 1000), date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      const contentType = 'application/json; charset=utf-8', scope = date + '/tts/tc3_request', signed = 'content-type;host';
      const canonical = 'POST\n/\n\ncontent-type:' + contentType + '\nhost:' + TEXT_TO_VOICE_API.endpoint + '\n\n' + signed + '\n' + hash(payload);
      const toSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + scope + '\n' + hash(canonical);
      const signingKey = hmac(hmac(hmac('TC3' + credentials.secretKey, date), 'tts'), 'tc3_request');
      const authorization = 'TC3-HMAC-SHA256 Credential=' + credentials.secretId + '/' + scope + ', SignedHeaders=' + signed + ', Signature=' + hmac(signingKey, toSign).toString('hex');
      try {
        return await boundedProviderJson(await send('https://' + TEXT_TO_VOICE_API.endpoint + '/', { method: 'POST', redirect: 'error', signal: child,
          headers: { 'Content-Type': contentType, Host: TEXT_TO_VOICE_API.endpoint, Authorization: authorization, 'X-TC-Action': TEXT_TO_VOICE_API.action,
            'X-TC-Version': TEXT_TO_VOICE_API.version, 'X-TC-Timestamp': String(timestamp), ...(options.region ? { 'X-TC-Region': options.region } : {}) }, body: payload }));
      } catch (error) { if (error instanceof ProviderTransportFault) throw error; throw new ProviderTransportFault('network'); }
    } }, signal);
    if(receipt.audioBytes.byteLength>ASSET_LIMITS.audioChunkBytes)throw new SpeechError('SPEECH_INVALID_AUDIO','音频超出平台单块上限，本次不交付。',true);
    // TextToVoice returns no character usage. This is a conservative request-derived
    // UTF-16 upper bound (including whitespace/punctuation), never a provider invoice.
    return { ...receipt, billedCharacters: input.text.length };
  };
}
