import { createHash } from 'node:crypto';
import type { AudioManifest, InvocationContext } from '../../shared/contracts.js';
import { SpeechInputSchema, TTSRequestSchema, type ExperienceServices, type SpeechInput, type TTSResponse } from '../../shared/ports.js';
import { SpeechBindingSchema, type SpeechBinding, type SpeechVoice } from './speech-ports.js';
import { SpeechError } from './speech-errors.js';
import { speechAttempt } from '../providers/tts/attempt.js';
import { checkedPrivateAudio } from '../providers/tts/audio.js';
export { SpeechError } from './speech-errors.js';
export interface SpeechPlan { readonly cacheKey: string; readonly textHash: string; readonly context: InvocationContext;
  readonly resultVersionId: string; readonly companionSessionId: string; readonly segmentId: string;
  readonly voiceId: string; readonly provider: 'tencent-tts'; readonly voiceRevision: string;
  readonly speed: 0; readonly codec: 'mp3'; readonly splitVersion: string;
  readonly chunks: readonly { readonly index: number; readonly text: string; readonly textHash: string }[] }
export interface SpeechChunkAudio { index: number; textHash: string; audio: TTSResponse }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const SPEECH_SPLIT_VERSION = 'speech-sentences-v1';
interface PlanState { voice: SpeechVoice; context: InvocationContext; attempted: Set<number>; stopped: boolean }
const plans = new WeakMap<SpeechPlan, PlanState>();

