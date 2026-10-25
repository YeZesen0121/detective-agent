import type { TTSRequest, TTSResponse } from '../../../shared/ports.js';
import type { SpeechVoice } from '../../companion/speech-ports.js';
import { SpeechVoiceSchema } from '../../companion/speech-ports.js';
import { TTSRequestSchema } from '../../../shared/ports.js';
import { SpeechError } from '../../companion/speech-errors.js';
import { checkedPrivateAudio, MAX_PRIVATE_AUDIO_BYTES } from './audio.js';
import { speechAttempt } from './attempt.js';
import { tencentErrorDiagnostic } from './diagnostic.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export interface TextToVoiceRequest { Text: string; SessionId: string; Speed: 0; Codec: 'mp3'; VoiceType: number }
export interface TextToVoiceTransport { send(request: TextToVoiceRequest, signal: AbortSignal): Promise<unknown> }
export const TEXT_TO_VOICE_API = { endpoint: 'tts.tencentcloudapi.com', action: 'TextToVoice', version: '2019-08-23' } as const;
export function normalizeTextToVoiceResponse(raw: unknown, sessionId: string): TTSResponse {
  const envelope = z.object({ Response: z.unknown() }).safeParse(raw);
  const value = envelope.success ? envelope.data.Response : raw;
  const failed = z.object({ Error: z.unknown() }).safeParse(value);
  if (failed.success) throw new SpeechError('SPEECH_PROVIDER_FAILED', '语音供应商返回错误，本次没有可用音频。', false, tencentErrorDiagnostic(value));
  const parsed = z.object({ Audio: z.string().min(1).max(Math.ceil(MAX_PRIVATE_AUDIO_BYTES / 3) * 4),
    SessionId: z.string().min(1).max(128), RequestId: z.string().min(1).max(256) }).safeParse(value);
  if (!parsed.success || parsed.data.SessionId !== sessionId) throw new SpeechError('SPEECH_INVALID_AUDIO', '语音响应格式或请求归属不正确，本次音频不交付。');
  const encoded = parsed.data.Audio;
  // A canonical decode/encode round trip below checks padding without a nested repeated regex.
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) throw new SpeechError('SPEECH_INVALID_AUDIO', '语音响应不是有效的音频编码。');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new SpeechError('SPEECH_INVALID_AUDIO', '语音响应的音频编码不完整。');
  return checkedPrivateAudio({ audioBytes: bytes, contentType: 'audio/mpeg', providerRequestId: parsed.data.RequestId,
    billedCharacters: null, usage: null });
}
/** P calls this adapter inside its single gateway invocation; transport is one raw send, without another charge wrapper. */
export async function synthesizeTencentOnce(request: TTSRequest, voice: SpeechVoice, transport: TextToVoiceTransport, signal: AbortSignal): Promise<TTSResponse> {
  const input = TTSRequestSchema.safeParse(request); const configured = SpeechVoiceSchema.safeParse(voice);
  if (!input.success || !configured.success) throw new SpeechError('SPEECH_INVALID_INPUT', '语音文字或已配置音色无效。');
  if (input.data.voiceId !== configured.data.id) throw new SpeechError('SPEECH_VOICE_MISMATCH', '所选音色与服务端配置不匹配。');
  const sessionId = randomUUID();
  return speechAttempt(async childSignal => normalizeTextToVoiceResponse(await transport.send({ Text: input.data.text,
    SessionId: sessionId, Speed: 0, Codec: 'mp3', VoiceType: configured.data.voiceType }, childSignal), sessionId), signal);
}
