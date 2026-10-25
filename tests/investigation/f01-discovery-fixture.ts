import fixture from './fixtures/f01-confirmation-discovery.json' with {type:'json'};
import {ScopeSchema} from '../../src/shared/contracts.js';
import {WorkingMaterialSchema,type ModelRequest,type ModelResponse} from '../../src/shared/ports.js';
export {fixture};
export const f01Scope=()=>ScopeSchema.parse(fixture.scope);
export const f01Material=()=>WorkingMaterialSchema.parse(structuredClone(fixture.checkpoint));
/** Retrospective first-plan replay: remove only its completed marker from a copy, never unknown/risk. */
export function beforePlan(){const material=f01Material();for(const evidence of material.evidence)evidence.limitations=evidence.limitations.filter(limit=>!limit.startsWith('direction_plan_state:')||JSON.parse(limit.slice('direction_plan_state:'.length)).stage!=='done');return material;}
export const reply=(value:unknown):ModelResponse=>({value:value as ModelResponse['value'],usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
export function scopeGap(request:ModelRequest){return request.messages.map(message=>{try{return JSON.parse(message.content);}catch{return {};}}).find(body=>body.scopeGapQuery)?.scopeGapQuery as {queryIndex:number;queryText:string;objectText:string;goalIndex:number}|undefined;}
export function approvedGap(request:ModelRequest){const item=scopeGap(request);return {queryChecks:item?[{...item,scopeMatches:true,basis:'confirmed_scope',anchors:[],reason:'仅按原用户对象和线索查未解名称，不采用未核候选名'}]:[]};}

/** controlled_fixture derivative: unresolved screens isolate discovery from completed-short-raw recovery. */
export function unresolvedDiscoveryMaterial(material=beforePlan()){
 for(const raw of material.evidence.filter(e=>e.limitations.some(l=>l.startsWith('raw_capture_only'))))raw.limitations=raw.limitations.map(limit=>{if(!limit.startsWith('context_screen_state:'))return limit;const state=JSON.parse(limit.slice('context_screen_state:'.length));if(state.pending)return limit;return 'context_screen_state:'+JSON.stringify({...state,done:[],pending:[0,Math.min(3200,raw.excerpt.length)]});});
 return material;
}
