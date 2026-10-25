import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResultViewModel } from '../../model/result.js';
import type { FollowupApi } from '../../api/followup.js';
import type { RuntimeApi } from '../../api/runtime.js';
import { createFollowupController } from '../../controllers/followup.js';
import type { FollowupJournal } from '../../model/followup-submission.js';
import type { FollowupView } from '../../api/followup.js';
import { safeError } from '../../api/client.js';

export interface FollowupIntent {versionId:string;question:string;cursor:number;token:number}
export function FollowupPanel({api,runtime,result,journal,onFollowRun,onOpenVersion,onNewCase,previousRunId,intent}:{api:FollowupApi;runtime:RuntimeApi;result:ResultViewModel;journal:FollowupJournal;onFollowRun:(caseId:string,runId:string)=>Promise<void>;onOpenVersion:(id:string)=>void;onNewCase:(question:string,key:string)=>Promise<void>;previousRunId:string;intent:FollowupIntent|null}){
 const version=useMemo(()=>{const{versionId,previousVersionId,createdAt,payloadHash,claimsByStatus:_,...payload}=result;return{id:versionId,previousVersionId,createdAt,payloadHash,investigationId:payload.investigationId,runId:payload.runId,payload};},[result.versionId]);
 const controller=useMemo(()=>createFollowupController({api,runtime,journal,onFollowRun}),[api,runtime,journal,version.id,onFollowRun]);
 const [state,setState]=useState(controller.getState()),[creating,setCreating]=useState<string|null>(null),[error,setError]=useState('');const creation=useRef<{turnId:string;key:string;busy:boolean}|null>(null);const textarea=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{const off=controller.subscribe(()=>setState(controller.getState()));void controller.open(version);return()=>{off();controller.dispose();};},[controller,version]);
 useEffect(()=>{if(intent?.versionId===version.id){controller.setQuestion(intent.question);textarea.current?.focus();}},[controller,intent?.token,version.id]);
 const blocked=state.busy||state.loading||state.submissions.some(r=>r.outcome==='pending'||r.outcome==='unknown'),tooLong=state.question.trim().length>2000;
 async function newCase(item:FollowupView){if(!item.suggestedQuestion||creation.current?.busy)return;const record=creation.current?.turnId===item.id?creation.current:{turnId:item.id,key:crypto.randomUUID(),busy:false};creation.current=record;record.busy=true;setCreating(item.id);setError('');try{await onNewCase(item.suggestedQuestion,record.key);}catch(e){setError(safeError(e).message);}finally{record.busy=false;setCreating(null);}}
 return <section className="media-panel" aria-label="固定版本追问">
  <h2>继续追问这份报告</h2><p>问题绑定当前打开的报告。解释沿用已有证据；需要补查时以服务器返回的方向和额度为准。</p>
  {intent?.versionId===version.id&&<p role="status">来自伴读第 {intent.cursor+1} 段的补查方向已保留。点击“提交追问”才会提交；原伴读游标保留。</p>}
  <form onSubmit={event=>{event.preventDefault();void controller.ask();}}><label>报告追问<textarea id="report-followup" ref={textarea} value={state.question} aria-invalid={tooLong} onChange={event=>controller.setQuestion(event.target.value)}/></label><p>{state.question.trim().length} / 2000</p>{tooLong&&<p role="alert">追问最多2000字，当前内容已保留。</p>}<button disabled={blocked||tooLong||!state.question.trim()}>提交追问</button></form>
  {(state.error||error)&&<p role="alert">{state.error?.message??error}</p>}
  {state.latestResultVersionId&&<button type="button" onClick={()=>onOpenVersion(state.latestResultVersionId!)}>显式查看新版报告</button>}
  {state.submissions.some(r=>r.outcome==='unknown')&&<p role="status">提交结果尚未确认。只按原标识读取，不自动重发或增加预算；输入与原报告保留。</p>}
  {state.loading&&<p role="status">正在读取追问记录…</p>}
  <ol className="media-turns">{state.items.map(item=><li key={item.id}>
   <h3>{item.question}</h3><p>状态：{item.status==='queued'?'排队中':item.status==='running'?'正在判断追问方向':item.status==='failed'?'本次未完成':'追问方向已确定'}</p>
   {item.error&&<p role="alert">{item.error.message}</p>}
   {item.latestResultVersionId&&<button type="button" onClick={()=>onOpenVersion(item.latestResultVersionId!)}>显式查看新版报告</button>}
   {item.turn?.route==='explain'&&<><p>解释已有证据</p><p className="media-prose">{item.turn.answer}</p></>}
   {item.turn?.route==='research_same_scope'&&<><p>补查方向：{item.researchPurpose??'以这次追问为准'}。补查任务已经由服务器安排，状态见本轮任务；当前旧报告保留。</p>{item.turn.newRunId&&<button type="button" onClick={()=>{void controller.followTurn(item.id);}}>读取补查任务状态</button>}</>}
   {item.turn?.route==='suggest_new_case'&&<><p>这个问题需要新开调查：{item.suggestedQuestion}</p><button type="button" disabled={!!creating} onClick={()=>{void newCase(item);}}>明确新建建议草稿</button></>}
   {item.turn?.route==='needs_budget_confirmation'&&<>{item.researchPurpose?.trim()?<p>现有调查额度不足。补查方向：{item.researchPurpose}。追加将建立一轮新的调查额度，已有账本与报告保留。</p>:<p role="status">尚未确认能否在当前案件补查，不能据此追加研究额度。原追问与当前报告已保留。</p>}{item.turn.newRunId?<button type="button" onClick={()=>{void controller.followTurn(item.id);}}>读取已追加任务状态</button>:item.researchPurpose?.trim()&&<button type="button" disabled={blocked||state.submissions.some(r=>r.kind==='budget'&&r.turnId===item.id&&r.outcome==='confirmed')} onClick={()=>{void controller.confirmBudget(item.id,previousRunId);}}>明确追加一轮调查</button>}</>}
   {(item.turn?.claimIds.length||item.evidenceIds.length)?<details><summary>本次回答的引用</summary>{item.turn?.claimIds.map(id=>{const claim=version.payload.claims.find(c=>c.id===id)!;return <p key={id}>{claim.statement}：{claim.reasonSummary}</p>;})}{item.evidenceIds.map(id=>{const evidence=version.payload.evidence.find(e=>e.id===id)!;return <blockquote key={id}><p>{evidence.excerpt}</p><p>定位：{evidence.locator.value}</p>{evidence.limitations.map((text,i)=><p key={i}>{text}</p>)}</blockquote>;})}</details>:null}
  </li>)}</ol>
  <button type="button" disabled={state.loading||state.busy} onClick={()=>{void controller.refresh();}}>只读恢复追问</button>
 </section>;
}
