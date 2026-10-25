import {expect,it} from 'vitest';
import chain from './fixtures/f01-research-chain.json' with {type:'json'};
import {quoteRange,normalizedView,hashText} from '../../src/server/investigation/evidence.js';
import {evaluationRequest,reviewRequest,inputCost} from '../../src/server/investigation/prompts.js';
import {applyMode} from '../../src/server/investigation/modes/strategy.js';
import {judge} from '../../src/server/investigation/judge.js';
import {ScopeSchema} from '../../src/shared/contracts.js';
import {WorkingMaterialSchema} from '../../src/shared/ports.js';
import {scenario} from './controlled.js';
import {prepareInvestigation,runInvestigation} from '../../src/server/investigation/index.js';
import {randomUUID} from 'node:crypto';
import type {ModelResponse} from '../../src/shared/ports.js';
const material=()=>WorkingMaterialSchema.parse(chain.checkpoint);
const scope=()=>ScopeSchema.parse(chain.scope);
it('locates the actual prose apostrophe escape using unchanged raw UTF16 offsets and hash',()=>{
 const raw=chain.checkpoint.evidence[5]!.excerpt;const value=chain.models[4]!.value as {claims:{links:{quote:string}[]}[]};const quote=value.claims[0]!.links[0]!.quote;const before=hashText(raw);const range=quoteRange(raw,quote);expect(range).not.toBeNull();expect(normalizedView(raw.slice(range!.start,range!.end)).text).toBe(normalizedView(quote).text);expect(hashText(raw)).toBe(before);
});
it('does not collapse code escaping or join non-contiguous prose with ellipses',()=>{
 expect(quoteRange("甲段。中间有不同内容。乙段。",'甲段……乙段')).toBeNull();expect(quoteRange("`\\'火花\\'`","'火花'")).toBeNull();expect(quoteRange("```js\nconst a=\\'火花\\';\n```","'火花'")).toBeNull();
});
it('excludes known context-risk sources at input time without silently clearing their markers or hashes',()=>{
 const s=scenario();s.input.scope=scope();const captured=material(),before=structuredClone(captured);const prepared=evaluationRequest(s.input,captured,s.budget())!;expect(prepared.selected).toEqual([4,5,6]);expect(captured).toEqual(before);const body=JSON.parse(prepared.request.messages[1]!.content);expect(body.clueTable.objectText).toBe(s.input.scope.objectText);expect(body.clueTable.known).toEqual(s.input.scope.knownClues.map((clueText,clueIndex)=>({clueKind:'known',clueIndex,clueText})));expect(body.clueTable.uncertain[0].clueIndex).toBe(0);const review=reviewRequest(prepared.request,[],s.budget(),{candidates:[]})!;expect(inputCost(review)).toBeLessThanOrEqual(24000);expect(review.maxOutputTokens).toBe(1200);
});
const freshCandidate=()=>({claims:[],answerBlocks:[],candidates:[{name:'心灵奇旅',aliases:['Soul'],evidenceIndexes:[5,6],matchedClues:[],conflictingClues:[],missingClues:['其他记忆候选尚未排除'],reasonSummary:'受控新提议仅用独立合格来源，不从旧候选裁链'}]});
function freshAudit(){const s=scope();return{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0],reason:'受控独立逐线索核对',clueChecks:[...s.knownClues.map((clueText,clueIndex)=>({clueIndex,clueKind:'known',clueText,relation:'matches',evidenceIndex:clueIndex===0?6:5,quote:clueIndex===0?'音乐在影片中占据重要地位':'意外坠入灵魂世界',reason:'原语位置对应'})),...s.uncertainClues.map((clueText,clueIndex)=>({clueIndex,clueKind:'uncertain',clueText,relation:'unknown',evidenceIndex:5,quote:'中学音乐教师',reason:'不把未明确材料当确认'}))]}]};}
it('rejects the actual globally numbered candidate audit as a whole instead of ignoring extra rows or remapping',()=>{
 const captured=material(),s=scope(),value=freshCandidate(),check=judge(value,captured,s,[4,5,6]);applyMode({scope:s},captured,check,value,chain.models[5]!.value,[4,5,6]);expect(captured.candidates[0]?.matchedClues).toEqual([]);expect(captured.candidates[0]?.missingClues.join(' ')).toMatch(/索引|文本|审核/);expect(check.coveredGoals).toEqual([]);
});
it.each(['extra','duplicate','wrong-text','missing-text','bad-quote','other-evidence'] as const)('rejects a candidate audit with %s clue rows without salvaging its valid subset',async defect=>{
 const captured=material(),s=scope(),value=freshCandidate(),check=judge(value,captured,s,[4,5,6]),audit=freshAudit(),rows=audit.candidateChecks[0]!.clueChecks;if(defect==='extra')rows.push({...rows[0]!,clueIndex:80});else if(defect==='duplicate')rows.push({...rows[0]!});else if(defect==='wrong-text')rows[0]!.clueText='动画电影';else if(defect==='missing-text')delete (rows[0] as {clueText?:string}).clueText;else if(defect==='bad-quote')rows[3]!.quote='原文中不存在的片段';else rows[3]!.evidenceIndex=9;applyMode({scope:s},captured,check,value,audit,[4,5,6]);expect(captured.candidates[0]?.matchedClues).toEqual([]);expect(check.coveredGoals).toEqual([]);
});
it('accepts a fresh independently audited candidate from qualified sources while retaining uncertainty and non-uniqueness',()=>{
 const captured=material(),s=scope(),value=freshCandidate(),check=judge(value,captured,s,[4,5,6]),audit=freshAudit();applyMode({scope:s},captured,check,value,audit,[4,5,6]);expect(captured.candidates[0]?.matchedClues).toEqual(s.knownClues);expect(captured.candidates[0]?.missingClues).toContain('其他记忆候选尚未排除');expect(s.uncertainClues).toEqual(chain.scope.uncertainClues);expect(Buffer.byteLength(JSON.stringify(audit),'utf8')).toBeLessThanOrEqual(1200);
});
it('consumes escaped backslashes once, preserving parity and UTF16 surrogate positions',()=>{
 for(let count=1;count<=4;count++){const raw='\\'.repeat(count)+"'火花"+'\\'.repeat(count)+"'";expect(normalizedView(raw).text).toBe('\\'.repeat(Math.floor(count/2))+"'火花"+'\\'.repeat(Math.floor(count/2))+"'");if(count>1)expect(quoteRange(raw,"'火花'")).toBeNull();}
 const raw="前🧭\\'火花\\'尾",quote="🧭'火花'",range=quoteRange(raw,quote)!;expect(range.start).toBe(1);expect(raw.slice(range.start,range.start+2)).toBe('🧭');expect(normalizedView(raw.slice(range.start,range.end)).text).toBe(quote);expect(quoteRange("~~~js\nconst a=\\'火花\\';\n~~~","'火花'")).toBeNull();
});
it('keeps unmatched code delimiter runs atomic and preserves terminal code whitespace',()=>{
 for(const raw of ["`x``Ａ\\'B`","``🧭x```Ａ\\'B``"]){expect(quoteRange(raw,"A'B")).toBeNull();expect(normalizedView(raw).text).toContain("Ａ\\'B");}
 expect(normalizedView('`A `').text).toBe('A ');expect(normalizedView('普通文本  ').text).toBe('普通文本');
});
it('distinguishes user-stated memory certainty from verified external facts in fresh scope proposals',async()=>{
 const s=scenario(),body=JSON.parse(chain.models[0]!.request.messages[1]!.content);const reply=(value:ModelResponse['value']):ModelResponse=>({value,usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});s.services.model=async request=>{s.models.push(request);expect(request.messages[0]!.content).toContain('known是用户明确陈述');expect(request.messages[0]!.content).toContain('记忆');return reply(request.promptVersion.startsWith('investigation.scope.saved-followup-review.')?{scopeMatches:true,clueChecks:[{clueIndex:0,grounded:true,certainty:'known',reason:'明确陈述成年教师，无局部不确定修饰'},{clueIndex:1,grounded:true,certainty:'uncertain',reason:'好像局部修饰钢琴'}],clueUpdateChecks:[],reason:'不要求用户先外部证实'}:{scopeMatches:true,clues:[{text:'主角是成年男老师',inputRef:'saved_followup',quote:'主角是成年男老师',certainty:'known'},{text:'好像弹钢琴',inputRef:'saved_followup',quote:'好像弹钢琴',certainty:'uncertain'}],clueUpdates:[],reason:'按用户陈述确信程度'});};
 const input={context:s.input.context,originalQuestion:body.originalQuestion,basicMode:'identify' as const,attachments:[],previousScope:body.previousScope,clarificationAnswer:null,followup:{...body.followup,turnId:randomUUID()}};const result=await prepareInvestigation(input,s.services,new AbortController().signal);expect(result.scope?.knownClues).toContain('主角是成年男老师');expect(result.scope?.uncertainClues).toContain('好像弹钢琴');expect(s.models).toHaveLength(2);
 const prior=scope(),before=structuredClone(prior);const reused=await prepareInvestigation({...input,previousScope:prior,followup:undefined},s.services,new AbortController().signal);expect(reused.scope).toEqual(before);expect(prior.uncertainClues).toContain('主角是成年男老师');expect(s.models).toHaveLength(2);
});
it('uses only qualified sources for a fresh candidate audit and reuses existing context states with exactly two engine models',async()=>{
 const s=scenario(),before=material();s.input={...s.input,basicMode:'identify',scope:scope(),checkpoint:before};const reply=(value:ModelResponse['value']):ModelResponse=>({value,usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content);expect(body.evidence.map((e:{index:number})=>e.index)).toEqual([12,13]);expect(body.evidence.every((e:{limitations:string[]})=>!e.limitations.some(limit=>/^(?:raw_capture_only|capture_context_risk|capture_screen_unverified)/.test(limit)))).toBe(true);if(request.schemaId==='investigation.evaluate.v2')return reply({...freshCandidate(),candidates:freshCandidate().candidates.map(c=>({...c,evidenceIndexes:[12]}))});expect(request.schemaId).toBe('investigation.review.v1');expect(request.maxOutputTokens).toBe(1200);const audit=freshAudit();for(const check of audit.candidateChecks[0]!.clueChecks)check.evidenceIndex=12;return reply(audit);};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.models.map(request=>request.schemaId),JSON.stringify(JSON.parse(s.models[0]!.messages[1]!.content).evidence.map((e:any)=>({index:e.index,limitations:e.limitations})))).toEqual(['investigation.evaluate.v2','investigation.review.v1']);expect(s.searches).toHaveLength(0);expect(s.reads).toHaveLength(0);expect(result.completion).toBe('partial');expect(result.draft?.candidates).toHaveLength(1);expect(result.draft?.candidates[0]?.matchedClues).toEqual(chain.scope.knownClues);expect(result.draft?.scope.uncertainClues).toEqual(chain.scope.uncertainClues);expect(result.draft?.evidence.slice(0,before.evidence.length).map(e=>e.contentHash)).toEqual(before.evidence.map(e=>e.contentHash));expect(result.draft?.evidence.some(e=>e.limitations.some(limit=>limit.startsWith('capture_context_risk')))).toBe(true);
});
it('does not salvage the actual old candidate or claim by trimming its risk-source references',async()=>{
 const s=scenario();s.input={...s.input,basicMode:'identify',scope:scope(),checkpoint:material()};s.services.model=async request=>({value:request.schemaId==='investigation.evaluate.v2'?chain.models[4]!.value:chain.models[5]!.value,usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.candidates).toEqual([]);expect(result.draft?.claims[0]?.status).toBe('insufficient');expect(result.draft?.claims[0]?.links).toEqual([]);
});
