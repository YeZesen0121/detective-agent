import {expect,it} from 'vitest';
import {routeFollowup} from '../../src/server/investigation/followup.js';
import {scenario,hash} from './controlled.js';
import {samplePayload,ids,at} from '../helpers/result.js';
import {reply} from './f01-discovery-fixture.js';

const question='请继续核对原问题：先根据本案已经保存的正文，判断距离更近是否总意味着温度更高，并逐条保留必要条件；日冕高温机理等扩展问题不作为本题必须回答的新目标。';
function setup(empty=true){const s=scenario(),payload=samplePayload();payload.scope={...payload.scope,objectText:'太阳',goal:'离太阳越近温度越高吗？',claimsToCheck:['距离更近是否总意味着温度更高']};if(empty){payload.claims=[];payload.answerBlocks=[];payload.conflicts=[];}
 const version={id:ids.source,investigationId:payload.investigationId,runId:payload.runId,previousVersionId:null,createdAt:at,payloadHash:hash(JSON.stringify(payload)),payload};return {s,input:{context:s.input.context,version,question,remainingBudget:s.budget()}};}
it('routes new judgement of the original question with no verified claims to research using the explicit empty-index output contract',async()=>{
 const {s,input}=setup();s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content),empty=body.outputContract?.claimIndexes?.maxItems===0;
  return reply(empty?{route:'research_same_scope',scopeMatches:true,objectText:'太阳',claimIndexes:[]}:{route:'explain',scopeMatches:true,objectText:'太阳',claimIndexes:[0]});};
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('research_same_scope');expect(s.models).toHaveLength(1);expect(s.searches).toEqual([]);expect(s.reads).toEqual([]);expect(s.checkpoints).toEqual([]);expect(input.version.payload.scope.claimsToCheck).toEqual(['距离更近是否总意味着温度更高']);
});
it.each([0,999])('still rejects an actually returned absent index %s after exactly one model call',async index=>{
 const {s,input}=setup();s.services.model=async request=>{s.models.push(request);return reply({route:'explain',scopeMatches:true,objectText:'太阳',claimIndexes:[index]});};await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_REFERENCE_OUT_OF_VERSION');expect(s.models).toHaveLength(1);expect(s.searches).toEqual([]);
});
it('exposes only actual existing claim indices and their saved statuses to the route model',async()=>{
 const {s,input}=setup(false);s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content);expect(body.outputContract.claimIndexes.items.enum).toEqual([0]);expect(body.claims[0].status).toBe(input.version.payload.claims[0]!.status);return reply({route:'research_same_scope',scopeMatches:true,objectText:'太阳',claimIndexes:[]});};expect((await routeFollowup(input,s.services,new AbortController().signal)).route).toBe('research_same_scope');expect(s.models).toHaveLength(1);
});
