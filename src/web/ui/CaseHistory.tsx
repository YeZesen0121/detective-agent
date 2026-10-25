import { useEffect,useMemo,useRef,useState } from 'react';
import {safeError} from '../api/client.js';
import type { InvestigationsApi } from '../api/investigations.js';
import { createInvestigationsController } from '../controllers/investigations.js';

export function CaseHistory({api,scope,currentId,onOpen,onDeleted}:{api:InvestigationsApi;scope:string|null;currentId:string|null;onOpen:(id:string,versionId:string|null)=>void;onDeleted:(id:string)=>void}){
 const controller=useMemo(()=>createInvestigationsController(api),[api]),[state,setState]=useState(controller.getState());
 useEffect(()=>{const off=controller.subscribe(()=>setState(controller.getState()));return()=>{off();controller.dispose();};},[controller]);
 useEffect(()=>{void controller.setSession(scope);},[controller,scope]);
 const [confirmId,setConfirmId]=useState<string|null>(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState(''),[deleteNote,setDeleteNote]=useState('');
 const deletion=useRef<AbortController|null>(null),scopeRef=useRef(scope);scopeRef.current=scope;
 useEffect(()=>{deletion.current?.abort();deletion.current=null;setConfirmId(null);setDeleting(false);setDeleteError('');setDeleteNote('');return()=>{deletion.current?.abort();};},[scope]);
 async function remove(){if(!scope||!confirmId||deletion.current)return;const id=confirmId,owner=scope,io=new AbortController();deletion.current=io;setDeleting(true);setDeleteError('');setDeleteNote('');
  try{await api.remove(id,io.signal);if(io.signal.aborted||scopeRef.current!==owner)return;setConfirmId(null);setDeleteNote('本案内容已删除，费用审计保留；媒体由后台安全回收。');onDeleted(id);await controller.refresh();}
  catch(error){if(io.signal.aborted||scopeRef.current!==owner)return;const safe=safeError(error);if(safe.status===404){setConfirmId(null);setDeleteNote('本案已不存在，正在刷新案卷历史。');await controller.refresh();}else setDeleteError(safe.status===409?'本案仍有活动任务或盯梢，请先停止并等待结束后再删除。':safe.status===null?'删除结果尚未确认，请刷新案卷历史核对；不会自动重试删除。':safe.message);}
  finally{if(deletion.current===io){deletion.current=null;setDeleting(false);}}
 }
 const active=scope!==null&&state.scope===scope,busy=state.phase==='loading';
 return <section className="case-history" aria-label="案卷历史"><div className="dsec">调查记录</div>{!scope?<p>激活体验码后读取当前会话案卷。</p>:<>
  <button type="button" className="btn history-tool" disabled={busy} onClick={()=>{void controller.refresh();}}>刷新案卷</button>
  {active&&busy&&<p role="status">正在读取案卷…</p>}{active&&state.error&&<p role="alert">案卷历史读取失败：{state.error.message}</p>}
  {active&&state.phase==='ready'&&state.items.length===0&&<p>当前会话还没有案卷。</p>}
  {active&&state.items.map(item=><div className="history-row" key={item.id}><button type="button" className={`case history-open ${item.id===currentId?'on':''}`} aria-current={item.id===currentId?'page':undefined} aria-label={`打开案卷：${item.originalQuestion}`} onClick={()=>onOpen(item.id,item.latestResultVersionId)}><span className="ct" title={item.originalQuestion}>{item.originalQuestion}</span><small>{item.latestResultVersionId?'有报告':item.status==='draft'?'草稿':item.status==='failed'?'未完成':'进行中'}</small></button><button type="button" className="btn history-delete" disabled={deleting} aria-label={`删除案卷：${item.originalQuestion}`} onClick={()=>{setConfirmId(item.id);setDeleteError('');setDeleteNote('');}}>删除</button></div>)}
  {confirmId&&active&&<div aria-label="删除案卷确认"><p>本案内容将删除，费用审计保留；媒体由后台安全回收。</p><p>{state.items.find(item=>item.id===confirmId)?.originalQuestion}</p><button type="button" className="btn" disabled={deleting} onClick={()=>{void remove();}}>{deleting?'正在删除…':'确认删除本案'}</button><button type="button" className="btn" disabled={deleting} onClick={()=>{setConfirmId(null);setDeleteError('');}}>保留案卷</button></div>}
  {deleteError&&<p role="alert">{deleteError}</p>}{deleteNote&&<p role="status">{deleteNote}</p>}
  {active&&state.nextBefore&&<button type="button" className="btn history-tool" disabled={busy} onClick={()=>{void controller.more();}}>更多案卷</button>}
 </>}</section>;
}
