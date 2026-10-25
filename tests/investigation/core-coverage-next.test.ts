import { expect, it } from 'vitest';
import { prepareInvestigation, runInvestigation } from '../../src/server/investigation/index.js';
import { scenario } from './controlled.js';
import { nextQueries } from '../../src/server/investigation/planner.js';
import { randomUUID } from 'node:crypto';
import { atomicGoals } from '../../src/server/investigation/goals.js';
it('separates an explicit entity and alias from compound goals without changing the original question',async()=>{
 const s=scenario();const originalQuestion='星光挑战赛（简称星赛）的报名日期和费用分别是什么？';
 s.services.model=async request=>({value:request.schemaId==='investigation.scope.review.v1'?{objectSupported:true,allUserGoalsRepresented:true,clueChecks:[],goalChecks:[{goalIndex:0,inScope:true,reason:'报名日期'},{goalIndex:1,inScope:true,reason:'费用'}],criticalChecks:[]}:{canLocate:true,object:{text:'星光挑战赛',inputRef:'question',quote:'星光挑战赛'},clues:[],goals:[{kind:'fact',text:'星光挑战赛的报名日期',inputRef:'question',quote:'报名日期'},{kind:'fact',text:'星光挑战赛的费用',inputRef:'question',quote:'费用'}],resolutions:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await prepareInvestigation({context:s.input.context,originalQuestion,basicMode:'truth',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);
 expect(result.scope?.objectText).toBe('星光挑战赛');expect(result.scope?.goal).toBe(originalQuestion);expect(result.scope?.knownClues.join(' ')).toContain('星赛');expect(result.scope?.claimsToCheck).toHaveLength(2);
});
it('continues an uncovered atomic goal with a directed alias query and reviews the new material',async()=>{
 const s=scenario();s.input.scope.objectText='星光挑战赛';s.input.scope.goal='星光挑战赛的报名日期和费用';s.input.scope.knownClues=['别名：星赛'];s.input.scope.claimsToCheck=['星光挑战赛的报名日期','星光挑战赛的费用'];
 let searches=0,evaluations=0,reviews=0;
 s.services.search=async request=>{s.searches.push(request);return{items:[{url:'https://example.invalid/'+searches++,title:'受控原始公告',snippet:'',publisher:null,publishedAt:null,providerScore:null}],providerRequestId:null,invalidItemCount:0,warnings:[],usage:null};};
 s.services.read=async r=>({sourceId:r.sourceId,finalUrl:r.url,title:null,text:r.url.endsWith('0')?'星光挑战赛报名截止2026年10月30日。':'星赛报名免费。',readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:null,failureCode:null,usage:null});
 s.services.model=async request=>{
  if(request.schemaId==='investigation.review.v1')return{value:{queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:1,anchors:[],reason:'既有别名用于未解费用目标'}],checks:(reviews++===0?[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'只核对日期'}]:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'日期'},{claimIndex:1,verdict:'supported',addressesQuestion:true,reason:'费用'}]),goalChecks:reviews===1?[{goalIndex:0,claimIndexes:[0],covered:true,reason:'日期原句'}]:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'日期原句'},{goalIndex:1,claimIndexes:[1],covered:true,reason:'免费原句'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};
  return{value:evaluations++===0?{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'日期原句'}],answerBlocks:[],nextQueries:[{query:'星赛 原始报名费用通知',purpose:'查费用',goalIndex:1}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'日期'},{statement:'报名免费',status:'supported',evidenceIndexes:[1],conditions:[],gaps:[],reasonSummary:'费用原句'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};
 };
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(s.searches.map(r=>r.query)).toEqual(['星光挑战赛 报名日期 费用 星赛','星赛 原始报名费用通知']);expect(reviews).toBe(2);expect(result.completion).toBe('completed');expect(result.draft?.claims).toHaveLength(2);
});
it('does not declare a compound request answered from one addressesQuestion boolean',async()=>{
 const s=scenario();s.input.scope.goal='2026年受控活动的学历要求和年龄要求分别是什么？';s.input.scope.claimsToCheck=['学历要求','年龄要求'];
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'只知道学历'}]}:{claims:[{statement:'仅限本科生',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'学历'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/目标|年龄/);
});
it('requires separate coverage for qualifications joined with 与',async()=>{
 const s=scenario();s.input.scope.goal='2026年受控活动的学历与年龄要求分别是什么？';s.input.scope.claimsToCheck=[];
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'只核对学历'}]}:{claims:[{statement:'仅限本科生',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'学历原句'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/年龄|目标/);
});
it('does not replace structured goal coverage with one general relevance boolean',async()=>{
 const s=scenario();s.input.scope.goal='请核对受控活动的学历/年龄要求';s.input.scope.claimsToCheck=[];
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'学历相关'}]}:{claims:[{statement:'仅限本科生',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'学历'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/目标/);
});
it('screens the captured omitted context rather than assuming an unrecognized exception is irrelevant',async()=>{
 const s=scenario();const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'2026年受控活动报名截止2026年10月30日。\n\n2026年受控活动报名介绍。\n\n2026年受控活动报名步骤。\n\n港澳学生延至11月10日。'});
 s.services.model=async r=>{s.models.push(r);return{value:r.schemaId==='investigation.context-screen.v1'?{screened:true,omittedRelevantQuotes:['港澳学生延至11月10日。'],reason:'未展示材料改变人群适用日期'}:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'只核对已展示日期'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'已展示日期'}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'日期原句'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(s.models.some(request=>request.schemaId==='investigation.context-screen.v1'&&request.messages.some(message=>message.content.includes('港澳学生延至11月10日')))).toBe(true);expect(result.draft?.unknowns.join(' ')).toMatch(/例外|条件|遗漏/);
});
it('does not replay an unknown context-screen request after resume with a smaller input grant',async()=>{
 const s=scenario();const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'背景介绍。'.repeat(1000)+'2026年受控活动报名截止2026年10月30日，仅限本科生。'+'网站页脚。'.repeat(1000)});
 let calls=0;const schemas:string[]=[];s.services.model=async request=>{schemas.push(request.schemaId);calls++;throw Error('controlled_fixture: unknown sent request');};
 const first=await runInvestigation(s.input,s.services,new AbortController().signal);expect(first.stopReason).toBe('provider_error');expect(schemas).toEqual(['investigation.context-screen.v1','investigation.review.v1']);
 s.input.checkpoint=s.checkpoints.at(-1)!;s.setBudget({...s.budget(),remaining:{...s.budget().remaining,inputTokens:15000}});calls=0;
 const resumed=await runInvestigation(s.input,s.services,new AbortController().signal);expect(resumed.completion).toBe('partial');expect(calls).toBe(0);
});
it('reuses a completed context screen when the remaining grant only fits evaluation',async()=>{
 const s=scenario();s.input.scope.claimsToCheck=[];const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:['2026年受控活动报名截止2026年10月30日。',...Array.from({length:8},()=>('背景说明。'.repeat(200)))].join('\n\n')});
 s.services.model=async r=>{if(r.schemaId==='investigation.context-screen.v1')return{value:{screened:true,omittedRelevantQuotes:[],reason:'无关背景'},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};throw Error('controlled_fixture: evaluate interrupted');};
 await runInvestigation(s.input,s.services,new AbortController().signal);s.input.checkpoint=s.checkpoints.at(-1)!;s.setBudget({...s.budget(),remaining:{...s.budget().remaining,inputTokens:6000}});
 let scans=0;s.services.model=async r=>{if(r.schemaId==='investigation.context-screen.v1')scans++;return{value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'日期'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'截止'}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'日期'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 const resumed=await runInvestigation(s.input,s.services,new AbortController().signal);expect(resumed.completion).toBe('completed');expect(scans).toBe(0);
});
it('keeps checkpoint and result schemas valid when many omitted conditions are discovered across chunks',async()=>{
 const s=scenario();const phrases=Array.from({length:30},(_,i)=>'地区'+i+'须提前确认。');const text=['2026年受控活动报名截止2026年10月30日。','2026年受控活动报名步骤。','2026年受控活动报名介绍。',...phrases.map(phrase=>phrase+'背景说明。'.repeat(70))].join('\n\n');const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text});
 s.services.model=async r=>{const body=JSON.parse(r.messages[1]!.content) as {chunk?:string};return{value:r.schemaId==='investigation.context-screen.v1'?{screened:true,omittedRelevantQuotes:phrases.filter(phrase=>body.chunk?.includes(phrase)).slice(0,12),reason:'地区补充条件'}:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'日期'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'日期'}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'日期'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.evidence.every(e=>e.limitations.length<=20)).toBe(true);expect(s.checkpoints.every(cp=>cp.evidence.every(e=>e.limitations.length<=20))).toBe(true);
});
it('accepts an entity-directed field query without requiring the full original question',()=>{
 const s=scenario();s.input.scope.objectText='华南师范大学2026年创新大赛是否免费，报名何时截止';s.input.scope.goal=s.input.scope.objectText;s.input.scope.claimsToCheck=[];
 const queries=nextQueries({nextQueries:[{query:'华南师范大学 2026 创新大赛 报名费用',purpose:'原始来源定向',gap:'需要费用来源'}]},s.input.scope,{sources:[],evidence:[],claims:[],queries:[],candidates:[]},['需要费用来源'],[0],{queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[],reason:'原对象的费用目标定向'}]});
 expect(queries).toHaveLength(1);
});
it('splits comma-separated questions into targets even when a legacy claim list contains only one answer',()=>{
 const s=scenario();s.input.scope.objectText='和平科技大赛';s.input.scope.goal='和平科技大赛是否免费，报名何时截止？';
 expect(atomicGoals(s.input.scope)).toEqual(['和平科技大赛的是否免费','和平科技大赛的报名何时截止？']);
});
it('can use a complete located sentence in a long unbroken paragraph after bounded review',async()=>{
 const s=scenario();const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'背景介绍不涉及申请要求。'.repeat(600)+'2026年受控活动报名截止2026年10月30日，仅限本科生。'+'网站栏目说明。'.repeat(600)});
 s.services.model=async r=>{if(r.schemaId==='investigation.context-screen.v1')return{value:{screened:true,omittedRelevantQuotes:[],reason:'完整捕获只有重复背景和已展示截止限定'},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};const body=JSON.parse(r.messages[1]!.content) as {evidence:{index:number;view?:string;rawExcerpt?:string}[]};const index=body.evidence.find(entry=>(entry.rawExcerpt??entry.view??'').includes('报名截止2026年10月30日'))?.index;
 if(index===undefined)throw Error('controlled_fixture: relevant sentence missing from model input');
 return{value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'完整原句保留限定'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'有可定位的截止日期和限定'}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[index],conditions:['仅限本科生'],gaps:[],reasonSummary:'完整原句'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion,JSON.stringify({reason:result.stopReason,unknowns:result.draft?.unknowns,claims:result.draft?.claims})).toBe('completed');expect(result.draft?.conditions).toContain('仅限本科生');
});
it('can answer a located long-page fact without treating every omitted background paragraph as fatal',async()=>{
 const s=scenario();const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'2026年受控活动报名截止2026年10月30日，仅限本科生。\n\n背景介绍甲。\n\n背景介绍乙。\n\n网站联系方式。\n\n无关页脚。'});
 s.services.model=async r=>({value:r.schemaId==='investigation.context-screen.v1'?{screened:true,omittedRelevantQuotes:[],reason:'完整捕获没有其他申请条件或日期'}:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'独立日期原句，限定已保留'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'日期与本科生限定都在选中原句中'}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[JSON.parse(r.messages[1]!.content).evidence[0].index],conditions:['仅限本科生'],gaps:[],reasonSummary:'定位原句'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('completed');expect(result.draft?.conditions).toContain('仅限本科生');
});
it('selects a later original-source lead without reading more than the actual requested limit',async()=>{
 const s=scenario();s.services.search=async()=>({items:[0,1,2,3].map(n=>({url:'https://example.invalid/'+n,title:n===3?'主办方原始公告':'转载通知',snippet:'相同的搜索线索',publisher:null,publishedAt:null,providerScore:null})),providerRequestId:null,invalidItemCount:0,warnings:[],usage:null});
 await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.reads).toContain('https://example.invalid/3');expect(s.reads.length).toBeLessThanOrEqual(3);
});
it('counts a fresh window from its budget rather than exhausting it from historical batch numbers',async()=>{
 const s=scenario();s.input.checkpoint={sources:[],evidence:[],claims:[],candidates:[],queries:[1,2,3,4].map(batchNo=>({id:randomUUID(),runId:randomUUID(),query:'历史不同方向'+batchNo,purpose:'旧窗未知历史保留',claimIds:[],site:null,freshness:null,limit:3,scopeVersion:1,batchNo,attemptCount:batchNo}))};
 await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(1);expect(s.checkpoints.some(cp=>cp.queries.length===5)).toBe(true);
});
it('preserves twelve historical queries and saves a thirteenth direction in an explicit fresh window',async()=>{
 const s=scenario();s.input.checkpoint={sources:[],evidence:[],claims:[],candidates:[],queries:Array.from({length:12},(_,index)=>({id:randomUUID(),runId:randomUUID(),query:'历史方向'+index,purpose:'已发未知不重放',claimIds:[],site:null,freshness:null,limit:3,scopeVersion:1,batchNo:Math.floor(index/3)+1,attemptCount:index+1}))};
 await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(1);expect(s.checkpoints.at(-1)?.queries).toHaveLength(13);expect(s.checkpoints.at(-1)?.queries.at(-1)?.attemptCount).toBe(1);
});
it('does not refresh the current window allowance on resume when twelve searches are used or reserved',async()=>{
 const s=scenario();s.setBudget({...s.budget(),used:{...s.budget().used,searches:11},reserved:{...s.budget().reserved,searches:1}});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(0);expect(result.stopReason).toBe('search_limit');
});
it('counts four actual sparse batches across resumed runs in the same authoritative window',async()=>{
 const s=scenario();s.input.checkpoint={sources:[],evidence:[],claims:[],candidates:[],queries:[1,2,3,4].map(batchNo=>({id:randomUUID(),runId:randomUUID(),budgetWindowId:s.input.context.budgetWindowId!,query:'该窗已发方向'+batchNo,purpose:'不同run的一条查询批次',claimIds:[],site:null,freshness:null,limit:3,scopeVersion:1,batchNo,attemptCount:batchNo}))};
 s.setBudget({...s.budget(),used:{...s.budget().used,searches:4}});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(0);expect(result.stopReason).toBe('search_limit');
});
it('starts a genuinely fresh window at actual batch one and tags the new query without deleting old records',async()=>{
 const s=scenario();const oldWindow=randomUUID();s.input.checkpoint={sources:[],evidence:[],claims:[],candidates:[],queries:Array.from({length:12},(_,index)=>({id:randomUUID(),runId:randomUUID(),budgetWindowId:oldWindow,query:'旧窗未知方向'+index,purpose:'保留已发未知历史',claimIds:[],site:null,freshness:null,limit:3,scopeVersion:1,batchNo:Math.floor(index/3)+1,attemptCount:index+1}))};
 await runInvestigation(s.input,s.services,new AbortController().signal);const queries=s.checkpoints.at(-1)!.queries;expect(queries).toHaveLength(13);expect(queries[12]?.budgetWindowId).toBe(s.input.context.budgetWindowId);expect(queries[12]?.batchNo).toBe(1);expect(queries[12]?.attemptCount).toBe(1);expect(queries.slice(0,12).every(query=>query.budgetWindowId===oldWindow)).toBe(true);
});
it('records a later actual batch even when prior batches contained fewer than three searches',async()=>{
 const s=scenario();s.input.checkpoint={sources:[],evidence:[],claims:[],candidates:[],queries:[1,2].map(batchNo=>({id:randomUUID(),runId:randomUUID(),budgetWindowId:s.input.context.budgetWindowId!,query:'之前稀疏批次'+batchNo,purpose:'每批只查一条',claimIds:[],site:null,freshness:null,limit:3,scopeVersion:1,batchNo,attemptCount:batchNo}))};s.setBudget({...s.budget(),used:{...s.budget().used,searches:2}});
 await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.checkpoints.at(-1)?.queries.at(-1)?.batchNo).toBe(3);expect(s.checkpoints.at(-1)?.queries.at(-1)?.attemptCount).toBe(3);
});
it('continues F02 fuzzy identification using a materially grounded candidate query rather than the full descriptive object',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.objectText='那个Python开源网页监测工具';s.input.scope.goal='那个Python开源网页监测工具，能按CSS选择器盯变化，名字忘了';s.input.scope.claimsToCheck=['识别工具身份'];s.input.scope.knownClues=['Python','CSS selector'];
 const query='Python 开源 网页监控 CSS selector changedetection';const quote='changedetection.io 是 Python 开源网页监测工具，支持 CSS selector。';const search=s.services.search;s.services.search=async(r,c,a)=>{if(s.searches.length){s.searches.push(r);return{items:[],providerRequestId:null,invalidItemCount:0,warnings:[],usage:null};}return search(r,c,a);};const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:quote});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,reason:'名称及两条确定线索有材料依据'}],queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[{text:'changedetection',evidenceIndex:0,quote}],reason:'补核候选是否是记忆对象，不把候选当确定身份'}]}:{claims:[],answerBlocks:[],candidates:[{name:'changedetection.io',evidenceIndexes:[0],aliases:[],matchedClues:['Python','CSS selector'],conflictingClues:[],missingClues:['是否就是用户记忆对象'],reasonSummary:'有材料的候选'}],nextQueries:[{query,purpose:'核对工具候选原始说明',goalIndex:0}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches.map(request=>request.query)).toContain(query);
});
it('uses a T01 first-party API name only after a bounded review binds it to this object and unresolved goal',async()=>{
 const s=scenario();s.input.scope.objectText='元宝搜索API';s.input.scope.goal='核对元宝搜索API的能力和计费';s.input.scope.claimsToCheck=['能力边界','计费方式'];const query='SearchPro 官方接口 能力范围';const quote='元宝搜索API的官方接口名称是 SearchPro。';const search=s.services.search;s.services.search=async(r,c,a)=>{if(s.searches.length){s.searches.push(r);return{items:[],providerRequestId:null,invalidItemCount:0,warnings:[],usage:null};}return search(r,c,a);};const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:quote});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[{text:'SearchPro',evidenceIndex:0,quote}],reason:'同一API材料明确给出的名称，用于未解能力目标'}]}:{claims:[{statement:'能力边界待查',status:'insufficient',evidenceIndexes:[],conditions:[],gaps:['能力边界缺原始说明'],reasonSummary:'只有API名称'}],answerBlocks:[],nextQueries:[{query,purpose:'核对第一手接口说明',goalIndex:0}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches.map(request=>request.query)).toContain(query);
});
it('does not let an explicit resolved target or a scope veto be bypassed by a direct object anchor',()=>{
 const s=scenario();s.input.scope.claimsToCheck=['学历要求','年龄要求'];const material={sources:[],evidence:[],claims:[],queries:[],candidates:[]};
 const answered=nextQueries({nextQueries:[{query:s.input.scope.objectText+' 学历复查',purpose:'重复学历',goalIndex:0,gap:'年龄未知'}]},s.input.scope,material,['年龄未知'],[1],{queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[],reason:'已答目标不可追加'}]});expect(answered).toHaveLength(0);
 const changed=nextQueries({nextQueries:[{query:s.input.scope.objectText+' 改为另一家公司财报',purpose:'扩大对象',goalIndex:1}]},s.input.scope,material,['年龄未知'],[1],{queryChecks:[{queryIndex:0,scopeMatches:false,goalIndex:1,anchors:[],reason:'转成另一对象'}]});expect(changed).toHaveLength(0);
});
