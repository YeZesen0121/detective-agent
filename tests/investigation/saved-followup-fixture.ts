import { createHash } from 'node:crypto';
import type { ModelResponse, ModelRequest, InvestigationModule } from '../../src/shared/ports.js';
import { investigationModule } from '../../src/server/investigation/index.js';

// Supplied text and provider responses are controlled_fixture, not a live film investigation.
export const movieQuestion='一部动画电影，有音乐和灵魂世界，我忘了名字。';
export const movieFollowup='主角是成年男老师，好像弹钢琴。';
export const movieAt='2026-10-25T00:00:00.000Z';
const texts=['Soul is an animated film about a middle-school music teacher, an adult man who plays jazz piano, and a world of souls.','Coco is an animated film about a young musician Miguel, his guitar and the Land of the Dead.'];
const reply=(value:ModelResponse['value']):ModelResponse=>({value,usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
export function savedFollowupFixture() {
  const preparations:Parameters<InvestigationModule['prepareInvestigation']>[0][]=[],preparedScopes:Awaited<ReturnType<InvestigationModule['prepareInvestigation']>>[]=[],runs:Parameters<InvestigationModule['runInvestigation']>[0][]=[],calls:{op:string;schemaId?:string;promptVersion?:string}[]=[];
  const module:InvestigationModule={...investigationModule,
    prepareInvestigation:async(input,services,signal)=>{preparations.push(structuredClone(input));const result=await investigationModule.prepareInvestigation(input,services,signal);preparedScopes.push(structuredClone(result));return result;},
    runInvestigation:async(input,services,signal)=>{runs.push(structuredClone(input));return investigationModule.runInvestigation(input,services,signal);},
  };
  const providers={
    search:async()=>{calls.push({op:'search'});return{items:['soul','coco'].map((name,index)=>({url:'https://example.invalid/'+name,title:['Soul','Coco'][index]!,snippet:'',publisher:'controlled_fixture',publishedAt:null,providerScore:null})),providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null};},
    read:async(input:{url:string;sourceId:string})=>{calls.push({op:'read'});const text=texts[input.url.endsWith('soul')?0:1]!;return{sourceId:input.sourceId,finalUrl:input.url,title:null,text,readStatus:'full' as const,fetchedAt:movieAt,contentHash:createHash('sha256').update(text).digest('hex'),failureCode:null,usage:null};},
    model:async(input:ModelRequest)=>{
      calls.push({op:'model',schemaId:input.schemaId,promptVersion:input.promptVersion});
      if(input.purpose==='followup')return reply({route:'research_same_scope',scopeMatches:true,objectText:'动画电影'});
      if(input.promptVersion==='investigation.scope.saved-followup.v3')return reply({scopeMatches:true,clues:[{text:'成年男老师',inputRef:'saved_followup',quote:'主角是成年男老师',certainty:'known'},{text:'弹钢琴',inputRef:'saved_followup',quote:'弹钢琴',certainty:'known'}],clueUpdates:[],reason:'同一识别目标的真实补充'});
      if(input.promptVersion==='investigation.scope.saved-followup-review.v3')return reply({scopeMatches:true,clueChecks:[{clueIndex:0,grounded:true,certainty:'known',reason:'明确陈述成年教师'},{clueIndex:1,grounded:true,certainty:'uncertain',reason:'好像弹钢琴'}],clueUpdateChecks:[],reason:'原对象和目标未变'});
      if(input.schemaId==='investigation.scope.review.v1')return reply({objectSupported:true,allUserGoalsRepresented:true,clueChecks:[0,1,2].map(clueIndex=>({clueIndex,certainty:'known',reason:'原始线索'})),goalChecks:[{goalIndex:0,inScope:true,reason:'识别名称'}],criticalChecks:[]});
      if(input.purpose==='scope')return reply({canLocate:true,object:{text:'动画电影',inputRef:'question',quote:'一部动画电影'},clues:['动画电影','音乐','灵魂世界'].map(text=>({text,inputRef:'question',quote:text,certainty:'known'})),goals:[{kind:'identity',text:'确定电影名称',inputRef:'question',quote:'我忘了名字'}],resolutions:[]});
      if(input.schemaId==='investigation.review.v1'){
        const body=JSON.parse(input.messages[1]!.content) as {scope:{knownClues:string[];uncertainClues:string[]};evidence:{index:number;view?:string;rawExcerpt?:string}[]};const originalIndex=(index:number)=>body.evidence.find(e=>(e.rawExcerpt??e.view??'').includes(index===0?'Soul is':'Coco is'))?.index??index;
        return reply({checks:[],candidateChecks:[0,1].map(index=>({candidateIndex:index,grounded:true,identityGoalIndexes:[0],reason:'逐原语引句核对',clueChecks:[...body.scope.knownClues.map((clue,clueIndex)=>({clueIndex,clueKind:'known',clueText:clue,relation:clue==='成年男老师'&&index===1?'conflicts':'matches',evidenceIndex:originalIndex(index),quote:clue==='动画电影'?'animated film':clue==='音乐'?(index===0?'music teacher':'young musician'):clue==='灵魂世界'?(index===0?'world of souls':'Land of the Dead'):(index===0?'middle-school music teacher, an adult man':'young musician Miguel'),reason:'所引用原文的角色与线索对应'})),...body.scope.uncertainClues.map((_clue,clueIndex)=>({clueIndex,clueKind:'uncertain',clueText:_clue,relation:index===0?'matches':'unknown',evidenceIndex:originalIndex(index),quote:index===0?'plays jazz piano':'his guitar',reason:'不确定记忆不硬排除'}))]}))});
      }
      const delivered=JSON.parse(input.messages[1]!.content).evidence as {index:number;view?:string;rawExcerpt?:string}[];
      return reply({claims:[],answerBlocks:[],candidates:[{name:'Soul',evidenceIndexes:[delivered.find(e=>(e.rawExcerpt??e.view??'').includes('Soul is'))?.index??0],matchedClues:[],conflictingClues:[],missingClues:[],reasonSummary:'受控英文来源'},{name:'Coco',evidenceIndexes:[delivered.find(e=>(e.rawExcerpt??e.view??'').includes('Coco is'))?.index??1],matchedClues:[],conflictingClues:[],missingClues:[],reasonSummary:'另一受控来源'}]});
    },
  };
  return{module,providers,preparations,preparedScopes,runs,calls};
}
