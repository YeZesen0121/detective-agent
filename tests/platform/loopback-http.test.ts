import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { listenLoopback } from '../helpers/loopback-http.js';

// controlled_fixture: real local HTTP only; no provider or credential access.
it('serves fetch on a browser-safe port and retries a concurrently occupied port',async()=>{
 const blocker=Fastify(),app=Fastify();app.get('/controlled',async()=>({kind:'controlled_fixture'}));
 try{
  const occupied=Number(new URL(await listenLoopback(blocker)).port);let choices=0;
  const address=await listenLoopback(app,()=>choices++===0?occupied:occupied===59999?20000:occupied+1);
  expect(choices).toBeGreaterThan(1);expect(Number(new URL(address).port)).toBeGreaterThanOrEqual(20000);
  expect(await(await fetch(address+'/controlled')).json()).toEqual({kind:'controlled_fixture'});
 }finally{await app.close();await blocker.close();}
});
it('rejects an unsafe fixture port before listening instead of bypassing fetch restrictions',async()=>{
 const app=Fastify();try{await expect(listenLoopback(app,()=>6000)).rejects.toThrow();expect(app.server.listening).toBe(false);}finally{await app.close();}
});
it('chooses another port after an OS-denied test bind and still serves real HTTP',async()=>{
 const app=Fastify();app.get('/controlled',async()=>({kind:'controlled_fixture'}));
 const listen=vi.spyOn(app,'listen');listen.mockRejectedValueOnce(Object.assign(new Error('controlled_fixture port denied'),{code:'EACCES'}));
 try{const address=await listenLoopback(app);expect(await(await fetch(address+'/controlled')).json()).toEqual({kind:'controlled_fixture'});expect(listen.mock.calls.length).toBeGreaterThan(1);}finally{await app.close();}
});
it('bounds denied bind retries and does not swallow unrelated errors',async()=>{
 const app=Fastify(),listen=vi.spyOn(app,'listen');
 try{
  listen.mockRejectedValue(Object.assign(new Error('controlled_fixture denied'),{code:'EACCES'}));
  await expect(listenLoopback(app)).rejects.toThrow('16 attempts');expect(listen).toHaveBeenCalledTimes(16);
  listen.mockReset().mockRejectedValue(Object.assign(new Error('controlled_fixture unrelated'),{code:'OTHER'}));
  await expect(listenLoopback(app)).rejects.toThrow('unrelated');expect(listen).toHaveBeenCalledTimes(1);
 }finally{await app.close();}
});
