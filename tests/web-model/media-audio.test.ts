import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createBrowserAudioDriver } from '../../src/web/ui/media/browser-audio.js';
import { createAudioSessionController } from '../../src/web/controllers/audio-session.js';
import type { ExperienceApi } from '../../src/web/api/experience.js';
import type { AudioDriver } from '../../src/web/controllers/audio.js';
import { createMediaJournal, newSubmission } from '../../src/web/controllers/media-submission.js';
import { ClientError } from '../../src/web/api/client.js';

class FakeAudio extends EventTarget {src='';preload='';pause=vi.fn();load=vi.fn();play=vi.fn(async()=>{});removeAttribute(){this.src='';}}
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
it('controlled_fixture browser denied play returns actionable failure, stop clears src synchronously',async()=>{
 const element=new FakeAudio();element.play.mockRejectedValue(new DOMException('denied','NotAllowedError'));
 const driver=createBrowserAudioDriver({createAudio:()=>element as unknown as HTMLAudioElement});
 await expect(driver.play(randomUUID(),new AbortController().signal)).rejects.toMatchObject({code:'AUDIO_FAILED',message:expect.stringContaining('再次点击')});expect(element.src).toBe('');expect(element.pause).toHaveBeenCalled();
});
it('late play promise and abort cannot revive or stop a newer audio element',async()=>{
 const first=new FakeAudio(),next=new FakeAudio(),d=deferred<void>();first.play.mockReturnValue(d.promise);const factory=vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next);
 const driver=createBrowserAudioDriver({createAudio:factory});const abort=new AbortController();const old=driver.play(randomUUID(),abort.signal).catch(()=>{});driver.stop();const fresh=driver.play(randomUUID(),new AbortController().signal);d.resolve();await old;expect(next.pause).not.toHaveBeenCalled();next.dispatchEvent(new Event('ended'));await fresh;expect(first.src).toBe('');
});
it('audio task double clicks generate once; lost POST recovers without regeneration; stopping is local',async()=>{
 const id=randomUUID(),d=deferred<{audioJobId:string}>();const api={voices:vi.fn(async()=>({items:[{id:'controlled_voice',label:'controlled_fixture',available:true}]})),requestAudio:vi.fn(()=>d.promise),recover:vi.fn(async()=>({submission:null})),getAudio:vi.fn(async()=>({jobId:id,status:'ready',chunks:[{index:0,assetId:randomUUID(),status:'ready'}],error:null})),cancelAudio:vi.fn()} as unknown as ExperienceApi;
 const driver:AudioDriver={play:vi.fn(async()=>{}),stop:vi.fn()};const controller=createAudioSessionController({api,driver});
 await controller.open({caseId:randomUUID(),versionId:randomUUID(),companionId:randomUUID(),segmentId:randomUUID()});const a=controller.generate('controlled_voice'),b=controller.generate('controlled_voice');expect(api.requestAudio).toHaveBeenCalledTimes(1);d.resolve({audioJobId:id});await Promise.all([a,b]);expect(driver.play).not.toHaveBeenCalled();await controller.play();expect(driver.play).toHaveBeenCalledTimes(1);controller.stop();expect(api.cancelAudio).not.toHaveBeenCalled();controller.dispose();
});
it('switching segment fences a real late manifest read and never plays it',async()=>{
 const d=deferred<any>();const api={voices:vi.fn(async()=>({items:[]})),getAudio:vi.fn(()=>d.promise)} as unknown as ExperienceApi;
 const binding={caseId:randomUUID(),versionId:randomUUID(),companionId:randomUUID(),segmentId:randomUUID()},jobId=randomUUID(),journal=createMediaJournal();
 journal.put({...newSubmission('audio',binding.caseId,'controlled-saved',binding.versionId,binding.companionId),segmentId:binding.segmentId,voiceId:'controlled_voice',outcome:'confirmed',submission:{operation:'audio',audioJobId:jobId,resultVersionId:binding.versionId,companionSessionId:binding.companionId}});
 const driver:AudioDriver={play:vi.fn(async()=>{}),stop:vi.fn()};const c=createAudioSessionController({api,driver,journal});const old=c.open(binding);await vi.waitFor(()=>expect(api.getAudio).toHaveBeenCalled());const segmentId=randomUUID();await c.open({...binding,segmentId});d.resolve({jobId,status:'ready',chunks:[],error:null});await old;expect(c.getState().binding?.segmentId).toBe(segmentId);expect(c.getState().manifest).toBeNull();expect(driver.play).not.toHaveBeenCalled();c.dispose();
});
it('lost audio acknowledgement and null recovery remain unknown, including repeated clicks',async()=>{
 const api={voices:vi.fn(async()=>({items:[{id:'voice',label:'controlled_fixture',available:true}]})),requestAudio:vi.fn(async()=>{throw Error('lost');}),recover:vi.fn(async()=>({submission:null}))} as unknown as ExperienceApi;
 const c=createAudioSessionController({api,driver:{play:vi.fn(),stop:vi.fn()}});await c.open({caseId:randomUUID(),versionId:randomUUID(),companionId:randomUUID(),segmentId:randomUUID()});await c.generate('voice');await c.generate('voice');await c.refresh();expect(api.requestAudio).toHaveBeenCalledTimes(1);expect(c.getState().submission?.outcome).toBe('unknown');c.dispose();
});
it('partial audio plays saved chunks without re-generating; dispose immediately fences playback',async()=>{
 const journal=createMediaJournal(),binding={caseId:randomUUID(),versionId:randomUUID(),companionId:randomUUID(),segmentId:randomUUID()},jobId=randomUUID(),assetId=randomUUID();
 journal.put({...newSubmission('audio',binding.caseId,'controlled-partial',binding.versionId,binding.companionId),segmentId:binding.segmentId,voiceId:'voice',outcome:'confirmed',submission:{operation:'audio',audioJobId:jobId,resultVersionId:binding.versionId,companionSessionId:binding.companionId}});
 const api={voices:vi.fn(async()=>({items:[]})),getAudio:vi.fn(async()=>({jobId,status:'partial',chunks:[{index:0,assetId,status:'ready'}],error:'controlled_fixture missing remainder'})),requestAudio:vi.fn()} as unknown as ExperienceApi;
 const d=deferred<void>();let aborted=false;const driver:AudioDriver={play:vi.fn((_asset,signal)=>{signal.addEventListener('abort',()=>{aborted=true;});return d.promise;}),stop:vi.fn()};const c=createAudioSessionController({api,driver,journal});await c.open(binding);const playing=c.play();expect(driver.play).toHaveBeenCalledWith(assetId,expect.any(AbortSignal));c.dispose();expect(aborted).toBe(true);d.resolve();await playing;expect(api.requestAudio).not.toHaveBeenCalled();
});
it('changing available voice starts a distinct job only explicitly and never rewrites old job identity',async()=>{
 const binding={caseId:randomUUID(),versionId:randomUUID(),companionId:randomUUID(),segmentId:randomUUID()},oldId=randomUUID(),newId=randomUUID(),journal=createMediaJournal();journal.put({...newSubmission('audio',binding.caseId,'controlled-voice-a',binding.versionId,binding.companionId),segmentId:binding.segmentId,voiceId:'a',outcome:'confirmed',submission:{operation:'audio',audioJobId:oldId,resultVersionId:binding.versionId,companionSessionId:binding.companionId}});
 const d=deferred<{audioJobId:string}>();const api={voices:vi.fn(async()=>({items:['a','b'].map(id=>({id,label:'controlled_fixture '+id,available:true}))})),getAudio:vi.fn(async(id:string)=>({jobId:id,status:'ready',chunks:[],error:null})),requestAudio:vi.fn(()=>d.promise)} as unknown as ExperienceApi;
 const c=createAudioSessionController({api,journal,driver:{play:vi.fn(),stop:vi.fn()}});await c.open(binding);const change=c.generate('b');expect(c.getState().manifest?.jobId).toBe(oldId);expect(c.getState().manifestVoiceId).toBe('a');d.resolve({audioJobId:newId});await change;expect(c.getState().manifest?.jobId).toBe(newId);expect(c.getState().manifestVoiceId).toBe('b');c.dispose();
});
it.each(['failed','unknown'] as const)('a newer %s submission cannot hide older saved audio on refresh',async(outcome)=>{
 const binding={caseId:randomUUID(),versionId:randomUUID(),companionId:randomUUID(),segmentId:randomUUID()},oldId=randomUUID(),journal=createMediaJournal();journal.put({...newSubmission('audio',binding.caseId,'controlled-older-audio',binding.versionId,binding.companionId),segmentId:binding.segmentId,voiceId:'a',outcome:'confirmed',submission:{operation:'audio',audioJobId:oldId,resultVersionId:binding.versionId,companionSessionId:binding.companionId}});
 const api={voices:vi.fn(async()=>({items:['a','b'].map(id=>({id,label:'controlled_fixture '+id,available:true}))})),getAudio:vi.fn(async(id:string)=>({jobId:id,status:'ready',chunks:[{index:0,assetId:randomUUID(),status:'ready'}],error:null})),requestAudio:vi.fn(async()=>{throw outcome==='failed'?new ClientError('INVALID_STATE','controlled_fixture unknown fee',null,409):new Error('lost');}),recover:vi.fn(async()=>({submission:null}))} as unknown as ExperienceApi;
 const driver={play:vi.fn(async()=>{}),stop:vi.fn()};const c=createAudioSessionController({api,journal,driver});await c.open(binding);await c.generate('b');expect(c.getState().submission?.outcome).toBe(outcome);await c.open(binding);expect(c.getState().manifest?.jobId).toBe(oldId);expect(c.getState().submission?.outcome).toBe(outcome);await c.play();expect(driver.play).toHaveBeenCalledTimes(1);expect(api.requestAudio).toHaveBeenCalledTimes(1);c.dispose();
});
it('retrying a saved partial cannot dispatch a failed submission voice instead',async()=>{
 const binding={caseId:randomUUID(),versionId:randomUUID(),companionId:randomUUID(),segmentId:randomUUID()},jobId=randomUUID(),journal=createMediaJournal();
 journal.put({...newSubmission('audio',binding.caseId,'controlled-saved-a',binding.versionId,binding.companionId),segmentId:binding.segmentId,voiceId:'a',outcome:'confirmed',submission:{operation:'audio',audioJobId:jobId,resultVersionId:binding.versionId,companionSessionId:binding.companionId}});
 journal.put({...newSubmission('audio',binding.caseId,'controlled-rejected-b',binding.versionId,binding.companionId),segmentId:binding.segmentId,voiceId:'b',outcome:'failed'});
 const api={voices:vi.fn(async()=>({items:['a','b'].map(id=>({id,label:'controlled_fixture '+id,available:true}))})),getAudio:vi.fn(async()=>({jobId,status:'partial',chunks:[],error:'controlled_fixture partial'})),requestAudio:vi.fn(async()=>({audioJobId:jobId}))} as unknown as ExperienceApi;
 const c=createAudioSessionController({api,journal,driver:{play:vi.fn(),stop:vi.fn()}});await c.open(binding);expect(c.getState()).toMatchObject({manifestVoiceId:'a',submission:{voiceId:'b',outcome:'failed'}});
 await c.generate('b',true);expect(api.requestAudio).not.toHaveBeenCalled();expect(c.getState().error?.code).toBe('VALIDATION_ERROR');await c.generate('a',true);expect(api.requestAudio).toHaveBeenCalledTimes(1);expect(vi.mocked(api.requestAudio).mock.calls[0]?.[1].voiceId).toBe('a');c.dispose();
});
