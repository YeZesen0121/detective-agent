import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ResultView, type ResultViewProps } from '../../src/web/ui/ResultView.js';
import { projectResult } from '../../src/web/model/result.js';
import { samplePayload } from '../helpers/result.js';
import { conflictPayload } from './conflict-result-fixture.js';
import type { ResultPayload } from '../../src/shared/contracts.js';

function renderReport(payload: ResultPayload, options: Partial<ResultViewProps> = {}) {
 const data=projectResult({id:'00000000-0000-4000-8000-000000000090',investigationId:payload.investigationId,runId:payload.runId,previousVersionId:null,createdAt:payload.queryTime,payloadHash:'a'.repeat(64),payload}),noop=()=>{};
 return renderToStaticMarkup(createElement(ResultView,{data,outcome:'partial',updateNotice:null,onLatest:noop,onPrevious:noop,onCopy:noop,onAddBudget:noop,onWatch:noop,watchAvailable:false,watchComposer:false,presentation:'evidence',error:'',watchFocus:'',watchSource:'',watchError:'',setWatchFocus:noop,setWatchSource:noop,createWatch:noop,note:'',...options}));
}

it('controlled_fixture unresolved identification leads with uncertainty and puts actual gaps and next steps before evidence',()=>{
 const payload=samplePayload();
 payload.scope.basicMode='identify';payload.scope.objectText='controlled_fixture 记忆中的互动演示';
 payload.summary='controlled_fixture 目前还不能匹配到具体演示。';
 payload.claims[0]!.status='insufficient';payload.claims[0]!.links=[];
 payload.unknowns=['controlled_fixture 尚不能确定演示名称和年份'];
 payload.nextSteps=['controlled_fixture 你大概在哪几年看到这个演示？不记得也可以直接说明。'];
 payload.stopReason='no_useful_direction';
 const before=JSON.stringify(payload),html=renderReport(payload);
 expect(html).toContain('<h2>暂时还没认出你要找的对象</h2>');
 expect(html).not.toContain('材料不全');
 expect(html.indexOf(payload.unknowns[0]!)).toBeLessThan(html.indexOf('class="chainhead"'));
 expect(html.indexOf(payload.nextSteps[0]!)).toBeLessThan(html.indexOf('class="chainhead"'));
 expect(html).toContain(payload.summary);
 expect(html).not.toContain('继续核验本案');expect(html).not.toContain('追加一轮</button>');
 expect(JSON.stringify(payload)).toBe(before);
});

it('controlled_fixture a service interruption explains the technical stop and only offers an eligible continuation',()=>{
 const payload=samplePayload();payload.stopReason='provider_error';
 payload.summary='controlled_fixture 已核实截止日，其余问题未核验完。';
 const interrupted=renderReport(payload,{canContinueProvider:true});
 expect(interrupted).toContain('外部服务或网络');expect(interrupted).not.toContain('需要你补充');
 expect(interrupted.indexOf('继续核验本案')).toBeLessThan(interrupted.indexOf('class="chainhead"'));
 const historical=renderReport(payload,{canContinueProvider:false,updateNotice:'00000000-0000-4000-8000-000000000091'});
 expect(historical).not.toContain('继续核验本案');expect(historical).toContain('看新版 →');
});

it('controlled_fixture user-clue and budget actions appear early without presenting suggestions as completed work',()=>{
 const payload=samplePayload();payload.stopReason='needs_user';
 payload.nextSteps=['controlled_fixture 请补充原通知的年份；记不清可直接说明。'];
 const needsClue=renderReport(payload);
 expect(needsClue).toContain('href="#report-followup"');
 expect(needsClue.indexOf(payload.nextSteps[0]!)).toBeLessThan(needsClue.indexOf('class="chainhead"'));
 payload.stopReason='time_limit';
 const limit=renderReport(payload,{outcome:'limit',canAddBudget:true});
 expect(limit).toContain('本轮时间已到限');expect(limit).not.toContain('没次数');
 expect(limit.indexOf('追加一轮</button>')).toBeLessThan(limit.indexOf('class="chainhead"'));
 expect(renderReport(payload,{outcome:'limit',canAddBudget:false})).not.toContain('追加一轮</button>');
});

