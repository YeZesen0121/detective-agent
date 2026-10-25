import type { ResultPayload, RunStatus, StopReason } from '../../shared/contracts.js';

export type Outcome = 'normal' | 'empty' | 'partial' | 'limit' | 'failed';
const limits = new Set<StopReason>(['time_limit', 'search_limit', 'read_limit', 'model_limit', 'token_limit', 'cost_limit']);

export function isLimitStopReason(reason:StopReason|null|undefined){return!!reason&&limits.has(reason);}

export function outcomeFor(payload: ResultPayload | null, runStatus?: RunStatus): Outcome {
  if (!payload) return 'failed';
  if (limits.has(payload.stopReason)) return 'limit';
  if (['provider_error', 'invalid_output', 'server_restart'].includes(payload.stopReason))
    return payload.sources.length || payload.evidence.length || payload.claims.length ? 'partial' : 'failed';
  if (payload.stopReason === 'no_useful_direction') return payload.sources.length || payload.evidence.length ? 'partial' : 'empty';
  if (runStatus === 'partial' || payload.stopReason === 'needs_user') return 'partial';
  return 'normal';
}

export function outcomeCopy(outcome: Outcome, payload?: ResultPayload): { stamp: string; title: string; note: string } {
  const copy = outcome === 'normal' ? { stamp: '已查', title: '调查结果', note: '' }
    : outcome === 'limit' ? { stamp: '到限暂停', title: '这一轮尚未核验完', note: '本轮已达到运行上限，未核实的部分仍不能下结论。' }
    : outcome === 'failed' ? { stamp: '核验未完', title: '这次调查未完成', note: '本轮未完成核验，不能据此判断原说法的真假。' }
    : { stamp: '待确认', title: '现有证据还不能确定答案', note: '目前还拿不准，未核实的部分见下方说明。' };
  if (!payload) return copy;
  const hasJudgment = payload.claims.some(claim => claim.status === 'supported' || claim.status === 'refuted')
    || outcome==='normal'&&payload.stopReason==='answered'&&payload.scope.basicMode==='identify'&&payload.candidates.length>0;
  const hasConflict = payload.conflicts.length > 0 || payload.claims.some(claim => claim.status === 'mixed');
  if (hasConflict) {
    copy.stamp = '有冲突'; copy.title = '现有证据有冲突，暂时无法确定';
  } else if (!hasJudgment) {
    copy.stamp = '待确认';
    copy.title = payload.scope.basicMode === 'identify'
      ? payload.candidates.length ? '找到一些候选，还不能确定是哪一个' : '暂时还没认出你要找的对象'
      : payload.scope.basicMode === 'latest' ? '暂时还不能确认最新情况' : '现有证据还不能确定答案';
  } else if (outcome !== 'normal') {
    copy.stamp = '部分确认'; copy.title = '已核实部分信息，仍有问题待确认';
  }
  const reason = payload.stopReason;
  if (reason === 'needs_user') copy.note = '需要你补充能缩小范围的关键线索；记不清的可以直接说明。';
  else if (reason === 'no_useful_direction') copy.note = '本轮暂未找到有效的后续核验方向，不能凭现有证据给出确定答案。';
  else if (['provider_error', 'invalid_output', 'server_restart'].includes(reason)) {
    copy.stamp = '核验中断'; copy.note = stopText[reason] + '。';
  } else if (limits.has(reason)) {
    copy.stamp = '到限暂停'; copy.note = stopText[reason] + '，未完成的核验已暂停。';
  }
  return copy;
}

const stopText:Record<StopReason,string>={answered:'本轮已完成核对',no_useful_direction:'暂未找到有效的后续核验方向',needs_user:'需要补充线索',time_limit:'本轮时间已到限',search_limit:'本轮检索次数已到限',read_limit:'本轮读取次数已到限',model_limit:'本轮模型额度已到限',token_limit:'本轮处理容量已到限',cost_limit:'本轮费用额度已到限',cancelled:'用户已停止本轮',provider_error:'外部服务或网络未完成核验，未确认部分仍保留未知',invalid_output:'本轮输出未通过核验，不能作为结论',server_restart:'服务中断，本轮未完成'};
export function humanizeStopReasonText(text:string){return text.replace(/停止原因\s*[：:]\s*([a-z_]+)/g,(_label,reason:string)=>'停止说明：'+(stopText[reason as StopReason]??'本轮未完成，请核对已保存状态'));}
