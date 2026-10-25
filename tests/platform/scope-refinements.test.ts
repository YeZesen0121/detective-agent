import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runtimeSeed,later } from '../helpers/runtime.js';
import { FollowupStore } from '../../src/server/platform/followup-store.js';
import { ensureRuntimeFunding } from '../../src/server/platform/runtime-funding.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { WatchStore } from '../../src/server/platform/watch-store.js';
const close:Array<()=>void>=[];afterEach(()=>{for(const fn of close.splice(0))fn();});
function seed(watching=false){
 const s=runtimeSeed();close.push(()=>s.db.close());s.payload.scope.knownClues=['controlled_fixture 旧线索'];
 const funding={...zeroAmounts(),activeMs:10000000,searches:100,reads:100,modelCalls:100,inputTokens:1000000,outputTokens:1000000,moneyMicros:100000000};ensureRuntimeFunding(s.db,{global:funding,trial:funding,demo:funding});
 s.runs.setScope(s.run.id,s.run.epoch,s.payload.scope,later(1));s.runs.saveCheckpoint(s.run.id,s.run.epoch,{sources:s.payload.sources,evidence:s.payload.evidence,claims:s.payload.claims},later(1));
 const version=s.runs.commitResult(s.run.id,s.run.epoch,s.payload,'completed',later(2)),store=new FollowupStore(s.db,later(3600));
 const watches=new WatchStore(s.db,{serviceEndsAt:later(3600)}),watch=watching?watches.create(s.owner,'controlled-refinement-watch',{investigationId:s.investigationId,resultVersionId:version.id,targetKind:'open_question',targetUrls:[],focus:'controlled_fixture 同一问题'},later(2)):null;
 const queuedCheck=watch?watches.requestManual(s.owner,watch.id,'controlled-watch-before-refinement',later(2)):null;
 const question='controlled_fixture 新线索；controlled_fixture 旧线索可能记错了',job=store.enqueue(s.owner,s.investigationId,'controlled-refinement',{resultVersionId:version.id,question},later(3));
 const claimed=store.claim(later(4))!;store.finish(claimed,{route:'research_same_scope',answer:null,researchPurpose:'controlled_fixture 核对新增线索',suggestedQuestion:null},later(5),()=>{});
 const run=s.runs.claimNext(later(6))!,scope={...version.payload.scope,knownClues:['controlled_fixture 新线索'],uncertainClues:['controlled_fixture 旧线索']};
 return{...s,store,job,version,run,scope,question,watches,watch,queuedCheck};
}
it('atomically applies an approved saved followup once, preserves the old snapshot and reuses the applied scope after cancel/resume',()=>{
 const s=seed(),before=structuredClone(s.version);
 expect(s.runs.preparationFollowup(s.run.id,s.owner)).toEqual({kind:'saved_followup',turnId:s.job.id,resultVersionId:s.version.id,question:s.question});
 const prepared=s.runs.setScope(s.run.id,s.run.epoch,s.scope,later(7));expect(prepared.scopeVersion).toBe(s.run.scopeVersion+1);
 expect(s.runs.preparationFollowup(s.run.id,s.owner)).toBeUndefined();expect(s.runs.setScope(s.run.id,s.run.epoch,s.scope,later(8)).scopeVersion).toBe(prepared.scopeVersion);
 s.runs.cancel(s.run.id,s.owner,later(9));const queued=s.runs.enqueue({sessionId:s.owner,investigationId:s.investigationId,budgetWindowId:s.windowId,key:'controlled-refined-resume',action:'resume',previousRunId:s.run.id,at:later(10)}),resumed=s.runs.claimNext(later(11))!;
 expect(resumed.id).toBe(queued.id);expect(s.runs.preparationFollowup(resumed.id,s.owner)).toBeUndefined();expect(s.runs.setScope(resumed.id,resumed.epoch,s.scope,later(12)).scopeVersion).toBe(prepared.scopeVersion);
 expect(s.db.prepare('SELECT count(*) n FROM scope_refinements').get()).toEqual({n:1});expect(s.runs.getResult(s.version.id,s.owner)).toEqual(before);
});
it('never uses an approved clue refinement to change the object, goal, region, time scope, mode, confirmation or raw reference time',()=>{
 const s=seed();for(const patch of [{objectText:'另一个对象'},{goal:'新目标'},{claimsToCheck:['新目标']},{region:'另一个地区'},{timeScope:'新届次'},{basicMode:'latest' as const},{userConfirmed:!s.scope.userConfirmed},{referenceTime:later(100)}])expect(()=>s.runs.setScope(s.run.id,s.run.epoch,{...s.scope,...patch},later(7))).toThrow();
 expect(()=>s.runs.setScope(s.run.id,s.run.epoch,{...s.scope,uncertainClues:[]},later(7))).toThrow();
 expect(s.db.prepare('SELECT count(*) n FROM scope_refinements').get()).toEqual({n:0});
 expect(()=>s.runs.setScope(s.run.id,s.run.epoch,s.scope,later(8))).not.toThrow();
});
it('rejects foreign reads, stale baselines and unapproved scope changes without recording an application',()=>{
 const s=seed();expect(()=>s.runs.preparationFollowup(s.run.id,randomUUID())).toThrow();
 const row=s.db.prepare('SELECT payload_json FROM investigations WHERE id=?').get(s.investigationId) as {payload_json:string},inv=JSON.parse(row.payload_json);inv.latestResultVersionId=randomUUID();s.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify(inv),s.investigationId);
 expect(()=>s.runs.preparationFollowup(s.run.id,s.owner)).toThrow();expect(()=>s.runs.setScope(s.run.id,s.run.epoch,s.scope,later(7))).toThrow();expect(s.db.prepare('SELECT count(*) n FROM scope_refinements').get()).toEqual({n:0});
 const other=runtimeSeed();close.push(()=>other.db.close());other.runs.setScope(other.run.id,other.run.epoch,other.payload.scope,later(1));expect(()=>other.runs.setScope(other.run.id,other.run.epoch,{...other.payload.scope,knownClues:['未经授权']},later(2))).toThrow();
});
it('inherits a real answered clarification after cancellation and consumes it once without fabricating a followup',()=>{
 const s=runtimeSeed();close.push(()=>s.db.close());s.runs.setScope(s.run.id,s.run.epoch,s.payload.scope,later(1));const id=randomUUID();
 s.runs.requestClarification(s.run.id,s.run.epoch,{id,runId:s.run.id,prompt:'controlled_fixture 请补一个区分线索',missingFields:['knownClues'],options:[],canProceedWithUnknown:false,answer:null,answeredAt:null},later(2));
 s.runs.answerClarification(s.run.id,id,s.owner,{answer:'controlled_fixture 新线索',proceedWithUnknown:false},later(3));const continuing=s.runs.claimNext(later(4))!;s.runs.cancel(continuing.id,s.owner,later(5));
 s.runs.enqueue({sessionId:s.owner,investigationId:s.investigationId,budgetWindowId:s.windowId,key:'controlled-clarification-resume',action:'resume',previousRunId:continuing.id,at:later(6)});const resumed=s.runs.claimNext(later(7))!;
 expect(s.runs.clarificationAnswer(resumed.id,s.owner)).toEqual({clarificationId:id,answer:'controlled_fixture 新线索',proceedWithUnknown:false});expect(s.runs.preparationFollowup(resumed.id,s.owner)).toBeUndefined();
 s.runs.setScope(resumed.id,resumed.epoch,{...s.payload.scope,knownClues:['controlled_fixture 新线索']},later(8));expect(s.runs.clarificationAnswer(resumed.id,s.owner)).toBeNull();
 expect(s.db.prepare('SELECT source_kind,source_id FROM scope_refinements').get()).toEqual({source_kind:'clarification',source_id:id});
});
it.each([true,false])('advances an existing watch only with a recorded same-scope chain (proof=%s)',proof=>{
 const s=seed(true),prepared=s.runs.setScope(s.run.id,s.run.epoch,s.scope,later(7));if(!proof)s.db.prepare('DELETE FROM scope_refinements').run();
 const draft={...s.payload,scope:s.scope,runId:s.run.id,queryTime:later(8),delta:{previousVersionId:s.version.id,changes:[],checkedAt:later(8)}};
 const next=s.runs.commitResult(s.run.id,s.run.epoch,draft,'completed',later(8)),watch=s.watches.get(s.watch!.id,s.owner)!;
 if(proof){expect(watch).toMatchObject({scopeVersion:prepared.scopeVersion,baselineVersionId:next.id,status:'active'});s.watches.requestManual(s.owner,watch.id,'controlled-watch-after-refinement',later(360));expect(s.watches.claimManual(s.owner,watch.id,later(360))).not.toBeNull();}
 else{expect(watch.status).toBe('paused');expect(watch.baselineVersionId).toBe(s.version.id);expect(()=>s.watches.change(watch.id,s.owner,'resume',later(40))).toThrow();}
 const old=s.db.prepare('SELECT status FROM watch_checks WHERE id=?').get(s.queuedCheck!.id);expect(old).toEqual({status:'cancelled'});
});
it('shows scope-changing cancellation as paused and restores only its own automatic pause after a resumed commit',()=>{
 const s=seed(true);s.runs.setScope(s.run.id,s.run.epoch,s.scope,later(7));expect(s.watches.get(s.watch!.id,s.owner)!.status).toBe('paused');s.runs.cancel(s.run.id,s.owner,later(8));expect(s.watches.claimDue(later(500))).toBeNull();expect(s.watches.get(s.watch!.id,s.owner)!.status).toBe('paused');
 s.runs.enqueue({sessionId:s.owner,investigationId:s.investigationId,budgetWindowId:s.windowId,key:'controlled-watch-refinement-resume',action:'resume',previousRunId:s.run.id,at:later(501)});const resumed=s.runs.claimNext(later(502))!;s.runs.setScope(resumed.id,resumed.epoch,s.scope,later(503));
 const next=s.runs.commitResult(resumed.id,resumed.epoch,{...s.payload,scope:s.scope,runId:resumed.id,queryTime:later(504),delta:{previousVersionId:s.version.id,changes:[],checkedAt:later(504)}},'completed',later(504));expect(s.watches.get(s.watch!.id,s.owner)).toMatchObject({status:'active',baselineVersionId:next.id,scopeVersion:resumed.scopeVersion});
});
it('never auto-resumes a user pause made while a clue refinement was waiting for a result',()=>{
 const s=seed(true);s.runs.setScope(s.run.id,s.run.epoch,s.scope,later(7));expect(s.watches.get(s.watch!.id,s.owner)!.status).toBe('paused');s.watches.change(s.watch!.id,s.owner,'pause',later(8));
 const next=s.runs.commitResult(s.run.id,s.run.epoch,{...s.payload,scope:s.scope,runId:s.run.id,queryTime:later(9),delta:{previousVersionId:s.version.id,changes:[],checkedAt:later(9)}},'completed',later(9));expect(s.watches.get(s.watch!.id,s.owner)).toMatchObject({status:'paused',baselineVersionId:next.id});
});
