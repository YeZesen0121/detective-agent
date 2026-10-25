import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { InvestigationsPage } from '../../src/shared/investigations-http.js';
import { createInvestigationsController } from '../../src/web/controllers/investigations.js';
import { createInvestigationsApi } from '../../src/web/api/investigations.js';
import { ClientError } from '../../src/web/api/client.js';

const row=()=>({id:randomUUID(),originalQuestion:'controlled_fixture 历史问题',basicMode:'truth' as const,presentationMode:'brief' as const,status:'draft' as const,latestResultVersionId:null,createdAt:'2026-10-25T00:00:00.000Z',updatedAt:'2026-10-25T00:00:00.000Z'});
it('history makes no anonymous calls and fences a late previous-session page',async()=>{
 let resolve!:(p:InvestigationsPage)=>void;const old=new Promise<InvestigationsPage>(r=>{resolve=r;}),a=row(),b=row(),api={list:vi.fn().mockReturnValueOnce(old).mockResolvedValue({items:[b],nextBefore:null})},c=createInvestigationsController(api);
 await c.refresh();expect(api.list).not.toHaveBeenCalled();const pending=c.setSession('a');const signal=api.list.mock.calls[0]![1] as AbortSignal;await c.setSession('b');expect(signal.aborted).toBe(true);resolve({items:[a],nextBefore:null});await pending;expect(c.getState().items).toEqual([b]);await c.setSession(null);expect(c.getState().items).toEqual([]);c.dispose();
});
it('pagination keeps prior rows on read failure and retries only the same GET cursor',async()=>{
 const a=row(),b=row(),api={list:vi.fn().mockResolvedValueOnce({items:[a],nextBefore:a.id}).mockRejectedValueOnce(new ClientError('PROVIDER_UNAVAILABLE','controlled_fixture',null,503)).mockResolvedValueOnce({items:[a,b],nextBefore:null})},c=createInvestigationsController(api);
 await c.setSession('session');await c.more();expect(c.getState()).toMatchObject({phase:'error',items:[a],nextBefore:a.id});await c.more();expect(c.getState().items).toEqual([a,b]);expect(api.list.mock.calls.map(call=>call[0])).toEqual([null,a.id,a.id]);c.dispose();
});
it('401 clears visible rows and the HTTP adapter consumes the released page schema with GET only',async()=>{
 const a=row(),api={list:vi.fn().mockResolvedValueOnce({items:[a],nextBefore:a.id}).mockRejectedValueOnce(new ClientError('UNAUTHENTICATED','controlled_fixture',null,401))},c=createInvestigationsController(api);await c.setSession('session');await c.more();expect(c.getState().items).toEqual([]);expect(c.getState().nextBefore).toBeNull();c.dispose();
 const transport=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({data:{items:[a],nextBefore:null},meta:{requestId:'controlled_fixture',contractVersion:'0.1.0'}}),{status:200,headers:{'content-type':'application/json'}}));const client=createInvestigationsApi(transport as typeof fetch);expect((await client.list(a.id,new AbortController().signal)).items).toEqual([a]);expect(transport.mock.calls[0]?.[0]).toBe(`/api/v1/investigations?limit=20&before=${a.id}`);
});
