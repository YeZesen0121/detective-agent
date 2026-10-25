import { expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import Fastify from 'fastify';
import * as locks from '../../src/server/platform/runtime-lock.js';

// controlled_fixture: actual independent processes, no network or credentials.
it('rejects a second host for the same database, permits another database and releases after a crash',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'detective-runtime-lock-'));
 const children:ReturnType<typeof fork>[]=[];
 async function start(path:string){
  const child=fork(resolve('tests/helpers/runtime-lock-worker.ts'),[path],{execArgv:['--import','tsx'],silent:true});children.push(child);
  const result=await Promise.race([once(child,'message').then(([value])=>value as {acquired:boolean}),once(child,'exit').then(()=>{throw Error('controlled_fixture worker exited before lock response');})]);
  return{child,result};
 }
 try{
  const first=await start(join(directory,'runtime.db'));expect(first.result.acquired).toBe(true);
  const second=await start(join(directory,'runtime.db'));expect(second.result.acquired).toBe(false);
  const separate=await start(join(directory,'other.db'));expect(separate.result.acquired).toBe(true);
  const exited=once(first.child,'exit');first.child.kill('SIGKILL');await exited;
  const recovered=await start(join(directory,'runtime.db'));expect(recovered.result.acquired).toBe(true);
 }finally{
  await Promise.all(children.map(async child=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}));
  rmSync(directory,{recursive:true,force:true});
 }
},15000);

it('keeps ownership until actual Fastify asynchronous shutdown has drained',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'detective-lock-drain-')),path=join(directory,'runtime.db');
 const release=locks.acquireRuntimeLock(path),app=Fastify();let drained!:()=>void,entered!:()=>void;
 const draining=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{drained=resolve;});
 app.addHook('onClose',async()=>{entered();await gate;});await app.ready();
 try{
  const close=locks.createRuntimeShutdown(()=>app.close(),release),first=close();expect(close()).toBe(first);await draining;
  expect(()=>locks.acquireRuntimeLock(path)).toThrow();drained();await first;
  const nextRelease=locks.acquireRuntimeLock(path);nextRelease();
 }finally{drained();await app.close();release();rmSync(directory,{recursive:true,force:true});}
});
it('does not release ownership after a failed close',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'detective-lock-error-')),path=join(directory,'runtime.db'),release=locks.acquireRuntimeLock(path);
 try{
  const close=locks.createRuntimeShutdown(async()=>{throw Error('controlled_fixture close failed');},release);
  await expect(close()).rejects.toThrow('controlled_fixture');expect(()=>locks.acquireRuntimeLock(path)).toThrow();
 }finally{release();rmSync(directory,{recursive:true,force:true});}
});
