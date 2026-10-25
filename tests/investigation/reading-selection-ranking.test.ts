import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {selectReadingLeads} from '../../src/server/investigation/reading-selection.js';
import {scenario} from './controlled.js';
import {unresolvedDiscoveryMaterial,reply} from './f01-discovery-fixture.js';
const query={query:'controlled_fixture 原范围',purpose:'原目标',site:null,freshness:null,claimIds:[],limit:3};
function setup(selectedIndexes:number[]){const s=scenario(),material=unresolvedDiscoveryMaterial(),items=Array.from({length:10},(_,index)=>({url:`https://example.invalid/ranked-${index}`,title:'controlled_fixture '+index,snippet:'未核验metadata',publisher:null,publishedAt:null,providerScore:null}));s.services.model=async request=>{s.models.push(request);return reply({selectedIndexes});};return {...s,material,items};}
it('validates the real five-item ranking then returns only the original first three with done/no replay intact',async()=>{
 const s=setup([0,3,7,8,6]),queryId=randomUUID(),result=await selectReadingLeads(s.input,s.material,s.services,new AbortController().signal,async()=>{},query,queryId,s.items);expect(result.stop).toBeNull();expect(result.items.map(item=>item.url)).toEqual(['https://example.invalid/ranked-0','https://example.invalid/ranked-3','https://example.invalid/ranked-7']);
 const contract=JSON.parse(s.models[0]!.messages[1]!.content).outputContract;expect(contract).toMatchObject({type:'object',additionalProperties:false,required:['selectedIndexes'],properties:{selectedIndexes:{type:'array',maxItems:3,uniqueItems:true,items:{type:'integer',minimum:0,maximum:9}}}});
 const repeat=await selectReadingLeads(s.input,s.material,s.services,new AbortController().signal,async()=>{},query,queryId,s.items);expect(repeat.stop).toBe('no_useful_direction');expect(s.models).toHaveLength(1);expect(s.reads).toEqual([]);
});
it.each([[0,3,7,8,99],[0,3,7,8,3],[0,3,7,8,-1]].map(indices=>({indices})))('rejects an invalid or duplicate suffix before any trim: $indices',async({indices})=>{
 const s=setup(indices),result=await selectReadingLeads(s.input,s.material,s.services,new AbortController().signal,async()=>{},query,randomUUID(),s.items);expect(result.stop).toBe('invalid_output');expect(result.items).toEqual([]);expect(s.reads).toEqual([]);
});
it('rejects a duplicate URL outside the first execution slice rather than hiding it by trimming',async()=>{
 const s=setup([0,3,7,8,6]);s.items[8]!.url=s.items[7]!.url;const result=await selectReadingLeads(s.input,s.material,s.services,new AbortController().signal,async()=>{},query,randomUUID(),s.items);expect(result.stop).toBe('invalid_output');expect(result.items).toEqual([]);
});
it('honors a smaller requested execution limit even when every ranked index is valid',async()=>{
 const s=setup([0,3,7,8,6]),result=await selectReadingLeads(s.input,s.material,s.services,new AbortController().signal,async()=>{},{...query,limit:1},randomUUID(),s.items);expect(result.items.map(item=>item.url)).toEqual(['https://example.invalid/ranked-0']);expect(JSON.parse(s.models[0]!.messages[1]!.content).outputContract.properties.selectedIndexes.maxItems).toBe(1);
});
