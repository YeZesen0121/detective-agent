import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename,dirname,join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/server/app.js';
import { sha256 } from '../../src/server/platform/repository.js';
import { runtimeSeed,later } from '../helpers/runtime.js';
import { experienceFunds } from '../helpers/experience.js';
import { conflictPayload } from './conflict-result-fixture.js';
import { moduleFor } from './runtime-http-fixture.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import type {ResultPayload} from '../../src/shared/contracts.js';

// Real HTTP and immutable SQLite snapshots; supplier transports throw before sending.
export async function serveConflicts(worker:number,change?:(payload:ResultPayload)=>ResultPayload,withUpdate=true){
 const root=mkdtempSync(join(tmpdir(),'controlled-w-conflict-')),databasePath=join(root,'state.db'),seed=runtimeSeed(databasePath),site=`http://127.0.0.1:${34760+worker}`,token='controlled_fixture_conflict_token',ends=new Date(Date.now()+86400000).toISOString();
 const session=JSON.parse((seed.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(seed.owner) as {payload_json:string}).payload_json);
 seed.db.prepare('UPDATE sessions SET token_hash=?,payload_json=? WHERE id=?').run(sha256(token),JSON.stringify({...session,tokenHash:sha256(token),expiresAt:ends}),seed.owner);
 const base={...conflictPayload(site),investigationId:seed.investigationId,runId:seed.run.id,queryTime:seed.run.startedAt!};
 const payload=change?change(base):base;
 seed.runs.setScope(seed.run.id,seed.run.epoch,payload.scope,seed.run.startedAt!);seed.runs.saveCheckpoint(seed.run.id,seed.run.epoch,{sources:payload.sources,evidence:payload.evidence,claims:payload.claims},seed.run.startedAt!);
 const version=seed.runs.commitResult(seed.run.id,seed.run.epoch,payload,'partial',seed.run.startedAt!);
 let newer=version;
 if(withUpdate){const windowId=randomUUID(),at=later(10);seed.book.createPool({id:windowId,kind:'window',sessionId:seed.owner,investigationId:seed.investigationId,accessGroup:'trial',limits:experienceFunds});
 seed.runs.enqueue({sessionId:seed.owner,investigationId:seed.investigationId,key:'controlled_fixture_conflict_update',action:'add_budget',previousRunId:seed.run.id,budgetWindowId:windowId,at});const run=seed.runs.claimNext(at)!;
 const next={...payload,runId:run.id,queryTime:at,summary:'controlled_fixture：新版仍未解决截止日冲突。',delta:{previousVersionId:version.id,changes:[],checkedAt:at}};
 seed.runs.setScope(run.id,run.epoch,next.scope,at);seed.runs.saveCheckpoint(run.id,run.epoch,{sources:next.sources,evidence:next.evidence,claims:next.claims},at);newer=seed.runs.commitResult(run.id,run.epoch,next,'partial',at);}
 let realCalls=0;const forbidden=async()=>{realCalls++;throw Error('controlled_fixture forbids supplier calls');};
 const app=buildApp({databasePath,allowedOrigin:site,trialCode:'controlled-conflict-trial',demoCode:'controlled-conflict-demo',serviceEndsAt:ends,secureCookies:false,webRoot:resolve('dist/web'),investigationRuntime:{module:moduleFor(),enableWatches:false,providers:{search:forbidden,read:forbidden,model:forbidden},funding:{global:experienceFunds,trial:experienceFunds,demo:experienceFunds},pricing:{quote:()=>({provider:'controlled_fixture',purpose:'controlled_fixture',attemptNo:1,priceRevision:'controlled_fixture',timeoutMs:1000,estimated:zeroAmounts()}),actual:()=>null}}});
 for(const [index,side] of ['a','b'].entries())app.get(`/controlled-fixture/notice-${side}`,async(_request,reply)=>reply.type('text/html; charset=utf-8').send(`<html lang="zh-CN"><body><h1>controlled_fixture 公告${side.toUpperCase()}</h1><p>${payload.evidence[index]!.excerpt}</p></body></html>`));
 await app.listen({host:'127.0.0.1',port:34760+worker});
 return{site,token,seed,payload,version,newer,get realCalls(){return realCalls;},async close(){try{await app.close();if(realCalls)throw Error('controlled_fixture attempted supplier calls');}finally{seed.db.close();if(dirname(resolve(root))!==resolve(tmpdir())||!basename(root).startsWith('controlled-w-conflict-'))throw Error('Unsafe fixture cleanup');rmSync(root,{recursive:true,force:true});}}};
}
