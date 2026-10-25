import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { successFixture } from '../../src/shared/fixtures/index.js';
import { createFollowupController } from '../../src/web/controllers/followup.js';
import type { FollowupApi,FollowupView } from '../../src/web/api/followup.js';
import type { RuntimeApi } from '../../src/web/api/runtime.js';
import { createFollowupJournal } from '../../src/web/model/followup-submission.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { ClientError } from '../../src/web/api/client.js';
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
function setup(route='explain'){
 const version=structuredClone(successFixture),id=randomUUID(),runId=randomUUID();
 const item:FollowupView={id,investigationId:version.investigationId,resultVersionId:version.id,question:'controlled_fixture question',createdAt:version.createdAt,status:'completed',turn:{id,investigationId:version.investigationId,resultVersionId:version.id,question:'controlled_fixture question',route:route as any,answer:route==='explain'?'controlled_fixture answer':null,claimIds:[],newRunId:route==='research_same_scope'?runId:null,createdAt:version.createdAt},evidenceIds:[],researchPurpose:route==='needs_budget_confirmation'?'controlled_fixture 已确认的同案补查方向':null,suggestedQuestion:null,activeRunId:route==='research_same_scope'?runId:null,latestResultVersionId:null,error:null};
 const api={create:vi.fn(async()=>({followupTurnId:id})),get:vi.fn(async()=>item),list:vi.fn(async()=>({items:[],nextAfter:null})),submission:vi.fn(async()=>({submission:null}))} as FollowupApi;
 const runtime={startRun:vi.fn()} as unknown as RuntimeApi,follow=vi.fn(async()=>{}),journal=createFollowupJournal();const controller=createFollowupController({api,runtime,journal,onFollowRun:follow});return{version,item,api,runtime,follow,journal,controller,id,runId};
}
it('controlled_fixture double click and repeated identical intent uses one POST, explanation starts zero runs',async()=>{
 const s=setup();await s.controller.open(s.version);s.controller.setQuestion('controlled_fixture question');await Promise.all([s.controller.ask(),s.controller.ask()]);await s.controller.ask();expect(s.api.create).toHaveBeenCalledTimes(1);expect(s.runtime.startRun).not.toHaveBeenCalled();expect(s.follow).not.toHaveBeenCalled();s.controller.dispose();
});
it('lost response and null recovery stay unknown across reopening and never replay POST',async()=>{
 const s=setup();await s.controller.open(s.version);vi.mocked(s.api.create).mockRejectedValue(new Error('lost'));s.controller.setQuestion('controlled_fixture question');await s.controller.ask();await s.controller.refresh();await s.controller.open(s.version);await s.controller.ask();expect(s.api.create).toHaveBeenCalledTimes(1);expect(s.controller.getState().submissions[0]?.outcome).toBe('unknown');s.controller.dispose();
});
it('follows stable server newRunId even if activeRunId sounds active, with zero start POST',async()=>{
 const s=setup('research_same_scope');vi.mocked(s.api.list).mockResolvedValue({items:[s.item],nextAfter:null});await s.controller.open(s.version);expect(s.follow).toHaveBeenCalledWith(s.version.investigationId,s.runId);expect(s.runtime.startRun).not.toHaveBeenCalled();s.controller.dispose();
});
it('budget confirmation waits for explicit click and coalesces using fixed key',async()=>{
 const s=setup('needs_budget_confirmation');vi.mocked(s.api.list).mockResolvedValue({items:[s.item],nextAfter:null});await s.controller.open(s.version);expect(s.runtime.startRun).not.toHaveBeenCalled();const d=deferred<any>();vi.mocked(s.runtime.startRun).mockReturnValue(d.promise);const a=s.controller.confirmBudget(s.id,s.version.runId),b=s.controller.confirmBudget(s.id,s.version.runId);await vi.waitFor(()=>expect(s.runtime.startRun).toHaveBeenCalledTimes(1));d.resolve({runId:s.runId,status:'queued',budgetWindowId:randomUUID(),limits:zeroAmounts()});await Promise.all([a,b]);expect(vi.mocked(s.runtime.startRun).mock.calls[0]?.[1]).toEqual({action:'add_budget',previousRunId:s.version.runId,followupTurnId:s.id});expect(s.follow).toHaveBeenCalledWith(s.version.investigationId,s.runId);s.controller.dispose();
});
it('late old input and case cannot replace a new question/version',async()=>{
 const s=setup();await s.controller.open(s.version);s.controller.setQuestion('controlled_fixture old');const d=deferred<any>();vi.mocked(s.api.create).mockReturnValue(d.promise);const old=s.controller.ask();await vi.waitFor(()=>expect(s.api.create).toHaveBeenCalled());s.controller.setQuestion('new input');const next={...s.version,id:randomUUID()};await s.controller.open(next);d.resolve({followupTurnId:s.id});await old;expect(s.controller.getState().version?.id).toBe(next.id);expect(s.controller.getState().items).toEqual([]);s.controller.dispose();
});
it('unknown explicit budget acknowledgement only looks up the persisted linked run and never resends',async()=>{
 const s=setup('needs_budget_confirmation');vi.mocked(s.api.list).mockResolvedValue({items:[s.item],nextAfter:null});await s.controller.open(s.version);vi.mocked(s.runtime.startRun).mockRejectedValue(new Error('lost'));
 await s.controller.confirmBudget(s.id,s.version.runId);await s.controller.confirmBudget(s.id,s.version.runId);expect(s.runtime.startRun).toHaveBeenCalledTimes(1);expect(s.controller.getState().submissions[0]?.outcome).toBe('unknown');
 const updated={...s.item,turn:{...s.item.turn!,newRunId:s.runId},activeRunId:s.runId};vi.mocked(s.api.get).mockResolvedValue(updated);vi.mocked(s.api.list).mockResolvedValue({items:[updated],nextAfter:null});await s.controller.refresh();expect(s.controller.getState().submissions[0]).toMatchObject({outcome:'confirmed',runId:s.runId});expect(s.follow).toHaveBeenCalledWith(s.version.investigationId,s.runId);expect(s.runtime.startRun).toHaveBeenCalledTimes(1);s.controller.dispose();
});
it('503 preserves input and an explicit retry reuses the logical question key',async()=>{
 const s=setup();await s.controller.open(s.version);s.controller.setQuestion('controlled_fixture kept');vi.mocked(s.api.create).mockRejectedValue(new ClientError('PROVIDER_UNAVAILABLE','not configured',null,503));await s.controller.ask();expect(s.controller.getState().question).toBe('controlled_fixture kept');expect(s.controller.getState().submissions[0]?.outcome).toBe('failed');await s.controller.ask();const calls=vi.mocked(s.api.create).mock.calls;expect(calls).toHaveLength(2);expect(calls[0]?.[2]).toBe(calls[1]?.[2]);expect(s.runtime.startRun).not.toHaveBeenCalled();s.controller.dispose();
});
it('stale budget reads the notice and exposes the new version without changing the old report',async()=>{
 const s=setup('needs_budget_confirmation'),next=randomUUID();vi.mocked(s.api.list).mockResolvedValue({items:[s.item],nextAfter:null});s.runtime.getResult=vi.fn(async()=>({version:s.version,updateNotice:{latestResultVersionId:next,createdAt:s.version.createdAt}}));await s.controller.open(s.version);vi.mocked(s.runtime.startRun).mockRejectedValue(new ClientError('STALE_VERSION','open latest',null,409));await s.controller.confirmBudget(s.id,s.version.runId);expect(s.controller.getState().latestResultVersionId).toBe(next);expect(s.controller.getState().version?.id).toBe(s.version.id);expect(s.follow).not.toHaveBeenCalled();s.controller.dispose();
});
it('pages history without dropping failures or exposing another case',async()=>{
 const s=setup(),failed={...s.item,id:randomUUID(),turn:null,status:'failed' as const,error:{code:'SERVER_RESTART',message:'controlled_fixture'}};vi.mocked(s.api.list).mockResolvedValueOnce({items:[s.item],nextAfter:8}).mockResolvedValueOnce({items:[failed],nextAfter:null});await s.controller.open(s.version);expect(s.controller.getState().items.map(x=>x.status)).toEqual(['completed','failed']);
 vi.mocked(s.api.list).mockResolvedValue({items:[{...s.item,investigationId:randomUUID()}],nextAfter:null});await s.controller.refresh();expect(s.controller.getState().error?.code).toBe('PROTOCOL_ERROR');expect(s.controller.getState().items.map(x=>x.investigationId)).toEqual([s.version.investigationId,s.version.investigationId]);s.controller.dispose();
});

it.each([null,'','   '])('unclassified budget purpose %j cannot grant research even by direct controller call',async researchPurpose=>{
 const s=setup('needs_budget_confirmation');s.item.researchPurpose=researchPurpose;vi.mocked(s.api.list).mockResolvedValue({items:[s.item],nextAfter:null});await s.controller.open(s.version);s.controller.setQuestion('controlled_fixture 保留原追问');
 await s.controller.confirmBudget(s.id,s.version.runId);await s.controller.refresh();await s.controller.confirmBudget(s.id,s.version.runId);
 expect(s.runtime.startRun).not.toHaveBeenCalled();expect(s.follow).not.toHaveBeenCalled();expect(s.journal.list()).toEqual([]);expect(s.controller.getState().question).toBe('controlled_fixture 保留原追问');expect(s.controller.getState().version?.id).toBe(s.version.id);s.controller.dispose();
});
