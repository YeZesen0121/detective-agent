import { useEffect,useState,type FormEvent } from 'react';
import type { ResultViewModel } from '../model/result.js';
import { outcomeCopy,humanizeStopReasonText, type Outcome } from './result-status.js';

const fmt = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const claimText: Record<string, string> = { supported: '成立', refuted: '不成立', mixed: '存在冲突', insufficient: '证据不足' };
const shortText=(text:string)=>Array.from(text).length>140?Array.from(text).slice(0,140).join('')+'…':text;
const readText: Record<string, string> = { full: '已读全文', partial: '部分读取', snippet_only: '只搜索摘要，未读正文', inaccessible: '未读' };

export interface ResultViewProps {
  data: ResultViewModel; outcome: Outcome; updateNotice: string | null;
  onLatest: () => void; onPrevious: () => void; onCopy: () => void; onAddBudget: () => void;
  onWatch: () => void; watchAvailable: boolean; watchComposer: boolean;
  presentation: 'brief' | 'evidence' | 'companion'; error: string;
  watchFocus: string; watchSource: string; watchError: string;
  setWatchFocus: (value: string) => void; setWatchSource: (value: string) => void;
  createWatch: (event: FormEvent) => void; note: string;
  canAddBudget?: boolean;
  question?: string;
  unrestrictedUsage?:boolean;
  canContinueProvider?:boolean;continueDisabled?:boolean;onContinueProvider?:()=>void;
}

