import type { InvestigationModule } from '../../src/shared/ports.js';
import { moduleFor } from './runtime-http-fixture.js';
import { serveMedia } from './media-http-fixture.js';

// The route labels below are a controlled_fixture scenario script, never product routing.
export async function serveFollowups(worker:number,{work,companionResearch=false,unclassifiedBudget=false,longMaterial=false,audioAvailable=true,sourceOnly=false,visionReady=false}:{work?:InvestigationModule['runInvestigation'];companionResearch?:boolean;unclassifiedBudget?:boolean;longMaterial?:boolean;audioAvailable?:boolean;sourceOnly?:boolean;visionReady?:boolean}={}){
 const module=moduleFor(work),stats={routes:0,inputs:[] as Parameters<InvestigationModule['runInvestigation']>[0][]};const run=module.runInvestigation;
 module.runInvestigation=async(...args)=>{stats.inputs.push(args[0]);return run(...args);};
 module.routeFollowup=async input=>{stats.routes++;if(unclassifiedBudget)return{route:'needs_budget_confirmation',answer:null,researchPurpose:null,suggestedQuestion:null};if(input.question.includes('new_case'))return{route:'suggest_new_case',answer:null,researchPurpose:null,suggestedQuestion:'controlled_fixture 建议另案核对另一个对象'};
  if(input.question.includes('research'))return{route:'research_same_scope',answer:null,researchPurpose:'controlled_fixture 核对后续材料',suggestedQuestion:null};
  return{route:'explain',answer:{text:'controlled_fixture 只解释这份报告的已有证据。',claimIds:[input.version.payload.claims[0]!.id],evidenceIds:[input.version.payload.evidence[0]!.id]},researchPurpose:null,suggestedQuestion:null};
 };
 const s=await serveMedia(worker,{followupModule:module,companionResearch,longMaterial,audioAvailable,sourceOnly,visionReady});
 return {...s,stats,exhaust(){const row=s.seed.db.prepare('SELECT limits_json,used_json FROM budget_pools WHERE id=?').get(s.seed.windowId) as {limits_json:string;used_json:string};const used=JSON.parse(row.used_json);used.moneyMicros=JSON.parse(row.limits_json).moneyMicros;s.seed.db.prepare('UPDATE budget_pools SET used_json=? WHERE id=?').run(JSON.stringify(used),s.seed.windowId);}};
}
