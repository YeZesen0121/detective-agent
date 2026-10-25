import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { successFixture } from '../../src/shared/fixtures/index.js';
import { createCompanionSessionController } from '../../src/web/controllers/companion-session.js';
import type { CompanionView, ExperienceApi } from '../../src/web/api/experience.js';
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
function setup(){
 const version=structuredClone(successFixture);const view:CompanionView={session:{id:randomUUID(),investigationId:version.investigationId,resultVersionId:version.id,personaVersion:'1',status:'ready',segments:[0,1,2].map(()=>({id:randomUUID(),text:'controlled_fixture',action:null,claimIds:[],evidenceIds:[]})),cursor:0,deliveredClaimIds:[],createdAt:version.createdAt},voiceId:null,updateNotice:null};
 const api={listCompanions:vi.fn(async()=>({items:[view],nextAfter:null})),getCompanion:vi.fn(async()=>view),listTurns:vi.fn(async()=>({items:[],nextAfter:null})),patchCompanion:vi.fn(),createCompanion:vi.fn(),recover:vi.fn(async()=>({submission:null})),ask:vi.fn()} as unknown as ExperienceApi;
 const stop=vi.fn();const controller=createCompanionSessionController({api,onInterrupt:stop});return{version,view,api,stop,controller};
}
it('controlled_fixture discovers saved same-version companion without POST, keeps notice separate',async()=>{
 const s=setup();await s.controller.open(s.version);expect(s.controller.getState().view?.session.id).toBe(s.view.session.id);expect(s.api.createCompanion).not.toHaveBeenCalled();
 s.view={...s.view,updateNotice:{latestResultVersionId:randomUUID(),createdAt:s.version.createdAt}};vi.mocked(s.api.getCompanion).mockResolvedValue(s.view);await s.controller.refresh();expect(s.controller.getState().version?.id).toBe(s.version.id);s.controller.dispose();
});
it('patch failure preserves saved cursor and stops playback before request',async()=>{
 const s=setup();await s.controller.open(s.version);vi.mocked(s.api.patchCompanion).mockRejectedValue(new Error('lost'));await s.controller.selectCursor(2);
 expect(s.controller.getState().view?.session.cursor).toBe(0);expect(s.controller.getState().error).not.toBeNull();expect(s.stop).toHaveBeenCalled();s.controller.dispose();
});
it('late old version reads cannot overwrite a new fixed version',async()=>{
 const s=setup();const d=deferred<{items:CompanionView[];nextAfter:null}>();vi.mocked(s.api.listCompanions).mockReturnValueOnce(d.promise).mockResolvedValueOnce({items:[],nextAfter:null});const old=s.controller.open(s.version);
 const next={...s.version,id:randomUUID()};await s.controller.open(next);d.resolve({items:[s.view],nextAfter:null});await old;expect(s.controller.getState().version?.id).toBe(next.id);expect(s.controller.getState().view).toBeNull();s.controller.dispose();
});
it('paginates all failed and in-flight turns without promoting TurnView to domain turn',async()=>{
 const s=setup();const row=(status:'failed'|'running')=>({turnId:randomUUID(),question:'controlled_fixture question',createdAt:s.version.createdAt,view:{status,reply:null,newRunId:null,error:null}});
 const a=row('failed'),b=row('running');vi.mocked(s.api.listTurns).mockResolvedValueOnce({items:[a],nextAfter:9}).mockResolvedValueOnce({items:[b],nextAfter:null});await s.controller.open(s.version);
 expect(s.controller.getState().turns.map(x=>x.view.status)).toEqual(['failed','running']);expect(s.api.listTurns).toHaveBeenLastCalledWith(s.view.session.id,9,expect.any(AbortSignal));s.controller.dispose();
});
it('unknown create is read-only recoverable and cannot issue another POST on click',async()=>{
 const s=setup();vi.mocked(s.api.listCompanions).mockResolvedValue({items:[],nextAfter:null});vi.mocked(s.api.createCompanion).mockRejectedValue(new Error('lost'));await s.controller.open(s.version);await s.controller.generate();await s.controller.generate();expect(s.api.createCompanion).toHaveBeenCalledTimes(1);expect(s.controller.getState().submission?.outcome).toBe('unknown');s.controller.dispose();
});
it('a late pre-PATCH GET cannot roll back the acknowledged cursor',async()=>{
 const s=setup();await s.controller.open(s.version);const old=deferred<CompanionView>();vi.mocked(s.api.getCompanion).mockReturnValueOnce(old.promise);const reading=s.controller.refresh();
 vi.mocked(s.api.patchCompanion).mockResolvedValue({...s.view.session,cursor:2});await s.controller.selectCursor(2);old.resolve(s.view);await reading;expect(s.controller.getState().view?.session.cursor).toBe(2);s.controller.dispose();
});
it('turn double click coalesces and failed HTTP turn remains in history without fabricated fields',async()=>{
 const s=setup();await s.controller.open(s.version);const pending=deferred<{turnId:string}>();vi.mocked(s.api.ask).mockReturnValue(pending.promise);const a=s.controller.ask('controlled_fixture'),b=s.controller.ask('controlled_fixture');expect(s.api.ask).toHaveBeenCalledTimes(1);
 const turnId=randomUUID();vi.mocked(s.api.listTurns).mockResolvedValue({items:[{turnId,question:'controlled_fixture',createdAt:s.version.createdAt,view:{status:'failed',reply:null,newRunId:null,error:{code:'CONTROLLED_FAIL',message:'controlled_fixture failed'}}}],nextAfter:null});pending.resolve({turnId});await Promise.all([a,b]);expect(s.controller.getState().turns[0]?.view).toMatchObject({status:'failed',reply:null,newRunId:null});s.controller.dispose();
});
it('rejects stalled page cursors instead of silently dropping turn history',async()=>{
 const s=setup();vi.mocked(s.api.listTurns).mockResolvedValue({items:[],nextAfter:3});await s.controller.open(s.version);expect(s.controller.getState().error?.code).toBe('PROTOCOL_ERROR');s.controller.dispose();
});
it('a poll started while PATCH is in flight cannot regress an acknowledged cursor',async()=>{
 const s=setup();await s.controller.open(s.version);const saved=deferred<CompanionView['session']>();vi.mocked(s.api.patchCompanion).mockReturnValueOnce(saved.promise);
 const turns=deferred<{items:[];nextAfter:null}>();vi.mocked(s.api.listTurns).mockReturnValueOnce(turns.promise);
 const patch=s.controller.selectCursor(2);const poll=s.controller.refresh();await Promise.resolve();saved.resolve({...s.view.session,cursor:2});await patch;expect(s.controller.getState().view?.session.cursor).toBe(2);turns.resolve({items:[],nextAfter:null});await poll;expect(s.controller.getState().view?.session.cursor).toBe(2);s.controller.dispose();
});
