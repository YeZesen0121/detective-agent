import type { InvestigationControllerState } from '../controllers/investigation.js';
import type { ResultControllerState } from '../controllers/result.js';

export function canContinueProviderRun(state:InvestigationControllerState,result:ResultControllerState){
 const inv=state.investigation,run=state.task?.data?.run,selected=result.data?.result;
 return state.phase==='ready'&&!state.recoveryIncomplete&&state.submission?.outcome!=='unknown'&&state.submission?.outcome!=='pending'&&result.phase==='ready'&&!result.selectionPending&&!result.noticeRefreshing&&!result.data?.updateNotice&&(!result.requestedVersionId||result.requestedVersionId===selected?.versionId)&&!!run&&!!selected&&inv?.status==='partial'&&!inv.activeRunId&&inv.id===selected.investigationId&&run.investigationId===inv.id&&run.status==='partial'&&run.stopReason==='provider_error'&&run.trigger!=='watch'&&run.id===selected.runId&&run.createdResultVersionId===selected.versionId&&inv.latestResultVersionId===selected.versionId;
}