export function splitSpeechText(text: string): string[] {
  if (typeof text !== 'string' || !text.trim() || text.length > 12000
    || Buffer.from(text, 'utf8').toString('utf8') !== text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
    || /<\/?[A-Za-z][^>]*>/u.test(text)) throw new SpeechError('SPEECH_INVALID_TEXT', '语音文本为空、过长、编码异常或包含不支持的语音标记。');
  const source = text.trim(); const units: string[] = []; let offset = 0;
  // Do not split inside a negative word, number or date. A sentence too long is rejected, never clipped.
  for (const match of source.matchAll(/(?:[。！？!?；;]+[”’」』）)"']*|[.](?=\s|$))/gu)) {
    const end = match.index + match[0].length; units.push(source.slice(offset, end)); offset = end;
  }
  if (offset < source.length) units.push(source.slice(offset));
  const chunks: string[] = []; let current = '';
  for (const unit of units) {
    const sentence = unit.trim(); if (!sentence) continue;
    if (sentence.length > 150) throw new SpeechError('SPEECH_SENTENCE_TOO_LONG', '语音长句超过150字且无法安全断句，请缩短句子；没有截掉否定或限定。');
    const combined = (current + unit).trim();
    if (combined.length <= 150) current = combined;
    else { if (current) chunks.push(current); current = sentence; }
  }
  if (current) chunks.push(current);
  if (!chunks.length || chunks.length > 100 || chunks.join('').replace(/\s/gu, '') !== source.replace(/\s/gu, '')) throw new SpeechError('SPEECH_INVALID_TEXT', '语音分段无法完整保留文本或超出片段上限。');
  return chunks;
}

/** The binding must come from P's authorized saved records. This does not authenticate client JSON. */
export function prepareSpeechPlan(input: SpeechInput, binding: SpeechBinding): SpeechPlan {
  const parsed = SpeechInputSchema.safeParse(input); const saved = SpeechBindingSchema.safeParse(binding);
  if (!parsed.success || !saved.success) throw new SpeechError('SPEECH_INVALID_BINDING', '语音请求或报告、会话、音色绑定格式无效。');
  const i = parsed.data, b = saved.data;
  if (b.ownerSessionId !== i.context.sessionId || b.accessGroup !== i.context.accessGroup
    || b.version.id !== i.resultVersionId || b.version.investigationId !== i.context.investigationId
    || b.companion.id !== i.companionSessionId || b.companion.resultVersionId !== b.version.id
    || b.companion.investigationId !== b.version.investigationId || !['ready','ended'].includes(b.companion.status)) {
    throw new SpeechError('SPEECH_BINDING_MISMATCH', '语音报告、会话或段落归属不匹配。');
  }
  const matches = b.companion.segments.filter(segment => segment.id === i.segmentId);
  if (matches.length !== 1 || matches[0]!.text !== i.text) throw new SpeechError('SPEECH_BINDING_MISMATCH', '朗读文字必须来自这份报告已保存的唯一段落。');
  if (b.voice.id !== i.voiceId) throw new SpeechError('SPEECH_VOICE_MISMATCH', '语音所选音色与服务端绑定不匹配。');
  const chunks = Object.freeze(splitSpeechText(i.text).map((text, index) => Object.freeze({index, text, textHash:hash(text)})));
  const textHash = hash(i.text);
  const cacheKey = hash(JSON.stringify({ owner:i.context.sessionId, group:i.context.accessGroup, investigationId:i.context.investigationId,
    resultVersionId:i.resultVersionId, companionSessionId:i.companionSessionId, segmentId:i.segmentId,
    personaVersion:b.companion.personaVersion, textHash, provider:b.voice.provider, voiceId:b.voice.id,
    voiceType:b.voice.voiceType, voiceRevision:b.voice.revision, speed:0,codec:'mp3',splitVersion:SPEECH_SPLIT_VERSION }));
  const context = Object.freeze({...i.context});
  const plan: SpeechPlan = Object.freeze({cacheKey,textHash,context,resultVersionId:i.resultVersionId,
    companionSessionId:i.companionSessionId,segmentId:i.segmentId,voiceId:i.voiceId,provider:b.voice.provider,
    voiceRevision:b.voice.revision,speed:0,codec:'mp3',splitVersion:SPEECH_SPLIT_VERSION,chunks});
  plans.set(plan, {voice:b.voice,context,attempted:new Set(),stopped:false}); return plan;
}

/** One private chunk only; caller P persists successful bytes before exposing any asset ID. */
export async function synthesizeSpeechChunk(plan: SpeechPlan, index: number, services: ExperienceServices, signal: AbortSignal): Promise<SpeechChunkAudio> {
  const state = plans.get(plan);
  if (!state || !Number.isInteger(index) || index < 0 || index >= plan.chunks.length) throw new SpeechError('SPEECH_INVALID_PLAN', '语音计划或片段索引无效。');
  if (state.stopped || state.attempted.has(index)) throw new SpeechError('SPEECH_PLAN_STOPPED', '语音计划已停止或片段已尝试，不会自动重发。');
  const chunk = plan.chunks[index]!;
  const request = TTSRequestSchema.parse({text:chunk.text,voiceId:state.voice.id,speed:0,codec:'mp3'});
  state.attempted.add(index);
  try {
    const audio = await speechAttempt(async childSignal => {
      const receipt = await services.tts(Object.freeze(request), state.context, childSignal);
      checkedPrivateAudio(receipt);
      // P authenticates this exact receipt by identity. Validation must not replace it.
      return receipt;
    }, signal, state.context.deadlineAt);
    return {index,textHash:chunk.textHash,audio};
  } catch (error) { state.stopped = true; throw error; }
}

/** Unconfigured compatibility entry. Production uses createSpeechSynthesizer with P's authorization resolver. */
export async function synthesizeSegment(input: SpeechInput, _services: ExperienceServices, signal: AbortSignal): Promise<AudioManifest> {
  if (signal.aborted) throw new SpeechError('SPEECH_ABORTED', '语音已停止，文字内容仍可阅读。');
  if (!SpeechInputSchema.safeParse(input).success) throw new SpeechError('SPEECH_INVALID_INPUT', '语音请求格式无效。');
  throw new SpeechError('SPEECH_STORAGE_UNAVAILABLE', '正式音频保存与任务清单端口尚未接入，暂不能生成可播放语音；文字仍可阅读。');
}
