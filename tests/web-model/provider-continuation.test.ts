import { expect,it } from 'vitest';
import { InvestigationPublicSchema } from '../../src/shared/contracts.js';
import type { InvestigationControllerState } from '../../src/web/controllers/investigation.js';
import type { ResultControllerState } from '../../src/web/controllers/result.js';
import { createResultState } from '../../src/web/model/result.js';
import { canContinueProviderRun } from '../../src/web/model/provider-continuation.js';
import { samplePayload } from '../helpers/result.js';
import { at,id,runView } from './fixtures.js';

function setup(){
 const view=runView(),payload={...samplePayload(),investigationId:view.run.investigationId,runId:view.run.id,stopReason:'provider_error' as const},version={id:id(90),investigationId:payload.investigationId,runId:payload.runId,createdAt:at,previousVersionId:null,payloadHash:'a'.repeat(64),payload};view.run={...view.run,status:'partial',stopReason:'provider_error',trigger:'initial',createdResultVersionId:version.id};
 const state:InvestigationControllerState={investigationId:payload.investigationId,investigation:InvestigationPublicSchema.parse({id:payload.investigationId,originalQuestion:'controlled_fixture',basicMode:'truth',presentationMode:'brief',scope:payload.scope,scopeVersion:1,status:'partial',attachmentIds:[],activeRunId:null,latestResultVersionId:version.id,createdAt:at,updatedAt:at}),task:{data:view,connection:'connected',events:[],lastSeq:0,error:null,cancelPending:false},phase:'ready',submission:null,error:null,recoveryIncomplete:false};
 const result:ResultControllerState={data:createResultState(version),phase:'ready',selectionPending:null,requestedVersionId:version.id,noticeRefreshing:false,copying:false,copy:null,error:null};return{state,result};
}
it('excludes a known new version even when the case cache still points at the old version',()=>{
 const s=setup();expect(canContinueProviderRun(s.state,s.result)).toBe(true);s.result.data={...s.result.data!,updateNotice:{latestResultVersionId:id(99),createdAt:at}};expect(canContinueProviderRun(s.state,s.result)).toBe(false);
});
it.each(['unknown','pending'] as const)('does not reopen while a %s submission remains unresolved despite ready phase',outcome=>{
 const s=setup();s.state.submission={kind:'add_budget',key:'controlled_fixture',outcome};expect(canContinueProviderRun(s.state,s.result)).toBe(false);
});
it('excludes selection, notice refresh, watch and active-run states',()=>{
 for(const patch of [{phase:'loading' as const},{selectionPending:id(99)},{requestedVersionId:id(99)},{noticeRefreshing:true}]){const s=setup();expect(canContinueProviderRun(s.state,{...s.result,...patch})).toBe(false);}
 const s=setup();s.state.task!.data!.run.trigger='watch';expect(canContinueProviderRun(s.state,s.result)).toBe(false);const active=setup();active.state.investigation!.activeRunId=id(100);expect(canContinueProviderRun(active.state,active.result)).toBe(false);
});
