import type { InvestigationControllerState } from '../controllers/investigation.js';

export function TaskFeedback({state,onRefresh,fallbackError}:{state:InvestigationControllerState;onRefresh:()=>void;fallbackError?:string|undefined}) {
  const pending=['loading','submitting','recovering'].includes(state.phase);
  const error=state.error?.message??state.task?.error?.message??fallbackError;
  const unknown=state.submission?.outcome==='unknown';
  const status=state.phase==='loading'?'正在重新读取已保存状态，不会发起新调查。':state.phase==='submitting'?'正在提交恢复请求，请勿重复操作。':unknown?(state.phase==='recovering'?'本次提交尚未确认，正在只读核对，不会自动重发。':state.phase==='ready'?'本次提交仍未确认；已读取当前状态，需要时可显式重试原操作。':'本次提交仍未确认；请重新读取状态，再决定是否重试。'):null;
  return <>
    {error&&<p className="vnote warn" role="alert">{error}</p>}
    {status&&<p className="vnote info" role="status">{status}</p>}
    <div className="actions"><button className="btn" disabled={pending} onClick={onRefresh}>重新读取状态</button></div>
  </>;
}
