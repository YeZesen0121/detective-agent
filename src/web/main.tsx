import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { BasicMode } from '../shared/contracts.js';
import { createFoundationApi, type SessionView } from './api/foundation.js';
import { safeError } from './api/client.js';
import { createCapabilitiesApi } from './api/capabilities.js';
import { createCapabilitiesController } from './controllers/capabilities.js';
import { canStartNewInvestigation,basicModeOptions,canSelectBasicMode,defaultBasicMode,draftInputMatches } from './model/basic-mode.js';
import { createRuntimeApi } from './api/runtime.js';
import { createInvestigationController } from './controllers/investigation.js';
import { createResultController } from './controllers/result.js';
import { createInvestigationsApi } from './api/investigations.js';
import { CaseHistory } from './ui/CaseHistory.js';
import { clarificationFieldLabels,canRecheckOriginalDescription } from './model/clarification-labels.js';
import { InvestigationLedger } from './ui/InvestigationLedger.js';
import { selectLocalImages,type LocalImage } from './model/local-images.js';
import { canContinueProviderRun } from './model/provider-continuation.js';
import { ResultView } from './ui/ResultView.js';
import { TaskFeedback } from './ui/TaskFeedback.js';
import { outcomeCopy, outcomeFor,isLimitStopReason } from './ui/result-status.js';
import { watchesApi, type WatchPublic } from './ui/watches.js';
import { createExperienceApi } from './api/experience.js';
import { createAttachmentController } from './controllers/attachments.js';
import { createMediaJournal } from './controllers/media-submission.js';
import { createFollowupApi } from './api/followup.js';
import { createFollowupJournal } from './model/followup-submission.js';
import { FollowupPanel, type FollowupIntent } from './ui/media/FollowupPanel.js';
import { CompanionPanel } from './ui/media/CompanionPanel.js';
import { AttachmentsPanel } from './ui/media/AttachmentsPanel.js';
import './ui/workbench.css';
import './ui/integration.css';
import './ui/media/media.css';
import './ui/draft-compact.css';

const foundation = createFoundationApi(fetch);
const investigationsApi=createInvestigationsApi(fetch);
const runtime = createRuntimeApi(fetch);
const experience = createExperienceApi(fetch);
const followups = createFollowupApi(fetch);
const fmt = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const terminal = (status: string) => ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(status);
const stageText: Record<string, string> = { extracting: '整理线索', planning: '拆出核验问题', searching: '检索出处', reading: '读取材料', evaluating: '交叉核对', finalizing: '整理结论' };

