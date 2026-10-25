import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { experienceSeed, experienceDraft } from '../helpers/experience.js';
import { ExperienceAudio } from '../../src/server/platform/experience-audio.js';
import { PrivateAssets } from '../../src/server/platform/private-assets.js';
import { createSpeechAuthorizationResolver } from '../../src/server/platform/speech-authorization.js';
const closes:Array<()=>void>=[];afterEach(()=>{for(const close of closes.splice(0))close();});
const voice={id:'controlled_voice',provider:'tencent-tts' as const,voiceType:123456789,revision:'controlled_fixture_not_real_voice',available:true as const};
function setup(){
 const s=experienceSeed(),root=mkdtempSync(join(tmpdir(),'controlled-speech-auth-')),assets=new PrivateAssets(s.db,root),audio=new ExperienceAudio(s.store,assets);
 const companion=s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at),initial=s.store.claim(s.at)!;s.store.finishCompanion(initial.id,initial.epoch,experienceDraft(s),s.at);
 const session=s.store.companion(companion.id,s.owner).session,segment=session.segments[0]!,request={segmentId:segment.id,voiceId:voice.id,speed:0 as const};
 const audioJob=audio.create(s.owner,session.id,'controlled-audio',request,{id:voice.id,providerVersion:'controlled_fixture-v1',splitVersion:'speech-sentences-v1',binding:voice},s.at),job=s.store.claim(s.at)!;
 const input={context:s.store.context(job.id,s.at),resultVersionId:s.version.id,companionSessionId:session.id,segmentId:segment.id,text:segment.text,voiceId:voice.id,speed:0 as const};
 closes.push(()=>{s.db.close();rmSync(root,{recursive:true,force:true});});return{...s,audio,session,audioJob,job,input};
}
it('resolves an active owned job from saved records and persisted provider voice identity',async()=>{
 const s=setup(),resolve=createSpeechAuthorizationResolver(s.store,[voice],()=>s.at),binding=await resolve(s.input,new AbortController().signal);
 expect(s.audioJob.request.voiceBinding).toEqual(voice);expect(binding).toMatchObject({ownerSessionId:s.owner,accessGroup:'trial',version:{id:s.version.id},companion:{id:s.session.id},voice});
 await expect(resolve({...s.input,text:'controlled_fixture invented text'},new AbortController().signal)).rejects.toThrow();
 await expect(resolve({...s.input,context:{...s.input.context,sessionId:randomUUID()}},new AbortController().signal)).rejects.toThrow();
 await expect(resolve({...s.input,resultVersionId:randomUUID()},new AbortController().signal)).rejects.toThrow();
 s.store.cancel(s.job.id,s.owner,s.at);await expect(resolve(s.input,new AbortController().signal)).rejects.toThrow();
});
it('does not invent a binding when config changes and checks abort before looking up private records',async()=>{
 const s=setup(),resolve=createSpeechAuthorizationResolver(s.store,[{...voice,voiceType:123456780,revision:'controlled_fixture_changed'}],()=>s.at);
 await expect(resolve(s.input,new AbortController().signal)).rejects.toMatchObject({status:503,code:'PROVIDER_UNAVAILABLE'});
 const aborted=new AbortController();aborted.abort();await expect(resolve(s.input,aborted.signal)).rejects.toHaveProperty('name','AbortError');
});
it('gives a changed provider voice type a different durable cache identity',()=>{
 const s=setup();s.store.cancel(s.job.id,s.owner,s.at);
 const next=s.audio.create(s.owner,s.session.id,'controlled-voice-type-change',{segmentId:s.input.segmentId,voiceId:voice.id,speed:0},{id:voice.id,providerVersion:'controlled_fixture-v1',splitVersion:'speech-sentences-v1',binding:{...voice,voiceType:123456780}},s.at);
 expect(next.id).not.toBe(s.audioJob.id);expect(next.request.voiceBinding).toMatchObject({voiceType:123456780});
});
