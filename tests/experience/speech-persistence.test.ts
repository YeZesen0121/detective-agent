import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createSpeechSynthesizer } from '../../src/server/companion/speech-persistent.js';
import { createExperienceModule, experienceTextModule } from '../../src/server/companion/module.js';
import type { SpeechBinding } from '../../src/server/companion/speech-ports.js';
import type { SpeechInput, TTSResponse } from '../../src/shared/ports.js';
import { companionCase, controlledModel } from './companion-fixture.js';

// controlled_fixture: these signature-shaped bytes test persistence, never actual playback.
const receipt=():TTSResponse=>({audioBytes:new Uint8Array([255,251,144,100,1,2,3,4]),contentType:'audio/mpeg',providerRequestId:'controlled_fixture',billedCharacters:null,usage:null});
function fixture(){
 const f=companionCase(),text='尚未确认延期，仅限广州校区。'.repeat(12),segment=f.turn.session.segments[0]!;segment.text=text;
 const input:SpeechInput={context:f.input.context,resultVersionId:f.input.version.id,companionSessionId:f.turn.session.id,segmentId:segment.id,text,voiceId:'controlled_voice',speed:0};
 const binding:SpeechBinding={ownerSessionId:input.context.sessionId,accessGroup:input.context.accessGroup,version:f.input.version,companion:f.turn.session,voice:{id:'controlled_voice',provider:'tencent-tts',voiceType:123456789,revision:'controlled_fixture_not_real_voice',available:true}};
 const {services}=controlledModel({});const sent:TTSResponse[]=[],saved:Array<{index:number;assetId:string}>=[];const jobId=randomUUID();
 services.tts=async()=>{const value=receipt();sent.push(value);return value;};
 services.audio={jobId,saveChunk:async(index,value)=>{expect(sent).toContain(value);const item={index,assetId:randomUUID()};saved.push(item);return item;}};
 return{input,binding,services,sent,saved,jobId};
}
it('authorizes saved records, prepares locally and publishes only chunks saved with their original receipt',async()=>{
 const f=fixture();let authorized=0;const synthesize=createSpeechSynthesizer(async(input,signal)=>{authorized++;expect(input).toEqual(f.input);expect(signal.aborted).toBe(false);return f.binding;});
 const result=await synthesize(f.input,f.services,new AbortController().signal);
 expect(authorized).toBe(1);expect(f.sent.length).toBeGreaterThan(1);expect(result).toEqual({jobId:f.jobId,status:'ready',chunks:f.saved.map(item=>({...item,status:'ready'})),error:null});
});
it('composes the actual text module without replacing its evidence-preserving implementations',()=>{
 const f=fixture(),module=createExperienceModule(async()=>f.binding);
 expect(module.buildCompanion).toBe(experienceTextModule.buildCompanion);expect(module.extractAttachments).toBe(experienceTextModule.extractAttachments);expect(typeof module.synthesizeSegment).toBe('function');
});
it('requires the host storage port before authorization or paid synthesis',async()=>{
 const f=fixture();delete f.services.audio;let authorized=0;
 await expect(createSpeechSynthesizer(async()=>{authorized++;return f.binding;})(f.input,f.services,new AbortController().signal)).rejects.toMatchObject({code:'SPEECH_STORAGE_UNAVAILABLE'});
 expect(authorized).toBe(0);expect(f.sent).toHaveLength(0);
});
it.each(['owner','group','version','companion','segment','text','voice'] as const)('rejects a mismatched %s saved binding before any TTS',async field=>{
 const f=fixture();if(field==='owner')f.binding.ownerSessionId=randomUUID();if(field==='group')f.binding.accessGroup='demo';
 if(field==='version')f.input.resultVersionId=randomUUID();if(field==='companion')f.input.companionSessionId=randomUUID();if(field==='segment')f.input.segmentId=randomUUID();
 if(field==='text')f.input.text='已经确认延期。';if(field==='voice')f.input.voiceId='wrong_voice';
 await expect(createSpeechSynthesizer(async()=>f.binding)(f.input,f.services,new AbortController().signal)).rejects.toThrow();expect(f.sent).toHaveLength(0);
});
it('retains the first saved block if the second TTS fails and never automatically retries',async()=>{
 const f=fixture();let attempts=0;f.services.tts=async()=>{if(++attempts===2)throw Error('PRIVATE_PROVIDER_SECRET');const value=receipt();f.sent.push(value);return value;};
 const result=await createSpeechSynthesizer(async()=>f.binding)(f.input,f.services,new AbortController().signal);
 expect(attempts).toBe(2);expect(result.status).toBe('partial');expect(result.chunks).toHaveLength(1);expect(result.error).toBe('SPEECH_PROVIDER_FAILED');expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_SECRET');
});
it('does not publish or resynthesize a block when its save receipt is uncertain',async()=>{
 const f=fixture();f.services.audio!.saveChunk=async()=>{throw Error('PRIVATE_STORAGE_PATH');};
 const result=await createSpeechSynthesizer(async()=>f.binding)(f.input,f.services,new AbortController().signal);
 expect(result).toMatchObject({status:'failed',chunks:[],error:'SPEECH_STORAGE_FAILED'});expect(f.sent).toHaveLength(1);expect(JSON.stringify(result)).not.toContain('PRIVATE_STORAGE_PATH');
});
it('rejects a mismatched saved chunk receipt rather than manufacturing a ready resource',async()=>{
 const f=fixture();f.services.audio!.saveChunk=async()=>({index:99,assetId:randomUUID()});
 const result=await createSpeechSynthesizer(async()=>f.binding)(f.input,f.services,new AbortController().signal);
 expect(result.status).toBe('failed');expect(result.chunks).toEqual([]);expect(f.sent).toHaveLength(1);
});
it('drops a cancelled in-flight second chunk while retaining the first saved chunk',async()=>{
 const f=fixture(),controller=new AbortController(),save=f.services.audio!.saveChunk;
 f.services.tts=async()=>{if(f.saved.length)controller.abort();const value=receipt();f.sent.push(value);return value;};
 f.services.audio!.saveChunk=save;
 const result=await createSpeechSynthesizer(async()=>f.binding)(f.input,f.services,controller.signal);
 expect(result.status).toBe('cancelled');expect(result.chunks).toHaveLength(1);expect(f.saved).toHaveLength(1);expect(f.sent).toHaveLength(2);
});
it('drops a late authorized binding on cancellation without sending a paid request',async()=>{
 const f=fixture(),controller=new AbortController();let release!:(b:SpeechBinding)=>void;
 const pending=createSpeechSynthesizer(()=>new Promise(r=>{release=r;}))(f.input,f.services,controller.signal);
 controller.abort();release(f.binding);await expect(pending).rejects.toMatchObject({code:'SPEECH_ABORTED'});expect(f.sent).toHaveLength(0);
});
