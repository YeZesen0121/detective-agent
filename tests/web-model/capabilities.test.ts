import { expect,it,vi } from 'vitest';
import { createCapabilitiesApi } from '../../src/web/api/capabilities.js';
import { createCapabilitiesController } from '../../src/web/controllers/capabilities.js';
import { defaultBasicMode,canSelectBasicMode,draftInputMatches } from '../../src/web/model/basic-mode.js';
import { ClientError } from '../../src/web/api/client.js';
const all={basicModes:['truth','latest','identify'] as const,followups:true,watches:false,vision:false,companion:false,audio:false};
const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
it('controlled_fixture capabilities uses authenticated same-origin envelope/schema and rejects invented/duplicate modes',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({data:{...all,basicModes:['truth','truth']},meta:{requestId:'controlled_fixture',contractVersion:'0.1.0'}}));await expect(createCapabilitiesApi(fetcher).get(new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});expect(fetcher.mock.calls[0]?.[1]).toMatchObject({credentials:'same-origin',method:'GET'});fetcher.mockResolvedValueOnce(Response.json({data:{...all,basicModes:['invented']},meta:{requestId:'controlled_fixture',contractVersion:'0.1.0'}}));await expect(createCapabilitiesApi(fetcher).get(new AbortController().signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
});
it('does not read before authentication and ignores a previous session response, including its error',async()=>{
 const old=deferred<any>(),api={get:vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({...all,basicModes:['latest']})},c=createCapabilitiesController(api);
 await c.refresh();expect(api.get).not.toHaveBeenCalled();const first=c.setSession('controlled-a');const signal=api.get.mock.calls[0]![0] as AbortSignal;await c.setSession('controlled-b');expect(signal.aborted).toBe(true);old.resolve(all);await first;expect(c.getState().data?.basicModes).toEqual(['latest']);
 const late=deferred<any>();api.get.mockReturnValueOnce(late.promise);const reading=c.refresh();await c.setSession(null);late.reject(Error('old failure'));await reading;expect(c.getState()).toMatchObject({data:null,phase:'idle',error:null});c.dispose();
});
it.each([401,503])('a %s refresh failure clears advertised capabilities and explicit retry only reads',async status=>{
 const api={get:vi.fn().mockResolvedValueOnce(all).mockRejectedValueOnce(new ClientError(status===401?'UNAUTHENTICATED':'PROVIDER_UNAVAILABLE','controlled_fixture',null,status)).mockResolvedValueOnce({...all,basicModes:[]})},c=createCapabilitiesController(api);await c.setSession('controlled-a');await c.refresh();expect(c.getState()).toMatchObject({data:null,phase:'error',error:{status}});await c.refresh();expect(c.getState().data?.basicModes).toEqual([]);expect(api.get).toHaveBeenCalledTimes(3);c.dispose();
});
it('defaults only from actual capabilities, never offers latest/identify for unknown or empty availability',()=>{
 expect(defaultBasicMode({...all,basicModes:['identify','latest']})).toBe('identify');expect(defaultBasicMode({...all,basicModes:['latest','truth']})).toBe('truth');expect(defaultBasicMode({...all,basicModes:[]})).toBe('truth');expect(canSelectBasicMode('truth',null)).toBe(false);expect(canSelectBasicMode('latest',{...all,basicModes:[]})).toBe(false);expect(canSelectBasicMode('truth',{...all,basicModes:[]})).toBe(true);
 const saved={originalQuestion:'controlled_fixture',basicMode:'latest' as const,presentationMode:'evidence' as const};expect(draftInputMatches(saved,{...saved,originalQuestion:' controlled_fixture '})).toBe(true);expect(draftInputMatches(saved,{...saved,basicMode:'truth'})).toBe(false);
});
