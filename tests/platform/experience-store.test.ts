import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runtimeSeed } from '../helpers/runtime.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import { ExperienceStore, DEFAULT_PERSONA } from '../../src/server/platform/experience-store.js';
const closers:Array<()=>void>=[];afterEach(()=>{for(const close of closers.splice(0))close();});
it('controlled_fixture unrestricted companion exceeds the old two-minute task and total speech allowance while preserving counters',()=>{
 const s=seed();new BudgetBook(s.db,undefined,{unrestricted:true});
 s.store.createCompanion(s.owner,s.version.id,'controlled-unrestricted-companion',s.at);
 const job=s.store.claim(s.at)!,ctx=s.store.context(job.id,s.at);
 const later=new Date(Date.parse(s.at)+600000).toISOString();
 expect(()=>s.store.assertContext(ctx,later)).not.toThrow();
 s.db.prepare('UPDATE experience_scopes SET characters_used=30000,paused=1 WHERE investigation_id=?').run(s.investigationId);
 expect(()=>s.store.reserveCharacters(job.id,job.epoch,150)).not.toThrow();
 expect(s.store.budget(s.owner,s.investigationId,later).ttsCharacters).toEqual({limit:null,remaining:null,used:30000,reserved:150});
 expect(s.store.book.inspectPool(ctx.interactionPoolId!).used.activeMs).toBe(600000);
});
function seed(){
 const s=runtimeSeed(),at=new Date().toISOString(),ends=new Date(Date.now()+86400000).toISOString();closers.push(()=>s.db.close());
 const session=JSON.parse((s.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(s.owner) as {payload_json:string}).payload_json);s.db.prepare('UPDATE sessions SET payload_json=? WHERE id=?').run(JSON.stringify({...session,expiresAt:ends}),s.owner);
 s.runs.setScope(s.run.id,s.run.epoch,s.payload.scope,at);s.runs.saveCheckpoint(s.run.id,s.run.epoch,{sources:s.payload.sources,evidence:s.payload.evidence,claims:s.payload.claims},at);
 const version=s.runs.commitResult(s.run.id,s.run.epoch,s.payload,'completed',at),funds={...zeroAmounts(),activeMs:100000000,searches:1000,reads:1000,modelCalls:1000,inputTokens:10000000,outputTokens:10000000,moneyMicros:100000000};
 for(const name of ['global','trial','demo'] as const)s.book.createPool({id:'runtime:'+name,kind:name==='global'?'global':'access_group',accessGroup:name==='global'?null:name,sessionId:null,investigationId:null,limits:funds});
 const store=new ExperienceStore(s.db,ends);return{...s,store,version,at,ends};
}
function draft(s:ReturnType<typeof seed>){return{resultVersionId:s.version.id,personaVersion:DEFAULT_PERSONA.version,summary:'controlled_fixture 伴读',segments:Array.from({length:3},(_,i)=>({id:randomUUID(),text:'controlled_fixture 第'+i+'段；仅基于已存证据。',action:null,claimIds:[s.payload.claims[0]!.id],evidenceIds:[s.payload.evidence[0]!.id]}))};}
it('reads an owned interaction balance without creating a grant or leaking it to another session',()=>{
 const s=seed();expect(s.store.budget(s.owner,s.investigationId,s.at)).toEqual({snapshot:null,ttsCharacters:null});
 expect(s.db.prepare('SELECT count(*) n FROM experience_scopes').get()).toMatchObject({n:0});
 expect(()=>s.store.budget(randomUUID(),s.investigationId,s.at)).toThrow();
 s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at);const view=s.store.budget(s.owner,s.investigationId,s.at);
 expect(view.snapshot?.used.modelCalls).toBe(0);expect(view.ttsCharacters).toEqual({limit:20000,used:0,reserved:0,remaining:20000});
});
it('reuses version/persona sessions and commits only references from the fixed result',()=>{
 const s=seed(),first=s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at);
 expect(s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at).id).toBe(first.id);
 expect(s.store.createCompanion(s.owner,s.version.id,'controlled-reuse',s.at).id).toBe(first.id);
 const job=s.store.claim(s.at)!;s.store.finishCompanion(job.id,job.epoch,draft(s),s.at);
 const view=s.store.companion(first.id,s.owner);expect(view.session.status).toBe('ready');expect(view.session.resultVersionId).toBe(s.version.id);
 expect(()=>s.store.companion(first.id,randomUUID())).toThrow();
 const patched=s.store.patchCompanion(first.id,s.owner,{cursor:2},s.at);expect(patched.cursor).toBe(2);expect(patched.deliveredClaimIds).toContain(s.payload.claims[0]!.id);
 expect(()=>s.store.patchCompanion(first.id,s.owner,{cursor:4},s.at)).toThrow();
});
it('rejects a fabricated companion citation without committing a partially valid session',()=>{
 const s=seed(),session=s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at),job=s.store.claim(s.at)!,output=draft(s);output.segments[0]!.claimIds=[randomUUID()];
 expect(()=>s.store.finishCompanion(job.id,job.epoch,output,s.at)).toThrow();expect(s.store.companion(session.id,s.owner).session.segments).toHaveLength(0);
});
it('fences cancelled epochs, preserves elapsed charges, and recovers without automatically running a job',()=>{
 const s=seed();s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at);const job=s.store.claim(s.at)!;
 const later=new Date(Date.parse(s.at)+5000).toISOString();const ctx=s.store.context(job.id,s.at);s.store.meter(job.id,later);s.store.cancel(job.id,s.owner,later);
 expect(()=>s.store.assertContext(ctx,later)).toThrow();expect(()=>s.store.finishCompanion(job.id,job.epoch,draft(s),later)).toThrow();
 expect(s.book.inspectPool(ctx.interactionPoolId!).used.activeMs).toBe(5000);
 s.store.createCompanion(s.owner,s.version.id,'controlled-retry',later);expect(s.store.recover(later)).toBe(1);expect(s.store.claim(later)).toBeNull();
});
it('holds unknown TTS character reservations across recovery without resetting the case pool',()=>{
 const s=seed();s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at);const job=s.store.claim(s.at)!,ctx=s.store.context(job.id,s.at);
 const token=s.store.reserveCharacters(job.id,job.epoch,150);s.store.markCharactersSent(token);s.store.recover(s.at);
 const row=s.db.prepare('SELECT characters_reserved FROM experience_scopes WHERE investigation_id=?').get(s.investigationId) as {characters_reserved:number};expect(row.characters_reserved).toBe(150);
 expect(s.book.inspectPool(ctx.interactionPoolId!).limits.modelCalls).toBe(30);
});
it('reports accounting paused to all shared budget readers when actual speech characters exceed the reservation',()=>{
 const s=seed();s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at);const job=s.store.claim(s.at)!;
 const token=s.store.reserveCharacters(job.id,job.epoch,30);s.store.markCharactersSent(token);s.store.settleCharacters(token,33);
 const budget=s.store.budget(s.owner,s.investigationId,s.at);expect(budget.snapshot?.canModel).toBe(false);expect(budget.snapshot?.blockedBy).toContain('accounting_paused');
 expect(budget.ttsCharacters?.used).toBe(33);expect(()=>s.store.assertContext(s.store.context(job.id,s.at),s.at)).toThrow();
});
it('caps interrupted elapsed work at its persisted task deadline instead of charging an hour of downtime',()=>{
 const s=seed();s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at);const job=s.store.claim(s.at)!,ctx=s.store.context(job.id,s.at);
 s.store.recover(new Date(Date.parse(s.at)+3600000).toISOString());
 expect(s.book.inspectPool(ctx.interactionPoolId!).used.activeMs).toBe(120000);expect(s.book.inspectPool(ctx.interactionPoolId!).state).toBe('active');
});
it('does not reopen a cancelled empty generation as a ready session or reuse it forever',()=>{
 const s=seed(),session=s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at);s.store.claim(s.at);
 s.store.patchCompanion(session.id,s.owner,{ended:true},s.at);
 expect(()=>s.store.patchCompanion(session.id,s.owner,{ended:false},s.at)).toThrow();
 const retry=s.store.createCompanion(s.owner,s.version.id,'controlled-retry-empty',s.at);expect(retry.id).toBe(session.id);expect(retry.status).toBe('generating');expect(s.store.claim(s.at)?.kind).toBe('companion');
});
it('keeps old companion text and the same cumulative pool when a later report version is saved',()=>{
 const s=seed(),old=s.store.createCompanion(s.owner,s.version.id,'controlled-create',s.at),job=s.store.claim(s.at)!,later=new Date(Date.parse(s.at)+5000).toISOString();
 const ctx=s.store.context(job.id,s.at);s.store.finishCompanion(job.id,job.epoch,draft(s),later);const before=s.store.companion(old.id,s.owner).session;
 const window=randomUUID();s.book.createPool({id:window,kind:'window',sessionId:s.owner,investigationId:s.investigationId,accessGroup:'trial',limits:s.book.inspectPool(s.windowId).limits});
 s.runs.enqueue({sessionId:s.owner,investigationId:s.investigationId,budgetWindowId:window,key:'controlled-next-run',action:'add_budget',previousRunId:s.run.id,at:later});const run=s.runs.claimNext(later)!;
 s.runs.setScope(run.id,run.epoch,s.payload.scope,later);s.runs.saveCheckpoint(run.id,run.epoch,{sources:s.payload.sources,evidence:s.payload.evidence,claims:s.payload.claims},later);
 const next=s.runs.commitResult(run.id,run.epoch,{...s.payload,runId:run.id,delta:{previousVersionId:s.version.id,changes:[],checkedAt:later}},'completed',later);
 const update=s.store.companion(old.id,s.owner);expect(update.session).toEqual(before);expect(update.updateNotice?.latestResultVersionId).toBe(next.id);
 const current=s.store.createCompanion(s.owner,next.id,'controlled-new-version',later);expect(current.id).not.toBe(old.id);const newJob=s.store.claim(later)!;
 expect(s.store.context(newJob.id,later).interactionPoolId).toBe(ctx.interactionPoolId);expect(s.book.inspectPool(ctx.interactionPoolId!).used.activeMs).toBe(5000);
});
