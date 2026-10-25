import { AudioManifestSchema, IdSchema, type AudioManifest } from '../../shared/contracts.js';
import { SpeechInputSchema, type ExperienceModule, type SpeechInput } from '../../shared/ports.js';
import type { SpeechBinding } from './speech-ports.js';
import { SpeechError } from './speech-errors.js';
import { prepareSpeechPlan, synthesizeSpeechChunk } from './speech.js';

/** Server-only closure supplied by P; never deserialize a binding or plan from HTTP. */
export type ResolveAuthorizedSpeech=(input:SpeechInput,signal:AbortSignal)=>Promise<SpeechBinding>;
function live(signal:AbortSignal){if(signal.aborted)throw new SpeechError('SPEECH_ABORTED','语音已停止，文字仍可阅读。');}
export function createSpeechSynthesizer(resolveAuthorized:ResolveAuthorizedSpeech):ExperienceModule['synthesizeSegment']{
 return async(raw,services,signal)=>{
  live(signal);const parsed=SpeechInputSchema.safeParse(raw);
  if(!parsed.success)throw new SpeechError('SPEECH_INVALID_INPUT','语音请求格式无效。');
  const persistence=services.audio;
  if(!persistence||!IdSchema.safeParse(persistence.jobId).success)throw new SpeechError('SPEECH_STORAGE_UNAVAILABLE','正式音频保存端口尚未接入，文字仍可阅读。');
  let binding:SpeechBinding;
  try{binding=await resolveAuthorized(parsed.data,signal);}catch(error){live(signal);if(error instanceof SpeechError)throw error;throw new SpeechError('SPEECH_BINDING_UNAVAILABLE','无法核对这份语音的服务端授权，尚未合成。');}
  live(signal);const plan=prepareSpeechPlan(parsed.data,binding),chunks:AudioManifest['chunks']=[];
  let saving=false;
  try{
   for(const chunk of plan.chunks){
    live(signal);saving=false;const synthesized=await synthesizeSpeechChunk(plan,chunk.index,services,signal);
    live(signal);saving=true;const saved=await persistence.saveChunk(chunk.index,synthesized.audio);
    if(saved.index!==chunk.index||!IdSchema.safeParse(saved.assetId).success||chunks.some(item=>item.assetId===saved.assetId))throw new SpeechError('SPEECH_INVALID_SAVED_CHUNK','音频保存回执不符合当前片段，本次不发布。');
    chunks.push({index:chunk.index,assetId:saved.assetId,status:'ready'});
    // A successful durable acknowledgement remains real even if cancellation arrived
    // while saving. Retain it in cancelled; never dispatch the next synthesis.
    live(signal);
   }
   return AudioManifestSchema.parse({jobId:persistence.jobId,status:'ready',chunks,error:null});
  }catch(error){
   const cancelled=signal.aborted||error instanceof SpeechError&&error.code==='SPEECH_ABORTED';
   const safeCode=cancelled?'SPEECH_ABORTED':error instanceof SpeechError?error.code:saving?'SPEECH_STORAGE_FAILED':'SPEECH_PROVIDER_FAILED';
   return AudioManifestSchema.parse({jobId:persistence.jobId,status:cancelled?'cancelled':chunks.length?'partial':'failed',chunks,error:safeCode});
  }
 };
}
