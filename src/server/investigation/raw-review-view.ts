import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {EvidenceSchema,type Evidence} from '../../shared/contracts.js';
import type {InvestigationInput,WorkingMaterial} from '../../shared/ports.js';
import {hashText} from './evidence.js';
import {atomicGoals} from './goals.js';

const prefix='screened_raw_view:';
const unverified='capture_screen_unverified: 完整复核视图的当前范围筛查proof未通过，不作为回答依据。';
export const isRawReviewView=(e:Evidence)=>e.limitations.some(l=>l.startsWith(prefix));
export const screenBaseExcerpts=(material:WorkingMaterial,sourceId:string)=>material.evidence.filter(e=>e.origin.id===sourceId&&!e.limitations.some(l=>l.startsWith('raw_capture_only'))&&!isRawReviewView(e));
export const screenRevision=(input:InvestigationInput,raw:Evidence,excerpts:Evidence[])=>hashText(JSON.stringify({capture:raw.contentHash,scope:input.scope,goals:atomicGoals(input.scope),excerpts:excerpts.map(e=>e.excerpt)}));
// A complete view resolves selection omissions only, never capture age, authenticity or scope limitations.
const retainedLimitations=(material:WorkingMaterial,raw:Evidence)=>[...new Set([raw,...screenBaseExcerpts(material,raw.origin.id)].flatMap(e=>e.limitations).filter(l=>! /^(?:raw_capture_only|capture_selection_partial|excerpt_only|capture_context_risk|capture_screen_unverified|context_screen_state:|direction_plan_state:|reading_selection_state:|screened_raw_view:)/.test(l)))];
function qualified(input:InvestigationInput,material:WorkingMaterial,raw:Evidence){
 const source=material.sources.find(s=>s.id===raw.origin.id),excerpts=screenBaseExcerpts(material,raw.origin.id);
 if(source?.readStatus!=='full'||raw.excerpt.length>6000||source.contentHash!==raw.contentHash||hashText(raw.excerpt)!==raw.contentHash||raw.locator.kind!=='char_range'||raw.locator.value!==`0:${raw.excerpt.length}`||!excerpts.some(e=>e.limitations.some(l=>l.startsWith('capture_selection_partial'))))return null;
 const marker=raw.limitations.find(l=>l.startsWith('context_screen_state:'));if(!marker)return null;
 const ranges=z.array(z.tuple([z.number().int().nonnegative(),z.number().int().positive()])).max(128);
 let state;try{state=z.object({revision:z.string(),done:ranges,irrelevant:ranges.default([]),pending:z.tuple([z.number().int().nonnegative(),z.number().int().positive()]).nullable()}).parse(JSON.parse(marker.slice('context_screen_state:'.length)));}catch{return null;}
 const revision=screenRevision(input,raw,excerpts);if(state.revision!==revision||state.pending||state.irrelevant.length||!state.done.length)return null;
 let covered=0;for(const [start,end] of [...state.done].sort((a,b)=>a[0]-b[0])){if(start>covered||end<=start||end>raw.excerpt.length)return null;covered=Math.max(covered,end);}if(covered!==raw.excerpt.length)return null;
 return revision;
}
/** Validate old views before any early finish; append only after old risky claims/candidates are invalidated. */
export function refreshRawReviewViews(input:InvestigationInput,material:WorkingMaterial,append=false){
 const rawCaptures=material.evidence.filter(e=>e.limitations.some(l=>l.startsWith('raw_capture_only')));
 const proofs=new Map(rawCaptures.map(raw=>[raw.id,qualified(input,material,raw)]));
 for(const view of material.evidence.filter(isRawReviewView)){
  let proof;try{proof=z.strictObject({rawId:z.uuid(),revision:z.string()}).parse(JSON.parse(view.limitations.find(l=>l.startsWith(prefix))!.slice(prefix.length)));}catch{/* malformed views remain quarantined */}
  const raw=proof?rawCaptures.find(e=>e.id===proof.rawId):undefined;
  const valid=raw&&proof&&proofs.get(raw.id)===proof.revision&&view.origin.id===raw.origin.id&&view.contentHash===raw.contentHash&&view.excerpt===raw.excerpt&&view.locator.kind===raw.locator.kind&&view.locator.value===raw.locator.value&&retainedLimitations(material,raw).every(l=>view.limitations.includes(l));
  if(valid)view.limitations=view.limitations.filter(l=>!l.startsWith('capture_screen_unverified'));
  else if(!view.limitations.some(l=>l.startsWith('capture_screen_unverified'))){if(view.limitations.length>=20)throw Error('RAW_REVIEW_LIMITATIONS_FULL');view.limitations.push(unverified);}
 }
 if(!append)return;
 for(const raw of rawCaptures){
  const revision=proofs.get(raw.id);if(!revision)continue;
  const marker=prefix+JSON.stringify({rawId:raw.id,revision});
  const retained=retainedLimitations(material,raw);if(retained.length>=20)continue;
  if(material.evidence.some(e=>e.limitations.includes(marker)&&retained.every(l=>e.limitations.includes(l))))continue;
  if(material.evidence.length>=400)continue;
  material.evidence.push(EvidenceSchema.parse({...raw,id:randomUUID(),limitations:[marker,...retained]}));
 }
}
