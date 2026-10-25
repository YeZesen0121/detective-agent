import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAttachmentController } from '../../src/web/controllers/attachments.js';
import { createMediaJournal } from '../../src/web/controllers/media-submission.js';
import type { ExperienceApi } from '../../src/web/api/experience.js';
import { ClientError } from '../../src/web/api/client.js';
const file=()=>new File(['controlled_fixture'],'screen.png',{type:'image/png'});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
function setup(){
  const api={listAttachments:vi.fn(async()=>({items:[]})),uploadAttachment:vi.fn(),recover:vi.fn(async()=>({submission:null})),deleteAttachment:vi.fn(async()=>{})} as unknown as ExperienceApi;
  const journal=createMediaJournal();const controller=createAttachmentController({api,journal});return{api,journal,controller,id:randomUUID()};
}
it('controlled_fixture same action double click coalesces; same image different key remains separate',async()=>{
 const s=setup();await s.controller.open(s.id);const d=deferred<never>();vi.mocked(s.api.uploadAttachment).mockReturnValue(d.promise);
 void s.controller.upload(file(),'controlled-key-one');void s.controller.upload(file(),'controlled-key-one');void s.controller.upload(file(),'controlled-key-two');
 expect(s.api.uploadAttachment).toHaveBeenCalledTimes(2);expect(s.controller.getState().canStart).toBe(false);s.controller.dispose();
});
it('lost upload response recovers by original key; null stays unknown across controller restart',async()=>{
 const s=setup();await s.controller.open(s.id);vi.mocked(s.api.uploadAttachment).mockRejectedValue(new Error('lost'));
 await s.controller.upload(file(),'controlled-original');expect(s.controller.getState().submissions[0]?.outcome).toBe('unknown');
 expect(s.api.recover).toHaveBeenCalledWith(s.id,'attachment','controlled-original',expect.any(AbortSignal));
 const next=createAttachmentController({api:s.api,journal:s.journal});await next.open(s.id);expect(next.getState().canStart).toBe(false);
 await next.refresh();expect(s.api.uploadAttachment).toHaveBeenCalledTimes(1);s.controller.dispose();next.dispose();
});
it('cross-case late reads cannot overwrite current attachments',async()=>{
 const s=setup();const d=deferred<{items:[]}>();vi.mocked(s.api.listAttachments).mockReturnValueOnce(d.promise);
 const first=s.controller.open(s.id);const next=randomUUID();await s.controller.open(next);d.resolve({items:[]});await first;
 expect(s.controller.getState().caseId).toBe(next);expect(s.controller.getState().canStart).toBe(true);s.controller.dispose();
});
it('enforces local byte limits before dispatch',async()=>{
 const s=setup();await s.controller.open(s.id);await s.controller.upload(new File([new Uint8Array(8*1024*1024+1)],'large'),'controlled-large');expect(s.api.uploadAttachment).not.toHaveBeenCalled();
 expect(s.controller.getState().error?.code).toBe('VALIDATION_ERROR');s.controller.dispose();
});
it('a controller reopened with a pending journal must recover it as unknown and clear on 401',async()=>{
 const s=setup();await s.controller.open(s.id);vi.mocked(s.api.uploadAttachment).mockReturnValue(new Promise(()=>{}));void s.controller.upload(file(),'controlled-flight');s.controller.dispose();
 const next=createAttachmentController({api:s.api,journal:s.journal});await next.open(s.id);expect(s.api.recover).toHaveBeenCalled();expect(next.getState().submissions[0]?.outcome).toBe('unknown');
 vi.mocked(s.api.recover).mockRejectedValue(new ClientError('UNAUTHENTICATED','expired',null,401));await next.refresh();expect(s.journal.list()).toEqual([]);expect(next.getState().canStart).toBe(false);next.dispose();
});
