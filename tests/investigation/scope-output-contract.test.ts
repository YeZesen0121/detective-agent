import {expect,it} from 'vitest';
import {prepareInvestigation} from '../../src/server/investigation/index.js';
import {inputCost} from '../../src/server/investigation/prompts.js';
import {scenario} from './controlled.js';
import {reply} from './f01-discovery-fixture.js';
const question='中山大学南校区北门附近有什么火锅店能在22:00去吃';
const clues=[{text:'中山大学南校区北门附近',inputRef:'question',quote:'中山大学南校区北门附近'},{text:'能在22:00去吃',inputRef:'question',quote:'能在22:00去吃'}];
const malformed={canLocate:true,object:{text:question,inputRef:'question',quote:question},clues,goals:[{text:'中山大学南校区北门附近有什么火锅店且能在22:00去吃',inputRef:'question',quote:question,kind:'fact'}],resolutions:[]};
it('sends the actual complete Proposal contract including required certainty and preserves a valid latest original goal for independent review',async()=>{
 const s=scenario();s.services.model=async request=>{s.models.push(request);if(request.schemaId==='investigation.scope.review.v1')return reply({objectSupported:true,allUserGoalsRepresented:true,clueChecks:[0,1].map(clueIndex=>({clueIndex,certainty:'known',reason:'用户明确条件'})),goalChecks:[{goalIndex:0,inScope:true,reason:'地点和22点目标全保留'}],criticalChecks:[]});
  const contract=JSON.parse(request.messages[1]!.content).outputContract,hasContract=contract?.properties?.clues?.items?.required?.includes('certainty');return reply({...malformed,object:{text:'火锅店',inputRef:'question',quote:'火锅店'},clues:hasContract?clues.map(c=>({...c,certainty:'known'})):clues});};
 const result=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode:'latest',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);expect(result.canInvestigate).toBe(true);expect(result.scope?.objectText).toBe('火锅店');expect(result.scope?.goal).toBe(question);expect(result.scope?.knownClues).toEqual(clues.map(c=>c.text));expect(s.models).toHaveLength(2);for(const request of s.models)expect(inputCost(request)).toBeLessThanOrEqual(24000);
 const contract=JSON.parse(s.models[0]!.messages[1]!.content).outputContract;expect(contract.properties.object).toBeDefined();expect(contract.properties.goals).toBeDefined();expect(contract.properties.resolutions).toBeDefined();expect(contract.properties.clues.items.properties.certainty.enum).toEqual(['known','uncertain']);
});
it('still rejects actual missing-certainty output wholesale rather than guessing known or starting a search',async()=>{
 const s=scenario();s.services.model=async request=>{s.models.push(request);return reply(malformed);};const result=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode:'latest',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(result.scope).toBeNull();expect(s.models).toHaveLength(1);expect(s.searches).toEqual([]);expect(result.clarification?.prompt).toMatch(/服务.*格式|格式.*不完整/);expect(result.clarification?.missingFields).toEqual(['groundedScope']);
});
