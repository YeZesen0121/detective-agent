import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { compareWatchResult } from '../../src/server/investigation/index.js';
import { samplePayload, ids, at } from '../helpers/result.js';
import { scenario, hash } from './controlled.js';
function setup(){const s=scenario();const payload=samplePayload();const before={id:randomUUID(),investigationId:ids.investigation,runId:ids.run,previousVersionId:null,createdAt:at,payloadHash:hash(JSON.stringify(payload)),payload};const candidate=structuredClone(payload);candidate.runId=randomUUID();return{s,input:{context:s.input.context,before,candidate,focus:'截止',readFailures:[] as {sourceId:string;errorCode:string}[]}};}
it('confirms unchanged facts despite new UUIDs, capture time and reordered conditions',async()=>{
 const {s,input}=setup();input.candidate.queryTime='2026-10-25T00:00:00.000Z';input.candidate.sources[0]!.fetchedAt='2026-10-25T00:00:00.000Z';
 const first=await compareWatchResult(input,s.services,new AbortController().signal);
 expect(first.kind).toBe('unchanged');expect(s.models).toHaveLength(0);
 input.candidate.claims[0]!.id=randomUUID();input.candidate.answerBlocks[0]!.claimIds=[input.candidate.claims[0]!.id];
 const second=await compareWatchResult(input,s.services,new AbortController().signal);expect(second.kind).toBe('unchanged');expect(second.factSignature).toBe(first.factSignature);
});
it('returns significant with candidate-only citations when the core fact is refuted',async()=>{
 const {s,input}=setup();const claim=input.candidate.claims[0]!;claim.id=randomUUID();claim.status='refuted';claim.links[0]!.relation='contradicts';input.candidate.answerBlocks[0]!.claimIds=[claim.id];
 input.candidate.evidence[0]!.excerpt='原称报名截至十月三十日不正确，报名截至十月二十日。';
 s.services.model=async()=>({value:{kind:'significant',reason:'截止事实被新原文反驳',changes:[{kind:'conclusion',description:'截止事实变化',claimIndexes:[0],evidenceIndexes:[0]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);
 expect(result.kind).toBe('significant');expect(result.changes[0]?.claimIds).toEqual([claim.id]);expect(result.changes[0]?.evidenceIds).toEqual([ids.evidence]);
});
it('recognizes an actually resolved insufficient claim as a gap resolution',async()=>{
 const {s,input}=setup();input.before.payload.claims[0]!.status='insufficient';input.before.payload.claims[0]!.gaps=['需原始公告'];
 s.services.model=async()=>({value:{kind:'significant',reason:'新原始公告解决原证据缺口',changes:[{kind:'gap_resolved',description:'原始公告给出截止日期',claimIndexes:[0],evidenceIndexes:[0]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('significant');expect(result.changes[0]?.kind).toBe('gap_resolved');
});
it('does not notify a bare status flip when semantic comparison cannot confirm the evidence change',async()=>{
 const {s,input}=setup();input.candidate.claims[0]!.status='refuted';input.candidate.claims[0]!.links[0]!.relation='contradicts';s.services.model=async()=>{throw Error('controlled_failure');};
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('returns unknown on any read failure even when the old and new text are identical',async()=>{
 const {s,input}=setup();input.readFailures=[{sourceId:ids.source,errorCode:'controlled_failure'}];
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');expect(s.models).toHaveLength(0);
});
it('uses bounded semantic comparison for a paraphrase and preserves the known fact signature',async()=>{
 const {s,input}=setup();const exact=await compareWatchResult(input,s.services,new AbortController().signal);
 input.candidate.claims[0]!.statement='十月三十日为报名最后一天';input.candidate.answerBlocks[0]!.text='十月三十日为报名最后一天';
 s.services.model=async()=>({value:{kind:'unchanged',equivalent:true,reason:'同一截止日期的改写',changes:[],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unchanged');expect(result.factSignature).toBe(exact.factSignature);
});
it('does not call unknown material unchanged just because the model failed',async()=>{
 const {s,input}=setup();input.candidate.claims[0]!.statement='报名日期待重新核对';s.services.model=async()=>{throw Error('controlled_failure');};
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('rejects invalid candidate references in model-reported significant changes',async()=>{
 const {s,input}=setup();input.candidate.claims[0]!.statement='报名日期变化';s.services.model=async()=>({value:{kind:'significant',reason:'变了',changes:[{kind:'conclusion',description:'日期变化',claimIndexes:[99],evidenceIndexes:[99]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');expect(result.changes).toEqual([]);
});
it('does not call a compound result unchanged when only one target has been covered',async()=>{
 const {s,input}=setup();input.before.payload.scope.claimsToCheck=['截止日期','报名费用'];input.candidate.scope.claimsToCheck=['截止日期','报名费用'];
 input.before.payload.scope.goal='截止日期和报名费用分别是什么';input.candidate.scope.goal=input.before.payload.scope.goal;
 s.services.model=async()=>({value:{kind:'unchanged',equivalent:true,reason:'已有的截止日期相同',changes:[],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true},{goalIndex:1,claimIndexes:[],covered:false}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('does not ignore explicit core unknowns even if the claim wording is identical',async()=>{
 const {s,input}=setup();input.candidate.unknowns=['核心费用目标仍未覆盖'];input.candidate.stopReason='no_useful_direction';
 s.services.model=async()=>({value:{kind:'unchanged',equivalent:true,reason:'日期文字相同',changes:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('includes changed applicability conditions instead of treating matching claims as the whole fact',async()=>{
 const {s,input}=setup();input.candidate.conditions=['仅适用于境外学生'];s.services.model=async()=>({value:{kind:'unknown',reason:'适用人群变化尚待核对',changes:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('cannot accept an unchanged model verdict without complete target coverage references',async()=>{
 const {s,input}=setup();input.before.payload.scope.claimsToCheck=['截止日期','报名费用'];input.candidate.scope.claimsToCheck=['截止日期','报名费用'];input.candidate.claims[0]!.statement='截止时间是十月三十日';
 s.services.model=async()=>({value:{kind:'unchanged',equivalent:true,reason:'只复述日期',changes:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('does not erase a decimal point from the fact signature and miss a price change',async()=>{
 const {s,input}=setup();input.before.payload.scope.goal='报名费用是多少';input.candidate.scope.goal='报名费用是多少';input.before.payload.scope.claimsToCheck=['报名费用'];input.candidate.scope.claimsToCheck=['报名费用'];
 input.before.payload.claims[0]!.statement='报名费为1.5元';input.before.payload.evidence[0]!.excerpt='报名费为1.5元';input.candidate.claims[0]!.statement='报名费为15元';input.candidate.evidence[0]!.excerpt='报名费为15元';
 s.services.model=async()=>({value:{kind:'significant',reason:'价格从1.5元改为15元',changes:[{kind:'conclusion',description:'费用变化',claimIndexes:[0],evidenceIndexes:[0]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('significant');
});
it('verifies the one requested target rather than assuming a single claim must cover it',async()=>{
 const {s,input}=setup();input.before.payload.scope.goal='报名费用是多少';input.candidate.scope.goal='报名费用是多少';input.before.payload.scope.claimsToCheck=['报名费用'];input.candidate.scope.claimsToCheck=['报名费用'];
 s.services.model=async()=>({value:{kind:'unchanged',equivalent:true,reason:'日期没有变化',changes:[],goalChecks:[{goalIndex:0,claimIndexes:[],covered:false}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('does not use the extractive shortcut when candidate evidence adds a condition omitted from its claims',async()=>{
 const {s,input}=setup();input.candidate.evidence[0]!.excerpt='报名截至十月三十日，仅限本科生';s.services.model=async()=>({value:{kind:'unknown',reason:'新条件尚未完整反映在命题中',changes:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
function identitySetup(){const value=setup();for(const payload of [value.input.before.payload,value.input.candidate]){payload.scope.basicMode='identify';payload.scope.objectText='记不清名字的受控活动';payload.scope.goal='确定活动名称';payload.scope.claimsToCheck=['确定对象名称'];payload.scope.knownClues=['科普'];payload.claims=[];payload.answerBlocks=[];payload.evidence[0]!.excerpt='星光活动提供科普。';payload.candidates=[{id:randomUUID(),name:'星光活动',aliases:[],sourceIds:[ids.source],matchedClues:['科普'],conflictingClues:[],missingClues:[],reasonSummary:'有据名称'}];}return value;}
it('compares a pure grounded identity result without requiring an invented factual claim',async()=>{
 const {s,input}=identitySetup();s.services.model=async()=>({value:{kind:'unchanged',equivalent:true,reason:'名称与确定线索保持一致',changes:[],goalChecks:[{goalIndex:0,claimIndexes:[],candidateIndexes:[0],covered:true}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unchanged');
});
it('reports a materially supported identity change with candidate evidence and no fabricated claim IDs',async()=>{
 const {s,input}=identitySetup();input.candidate.candidates[0]!.name='晨曦活动';input.candidate.evidence[0]!.excerpt='原星光活动现已更名为晨曦活动，仍提供科普。';s.services.model=async()=>({value:{kind:'significant',reason:'原对象名称更新',changes:[{kind:'conclusion',description:'名称更改',goalIndexes:[0],claimIndexes:[],candidateIndexes:[0],evidenceIndexes:[0]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('significant');expect(result.changes[0]?.claimIds).toEqual([]);expect(result.changes[0]?.evidenceIds).toEqual([ids.evidence]);
});
it('does not let candidate-only coverage stand in for a separate fee target',async()=>{
 const {s,input}=identitySetup();for(const payload of [input.before.payload,input.candidate])payload.scope.claimsToCheck=['确定对象名称','报名费用'];s.services.model=async()=>({value:{kind:'unchanged',equivalent:true,reason:'错误地把候选当全案答案',changes:[],goalChecks:[{goalIndex:0,claimIndexes:[],candidateIndexes:[0],covered:true},{goalIndex:1,claimIndexes:[],candidateIndexes:[0],covered:true}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('does not accept a candidate name as a significant resolution of a factual fee gap',async()=>{
 const {s,input}=identitySetup();for(const payload of [input.before.payload,input.candidate]){payload.scope.goal='报名费用';payload.scope.claimsToCheck=['报名费用'];payload.stopReason='no_useful_direction';payload.unknowns=['核心费用仍未覆盖'];}
 s.services.model=async()=>({value:{kind:'significant',reason:'费用已解决',changes:[{kind:'gap_resolved',description:'活动免费',goalIndexes:[0],claimIndexes:[],candidateIndexes:[0],evidenceIndexes:[0]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
it('does not report a uniquely determined identity while two equally plausible candidates remain',async()=>{
 const {s,input}=identitySetup();input.candidate.candidates.push({...input.candidate.candidates[0]!,id:randomUUID(),name:'晨曦活动'});input.candidate.evidence[0]!.excerpt='星光活动和晨曦活动都提供科普。';input.candidate.stopReason='no_useful_direction';input.candidate.unknowns=['核心身份仍未确定'];
 s.services.model=async()=>({value:{kind:'significant',reason:'声称已唯一确定',changes:[{kind:'conclusion',description:'唯一星光活动',goalIndexes:[0],claimIndexes:[],candidateIndexes:[0],evidenceIndexes:[0]}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});const result=await compareWatchResult(input,s.services,new AbortController().signal);expect(result.kind).toBe('unknown');
});
