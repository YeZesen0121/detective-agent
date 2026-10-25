import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {spawnSync} from 'node:child_process';
import {buildApp} from '../../src/server/app.js';
import {sha256} from '../../src/server/platform/repository.js';
import {runtimeSeed,time,later} from '../helpers/runtime.js';
import {PrivateAssets} from '../../src/server/platform/private-assets.js';
import {BudgetBook,zeroAmounts} from '../../src/server/platform/budget.js';
import {PaidCampaign} from '../../src/server/platform/paid-campaign.js';
import {acquireRuntimeLock} from '../../src/server/platform/runtime-lock.js';
import {ensureRuntimeFunding} from '../../src/server/platform/runtime-funding.js';
import {backupRuntime,restoreRuntime} from '../../src/server/platform/runtime-backup.js';

const close:Array<()=>void>=[];afterEach(()=>{for(const fn of close.splice(0).reverse())fn();});
function seed(){
 const directory=mkdtempSync(join(tmpdir(),'detective-backup-'));close.push(()=>rmSync(directory,{recursive:true,force:true}));
 const databasePath=join(directory,'source.db'),assetsRoot=join(directory,'private'),s=runtimeSeed(databasePath);close.push(()=>s.db.close());
 const token='controlled_fixture_restore_token',tokenHash=sha256(token),session=JSON.parse((s.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(s.owner) as {payload_json:string}).payload_json);session.tokenHash=tokenHash;s.db.prepare('UPDATE sessions SET token_hash=?,payload_json=? WHERE id=?').run(tokenHash,JSON.stringify(session),s.owner);
 const funding={...zeroAmounts(),activeMs:10000000,searches:100,reads:100,modelCalls:100,inputTokens:1000000,outputTokens:1000000,moneyMicros:100000000};ensureRuntimeFunding(s.db,{global:funding,trial:funding,demo:funding});
 const assets=new PrivateAssets(s.db,assetsRoot),bytes=Buffer.from('ID3 controlled_fixture stored bytes, not playback acceptance');
 const assetId=assets.writeAudio(s.owner,s.investigationId,bytes,time);
 s.runs.setScope(s.run.id,s.run.epoch,s.payload.scope,time);s.runs.saveCheckpoint(s.run.id,s.run.epoch,{sources:s.payload.sources,evidence:s.payload.evidence,claims:s.payload.claims},time);const result=s.runs.commitResult(s.run.id,s.run.epoch,s.payload,'completed',later(1));
 const book=new BudgetBook(s.db,{id:'controlled_fixture-backup',moneyMicros:1000,requestLimit:10,operationLimits:{search:3,read:3,model:3,tts:1},expiresAt:new Date(Date.now()+3600000).toISOString()});
 const callId=randomUUID(),context={sessionId:s.owner,accessGroup:'trial' as const,investigationId:s.investigationId,runId:s.run.id,budgetWindowId:s.windowId,interactionPoolId:null,watchCheckId:null,watchLeaseEpoch:null,epoch:s.run.epoch,deadlineAt:new Date(Date.now()+60000).toISOString()};
 book.reserve(context,['runtime:global','runtime:trial',s.windowId],{callId,provider:'controlled_fixture',operation:'read',purpose:'controlled_fixture prior unknown',attemptNo:1,priceRevision:'fixture-v1',estimated:{...zeroAmounts(),reads:1,moneyMicros:7}});book.markSent(callId);book.markUnknown(callId);
 writeFileSync(join(directory,'.env'),'controlled_fixture_do_not_copy');
 return{...s,directory,databasePath,assetsRoot,assets,assetId,bytes,result,callId,token};
}
it('backs up live WAL contents with immutable reports, unknown usage and private bytes, then restores only into a new directory',async()=>{
 const s=seed();expect(existsSync(s.databasePath+'-wal')&&statSync(s.databasePath+'-wal').size>0).toBe(true);
 const before=s.db.prepare('SELECT payload_json,payload_hash FROM result_versions').get();
 const backup=await backupRuntime({databasePath:s.databasePath,assetsRoot:s.assetsRoot,destination:join(s.directory,'backup')});
 expect(readdirSync(backup.directory).sort()).toEqual(['manifest.json','private-assets','runtime.db']);
 expect(backup.manifest.assets).toHaveLength(1);expect(backup.manifest.schemaVersion).toBe(12);
 const restored=await restoreRuntime({backupDirectory:backup.directory,destination:join(s.directory,'restored')});
 expect(restored.assetsRoot).toBe(join(restored.directory,'private-assets'));
 const db=new Database(restored.databasePath,{readonly:true,fileMustExist:true});try{
  expect(db.pragma('integrity_check',{simple:true})).toBe('ok');expect(db.prepare('SELECT payload_json,payload_hash FROM result_versions').get()).toEqual(before);
  expect(new PaidCampaign(db).inspect()).toMatchObject({requestCount:1,unknownCount:1,heldMicros:7});
  expect(db.prepare('SELECT call_id,status FROM usage_ledger').get()).toEqual({call_id:s.callId,status:'unknown'});
  expect(new PrivateAssets(db,restored.assetsRoot).readAsset(s.assetId,s.owner,time).bytes).toEqual(s.bytes);
 }finally{db.close();}
 const app=buildApp({databasePath:restored.databasePath,allowedOrigin:'http://127.0.0.1:5173',trialCode:'controlled_trial_restore',demoCode:'controlled_demo_restore',serviceEndsAt:later(3600),secureCookies:false,now:()=>later(2)});
 try{const response=await app.inject({url:'/api/v1/audio-assets/'+s.assetId,headers:{cookie:'detective_session='+s.token}});expect(response.statusCode).toBe(200);expect(response.rawPayload).toEqual(s.bytes);}finally{await app.close();}
 expect(s.db.prepare('SELECT payload_json,payload_hash FROM result_versions').get()).toEqual(before);
 expect(existsSync(join(restored.directory,'.env'))).toBe(false);
});
it('refuses a running official host and existing destinations without changing them',async()=>{
 const s=seed(),release=acquireRuntimeLock(s.databasePath);try{await expect(backupRuntime({databasePath:s.databasePath,assetsRoot:s.assetsRoot,destination:join(s.directory,'blocked')})).rejects.toThrow();expect(existsSync(join(s.directory,'blocked'))).toBe(false);}finally{release();}
 const destination=join(s.directory,'existing');mkdirSync(destination);writeFileSync(join(destination,'keep.txt'),'controlled_fixture keep');
 await expect(backupRuntime({databasePath:s.databasePath,assetsRoot:s.assetsRoot,destination})).rejects.toThrow();expect(readFileSync(join(destination,'keep.txt'),'utf8')).toBe('controlled_fixture keep');
});
it.each(['runtime.db','asset'])('refuses a corrupt %s backup and never overwrites a restore target',async corrupt=>{
 const s=seed(),backup=await backupRuntime({databasePath:s.databasePath,assetsRoot:s.assetsRoot,destination:join(s.directory,'backup')});
 const destination=join(s.directory,'restore');mkdirSync(destination);writeFileSync(join(destination,'keep.txt'),'controlled_fixture keep');
 await expect(restoreRuntime({backupDirectory:backup.directory,destination})).rejects.toThrow();expect(readFileSync(join(destination,'keep.txt'),'utf8')).toBe('controlled_fixture keep');
 writeFileSync(corrupt==='runtime.db'?backup.databasePath:join(backup.assetsRoot,backup.manifest.assets[0]!.storageKey),'controlled_fixture tampered');
 await expect(restoreRuntime({backupDirectory:backup.directory,destination:join(s.directory,'corrupt-restore')})).rejects.toThrow();
});
it('rejects a manifest path escape before copying anything outside the new restore directory',async()=>{
 const s=seed(),backup=await backupRuntime({databasePath:s.databasePath,assetsRoot:s.assetsRoot,destination:join(s.directory,'backup')});
 const manifest=JSON.parse(readFileSync(join(backup.directory,'manifest.json'),'utf8'));manifest.assets[0].storageKey='../.env';writeFileSync(join(backup.directory,'manifest.json'),JSON.stringify(manifest));
 await expect(restoreRuntime({backupDirectory:backup.directory,destination:join(s.directory,'unsafe')})).rejects.toThrow();
 expect(readFileSync(join(s.directory,'.env'),'utf8')).toBe('controlled_fixture_do_not_copy');
});
it('offers a credential-free operator verification command and fails closed for tampered backups',async()=>{
 const s=seed(),backup=await backupRuntime({databasePath:s.databasePath,assetsRoot:s.assetsRoot,destination:join(s.directory,'backup')});
 const invoke=()=>spawnSync(process.execPath,['--import','tsx','scripts/ops/runtime-storage.ts','verify',backup.directory],{encoding:'utf8'});
 const good=invoke();expect(good.status).toBe(0);expect(JSON.parse(good.stdout)).toMatchObject({action:'verify',status:'operation_complete',assetCount:1,newSupplierRequests:0});
 expect(good.stdout).not.toContain('controlled_fixture_do_not_copy');
 writeFileSync(backup.databasePath,'controlled_fixture corrupt');const bad=invoke();expect(bad.status).toBe(1);expect(JSON.parse(bad.stdout)).toEqual({status:'failed',code:'DATABASE_HASH_MISMATCH'});
});
