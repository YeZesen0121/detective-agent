import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ExperienceApi } from '../../api/experience.js';
import type { ResultViewModel } from '../../model/result.js';
import type { MediaJournal } from '../../controllers/media-submission.js';
import { createCompanionSessionController } from '../../controllers/companion-session.js';
import { createAudioSessionController } from '../../controllers/audio-session.js';
import { createBrowserAudioDriver } from './browser-audio.js';
import { AudioControls } from './AudioControls.js';
import './companion-workspace.css';

export function CompanionPanel({api,result,journal,registerStop,onOpenVersion,onResearchRequest,expanded=true,caseTitle='当前案卷',onClose,latestVersionId}:{api:ExperienceApi;result:ResultViewModel;journal:MediaJournal;registerStop?:(stop:()=>void)=>()=>void;onOpenVersion?:(id:string)=>void;onResearchRequest?:(question:string,cursor:number)=>void;expanded?:boolean;caseTitle?:string;onClose?:()=>void;latestVersionId?:string|null}){
 const version=useMemo(()=>{const {versionId,previousVersionId,createdAt,payloadHash,claimsByStatus:_,...payload}=result;return{id:versionId,previousVersionId,createdAt,payloadHash,investigationId:payload.investigationId,runId:payload.runId,payload};},[result.versionId]);
 const audio=useMemo(()=>createAudioSessionController({api,journal,driver:createBrowserAudioDriver()}),[api,journal,version.id]);
 const controller=useMemo(()=>createCompanionSessionController({api,journal,onInterrupt:()=>audio.stop()}),[api,journal,version.id,audio]);
 const [state,setState]=useState(controller.getState());const [question,setQuestion]=useState('');
 const frame=useRef<HTMLElement>(null),[frameHeight,setFrameHeight]=useState<number>();
 useLayoutEffect(()=>{
  const element=frame.current,parent=element?.parentElement;if(!expanded||!element||!parent)return;
  parent.scrollTop=0;
  const measure=()=>setFrameHeight(Math.max(420,parent.clientHeight-element.offsetTop));
  const resize=new ResizeObserver(measure);
  const observe=()=>{resize.observe(parent);for(let sibling=element.previousElementSibling;sibling;sibling=sibling.previousElementSibling)resize.observe(sibling);measure();};
  observe();const children=new MutationObserver(observe);children.observe(parent,{childList:true});
  window.addEventListener('resize',measure);
  return()=>{resize.disconnect();children.disconnect();window.removeEventListener('resize',measure);};
 },[expanded,version.id]);
 useEffect(()=>{const off=controller.subscribe(()=>setState(controller.getState()));void controller.open(version);return()=>{off();controller.dispose();};},[controller,version]);
 const session=state.view?.session,segment=session?.segments[session.cursor];const pending=state.busy||state.loading||state.submission?.outcome==='unknown';
 const reopenButton=useRef<HTMLButtonElement>(null),reader=useRef<HTMLSelectElement>(null),focusIntent=useRef<'end'|'reopen'|null>(null);
 useEffect(()=>{
  if(state.busy||state.loading)return;
  const target=focusIntent.current==='end'&&session?.status==='ended'?reopenButton.current:focusIntent.current==='reopen'&&session?.status==='ready'?reader.current:null;
  if(target){if(document.activeElement===document.body)target.focus();focusIntent.current=null;}
  else if(state.error)focusIntent.current=null;
 },[session?.status,state.busy,state.loading,state.error]);
 useEffect(()=>{const unregister=registerStop?.(()=>audio.stop());return()=>{unregister?.();audio.dispose();};},[audio,registerStop]);
 useEffect(()=>{if(expanded&&session?.status==='ready'&&segment)void audio.open({caseId:version.investigationId,versionId:version.id,companionId:session.id,segmentId:segment.id});return()=>audio.disconnect();},[audio,session?.id,session?.status,segment?.id,version.id,expanded]);
 const conversation=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(expanded&&conversation.current)conversation.current.scrollTop=conversation.current.scrollHeight;},[session?.cursor,state.turns.length,expanded]);
 const close=()=>{audio.stop();onClose?.();};
 return <section ref={frame} style={{height:frameHeight}} className="companion-workspace" aria-label="固定版本伴读" hidden={!expanded}>
  <aside className="companion-sidebar">
   <div className="companion-wordmark"><span className="companion-monogram">D</span><div>侦探伴读<small>READ WITH YOUR DETECTIVE</small></div></div>
   <div className="companion-sidebar-label">本次案卷</div><button className="companion-case" type="button" onClick={close}><span className="companion-case-dot"/><span>{caseTitle}<small>固定版本 · {version.id.slice(0,8)}</small></span></button>
   <nav aria-label="伴读段落"><div className="companion-sidebar-label">阅读主线{session&&<span>{Math.min(session.cursor+1,session.segments.length)} / {session.segments.length}</span>}</div>
    {session?.segments.length?<ol className="companion-segments">{session.segments.map((item,index)=><li key={item.id}><button type="button" aria-label={'跳到第 '+(index+1)+' 段'} aria-current={session.cursor===index?'step':undefined} disabled={state.busy||session.status!=='ready'} onClick={()=>{void controller.selectCursor(index);}}><span>{String(index+1).padStart(2,'0')}</span><span>第 {index+1} 段<small>{item.text.split('\n').find(text=>text.trim())}</small></span></button></li>)}</ol>:<p className="companion-sidebar-note">生成伴读后，在这里选择段落。阅读位置会随本案保存。</p>}
   </nav>
   <div className="companion-sidebar-bottom"><DetectivePortrait/><p>同一份材料，慢慢读懂。<small>可以打断，也可以直接收尾。</small></p><button type="button" onClick={close}>返回案卷与报告</button></div>
  </aside>
  <div className="companion-room">
   <header className="companion-room-header"><div><span className="companion-room-dot"/><strong>侦探伴读</strong><span className="companion-version">版本 {version.id.slice(0,8)}</span></div><div><button type="button" disabled={state.loading||state.busy} onClick={()=>{void controller.refresh();}}>重新读取伴读状态</button><button type="button" onClick={close}>返回报告</button></div></header>
   <div className="companion-result-strip"><span>本版结论</span><h2>{result.summary}</h2><div className="companion-report-links">{latestVersionId&&<button type="button" onClick={()=>onOpenVersion?.(latestVersionId)}>看新版 →</button>}{version.previousVersionId&&<button type="button" onClick={()=>onOpenVersion?.(version.previousVersionId!)}>返回旧版 →</button>}<button type="button" onClick={close}>展开报告 ↗</button></div></div>
   <div className="companion-conversation" ref={conversation}>
    <div className="companion-conversation-inner">
     {state.view?.updateNotice&&<p className="companion-notice" role="status">已有新版报告。当前伴读仍属于旧版。<button type="button" onClick={()=>{const id=state.view?.updateNotice?.latestResultVersionId;if(id)onOpenVersion?.(id);}}>看新版报告</button></p>}
     {state.error&&<p className="companion-notice" role="alert">{state.error.message}</p>}
     {state.submission?.outcome==='unknown'&&<p className="companion-notice" role="status">提交结果未确认，正在只读核对；不会自动再次生成。</p>}
     {state.loading&&<p className="companion-status" role="status">正在读取伴读记录…</p>}
     {(!session||session.status==='failed')&&<div className="companion-welcome"><DetectivePortrait/><span>一份报告，一场有出处的对话</span><h3>把结论读明白，<br/>也把疑问留下来。</h3><p>按段阅读已保存的材料，随时展开证据或打断追问。进入页面不会自动生成。</p><button className="companion-primary" type="button" disabled={pending} onClick={()=>{void controller.generate();}}>{session?'重新生成伴读':'生成本版伴读'}</button></div>}
     {session?.status==='generating'&&<div className="companion-welcome"><DetectivePortrait/><h3>正在准备这份伴读</h3><p role="status">正在生成伴读，报告文字仍可阅读。</p><button type="button" onClick={close}>先读报告</button></div>}
     {session?.status==='ended'&&<div className="companion-welcome"><DetectivePortrait/><h3>先读到这里。</h3><p>本版伴读已收尾。材料和阅读位置都保留着。</p><button ref={reopenButton} type="button" disabled={pending} onClick={()=>{focusIntent.current='reopen';void controller.reopen();}}>重新打开已存伴读</button></div>}
     {session?.status==='ready'&&<>
      <div className="companion-reading-meta"><span>已保存的讲述</span><label>阅读段落<select ref={reader} value={session.cursor} disabled={state.busy} onChange={event=>{void controller.selectCursor(Number(event.target.value));}}>{session.segments.map((item,index)=><option value={index} key={item.id}>第 {index+1} 段</option>)}<option value={session.segments.length}>已读到结尾</option></select></label></div>
      {segment&&<article className="companion-message-row" aria-label={'侦探讲述第 '+(session.cursor+1)+' 段'}><DetectivePortrait/><div className="companion-message-content"><div className="companion-speaker">侦探<h3>第 {session.cursor+1} 段</h3><span>已存材料</span></div><div className="companion-bubble"><div className="media-prose">{segment.text}</div>{segment.action&&<p className="companion-aside">{segment.action}</p>}
       <details className="companion-evidence"><summary>本段证据</summary>{segment.evidenceIds.length===0?<p>本段没有新增引用，请核对报告中的证据与未知。</p>:segment.evidenceIds.map(id=>{const evidence=version.payload.evidence.find(e=>e.id===id)!;const source=evidence.origin.kind==='source'?version.payload.sources.find(source=>source.id===evidence.origin.id):null;return <div className="companion-evidence-card" key={id}><strong>{source?.title??'本案材料'}</strong><blockquote className="media-prose">{evidence.excerpt}</blockquote><p>定位：{evidence.locator.value}</p>{evidence.limitations.map((text,index)=><p key={index}>限制：{text}</p>)}{source&&<a href={source.url} target="_blank" rel="noreferrer">打开原始来源</a>}</div>;})}</details>
      </div></div></article>}
      {segment&&<div className="companion-audio-settings"><AudioControls controller={audio}/></div>}
     </>}
     <ol className="companion-turns">{state.turns.map(turn=><li key={turn.turnId}><div className="companion-message-row companion-user-row"><span className="companion-user-avatar" aria-hidden="true">我</span><div className="companion-message-content"><div className="companion-speaker">你</div><div className="companion-bubble"><p>问：{turn.question}</p></div></div></div><div className="companion-message-row"><DetectivePortrait/><div className="companion-message-content"><div className="companion-speaker">侦探<span>{turn.view.reply?(turn.view.reply.kind==='research_request'?'补查请求':turn.view.reply.kind==='finish'?'收尾回复':'解释回复'):'正在核对'}</span></div><div className="companion-bubble"><p className="companion-status">状态：{turn.view.status}</p>{turn.view.reply&&<><p className="media-prose">{turn.view.reply.text}</p>{turn.view.reply.kind==='research_request'&&<><p>补查方向：{turn.view.reply.followupQuestion}。尚未执行。</p><button type="button" onClick={()=>{audio.stop();if(turn.view.reply?.followupQuestion)onResearchRequest?.(turn.view.reply.followupQuestion,turn.view.reply.resumeCursor);}}>将补查方向放入报告追问</button></>}{session?.status==='ready'&&<button type="button" disabled={state.busy} onClick={()=>{void controller.selectCursor(turn.view.reply!.resumeCursor);}}>回到第 {Math.min(turn.view.reply.resumeCursor+1,session.segments.length)} 段</button>}</>}{turn.view.error&&<p role="alert">{turn.view.error.message}</p>}</div></div></div></li>)}</ol>
    </div>
   </div>
   <footer className="companion-compose-area">
    <div className="companion-compose-toolbar"><span>不必回答问题才能继续</span>{session?.status==='ready'&&<div><button type="button" disabled={state.busy||session.cursor>=session.segments.length} onClick={()=>{void controller.selectCursor(session.cursor+1);}}>继续下一段 →</button><button type="button" disabled={state.busy} onClick={()=>{focusIntent.current='end';void controller.end();}}>收尾</button></div>}</div>
    <form className="companion-composer" onSubmit={event=>{event.preventDefault();void controller.ask(question);}}><label htmlFor={'companion-question-'+version.id} className="companion-sr-only">打断追问</label><textarea id={'companion-question-'+version.id} rows={2} maxLength={2000} disabled={session?.status!=='ready'} placeholder="随时打断，问一句你的疑惑…" value={question} onChange={event=>setQuestion(event.target.value)}/><button className="companion-send" aria-label="停止播放并追问" disabled={session?.status!=='ready'||pending||!question.trim()}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14"/></svg></button></form>
    <div className="companion-compose-footnote"><span>解释沿用已有证据 · 新事实需回到报告补查</span><span>{question.length} / 2000</span></div>
   </footer>
  </div>
 </section>;
}

function DetectivePortrait(){return <span className="companion-portrait" aria-hidden="true"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#d7dfce"/><path d="M7 64c1-17 12-23 25-23s24 6 25 23" fill="#485851"/><path d="m22 44 10 11 10-11 5 20H17" fill="#f2ead6"/><path d="M19 25c-1-16 29-19 29 1l-2 18-11 5-16-8Z" fill="#413c35"/><ellipse cx="33" cy="29" rx="12" ry="15" fill="#edc4a5"/><path d="M19 27c-2-17 27-22 28 0-6-1-10-6-12-10-3 6-9 10-16 10" fill="#413c35"/><path d="M25 29h4m8 0h4m-11 10c2 1 4 1 6 0" stroke="#675044" strokeWidth="1.5" fill="none" strokeLinecap="round"/><path d="m18 15 5-11h19l6 12" fill="#8b9277"/><path d="M15 16c7-5 26-5 35 0l-1 4c-11-3-23-3-33 0Z" fill="#777f67"/><path d="m27 58 5-5 5 5-3 6h-4" fill="#977451"/></svg></span>;}