export function ResultView(props: ResultViewProps) {
  const { data, outcome, updateNotice } = props;
  const state = outcomeCopy(outcome, data);
  const sources = new Map(data.sources.map((item, index) => [item.id, { ...item, number: index + 1 }]));
  const evidence = new Map(data.evidence.map(item => [item.id, item]));
  const citedSources=new Set(data.claims.flatMap(claim=>claim.links.flatMap(link=>{const item=evidence.get(link.evidenceId);return item?.origin.kind==='source'?[item.origin.id]:[];})));
  const [evidenceOpen,setEvidenceOpen]=useState(props.presentation==='evidence');
  useEffect(()=>setEvidenceOpen(props.presentation==='evidence'),[data.versionId,props.presentation]);
  const savedMaterials=data.evidence.filter(item=>!item.limitations.some(limit=>limit.startsWith('raw_capture_only')));
  const summary=humanizeStopReasonText(data.summary),sourceOnly=data.claims.length===0&&data.evidence.length===0&&data.sources.length>0;
  const longSummary=Array.from(summary).length>120;
  const showSummaryInHeading=outcome==='normal'&&state.stamp==='已查'&&!longSummary;
  const needsClue=data.stopReason==='needs_user';
  const nextSteps=data.nextSteps.length?data.nextSteps:[needsClue
    ? data.scope.basicMode==='identify'?'补充你还记得的名称片段、大致年份或画面等任一条线索；不记得的可以直接说明。':'在下方补充尚未明确的对象、时间或原始说法；不确定的可以直接说明。'
    : data.stopReason==='no_useful_direction'?'如果还有其他线索或原始链接，可在下方补充，帮助寻找新的核验方向。':'' ].filter(Boolean);
  return <section className="view on">
    <div className="verdict"><div className="sealbig short"><span>{state.stamp}</span></div><div className="vtext">
      <h2>{showSummaryInHeading ? summary : state.title}</h2>
      {props.question&&<p className="result-question">你问：{props.question}</p>}
      <div className="vmeta"><span>核查时间 {fmt(data.queryTime)}</span><span>报告版本 {data.versionId.slice(0, 8)}</span></div>
      <div className="tally"><span className="t up">↑ 支持 <b>{data.claims.filter(item => item.status === 'supported').length}</b></span><span className="t down">↓ 反证/冲突 <b>{data.claims.filter(item => item.status === 'refuted' || item.status === 'mixed').length}</b></span><span className="t">· 已查看来源 <b>{data.sources.length}</b></span><span className="t nil">？ 未知 <b>{data.unknowns.length}</b></span></div>
    </div></div>
    {!showSummaryInHeading&&<div className="vnote result-answer"><b>目前判断：</b>{longSummary?<><p>{Array.from(summary).slice(0,120).join('')}…</p><details><summary>查看结论全文</summary><p className="media-prose">{summary}</p></details></>:<p className="media-prose">{summary}</p>}</div>}
    {state.note && <div className={`vnote ${outcome === 'limit' ? 'warn' : 'info'}`}><b>本轮说明：</b>{state.note}</div>}
    {updateNotice && <div className="vnote warn"><b>已有更新。</b>旧报告正文、引用和核查时间保留原样。<button type="button" className="inline-link" onClick={props.onLatest}>看新版 →</button></div>}
    {data.delta && <div className="vnote info"><b>相比上一版：</b>{data.delta.changes.length ? data.delta.changes.map(item => item.description).join('；') : '暂无可列出的变化'}。核查时间 {fmt(data.delta.checkedAt)}。<button type="button" className="inline-link" onClick={props.onPrevious}>返回旧版 →</button></div>}
    {data.conditions.length > 0 && <div className="vnote info"><b>适用条件：</b>{data.conditions.join('；')}</div>}
    {data.unknowns.length > 0 && <div className="unknown" aria-label="仍拿不准的"><span className="dia"/><div><b>仍拿不准的</b><ul>{data.unknowns.slice(0,3).map((text,index)=><li key={index}>{humanizeStopReasonText(text)}</li>)}</ul>{data.unknowns.length>3&&<details><summary>其他未确认项（{data.unknowns.length-3}）</summary><ul>{data.unknowns.slice(3).map((text,index)=><li key={index}>{humanizeStopReasonText(text)}</li>)}</ul></details>}</div></div>}
    {(nextSteps.length>0||props.canContinueProvider||outcome==='limit')&&<div className="vnote result-next" aria-label="下一步"><b>下一步：</b>
      {nextSteps.length>0&&<ul>{nextSteps.map((text,index)=><li key={index}>{humanizeStopReasonText(text)}</li>)}</ul>}
      {props.canContinueProvider&&<p>可以继续核验本案。点击后会建立新一轮调查，已有报告保留。</p>}
      {outcome==='limit'&&<p>{props.canAddBudget===false?'当前显示的是历史报告，请先核对本轮状态及版本提示。':props.unrestrictedUsage?'这份报告保留了上一轮的停止记录；当前已取消用量上限，可以继续核验。':'如需继续，可明确追加一轮调查；查看报告不会自动续查。'}</p>}
      <div className="actions">{needsClue&&!updateNotice&&<a className="btn" href="#report-followup">补充线索</a>}{props.canContinueProvider&&<button type="button" className="btn" disabled={props.continueDisabled} onClick={props.onContinueProvider}>继续核验本案</button>}{outcome==='limit'&&props.canAddBudget!==false&&<button type="button" className="btn dark" onClick={props.onAddBudget}>{props.unrestrictedUsage?'继续核验本案':'追加一轮'}</button>}</div>
    </div>}
    <p><button type="button" className="btn" aria-expanded={evidenceOpen} onClick={()=>setEvidenceOpen(open=>!open)}>{evidenceOpen?'收起证据链':sourceOnly?'查看已保存线索（未核验）':'查看证据链'}</button> · 核验命题 {data.claims.length} 项 · 已查看来源 {data.sources.length} 项</p>
    {evidenceOpen && data.claims.length > 0 && <><div className="chainhead"><h3>证据链</h3><span>共 {data.claims.length} 项命题</span></div>{data.claims.map(claim => <article className="claim" key={claim.id}>
      <div className="claimtop"><p>{claim.statement}</p><span className={`st ${claim.status === 'supported' ? 'ok' : claim.status === 'refuted' ? 'fail' : claim.status === 'mixed' ? 'mixed' : 'nil'}`}>{claimText[claim.status]}</span></div>
      {claim.conditions.length > 0 && <p className="claim-detail"><b>本命题条件：</b>{claim.conditions.join('；')}</p>}
      {claim.reasonSummary && <details><summary>判定依据</summary><p className="claim-detail">{claim.reasonSummary}</p></details>}
      {claim.links.map((link,index) => { const item = evidence.get(link.evidenceId); if (!item) return null; const source = item.origin.kind === 'source' ? sources.get(item.origin.id) : null; const row=<div className="ev">
        <span className={`mark ${link.relation === 'supports' ? 'up' : link.relation === 'contradicts' ? 'down' : 'ref'}`}>{link.relation === 'supports' ? '↑' : link.relation === 'contradicts' ? '↓' : '·'}</span>
        <div className="evbody" style={{overflowWrap:'anywhere'}}><p className="evt"><span className="src">{source ? `S${source.number}` : '附件'}</span>{source?.title ?? '用户材料'}</p><p className="evq">{link.quote?'引用原文：':'原始摘录：'}{shortText(link.quote??item.excerpt)}</p><details><summary>原始摘录全文</summary>{link.quote&&<p className="media-prose">引用原文全文：{link.quote}</p>}<p className="media-prose">{item.excerpt}</p><p style={{overflowWrap:'anywhere'}}>定位：{item.locator.kind} {item.locator.value} · 摘录哈希：{item.contentHash}</p></details>{link.rationale && <details><summary>引用关系依据</summary><p className="evq">{link.rationale}</p></details>}{item.limitations.length > 0 && <p className="evq">局限：{item.limitations.join('；')}</p>}</div>
        <div className="evr"><span className={`rd ${source?.readStatus === 'full' ? 'full' : source?.readStatus === 'inaccessible' ? 'none' : 'part'}`}>{source ? readText[source.readStatus] : '附件'}</span>{source && <a className="go2" href={source.url} target="_blank" rel="noopener noreferrer">打开原文 →</a>}</div>
      </div>;return index===0?<div key={`${claim.id}-${item.id}`}>{row}</div>:<details key={`${claim.id}-${item.id}`}><summary>其他引用来源（{index}） · {source?.title??'用户材料'}</summary>{row}</details>; })}
      {claim.gaps.length > 0 && <div className="unknown"><span className="dia"/><div><b>仍有缺口</b><p>{claim.gaps.join('；')}</p></div></div>}
    </article>)}</>}
    {evidenceOpen&&data.claims.length===0&&<><p role="status">尚未形成可核验命题；已有材料不代表结论。</p><details><summary>已保存材料（{savedMaterials.length}）</summary>{savedMaterials.map(item=>{const source=item.origin.kind==='source'?sources.get(item.origin.id):null;return <article key={item.id}><p>{source?<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>:'用户材料'} · {source?readText[source.readStatus]:'附件提取材料'}</p><p className="media-prose">{item.excerpt}</p><p style={{overflowWrap:'anywhere'}}>定位：{item.locator.kind} {item.locator.value} · 摘录哈希：{item.contentHash}</p>{item.limitations.map((limit,index)=><p key={index}>材料局限：{limit}</p>)}</article>;})}</details></>}
    {evidenceOpen&&sourceOnly&&<div><h3>已保存线索（未核验）</h3>{data.sources.map(source=><article key={source.id}><p>{source.title} · {readText[source.readStatus]}</p>{source.snippet&&<p className="media-prose">{source.snippet}</p>}<p>搜索线索尚未形成可核验命题，不能据此作结论。</p><details><summary>读取说明与原文地址</summary><p>{source.diagnostic?/timeout|unknown/i.test(source.diagnostic)?'原文读取尚未确认完成，结果保留未知；不会自动重复读取。':humanizeStopReasonText(source.diagnostic):'没有额外读取说明。'}</p><a href={source.url} target="_blank" rel="noopener noreferrer" style={{overflowWrap:'anywhere'}}>{source.url}</a></details></article>)}</div>}
    {data.sources.length>0&&<details><summary>来源（{data.sources.length}）</summary><ul style={{overflowWrap:'anywhere'}}>{data.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> · {readText[source.readStatus]} · {citedSources.has(source.id)?'被当前命题引用':'未被当前命题引用'}{source.diagnostic&&<details><summary>读取局限</summary><p>{humanizeStopReasonText(source.diagnostic)}</p></details>}</li>)}</ul></details>}
    <div className="actions">{props.watchAvailable && data.sources.length > 0 && <button type="button" className="btn" onClick={props.onWatch}>盯住这桩</button>}<button type="button" className="btn" onClick={props.onCopy}>复制结论 + 出处</button>{!props.watchAvailable && <span className="hint">当前服务未开放盯梢创建</span>}{!data.sources.length && <span className="hint">没有可盯的公开来源</span>}</div>
    {props.note && <p className="vnote info" role="status">{props.note}</p>}
    {props.error && <p className="vnote warn" role="alert">{props.error}</p>}
    {props.watchComposer && <form className="watch-form" onSubmit={props.createWatch}><div className="label">盯什么变化</div><label htmlFor="watchFocus">关注点</label><textarea id="watchFocus" value={props.watchFocus} onChange={event => props.setWatchFocus(event.target.value)} required/><label htmlFor="watchSource">公开来源</label><select id="watchSource" value={props.watchSource} onChange={event => props.setWatchSource(event.target.value)} required>{data.sources.map(source => <option key={source.id} value={source.url}>{source.title}</option>)}</select><div className="go"><button type="submit" className="primary">确认盯梢 →</button><span className="hint">每小时检查一次，以服务实际执行为准。</span></div>{props.watchError && <p className="vnote warn" role="alert">{props.watchError}</p>}</form>}
    <p className="footnote">说不知道不扣分，瞎编才扣分。</p>
  </section>;
}
