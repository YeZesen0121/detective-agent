import { SpeechInputSchema } from '../../shared/ports.js';
import { SpeechVoiceBindingSchema, type SpeechAuthorizationResolver, type SpeechVoiceBinding } from './experience-ports.js';
import type { ExperienceStore } from './experience-store.js';
import { ApiFault } from './errors.js';
import { hashValue, readSnapshot } from './snapshots.js';

/** Trusted configuration and saved records only: a valid JSON binding is not authorization. */
export function createSpeechAuthorizationResolver(store:ExperienceStore,configured:readonly SpeechVoiceBinding[],now:()=>string):SpeechAuthorizationResolver{
 const voices=configured.map(voice=>Object.freeze(SpeechVoiceBindingSchema.parse(voice)));
 if(new Set(voices.map(voice=>voice.id)).size!==voices.length)throw new ApiFault(503,'PROVIDER_UNAVAILABLE','音色配置存在重复标识。');
 return async(raw,signal)=>{
  signal.throwIfAborted();const input=SpeechInputSchema.parse(raw),job=store.assertContext(input.context,now());
  if(job.kind!=='audio'||job.companionId!==input.companionSessionId||job.resultVersionId!==input.resultVersionId||job.request.segmentId!==input.segmentId||job.request.text!==input.text||job.request.voiceId!==input.voiceId)throw new ApiFault(409,'INVALID_STATE','语音请求与已授权任务不一致。');
  const saved=SpeechVoiceBindingSchema.safeParse(job.request.voiceBinding),configuredVoice=voices.find(voice=>voice.id===input.voiceId);
  if(!saved.success||!configuredVoice||hashValue(saved.data)!==hashValue(configuredVoice))throw new ApiFault(503,'PROVIDER_UNAVAILABLE','已保存音色绑定与当前可信配置不一致，尚未合成。');
  const version=readSnapshot(store.db,job.resultVersionId,job.sessionId),{session:companion,voiceId}=store.companion(job.companionId,job.sessionId);
  const segments=companion.segments.filter(segment=>segment.id===input.segmentId);
  if(!version||version.investigationId!==job.investigationId||companion.investigationId!==job.investigationId||companion.resultVersionId!==job.resultVersionId||!['ready','ended'].includes(companion.status)||voiceId!==input.voiceId||segments.length!==1||segments[0]!.text!==input.text)throw new ApiFault(409,'INVALID_STATE','语音引用必须属于该会话已保存的唯一报告段落。');
  signal.throwIfAborted();return{ownerSessionId:job.sessionId,accessGroup:input.context.accessGroup,version,companion,voice:saved.data};
 };
}
