import { expect, it } from 'vitest';
import { runInvestigation } from '../../src/server/investigation/index.js';
import { scenario, hash } from './controlled.js';

function latestScenario(dated=true) {
  const s=scenario();s.input.basicMode='latest';s.input.scope.basicMode='latest';s.input.scope.goal='2026年受控活动目前的报名状态';
  s.services.search=async()=>({items:[{url:'https://example.invalid/old',title:'近期转载旧消息',snippet:'',publisher:null,publishedAt:'2026-10-24T00:00:00.000Z',providerScore:null},{url:'https://example.invalid/new',title:'当前通知',snippet:'',publisher:null,publishedAt:'2026-10-21T00:00:00.000Z',providerScore:null}],providerRequestId:null,invalidItemCount:0,warnings:[],usage:null});
  s.services.read=async r=>{const text=r.url.endsWith('old')?'2026年受控活动自2026年09月01日起暂停报名。':'2026年受控活动自2026年10月20日起开放报名。';return{sourceId:r.sourceId,finalUrl:r.url,title:null,text,readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:hash(text),failureCode:null,usage:null};};
  s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'历史暂停，后续开放'},{claimIndex:1,verdict:'supported',addressesQuestion:true,reason:'有效范围一致'}],goalChecks:[{goalIndex:0,claimIndexes:[0,1],covered:true,reason:'同一报名状态的历史和更新'}],temporalRelations:[{previousClaimIndex:0,nextClaimIndex:1,relation:'supersedes',reason:'同一报名状态由暂停更新为开放'}]}:{claims:[{statement:'暂停报名',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'旧有效状态'},{statement:'开放报名',status:'supported',evidenceIndexes:[1],conditions:[],gaps:[],reasonSummary:'新有效状态'}],answerBlocks:[],latestFacts:dated?[{claimIndex:0,evidenceIndex:0,effectiveAt:'2026-09-01T00:00:00.000Z',quote:'自2026年09月01日起暂停报名'},{claimIndex:1,evidenceIndex:1,effectiveAt:'2026-10-20T00:00:00.000Z',quote:'自2026年10月20日起开放报名'}]:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  return s;
}
it('latest selects evidenced effective time rather than newer publication or fetch time',async()=>{
  const s=latestScenario();const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.draft?.claims.map(c=>c.statement)).toEqual(['开放报名']);
  expect(result.draft?.sources.find(source=>source.url.endsWith('/new'))?.eventAt).toBe('2026-10-20T00:00:00.000Z');
  expect(result.draft?.conditions.join(' ')).toMatch(/截至|查询/);
});
it('latest with no evidenced effective date remains unknown instead of treating fetchedAt as latest',async()=>{
  const s=latestScenario(false);const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.completion).toBe('partial');expect(result.stopReason).not.toBe('answered');expect(result.draft?.unknowns.join(' ')).toMatch(/有效|日期|时间/);
});
it('does not suppress an undated conflicting update merely because another state has a known date',async()=>{
 const s=latestScenario();const model=s.services.model;s.services.model=async(r,c,a)=>{const response=await model(r,c,a);if(r.schemaId!=='investigation.review.v1')(response.value as {latestFacts:unknown[]}).latestFacts=[{claimIndex:0,evidenceIndex:0,effectiveAt:'2026-09-01T00:00:00.000Z',quote:'自2026年09月01日起暂停报名'}];return response;};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/时间|日期|更新/);
});
it('latest rejects a publication date presented as an effective fact date',async()=>{
  const s=latestScenario();s.services.read=async r=>({sourceId:r.sourceId,finalUrl:r.url,title:null,text:'2026年受控活动。文章发表于2026年10月20日，当前状态未知。',readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:null,failureCode:null,usage:null});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');
});
it('binds an effective cue to its own date instead of another publication date in the same sentence',async()=>{
 const s=latestScenario();s.services.read=async r=>({sourceId:r.sourceId,finalUrl:r.url,title:null,text:'2026年受控活动通知发表于2026年10月20日，自2026年09月01日起暂停报名。',readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:null,failureCode:null,usage:null});
 const model=s.services.model;s.services.model=async(r,c,a)=>{const response=await model(r,c,a);if(r.schemaId!=='investigation.review.v1')(response.value as {latestFacts:unknown[]}).latestFacts=[{claimIndex:0,evidenceIndex:0,effectiveAt:'2026-10-20T00:00:00.000Z',quote:'通知发表于2026年10月20日，自2026年09月01日起暂停报名'}];return response;};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.sources.every(source=>source.eventAt===null)).toBe(true);
});
it('keeps independently dated facts for different atomic goals instead of dropping the older goal',async()=>{
 const s=latestScenario();s.input.scope.goal='2026年受控活动的报名状态和费用';s.input.scope.claimsToCheck=['报名状态','费用'];
 s.services.read=async r=>({sourceId:r.sourceId,finalUrl:r.url,title:null,text:r.url.endsWith('old')?'2026年受控活动自2026年09月01日起报名免费。':'2026年受控活动自2026年10月20日起开放报名。',readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:null,failureCode:null,usage:null});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'费用原句'},{claimIndex:1,verdict:'supported',addressesQuestion:true,reason:'状态原句'}],goalChecks:[{goalIndex:0,claimIndexes:[1],covered:true,reason:'状态'},{goalIndex:1,claimIndexes:[0],covered:true,reason:'费用'}]}:{claims:[{statement:'报名免费',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'费用'},{statement:'开放报名',status:'supported',evidenceIndexes:[1],conditions:[],gaps:[],reasonSummary:'状态'}],answerBlocks:[],latestFacts:[{claimIndex:0,evidenceIndex:0,effectiveAt:'2026-09-01T00:00:00.000Z',quote:'自2026年09月01日起报名免费'},{claimIndex:1,evidenceIndex:1,effectiveAt:'2026-10-20T00:00:00.000Z',quote:'自2026年10月20日起开放报名'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.draft?.claims.map(claim=>claim.statement)).toEqual(['报名免费','开放报名']);expect(result.completion).toBe('completed');
});
it('retains cumulative eligibility conditions when a later notice adds a requirement without replacing the old one',async()=>{
 const s=latestScenario();s.input.scope.goal='2026年受控活动目前的资格要求';s.input.scope.claimsToCheck=['目前资格要求'];
 s.services.read=async r=>({sourceId:r.sourceId,finalUrl:r.url,title:null,text:r.url.endsWith('old')?'2026年受控活动自2026年09月01日起要求本科生。':'2026年受控活动自2026年10月20日起增加年龄不超过25岁要求。',readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:null,failureCode:null,usage:null});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'学历'},{claimIndex:1,verdict:'supported',addressesQuestion:true,reason:'新增年龄条件'}],goalChecks:[{goalIndex:0,claimIndexes:[0,1],covered:true,reason:'两项共同构成资格'}],temporalRelations:[{previousClaimIndex:0,nextClaimIndex:1,relation:'cumulative',reason:'增加年龄条件，没有撤销学历要求'}]}:{claims:[{statement:'要求本科生',status:'supported',evidenceIndexes:[0],conditions:[],gaps:[],reasonSummary:'学历'},{statement:'年龄不超过25岁',status:'supported',evidenceIndexes:[1],conditions:[],gaps:[],reasonSummary:'年龄'}],answerBlocks:[],latestFacts:[{claimIndex:0,evidenceIndex:0,effectiveAt:'2026-09-01T00:00:00.000Z',quote:'自2026年09月01日起要求本科生'},{claimIndex:1,evidenceIndex:1,effectiveAt:'2026-10-20T00:00:00.000Z',quote:'自2026年10月20日起增加年龄不超过25岁要求'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const originalModel=s.services.model;s.services.model=async(r,c,a)=>{const result=await originalModel(r,c,a);if(r.schemaId==='investigation.review.v1')Object.assign(result.value as object,{claimPairChecks:[{leftClaimIndex:0,rightClaimIndex:1,objectText:s.input.scope.objectText,sameObject:true,sameFactDimension:true,sameConditions:false,relation:'cumulative',left:{evidenceIndex:0,quote:'自2026年09月01日起要求本科生'},right:{evidenceIndex:1,quote:'自2026年10月20日起增加年龄不超过25岁要求'},reason:'新增年龄要求与原学历条件同时成立，不互斥'}]});return result;};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.draft?.claims.map(claim=>claim.statement)).toEqual(['要求本科生','年龄不超过25岁']);expect(result.completion).toBe('completed');
});
it('identify retains two grounded candidates and asks a distinguishing question rather than selecting one',async()=>{
  const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.objectText='记不清名称的校园活动';s.input.scope.goal='按科普线索查活动';s.input.scope.knownClues=['科普'];
  s.services.search=async()=>({items:[{url:'https://example.invalid/a',title:'候选甲',snippet:'',publisher:null,publishedAt:null,providerScore:null},{url:'https://example.invalid/b',title:'候选乙',snippet:'',publisher:null,publishedAt:null,providerScore:null}],providerRequestId:null,invalidItemCount:0,warnings:[],usage:null});
  s.services.read=async r=>({sourceId:r.sourceId,finalUrl:r.url,title:null,text:r.url.endsWith('/a')?'星光活动提供科普。地点待核对。':'晨曦活动提供科普。年份待核对。',readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:null,failureCode:null,usage:null});
  s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,reason:'名称与科普线索在材料中'},{candidateIndex:1,grounded:true,reason:'名称与科普线索在材料中'}]}:{claims:[],answerBlocks:[],candidates:[{name:'星光活动',evidenceIndexes:[0],aliases:[],matchedClues:['科普'],conflictingClues:[],missingClues:['地点'],reasonSummary:'来源甲提供线索'},{name:'晨曦活动',evidenceIndexes:[1],aliases:[],matchedClues:['科普'],conflictingClues:[],missingClues:['年份'],reasonSummary:'来源乙提供线索'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.draft?.candidates.map(c=>c.name)).toEqual(['星光活动','晨曦活动']);expect(result.completion).toBe('partial');expect(result.draft?.nextSteps.join(' ')).toMatch(/地点|年份/);
});
it('truth preserves opposing evidence as a conflict instead of majority-voting it away',async()=>{
  const s=scenario();s.services.search=async()=>({items:['a','b'].map(n=>({url:'https://example.invalid/'+n,title:n,snippet:'',publisher:null,publishedAt:null,providerScore:null})),providerRequestId:null,invalidItemCount:0,warnings:[],usage:null});
  s.services.read=async r=>({sourceId:r.sourceId,finalUrl:r.url,title:null,text:r.url.endsWith('a')?'2026年受控活动报名截止2026年10月30日。':'2026年受控活动报名截止不是2026年10月30日，而是2026年10月20日。',readStatus:'full',fetchedAt:'2026-10-25T00:00:00.000Z',contentHash:null,failureCode:null,usage:null});
  s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'mixed',addressesQuestion:true,reason:'同届材料在截止日上冲突'}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',links:[{evidenceIndex:0,relation:'supports',quote:'报名截止2026年10月30日'},{evidenceIndex:1,relation:'contradicts',quote:'报名截止不是2026年10月30日'}],conditions:[],gaps:[],reasonSummary:'不能忽略反证'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
  const result=await runInvestigation(s.input,s.services,new AbortController().signal);
  expect(result.draft?.claims[0]?.status).toBe('mixed');expect(result.draft?.conflicts).toHaveLength(1);
});
it('does not treat one identified candidate as an answer to unresolved registration and fee goals',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.goal='确定活动名称和报名费用';s.input.scope.claimsToCheck=['活动名称','报名费用'];s.input.scope.knownClues=['科普'];
 const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'星光活动提供科普，报名费用未公布。'});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,reason:'名称有依据'}]}:{claims:[],answerBlocks:[],candidates:[{name:'星光活动',evidenceIndexes:[0],aliases:[],matchedClues:['科普'],conflictingClues:[],missingClues:[],reasonSummary:'唯一找到的候选'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/费用|目标/);
});
it('can complete a pure identity goal with one reviewed fully matching candidate and its evidence',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.goal='确定活动名称';s.input.scope.claimsToCheck=['确定活动名称'];s.input.scope.knownClues=['科普'];const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'星光活动提供科普。'});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0],clueChecks:[{clueIndex:0,clueKind:'known',clueText:'科普',relation:'matches',evidenceIndex:0,quote:'提供科普',reason:'原句说明科普'}],reason:'唯一名称及全部科普线索在材料中'}]}:{claims:[],answerBlocks:[],candidates:[{name:'星光活动',evidenceIndexes:[0],aliases:[],matchedClues:['科普'],conflictingClues:[],missingClues:[],reasonSummary:'唯一有依据的名称'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('completed');expect(result.stopReason).toBe('answered');expect(result.draft?.candidates[0]?.name).toBe('星光活动');expect(result.draft?.answerBlocks[0]?.evidenceIds).toHaveLength(1);
});
it('does not let candidate identity indexes assert a separate factual fee goal',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.goal='确定活动名称和报名费用';s.input.scope.claimsToCheck=['活动名称','报名费用'];s.input.scope.knownClues=['科普'];const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'星光活动提供科普，报名费用未公布。'});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0,1],reason:'错误地把费用也当身份目标'}]}:{claims:[],answerBlocks:[],candidates:[{name:'星光活动',evidenceIndexes:[0],aliases:[],matchedClues:['科普'],conflictingClues:[],missingClues:[],reasonSummary:'名称'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.stopReason).not.toBe('answered');expect(result.draft?.unknowns.join(' ')).toMatch(/费用/);
});
it('keeps a candidate unresolved when complete capture screening found omitted contrary clues',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.goal='确定活动名称';s.input.scope.claimsToCheck=[];s.input.scope.knownClues=['科普'];const read=s.services.read;
 s.services.read=async(r,c,a)=>({...await read(r,c,a),text:['2026年受控活动星光活动提供科普。','2026年受控活动介绍。','2026年受控活动报名步骤。','该页面说的科普是另一个项目，星光活动实际为体育项目。'].join('\n\n')});
 s.services.model=async r=>({value:r.schemaId==='investigation.context-screen.v1'?{screened:true,omittedRelevantQuotes:['该页面说的科普是另一个项目，星光活动实际为体育项目。'],reason:'遗漏反证'}:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0],reason:'仅看选段似乎匹配'}]}:{claims:[],answerBlocks:[],candidates:[{name:'星光活动',evidenceIndexes:[0],aliases:[],matchedClues:['科普'],conflictingClues:[],missingClues:[],reasonSummary:'名称'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.unknowns.join(' ')).toMatch(/线索|条件|反证/);
});
it('does not use substring clue presence in a denial as a substitute for a quote-bound semantic match',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.goal='确定活动名称';s.input.scope.claimsToCheck=['确定对象名称'];s.input.scope.knownClues=['科普'];const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'星光活动并不提供科普。'});
 s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0],reason:'只承认名字存在，未逐线索核对'}]}:{claims:[],answerBlocks:[],candidates:[{name:'星光活动',evidenceIndexes:[0],matchedClues:['科普'],conflictingClues:[],missingClues:[],reasonSummary:'字面出现'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.candidates[0]?.matchedClues).not.toContain('科普');
});
it('does not treat duplicate contradictory candidate audits as one unambiguous review',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope.basicMode='identify';s.input.scope.goal='确定活动名称';s.input.scope.claimsToCheck=['确定对象名称'];s.input.scope.knownClues=['科普'];const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'星光活动提供科普。'});
 const clueChecks=[{clueIndex:0,clueKind:'known',clueText:'科普',relation:'matches',evidenceIndex:0,quote:'提供科普',reason:'科普'}];s.services.model=async r=>({value:r.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:false,identityGoalIndexes:[0],clueChecks,reason:'不确认'},{candidateIndex:0,grounded:true,identityGoalIndexes:[0],clueChecks,reason:'确认'}]}:{claims:[],answerBlocks:[],candidates:[{name:'星光活动',evidenceIndexes:[0],matchedClues:['科普'],conflictingClues:[],missingClues:[],reasonSummary:'名称'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');
});
