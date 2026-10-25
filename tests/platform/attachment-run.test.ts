import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/platform/database.js';
import { PrivateAssets, byteHash } from '../../src/server/platform/private-assets.js';
import { FoundationStore } from '../../src/server/platform/repository.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { extractAttachments } from '../../src/server/attachments/extract.js';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const fn of close.splice(0))await fn();});
it('extracts authorized private images into an actual run and freezes original attachment snapshots',async()=>{
 const root=mkdtempSync(join(tmpdir(),'controlled-attachment-run-')),path=join(root,'state.db'),db=openDatabase(path),f=new FoundationStore(db),at=new Date().toISOString(),ends=new Date(Date.now()+86400000).toISOString();
 const owner=f.createSession('a'.repeat(64),'trial',at,ends),draft=f.createDraft(owner.id,'controlled-draft',{originalQuestion:'controlled_fixture 请核对图片',basicMode:'truth',presentationMode:'evidence'},at,ends),assets=new PrivateAssets(db,join(root,'assets'));
 const image=await assets.upload(owner.id,draft.id,'controlled-image',await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer(),'image/png',at);
 let prepared=0,ran=0,imagesPassed=0;
 const module:any={prepareInvestigation:async(input:any)=>{prepared=input.attachments.length;return{scope:{objectText:'controlled_fixture 对象',goal:input.originalQuestion,basicMode:'truth',knownClues:[],uncertainClues:[],claimsToCheck:[],timeScope:null,region:null,referenceTime:at,userConfirmed:false},clarification:null,canInvestigate:true};},runInvestigation:async(input:any,services:any)=>{
  ran=input.attachments.length;const excerpt=input.attachments[0].visibleText,evidence={id:randomUUID(),origin:{kind:'attachment',id:image.id},representation:'extracted',excerpt,locator:{kind:'description',value:'controlled_fixture 可见文字'},capturedAt:at,contentHash:byteHash(Buffer.from(excerpt)),limitations:['截图只作为待核验线索']};
  await services.checkpoint.save(input.run.id,input.run.epoch,{sources:[],evidence:[evidence],claims:[],candidates:[],queries:[]});
  return{completion:'partial',stopReason:'no_useful_direction',clarification:null,draft:{schemaVersion:'0.1.0',investigationId:input.run.investigationId,runId:input.run.id,scope:input.scope,queryTime:at,summary:'controlled_fixture 已保留图片线索，未判真假。',conditions:[],unknowns:['尚无外部证据'],nextSteps:[],stopReason:'no_useful_direction',sources:[],evidence:[evidence],claims:[],candidates:[],conflicts:[],answerBlocks:[],attachments:[],delta:null}};
 },routeFollowup:async()=>{throw Error('unused')},compareWatchResult:async()=>{throw Error('unused')}};
 const funds={...zeroAmounts(),activeMs:10000000,modelCalls:100,searches:100,reads:100,inputTokens:1000000,outputTokens:1000000,moneyMicros:10000000};
 const no=async()=>{throw Error('controlled_fixture no external network')},pricing:any={quote:(_op:any,input:any)=>({provider:'controlled_fixture',purpose:'extract',attemptNo:1,priceRevision:'fixture-v1',timeoutMs:1000,estimated:{...zeroAmounts(),modelCalls:1,inputTokens:2000,outputTokens:input.maxOutputTokens,moneyMicros:10}}),actual:()=>({...zeroAmounts(),modelCalls:1,inputTokens:500,outputTokens:20,moneyMicros:10}),visionInputTokens:()=>100};
 const app=buildApp({databasePath:path,privateStorageRoot:join(root,'assets'),allowedOrigin:'http://127.0.0.1:5173',trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:ends,secureCookies:false,
  investigationRuntime:{module,providers:{search:no,read:no,model:no},pricing,funding:{global:funds,trial:funds,demo:funds},supportsAttachments:true},
  experienceRuntime:{module:{extractAttachments,buildCompanion:no,answerCompanion:no},providers:{model:async(_request:any,_ctx:any,_signal:any,images:any[])=>{imagesPassed=images.length;expect(images[0].bytes).toEqual(assets.readAttachment(image.id,owner.id).bytes);return{value:{visibleText:'controlled_fixture 不晚于十月三十日',speakerClues:[],visibleDates:[],claimSuggestions:[],uncertainSpans:[],warnings:[]},usage:{inputTokens:500,outputTokens:20,characters:0,searches:0,reads:0},providerRequestId:'controlled_vision',modelId:'controlled_fixture',finishReason:'stop'};}},pricing,funding:{global:funds,trial:funds,demo:funds}}} as any);
 close.push(async()=>{await app.close();db.close();rmSync(root,{recursive:true,force:true});});
 await app.ready();const runs=await import('../../src/server/platform/runs.js');const original=f.findSession('a'.repeat(64),at)!;
 // Existing owner is addressed by a controlled token solely for this HTTP fixture.
 const {sha256}=await import('../../src/server/platform/repository.js');db.prepare('UPDATE sessions SET token_hash=? WHERE id=?').run(sha256('controlled-token'),original.id);
 const headers={origin:'http://127.0.0.1:5173',cookie:'detective_session=controlled-token','idempotency-key':'controlled-start'};
 const start=await app.inject({method:'POST',url:'/api/v1/investigations/'+draft.id+'/runs',headers,payload:{action:'start',previousRunId:null}});expect(start.statusCode).toBe(202);
 let view:any;for(let i=0;i<100;i++){view=(await app.inject({url:'/api/v1/runs/'+start.json().data.runId,headers})).json().data;if(['partial','completed','failed'].includes(view.run.status))break;await new Promise<void>(r=>setImmediate(r));}
 expect({status:view.run.status,stopReason:view.run.stopReason,prepared,ran,imagesPassed}).toMatchObject({status:'partial',prepared:1,ran:1,imagesPassed:1});
 const result=new runs.RunStore(db).getResult(view.run.createdResultVersionId,owner.id)!;
 expect(result.payload.attachments[0]?.sha256).toBe(image.sha256);expect(result.payload.attachments[0]?.extraction?.visibleText).toContain('不晚于');
 expect(db.prepare('SELECT count(*) n FROM result_attachment_refs WHERE attachment_id=?').get(image.id)).toMatchObject({n:1});
 expect(()=>assets.remove(owner.id,draft.id,image.id,at)).toThrow();
});
