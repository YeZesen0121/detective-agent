import { useEffect, useState } from 'react';
import type { ProgressEvent, Run } from '../../shared/contracts.js';
import type { RuntimeApi } from '../api/runtime.js';
import type { InvestigationControllerState } from '../controllers/investigation.js';
import { createTaskController } from '../controllers/task.js';
import type { TaskViewState } from '../model/task.js';
import type { ResultViewModel } from '../model/result.js';

const fmt = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const stageText: Record<string, string> = { extracting: '整理线索', planning: '拆出核验问题', searching: '检索出处', reading: '读取材料', evaluating: '交叉核对', finalizing: '整理结论' };
const readText: Record<string, string> = { full: '已读全文', partial: '部分读取', snippet_only: '只搜索摘要，未读正文', inaccessible: '未读' };
function summary(run: Run | undefined) {
  if (!run) return '尚未开查 · 开查后逐条记录实际发生的公开事件。';
  switch (run.status) {
    case 'queued': return '等待执行 · 本轮调查已排队。';
    case 'running': return `调查中 · ${stageText[run.stage ?? ''] ?? '正在处理本轮任务'}。`;
    case 'waiting_for_user': return '等待补充 · 本轮已暂停，补充线索后继续。';
    case 'completed': return '已保存报告 · 以下为本版调查实际发生的公开事件。';
    case 'partial': return '已保存部分报告 · 调查仍有缺口，以报告中的限制为准。';
    case 'cancelled': return '已取消 · 以下保留本轮停止前的公开记录。';
    case 'failed': return '本轮未完成 · 已有记录保留，失败不代表调查结论。';
    case 'interrupted': return '调查中断 · 已有记录保留，请核对状态后再继续。';
  }
}

export function InvestigationLedger({ desk, state, report, api }: {
  desk: boolean; state: InvestigationControllerState; report: ResultViewModel | null; api: RuntimeApi;
}) {
  const caseId = state.investigationId;
  const currentTask = !state.task?.data || state.task.data.run.investigationId === caseId ? state.task : null;
  const currentRun = currentTask?.data?.run;
  const viewedReport = report?.investigationId === caseId ? report : null;
  // Live work and a newer failed/stopped task remain visible alongside an old report.
  // Once work settles with a report, the ledger follows the report actually on screen.
  const showCurrent = !!currentRun && !['completed', 'partial'].includes(currentRun.status);
  const targetRunId = desk ? (showCurrent ? currentRun.id : viewedReport?.runId ?? currentRun?.id) : undefined;
  const archiveRunId = targetRunId && targetRunId !== currentRun?.id ? targetRunId : null;
  const [archive, setArchive] = useState<{ caseId: string; runId: string; task: TaskViewState } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!caseId || !archiveRunId) return;
    const controller = createTaskController(api);
    const publish = () => setArchive({ caseId, runId: archiveRunId, task: controller.getState() });
    const off = controller.subscribe(publish);
    void controller.follow(caseId, archiveRunId);
    return () => { off(); controller.disconnect(); };
  }, [api, caseId, archiveRunId, retry]);
  const task = archiveRunId ? (archive?.caseId === caseId && archive.runId === archiveRunId ? archive.task : null) : currentTask;
  const events = desk ? task?.events ?? [] : [];
  const loading = desk && (!!targetRunId && !task || task?.connection === 'loading' || state.phase === 'loading');
  const error = desk ? task?.error ?? (!task?.data && state.phase === 'error' ? state.error : null) : null;
  const sources = desk ? viewedReport?.sources ?? [] : [];
  const evidence = viewedReport?.evidence ?? [];
  const cited = new Set(viewedReport?.claims.flatMap(claim => claim.links.flatMap(link => {
    const item = evidence.find(item => item.id === link.evidenceId);
    return item?.origin.kind === 'source' ? [item.origin.id] : [];
  })) ?? []);
  const text = !desk ? '当前为盯梢页 · 返回调查台可查看所选案卷的调查记录。'
    : loading ? '正在读取调查记录…'
    : !state.investigation ? caseId ? '案卷尚未读取成功，请重新核对状态。' : '尚未打开案卷 · 新开一桩后记录调查过程。'
    : !task?.data && (targetRunId || state.investigation.status !== 'draft') ? '调查记录尚未读取成功，请核对状态。'
    : summary(task?.data?.run);
  return <aside className="ledger" aria-label={desk ? '调查台账' : '盯梢页说明'}>
    <div className="lhead"><span>{desk ? '调查台账' : '盯梢'}</span><em>{events.length ? String(events.length).padStart(2, '0') : '—'}</em></div>
    {desk && state.investigation && <p className="lsub">案卷 {caseId?.slice(0, 8)}{viewedReport && !showCurrent ? ` · 报告 ${viewedReport.versionId.slice(0, 8)}` : showCurrent && viewedReport?.runId !== currentRun?.id ? ' · 当前调查任务' : ''}</p>}
    <p className="lsub" aria-label="台账状态" aria-live="polite">{text}</p>
    {error && <p className="vnote warn" role="alert">台账更新未完成，已有记录可能不是最新。{error.message}{archiveRunId && <button className="btn" onClick={() => setRetry(value => value + 1)}>重新读取台账</button>}</p>}
    {desk && (events.length ? <ol className="log">{events.map(event => <LedgerEvent key={event.id} event={event}/>)}</ol> : <div className="empty"><div className="glass"/>{loading ? '正在读取已保存的记录。' : error ? '暂时无法确认调查记录。' : '本轮尚无公开事件。'}</div>)}
    {sources.length > 0 && <><div className="lhead ledger-source"><span>已查看来源</span><em>{sources.length}</em></div><ul className="srcs">{sources.map((source, index) => <li key={source.id}><span className="sid">S{index + 1}</span><div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><small>{source.publisher ?? '来源未标明'} · {readText[source.readStatus]} · {cited.has(source.id) ? '被当前命题引用' : '未被当前命题引用'}</small></div></li>)}</ul></>}
    {desk && task?.data && <div className="usage">检索 <b>{task.data.remainingBudget.used.searches}</b>{!task.data.remainingBudget.unrestricted&&<> / {task.data.remainingBudget.limits.searches}</>} · 读取调用 <b>{task.data.remainingBudget.used.reads}</b></div>}
  </aside>;
}

function LedgerEvent({ event }: { event: ProgressEvent }) {
  const status: Record<ProgressEvent['type'], string> = { 'run.queued': '等待执行', 'run.started': '开始调查', 'clarification.requested': '等待补充', 'query.started': '正在检索', 'query.completed': '检索完成', 'source.read': '读取材料', 'evidence.updated': '更新证据', 'run.finalized': '已保存结果', 'run.stopped': '本轮停止', 'provider.failed': '服务异常' };
  return <li className={event.type === 'provider.failed' ? 'hot' : ''}><span className="lt">{fmt(event.at)}</span><span className="lx"><b>{event.type === 'provider.failed' ? '! ' : event.type === 'query.started' ? '⌕ ' : ''}{status[event.type]}</b> · {event.message}</span></li>;
}