function App() {
  const capabilityController=useMemo(()=>createCapabilitiesController(createCapabilitiesApi(fetch)),[]);
  const [capabilityState,setCapabilityState]=useState(capabilityController.getState());
  const [basicMode,setBasicMode]=useState<BasicMode>('truth');
  const modeInitialized=useRef(false);
  const investigation = useMemo(() => createInvestigationController({ foundation, runtime }), []);
  const mediaStop = useRef<() => void>(() => {});
  const registerMediaStop = useCallback((stop: () => void) => { mediaStop.current = stop; return () => { if (mediaStop.current === stop) mediaStop.current = () => {}; }; }, []);
  const result = useMemo(() => createResultController({ runtime, onVersionChange: () => mediaStop.current() }), []);
  const [caseState, setCaseState] = useState(investigation.getState());
  const [resultState, setResultState] = useState(result.getState());
  const [session, setSession] = useState<SessionView | null>(null);
  const journal = useMemo(() => createMediaJournal(sessionStorage, session ? `${session.accessGroup}:${session.expiresAt}` : 'inactive'), [session?.expiresAt, session?.accessGroup]);
  const followupJournal = useMemo(() => createFollowupJournal(sessionStorage, session ? `${session.accessGroup}:${session.expiresAt}` : 'inactive'), [session?.expiresAt, session?.accessGroup]);
  const [followupIntent,setFollowupIntent] = useState<FollowupIntent|null>(null);
  const followServerRun = useCallback(async(caseId:string,runId:string)=>{if(investigation.getState().investigationId===caseId)await investigation.followRun(runId);},[investigation]);
  const attachments = useMemo(() => createAttachmentController({ api: experience, journal }), [journal]);
  const [attachmentState, setAttachmentState] = useState(attachments.getState());
  const [sessionLoading, setSessionLoading] = useState(true);
  const historyScope=useMemo(()=>session?crypto.randomUUID():null,[session]);
  const [sessionError, setSessionError] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [question, setQuestion] = useState('');
  const localImages=useRef<LocalImage[]>([]);const [,setImagesRevision]=useState(0);
  const draftAttempt=useRef<{signature:string;key:string}|null>(null);
  const updateImages=(items:LocalImage[])=>{localImages.current=items;setImagesRevision(n=>n+1);};
  const [presentation, setPresentation] = useState<'brief' | 'evidence' | 'companion'>('evidence');
  const [companionExpanded,setCompanionExpanded]=useState(false),[companionOpened,setCompanionOpened]=useState(false);
  const companionEntry=useRef<HTMLButtonElement>(null);
  const draftInputRef=useRef({originalQuestion:question,basicMode,presentationMode:presentation});
  draftInputRef.current={originalQuestion:question,basicMode,presentationMode:presentation};
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('detective-theme') === 'dark' ? 'dark' : 'light');
  const [tab, setTab] = useState<'desk' | 'watches'>('desk');
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState('');
  const [clarification, setClarification] = useState('');
  const [watches, setWatches] = useState<WatchPublic[]>([]);
  const [watchError, setWatchError] = useState('');
  const [watchLoading, setWatchLoading] = useState(false);
  const [watchComposer, setWatchComposer] = useState(false);
  const [watchFocus, setWatchFocus] = useState('');
  const [watchSource, setWatchSource] = useState('');
  const [deleteWatchId, setDeleteWatchId] = useState<string | null>(null);
  const noticeCheckedFor = useRef<string | null>(null);
  const current = caseState.investigation;
  const task = caseState.task;
  const run = task?.data?.run;
  const payload = resultState.data?.result;
  const selectedVersionId = resultState.data?.selectedVersionId;

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('detective-theme', theme); }, [theme]);
  useEffect(() => {
    const stopCase = investigation.subscribe(() => setCaseState(investigation.getState()));
    const stopResult = result.subscribe(() => {const state=result.getState();setResultState(state);if(state.data){const url=new URL(location.href);url.searchParams.set('version',state.data.selectedVersionId);history.replaceState(null,'',url);}});
    return () => { stopCase(); stopResult(); investigation.dispose(); result.dispose(); };
  }, [investigation, result]);
  useEffect(() => {
    const io = new AbortController();
    void foundation.getSession(io.signal).then(async found => {
      if (io.signal.aborted) return;
      setSession(found);
      const id = new URL(location.href).searchParams.get('case');
      if (id) {
        const requestedVersion=new URL(location.href).searchParams.get('version');await investigation.open(id);
        if(requestedVersion&&!io.signal.aborted)await result.select(requestedVersion,id);
      }
    }).catch(error => { if (!io.signal.aborted) setSessionError(safeError(error).message); })
      .finally(() => { if (!io.signal.aborted) setSessionLoading(false); });
    return () => io.abort();
  }, [investigation,result]);
  useEffect(()=>{const off=capabilityController.subscribe(()=>setCapabilityState(capabilityController.getState()));return()=>{off();capabilityController.dispose();};},[capabilityController]);
  useEffect(()=>{modeInitialized.current=false;void capabilityController.setSession(session?crypto.randomUUID():null);},[session,capabilityController]);
  useEffect(()=>{if(!current&&capabilityState.data&&!modeInitialized.current){modeInitialized.current=true;setBasicMode(defaultBasicMode(capabilityState.data));}},[current?.id,capabilityState.data]);
  useEffect(() => { const unsubscribe = attachments.subscribe(() => setAttachmentState(attachments.getState())); return () => { unsubscribe(); attachments.dispose(); }; }, [attachments]);
  useEffect(() => { if (current&&attachments.getState().caseId!==current.id) void attachments.open(current.id); }, [current?.id, attachments]);
  useEffect(() => {
    if (current) { setQuestion(current.originalQuestion); setPresentation(current.presentationMode); setBasicMode(current.basicMode); }
    setCompanionExpanded(current?.presentationMode==='companion');setCompanionOpened(current?.presentationMode==='companion');
  }, [current?.id]);
  useEffect(() => {
    if(sessionLoading)return;
    const latest = run?.createdResultVersionId ?? current?.latestResultVersionId;
    if (!latest) return;
    if (!resultState.data && resultState.phase === 'idle' && !resultState.requestedVersionId) void result.select(latest,current?.id);
    else if (resultState.data && resultState.phase === 'ready' && latest !== selectedVersionId && !resultState.noticeRefreshing && noticeCheckedFor.current !== `${selectedVersionId}:${latest}`) {
      noticeCheckedFor.current = `${selectedVersionId}:${latest}`;
      void result.refreshNotice();
    }
  }, [run?.createdResultVersionId, current?.latestResultVersionId, selectedVersionId, resultState.phase, resultState.data, resultState.noticeRefreshing, result, sessionLoading, resultState.requestedVersionId]);
  useEffect(() => {
    if (tab !== 'watches' || !session) return;
    const io = new AbortController(); setWatchLoading(true); setWatchError('');
    void watchesApi.list(io.signal).then(data => { if (!io.signal.aborted) setWatches(data.items); })
      .catch(error => { if (!io.signal.aborted) setWatchError(safeError(error).message); })
      .finally(() => { if (!io.signal.aborted) setWatchLoading(false); });
    return () => io.abort();
  }, [tab, session]);

  async function activate(event: FormEvent) {
    event.preventDefault(); setWorking(true); setSessionError('');
    try { setSession(await foundation.createSession(accessCode.trim(), new AbortController().signal)); setAccessCode(''); }
    catch (error) { setSessionError(safeError(error).message); }
    finally { setWorking(false); }
  }
  async function start(event: FormEvent) {
    event.preventDefault();if(!question.trim()||question.trim().length>4000||working)return;
    setWorking(true);setNote('');
    try{
      const input={originalQuestion:question.trim(),basicMode,presentationMode:presentation};
      if(!canSelectBasicMode(basicMode,capabilityController.getState().data)||!canStartNewInvestigation(capabilityController.getState().data)){setNote(capabilityController.getState().data?.newInvestigations?.message??'当前暂不能开查，请保留输入并重新检查可用性。');return;}
      let saved=investigation.getState().investigation;
      if(saved&&saved.status!=='draft')return;
      if(saved&&!draftInputMatches(saved,input)){setNote('本案的问题或呈现已经改变，请新开一桩；已有截图仍保留在原案。');return;}
      if(!saved){
        const signature=JSON.stringify(input);if(draftAttempt.current?.signature!==signature)draftAttempt.current={signature,key:crypto.randomUUID()};
        saved=await foundation.createInvestigation(input,draftAttempt.current!.key,new AbortController().signal);result.disconnect();
        const url=new URL(location.href);url.searchParams.set('case',saved.id);url.searchParams.delete('version');history.replaceState(null,'',url);await investigation.open(saved.id);
      }
      const caseId=saved.id,submission=investigation.getState().submission;
      if(submission?.kind==='start'&&['unknown','pending'].includes(submission.outcome)){await investigation.open(caseId);setNote('上次开查尚未确认，现仅核对已有状态，不会自动重发。');return;}
      updateImages(localImages.current.map(item=>item.caseId?item:{...item,caseId}));
      if(localImages.current.some(item=>item.caseId!==caseId)){setNote('所选截图属于其他案卷，当前没有重新上传。');return;}
      if(attachments.getState().caseId!==caseId)await attachments.open(caseId);else await attachments.refresh();
      for(const image of localImages.current){
        const record=attachments.getState().submissions.find(row=>row.key===image.key);
        if(record?.outcome==='confirmed')continue;
        if(record?.outcome==='unknown'||record?.outcome==='pending'){setNote('截图提交尚未确认，请重新核对截图；文件与原问题保留，不重复上传或开查。');return;}
        await attachments.upload(image.file,image.key);
        if(attachments.getState().submissions.find(row=>row.key===image.key)?.outcome!=='confirmed'){setNote('截图尚未上传确认，原问题与本页文件已保留；请核对后再明确开查。');return;}
      }
      await attachments.refresh();const live=investigation.getState(),latestInput=draftInputRef.current;
      if(!attachments.getState().canStart||live.investigation?.id!==caseId||!draftInputMatches(live.investigation,latestInput)||!canSelectBasicMode(latestInput.basicMode,capabilityController.getState().data)||!canStartNewInvestigation(capabilityController.getState().data)){setNote('资料或可用性仍待确认，本案内容保留，尚未发起调查。');return;}
      await investigation.start('start',null);
      if(investigation.getState().submission?.outcome==='unknown')setNote('开查提交尚未确认，请只读核对本案状态，不会自动重复提交。');
    }catch(error){setNote(safeError(error).message);}finally{setWorking(false);}
  }
  async function createSuggestedCase(originalQuestion:string,key:string) {
    const draft=await foundation.createInvestigation({originalQuestion,basicMode:current?.basicMode??basicMode,presentationMode:current?.presentationMode??'evidence'},key,new AbortController().signal);
    const url=new URL(location.href);url.searchParams.set('case',draft.id);url.searchParams.delete('version');location.assign(url.toString());
  }
  function newCase() {
    const url = new URL(location.href); url.searchParams.delete('case'); url.searchParams.delete('version'); location.assign(url.toString());
  }
  async function copyResult() {
    const copied = await result.copy(); if (!copied) return;
    try { await navigator.clipboard.writeText(copied.text); setNote('已复制这一版的结论与出处。'); }
    catch { setNote('浏览器未允许复制，请检查剪贴板权限。'); }
  }
  async function changeWatch(id: string, action: 'pause' | 'resume') {
    setWatchError('');
    try { const changed = await watchesApi.change(id, action, new AbortController().signal); setWatches(items => items.map(item => item.id === id ? changed : item)); }
    catch (error) { setWatchError(safeError(error).message); }
  }
  async function removeWatch(id: string) {
    setWatchError('');
    try { await watchesApi.remove(id, new AbortController().signal); setWatches(items => items.filter(item => item.id !== id)); setDeleteWatchId(null); }
    catch (error) { setWatchError(safeError(error).message); }
  }
  async function createWatch(event: FormEvent) {
    event.preventDefault(); if (!current || !selectedVersionId || !watchFocus.trim() || !watchSource) return;
    setWatchError('');
    try {
      const created = await watchesApi.create({ investigationId: current.id, resultVersionId: selectedVersionId, targetKind: 'page', targetUrls: [watchSource], focus: watchFocus.trim() }, crypto.randomUUID(), new AbortController().signal);
      setWatches(items => [...items, created]); setWatchComposer(false); setWatchFocus(''); setTab('watches');
    } catch (error) { setWatchError(safeError(error).message); }
  }

  const status = run?.status ?? current?.status ?? 'draft';
  const followingResearch = run?.trigger === 'followup' || (run?.trigger === 'resume' && !!payload && run.id !== payload.runId);
  const hasResult = tab === 'desk' && !!payload && (!run || terminal(run.status) || followingResearch);
  const stoppedWithOldReport = !!payload && !!run && payload.runId !== run.id && ['cancelled', 'failed', 'interrupted'].includes(run.status);
  const actionPending = ['loading', 'submitting', 'recovering'].includes(caseState.phase);
  const canResume = !!run && ['cancelled', 'interrupted'].includes(run.status) && run.trigger !== 'watch';
  const resumeDisabled = actionPending || caseState.recoveryIncomplete || (caseState.submission?.outcome === 'unknown' && caseState.phase !== 'ready');
  const modeAvailable=canSelectBasicMode(basicMode,capabilityState.data);
  const questionTooLong = question.trim().length > 4000;
  const readStatus = () => { if (current) void investigation.open(current.id); };
  const waiting = !hasResult && status === 'waiting_for_user' && !!task?.data?.clarification;
  const cancelled = !hasResult && status === 'cancelled';
  const failed = !hasResult && (status === 'failed' || status === 'interrupted');
  const failedAtLimit=status==='failed'&&isLimitStopReason(run?.stopReason);
  const caseUnavailable=!current&&caseState.error?.status===404;
  const canContinueProvider=canContinueProviderRun(caseState,resultState);
  const outcome = payload ? outcomeFor(payload, run?.id === payload.runId ? run.status : undefined) : 'failed';
  const events = task?.events ?? [];
  const sources = payload?.sources ?? [];
  const citedSourceIds=new Set(payload?.claims.flatMap(claim=>claim.links.flatMap(link=>{const item=payload.evidence.find(item=>item.id===link.evidenceId);return item?.origin.kind==='source'?[item.origin.id]:[];}))??[]);
  const displayState = tab === 'watches' ? '盯梢' : caseUnavailable ? '无法读取' : failedAtLimit ? '到限未完' : stoppedWithOldReport ? run?.status === 'cancelled' ? '已取消' : '没查成' : hasResult ? outcomeCopy(outcome,payload??undefined).stamp : waiting ? '待澄清' : cancelled ? '已取消' : failed ? '没查成' : status === 'draft' ? '待受理' : '调查中';
  const showCompanion=tab==='desk'&&hasResult&&!!payload&&companionExpanded;

  return <>
    <header className="top"><div className="mark brand"><span className="lamp"/><b>侦探 Agent</b><i>事务所</i></div><div className="tabs" role="tablist" aria-label="工作台"><button role="tab" aria-selected={tab === 'desk'} className={tab === 'desk' ? 'on' : ''} onClick={() => setTab('desk')}>调查台</button><button role="tab" aria-selected={tab === 'watches'} className={tab === 'watches' ? 'on' : ''} onClick={() => setTab('watches')}>盯梢{watches.length > 0 && <span className="n">{watches.length}</span>}</button></div><span className="grow"/><span className="tag"><i/>{session ? '体验码已激活' : '等待体验码'}</span><button className="ghost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '暗房' : '亮房'}</button></header>
    <div className={'shell'+(showCompanion?' companion-shell':'')}>
      <aside className="drawer"><div className="dhead"><span>案卷柜</span><em>{current ? '01' : '00'}</em></div><button className="newcase" onClick={newCase}>＋ 新开一桩</button><div className="dsec">盯梢中</div><button className="wsum" onClick={() => setTab('watches')}><i className="pulse"/>查看盯梢<span className="go">全部 →</span></button><CaseHistory onDeleted={id=>{if(investigation.getState().investigationId===id)newCase();}} api={investigationsApi} scope={historyScope} currentId={current?.id??null} onOpen={(id,versionId)=>{const url=new URL(location.href);url.searchParams.set('case',id);if(versionId)url.searchParams.set('version',versionId);else url.searchParams.delete('version');location.assign(url.toString());}}/><div className="dfoot">案卷仅属于当前体验会话，点击后只读取已有记录。</div></aside>
      <main className="stage"><div className="stagehead"><span className="no">{current ? `CASE №${current.id.slice(0, 8)}` : 'CASE №—'}</span><span className="grow"/><span className="state">{displayState}</span></div>
        {session&&<>{(capabilityState.error||capabilityState.data?.newInvestigations?.available===false)&&<div className="vnote warn" aria-label="服务暂不可用">{capabilityState.error?<p role="alert">服务能力读取失败：{capabilityState.error.message}</p>:<p role="status">{capabilityState.data?.newInvestigations?.message??'当前暂不能开查，已有报告仍可阅读。'}</p>}<button type="button" className="btn" disabled={capabilityState.phase==='loading'} onClick={()=>{void capabilityController.refresh();}}>重新检查可用性</button></div>}</>}
        {sessionLoading ? <section className="view on"><div className="hero"><div className="kicker">正在核对会话</div><h1>稍候，<em>正在开门</em>。</h1></div></section>
        : !session ? <section className="view on"><div className="hero"><div className="kicker">事务所 · 体验入口</div><h1>先核对一下，<em>体验码</em>。</h1><p>输入已有体验码，再开始调查。</p></div><form className="askbox" onSubmit={event => { void activate(event); }}><label htmlFor="accessCode">体验码</label><input id="accessCode" type="password" autoComplete="off" value={accessCode} onChange={event => setAccessCode(event.target.value)} required/><div className="go"><button className="primary" disabled={working}>进入事务所 →</button></div></form>{sessionError && <p className="vnote warn" role="alert">{sessionError}</p>}</section>
        : tab === 'watches' ? <section className="view on"><div className="hero"><div className="kicker">盯梢 · {watches.filter(item => item.status === 'active').length} 项在跑</div><h1>有变化，<em>我再叫你</em>。</h1><p>按约定的目标检查公开页面。变化与否以实际检查记录为准。</p></div>{watchLoading && <p role="status">正在读取盯梢…</p>}{watchError && <p className="vnote warn" role="alert">{watchError}</p>}<div className="wlist">{!watchLoading && watches.length === 0 && <div className="wempty">当前没有盯梢记录。</div>}{watches.map(watch => <article className={`wbig ${watch.status !== 'active' ? 'paused' : ''}`} key={watch.id}><div className="wtop"><i className="pulse"/><h3>{watch.focus}</h3><span className="wbig-state">{watch.status === 'active' ? '进行中' : watch.status === 'paused' ? '已暂停' : watch.status}</span></div><p className="wq">{watch.targetKind === 'page' ? watch.targetUrls.join(' · ') : '追踪尚未解决的问题'}</p><div className="wgrid"><div>频率<b>每小时</b></div><div>下次检查<b>{fmt(watch.nextCheckAt)}</b></div><div>上次成功<b>{fmt(watch.lastSuccessAt)}</b></div></div><div className="wfoot">{watch.status === 'active' && <button onClick={() => { void changeWatch(watch.id, 'pause'); }}>暂停</button>}{watch.status === 'paused' && <button onClick={() => { void changeWatch(watch.id, 'resume'); }}>恢复</button>}<button className="danger" onClick={() => setDeleteWatchId(watch.id)}>删除</button><span className="grow"/></div>{deleteWatchId === watch.id && <div className="vnote warn">确定删除这项盯梢？<button className="btn" onClick={() => { void removeWatch(watch.id); }}>确认删除</button><button className="btn" onClick={() => setDeleteWatchId(null)}>保留</button></div>}</article>)}</div></section>
        : caseUnavailable ? <section className="view on"><div className="kicker">案卷无法读取</div><p className="vnote warn" role="alert">当前会话无法读取此案卷，请使用原会话或新开调查</p><button type="button" className="btn" onClick={newCase}>新开调查</button></section>
        : !payload && resultState.requestedVersionId && (resultState.phase === 'loading' || resultState.phase === 'error') ? <section className="view on" aria-label="所选报告读取状态"><div className="kicker">读取所选报告</div><h1>这份报告，<em>还没读到</em>。</h1><p className="lede">原来选择的报告版本已保留，不会自动打开其他版本。</p>{resultState.error && <p className="vnote warn" role="alert">{resultState.error.message}</p>}{resultState.phase === 'loading' && <p role="status">正在只读获取所选报告…</p>}<div className="actions"><button className="btn" disabled={resultState.phase === 'loading'} onClick={()=>{void result.retrySelection();}}>重试所选报告</button></div></section>
        : !current || status === 'draft' ? <section className="view on draft-view"><div className="hero"><div className="kicker">新案卷 · 尚未开查</div><h1>这一桩，<em>查还是不查</em>？</h1><p>把拿不准的那句话丢进来。我只查，不猜——<br/>查不到就直说，哪句话站不住也直说。</p></div><form onSubmit={event => { void start(event); }}><div className="ask"><textarea disabled={working} aria-label="要调查的问题" aria-invalid={questionTooLong} aria-describedby={questionTooLong ? "question-error" : undefined} spellCheck={false} placeholder="写下你想核对的说法，以及你关心的时间、地点或对象" value={question} onChange={event => setQuestion(event.target.value)}/><div className="askbar"><span className="hint">可先选择截图，点击开查后上传到本案并开始核验</span><span className="count">{question.trim().length} / 4000</span></div></div><div className="label">查什么</div><div className="modes">{basicModeOptions.map(mode=><button key={mode.id} type="button" className={`mode ${basicMode===mode.id?'sel':''}`} aria-pressed={basicMode===mode.id} disabled={working||!canSelectBasicMode(mode.id,capabilityState.data)} title={canSelectBasicMode(mode.id,capabilityState.data)?mode.description:'当前服务暂未开放此模式或能力尚未确认'} onClick={()=>{modeInitialized.current=true;setBasicMode(mode.id);}}><span className="tick"/><span className="mh"><b>{mode.label}</b></span><p>{mode.description}{!canSelectBasicMode(mode.id,capabilityState.data)?' · 待开放':''}</p></button>)}</div><div className="label">怎么呈现</div><div className="seg"><button disabled={working} type="button" className={presentation === 'brief' ? 'on' : ''} onClick={() => setPresentation('brief')}>简答</button><button disabled={working} type="button" className={presentation === 'evidence' ? 'on' : ''} onClick={() => setPresentation('evidence')}>证据链</button><button disabled={working} type="button" className={presentation === 'companion' ? 'on' : ''} onClick={() => setPresentation('companion')}>侦探伴读</button></div>{(!current||localImages.current.some(image=>attachmentState.submissions.find(row=>row.key===image.key)?.outcome!=='confirmed'))&&<section className="media-panel draft-uploads" aria-label="开查前截图"><div><h3>截图线索（可选）</h3><p id="draft-upload-hint">最多3张 · 每张8 MiB · 开查时上传，刷新前请确认结果。</p></div>{!current&&<label><span className="draft-file-label">选择截图（暂存本页）</span><input aria-describedby="draft-upload-hint" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={working} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';try{updateImages(selectLocalImages(localImages.current,files));setNote('');}catch(error){setNote(safeError(error).message);}}}/></label>}<ul>{localImages.current.filter(image=>attachmentState.submissions.find(row=>row.key===image.key)?.outcome!=='confirmed').map((image,index)=>{const outcome=attachmentState.submissions.find(row=>row.key===image.key)?.outcome;return <li key={image.key}>{image.file.name} · {outcome==='unknown'?'上传尚未确认':outcome==='failed'?'上传未成功，文件仍保留':'待上传'}<button type="button" disabled={working||outcome==='unknown'||outcome==='pending'} onClick={()=>updateImages(localImages.current.filter(item=>item.key!==image.key))}>移除待上传截图 {index+1}</button></li>;})}</ul></section>}<div className="go"><button type="submit" className="primary" disabled={!question.trim()||questionTooLong||working||!modeAvailable||!canStartNewInvestigation(capabilityState.data)||attachmentState.loading||caseState.submission?.outcome==='unknown'||caseState.submission?.outcome==='pending'||(!!current&&!draftInputMatches(current,{originalQuestion:question,basicMode,presentationMode:presentation}))}>{working?'正在受理…':'开查'} →</button><span className="hint">开查后会记录实际进展，可以随时停止。</span></div></form>{current?.status === 'draft' && <>{(caseState.error||caseState.recoveryIncomplete||caseState.submission?.outcome==='unknown')&&<TaskFeedback state={caseState} onRefresh={readStatus}/>}<AttachmentsPanel controller={attachments} api={experience} locked={working}/>{(!draftInputMatches(current,{originalQuestion:question,basicMode,presentationMode:presentation})) && <p className="vnote warn" role="alert">草稿保存后问题、基本模式或呈现已改变，请新开一桩；当前截图保留在原案。</p>}</>}{questionTooLong && <p id="question-error" className="vnote warn" role="alert">问题最多4000字，请缩短后再开查；当前内容已保留。</p>}{note && <p className="vnote warn" role="alert">{note}</p>}{caseState.error && <p className="vnote warn" role="alert">{caseState.error.message}</p>}</section>
        : waiting ? <section className="view on">
          <div className="kicker">还需要一句 · {task?.data?.clarification?.canProceedWithUnknown ? '也可以按现有线索先查' : '请先补充必要线索'}</div>
          <h1>这一句，<em>你指的是哪一个</em>？</h1><p className="lede">{task?.data?.clarification?.prompt}</p>
          {task?.data?.clarification?.missingFields.length ? <p className="vnote info">待补充：{clarificationFieldLabels(task.data.clarification.missingFields).join('、')}</p> : null}
          {task?.data?.clarification&&canRecheckOriginalDescription(task.data.clarification.missingFields)&&<div className="vnote info"><p>沿用原题重新核对对象和范围，不会跳过证据检查，也不会新增你未提供的事实。</p><button type="button" className="btn" disabled={actionPending||caseState.submission?.outcome==='unknown'||caseState.submission?.outcome==='pending'} onClick={()=>{const live=investigation.getState(),clarification=live.task?.data?.clarification;if(!clarification||!live.investigation||!canRecheckOriginalDescription(clarification.missingFields)||['unknown','pending'].includes(live.submission?.outcome??'')||['loading','submitting','recovering'].includes(live.phase))return;void investigation.answer(clarification.id,{answer:live.investigation.originalQuestion,proceedWithUnknown:false});}}>按原描述重新核对</button></div>}
          <div className="askbox"><label htmlFor="clarification">补充一句</label><textarea id="clarification" rows={2} maxLength={2000} value={clarification} disabled={actionPending} onChange={event => setClarification(event.target.value)} placeholder="补上你知道的线索"/></div>
          <div className="askrow"><button className="primary" disabled={!clarification.trim() || actionPending} onClick={() => { const id = task?.data?.clarification?.id; if (id) void investigation.answer(id, { answer: clarification.trim(), proceedWithUnknown: false }); }}>{actionPending ? '正在提交…' : '补充后开查 →'}</button>
            {task?.data?.clarification?.canProceedWithUnknown && <button className="btn" disabled={actionPending} onClick={() => { const id = task.data?.clarification?.id; if (id) void investigation.answer(id, { answer: null, proceedWithUnknown: true }); }}>按现有线索先查</button>}<span className="hint">未知会保持未知。</span></div>
          {(caseState.error ?? task?.error) && <p className="vnote warn" role="alert">{(caseState.error ?? task?.error)?.message}</p>}
          {caseState.submission?.outcome === 'unknown' && <p className="vnote info" role="status">{caseState.phase === 'recovering' ? '本次提交尚未确认，正在只读核对；请勿重复创建任务。' : '本次提交仍未确认；请保留回答，重新核对状态后再决定是否重试。'}</p>}
        </section>
        : hasResult && payload ? <>
          {stoppedWithOldReport && <section className="view on" aria-label="本轮任务状态"><div className="vnote warn" role="status"><b>{run?.status === 'cancelled' ? '本轮已取消。' : failedAtLimit ? '本轮已到限。' : '本轮未完成。'}</b>这次未生成新报告；下方保留上一份报告，不能据此认定本轮已经查完。</div><TaskFeedback state={caseState} onRefresh={readStatus} fallbackError={run?.status === 'failed' ? failedAtLimit?'本轮已到限，未形成新报告；旧报告仍可阅读，请先核对服务能力。':'本轮调查失败，未形成新报告。旧报告仍可阅读；如需重新调查，请新开一桩。' : undefined}/><div className="actions">{canResume && <button className="btn dark" disabled={resumeDisabled} onClick={() => { if (run) void investigation.start('resume', run.id); }}>继续调查</button>}<button className="btn" onClick={newCase}>新开一桩</button></div></section>}
          {followingResearch && run && !terminal(run.status) && <section className="view on" aria-label="本轮补查任务"><p role="status">正在补查；下方保留当前打开的报告。原问题与已存材料沿用服务器记录。</p><TaskFeedback state={caseState} onRefresh={readStatus}/><button className="btn" disabled={task?.cancelPending} onClick={()=>{void investigation.cancel();}}>停止补查</button></section>}
          <div hidden={showCompanion}><ResultView data={payload} unrestrictedUsage={capabilityState.data?.unrestrictedUsage===true} question={current.originalQuestion} outcome={outcome} canContinueProvider={canContinueProvider} continueDisabled={actionPending||caseState.recoveryIncomplete||!canStartNewInvestigation(capabilityState.data)} onContinueProvider={()=>{const live=investigation.getState();if(canStartNewInvestigation(capabilityController.getState().data)&&canContinueProviderRun(live,result.getState()))void investigation.start('add_budget',live.task!.data!.run.id);}} canAddBudget={!!run && run.id === payload.runId && !caseState.recoveryIncomplete} presentation={current.presentationMode} error={(stoppedWithOldReport ? null : caseState.error?.message) ?? resultState.error?.message ?? ''} updateNotice={resultState.data?.updateNotice?.latestResultVersionId ?? null} onLatest={() => { void result.openLatest(); }} onPrevious={() => { if (payload.previousVersionId) void result.select(payload.previousVersionId); }} onCopy={() => { void copyResult(); }} onAddBudget={() => { void investigation.start('add_budget', run?.id ?? payload.runId); }} onWatch={() => { setWatchComposer(true); setWatchFocus(payload.unknowns[0] ?? current.originalQuestion); setWatchSource(payload.sources[0]?.url ?? ''); }} watchAvailable={capabilityState.data?.watches===true} watchComposer={watchComposer} watchFocus={watchFocus} watchSource={watchSource} watchError={watchError} setWatchFocus={setWatchFocus} setWatchSource={setWatchSource} createWatch={createWatch} note={note}/></div>
          {!showCompanion&&<button ref={companionEntry} type="button" className="btn companion-launcher" onClick={()=>{setCompanionOpened(true);setCompanionExpanded(true);}}>进入侦探伴读</button>}
          {(companionOpened||current.presentationMode === 'companion') && <CompanionPanel key={payload.versionId} api={experience} result={payload} journal={journal} expanded={showCompanion} latestVersionId={resultState.data?.updateNotice?.latestResultVersionId??null} caseTitle={current.originalQuestion} onClose={()=>{setCompanionExpanded(false);requestAnimationFrame(()=>companionEntry.current?.focus());}} registerStop={registerMediaStop} onOpenVersion={id=>{void result.select(id);}} onResearchRequest={(question,cursor)=>setFollowupIntent({versionId:payload.versionId,question,cursor,token:Date.now()})}/>}
          {resultState.phase === 'error' && resultState.requestedVersionId && <button className="btn" onClick={()=>{void result.retrySelection();}}>重试所选报告</button>}
          <FollowupPanel key={`followup:${payload.versionId}`} api={followups} runtime={runtime} result={payload} journal={followupJournal} onFollowRun={followServerRun} onOpenVersion={id=>{void result.select(id);}} onNewCase={createSuggestedCase} previousRunId={run?.id??payload.runId} intent={followupIntent}/>
        </>
        : (status === 'completed' || status === 'partial') && !payload ? <section className="view on"><div className="kicker">报告读取中</div><h1>任务已停，<em>报告还没读到</em>。</h1><p className="lede">{resultState.error?.message ?? '正在从服务读取报告。'}</p><div className="actions"><button className="btn" onClick={() => { const id = run?.createdResultVersionId ?? current.latestResultVersionId; if(resultState.requestedVersionId)void result.retrySelection();else if (id) void result.select(id,current.id); else void investigation.open(current.id); }}>重新读取</button></div></section>
        : cancelled ? <section className="view on"><div className="kicker">已停止 · 不是查完了</div><h1>停在这里，<em>材料都留着</em>。</h1><p className="lede">已发出的请求可能仍会完成并计费；已有材料以服务器记录为准。</p>{task?.data?.partialMaterialSummary && <div className="got"><div className="ghead">已找到的材料</div><p>{task.data.partialMaterialSummary}</p></div>}<TaskFeedback state={caseState} onRefresh={readStatus}/><div className="actions">{canResume && <button className="btn dark" disabled={resumeDisabled} onClick={() => { if (run) void investigation.start('resume', run.id); }}>继续调查</button>}<button className="btn" onClick={newCase}>新开一桩</button></div><p className="footnote">停止不等于查明。</p></section>
        : failed ? <section className="view on"><div className="kicker">{failedAtLimit?'到限未完':status === 'failed' ? '本轮未完成' : '调查中断'}</div><div className="verdict"><div className="sealbig short"><span>{failedAtLimit?'到限未完':'没查成'}</span></div><div className="vtext"><h2>{failedAtLimit?'本轮已到限，尚未形成报告':<>这次没查成，<em>不是没有问题</em>。</>}</h2><p>{failedAtLimit?'本轮达到运行额度或时间上限，尚未形成可核对报告。请先只读核对服务能力与任务状态，勿重复提交。':'本轮没有形成可核对的报告。新开一桩会建立新案件，不会自动执行调查。'}</p><p>原问题：{current.originalQuestion}</p></div></div><TaskFeedback state={caseState} onRefresh={readStatus} fallbackError={failedAtLimit?'本轮已到限，原问题和已有材料保留；读取状态不会重发调查。':status === 'failed' ? '本轮调查失败，未形成核验结果；请保留已有材料，或新开一桩。' : undefined}/>{failedAtLimit&&run&&<p className="vnote">重新开查本案会复用原问题，建立新一轮调查额度；仅在明确点击后执行。</p>}<div className="actions">{failedAtLimit&&run&&<button type="button" className="btn" disabled={actionPending||caseState.recoveryIncomplete||!canStartNewInvestigation(capabilityState.data)} onClick={()=>{const latest=investigation.getState();if(canStartNewInvestigation(capabilityController.getState().data)&&!latest.recoveryIncomplete&&latest.task?.data?.run.id===run.id)void investigation.start('add_budget',run.id);}}>重新开查本案</button>}{canResume && <button className="btn" disabled={resumeDisabled} onClick={() => { if (run) void investigation.start('resume', run.id); }}>继续调查</button>}<button className="btn" onClick={newCase}>新开一桩</button></div></section>
        : <section className="view on"><div className="rq"><q>{current.originalQuestion}</q>{current.scope && <div className="scope"><span className="sc"><b>对象</b>{current.scope.objectText}</span><span className="sc"><b>目的</b>{current.scope.goal}</span>{current.scope.uncertainClues.map(clue => <span className="sc" key={clue}><b>未知</b>{clue}</span>)}</div>}</div><div className="pressing"><div className="seal-live">阅</div><div className="live-text"><div className="now">{run?.stage ? stageText[run.stage] : '正在核对任务状态'}<span className="dots"><i/><i/><i/></span></div><div className="meter">{task?.data && <span>已用 <b>{task.data.remainingBudget.used.searches}</b>{!task.data.remainingBudget.unrestricted&&<> / {task.data.remainingBudget.limits.searches}</>} 次检索</span>}<span>{task?.connection === 'reconnecting' ? '连接恢复中' : task?.connection === 'error' ? '读取中断' : '持续记录'}</span></div></div></div><div className="found"><div className="fhead"><span>已翻到的材料</span><em>{events.filter(event => event.type === 'source.read').length} 条记录</em></div><ul id="foundList">{events.filter(event => event.type === 'source.read').map(event => <li key={event.id}><span className="fid">来源</span><span className="ft">{event.message}</span><span className="fm">{fmt(event.at)}</span></li>)}</ul></div><div className="rfoot"><button className="stopbtn" disabled={!run || task?.cancelPending} onClick={() => { void investigation.cancel(); }}>{task?.cancelPending ? '正在停止…' : '停止调查'}</button><span className="hint">停手后已发出的请求可能仍在计费。</span></div>{caseState.error && <p className="vnote warn" role="alert">{caseState.error.message}</p>}{task?.error && <p className="vnote warn" role="alert">{task.error.message}</p>}</section>}
      </main>
      <InvestigationLedger desk={tab === 'desk'} state={caseState} report={hasResult ? resultState.data?.result ?? null : null} api={runtime}/>
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<App/>);