it('keeps per-claim conditions and the explanation of each evidence relation visible',()=>{
  const payload=samplePayload();
  payload.claims[0]!.conditions=['controlled_fixture 只适用于本年度现场报名'];
  payload.claims[0]!.reasonSummary='controlled_fixture 日期与活动对象一致';
  payload.claims[0]!.links[0]!.rationale='controlled_fixture 公告直接给出这一报名渠道的截止日';
  const data=projectResult({id:'00000000-0000-4000-8000-000000000090',investigationId:payload.investigationId,runId:payload.runId,previousVersionId:null,createdAt:payload.queryTime,payloadHash:'a'.repeat(64),payload});
  const noop=()=>{};
  const html=renderToStaticMarkup(createElement(ResultView,{data,outcome:'normal',updateNotice:null,onLatest:noop,onPrevious:noop,onCopy:noop,onAddBudget:noop,onWatch:noop,watchAvailable:false,watchComposer:false,presentation:'evidence',error:'',watchFocus:'',watchSource:'',watchError:'',setWatchFocus:noop,setWatchSource:noop,createWatch:noop,note:''}));
  expect(html).toContain(payload.claims[0]!.conditions[0]);
  expect(html).toContain(payload.claims[0]!.reasonSummary);
  expect(html).toContain(payload.claims[0]!.links[0]!.rationale);
});

it('labels unresolved mixed claims as conflicts and counts refutations/conflicts without changing refuted',()=>{
 const payload=conflictPayload();payload.claims[0]!.status='refuted';
 const data=projectResult({id:'00000000-0000-4000-8000-000000000090',investigationId:payload.investigationId,runId:payload.runId,previousVersionId:null,createdAt:payload.queryTime,payloadHash:'a'.repeat(64),payload}),noop=()=>{};
 const html=renderToStaticMarkup(createElement(ResultView,{data,outcome:'partial',updateNotice:null,onLatest:noop,onPrevious:noop,onCopy:noop,onAddBudget:noop,onWatch:noop,watchAvailable:false,watchComposer:false,presentation:'evidence',error:'',watchFocus:'',watchSource:'',watchError:'',setWatchFocus:noop,setWatchSource:noop,createWatch:noop,note:''}));
 expect(html).toContain('存在冲突');expect(html).toContain('不成立');expect(html).toContain('反证/冲突 <b>2</b>');expect(html).not.toContain('部分成立');expect(html).not.toContain('↓ 限定');expect(html).toContain(payload.unknowns[0]);
});

it('keeps a long conclusion out of the heading and separates verified quote from original excerpt',()=>{
 const payload=samplePayload();payload.summary='controlled_fixture 长结论。'.repeat(40);payload.evidence[0]!.excerpt='controlled_fixture 原始正文开头。报名截至十月三十日。原始正文结尾。';payload.claims[0]!.links[0]!.quote='报名截至十月三十日';
 const data=projectResult({id:'00000000-0000-4000-8000-000000000090',investigationId:payload.investigationId,runId:payload.runId,previousVersionId:null,createdAt:payload.queryTime,payloadHash:'a'.repeat(64),payload}),noop=()=>{};
 const html=renderToStaticMarkup(createElement(ResultView,{data,outcome:'normal',updateNotice:null,onLatest:noop,onPrevious:noop,onCopy:noop,onAddBudget:noop,onWatch:noop,watchAvailable:false,watchComposer:false,presentation:'evidence',error:'',watchFocus:'',watchSource:'',watchError:'',setWatchFocus:noop,setWatchSource:noop,createWatch:noop,note:''}));
 expect(html).not.toContain('<h2>'+payload.summary);expect(html).toContain('查看结论全文');expect(html).toContain('引用原文：报名截至十月三十日');expect(html).toContain('原始摘录全文');expect(html).toContain(payload.evidence[0]!.excerpt);
});
