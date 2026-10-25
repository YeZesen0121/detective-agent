import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildApp, type FoundationOptions } from '../../src/server/app.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { movieAt, movieQuestion, movieFollowup, savedFollowupFixture } from './saved-followup-fixture.js';

const origin='http://127.0.0.1:5173';
const apps:ReturnType<typeof buildApp>[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(movieAt);});
afterEach(async()=>{try{for(const app of apps.splice(0))await app.close();}finally{vi.useRealTimers();}});
async function poll(app:ReturnType<typeof buildApp>,url:string,headers:Record<string,string>,done:(data:any)=>boolean){
 for(let index=0;index<400;index++){const response=await app.inject({url,headers});const data=response.json().data;if(data&&done(data))return data;await new Promise(resolve=>setTimeout(resolve,5));}
 throw Error('controlled_fixture lifecycle did not finish: '+url);
}
it.each(['direct','misclassified','echo_drift'] as const)('closes the original F01 HTTP followup with actual I and immutable baseline: %s',async routeMode=>{
 const fixture=savedFollowupFixture();const funds={...zeroAmounts(),activeMs:10000000,searches:200,reads:200,modelCalls:200,inputTokens:1000000,outputTokens:1000000,moneyMicros:100000000};
 const routeModel=fixture.providers.model;fixture.providers.model=async(request)=>{const result=await routeModel(request);if(routeMode==='misclassified'&&request.schemaId==='investigation.followup.v1')result.value={route:'explain',scopeMatches:true,objectText:'动画电影',claimIndexes:[]};if(routeMode==='echo_drift'&&request.schemaId==='investigation.followup.v1')result.value={route:'research_same_scope',scopeMatches:true,objectText:'动画电影，音乐和灵魂世界',claimIndexes:[]};if(request.schemaId==='investigation.followup.intent.v1')result.value={scopeMatches:true,objectText:'动画电影',intent:'add_or_correct_clues',deltas:[{text:'成年男老师',quote:'主角是成年男老师',change:'add',certainty:'known',previousClue:null},{text:'弹钢琴',quote:'好像弹钢琴',change:'add',certainty:'uncertain',previousClue:null}],requestQuote:null,reason:'原身份目标的新增记忆'};return result;};
 const options:FoundationOptions={databasePath:':memory:',allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:'2026-10-28T00:00:00.000Z',now:()=>movieAt,secureCookies:false,investigationRuntime:{module:fixture.module,supportedBasicModes:['identify'],enableFollowups:true,enableWatches:false,providers:fixture.providers,funding:{global:funds,trial:funds,demo:funds},pricing:{quote:(operation,input)=>({provider:'controlled_fixture',purpose:'purpose' in input?input.purpose:operation,priceRevision:'fixture-v1',estimated:{...zeroAmounts(),moneyMicros:1,...('messages' in input?{modelCalls:1,inputTokens:Buffer.byteLength(JSON.stringify(input.messages),'utf8')+512,outputTokens:input.maxOutputTokens}:operation==='search'?{searches:1}:{reads:1})},timeoutMs:1000,attemptNo:1}),actual:()=>null}}};
 const app=buildApp(options);apps.push(app);
 const login=await app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin},payload:{code:'controlled-trial-code'}});const headers={origin,cookie:String(login.headers['set-cookie']).split(';')[0]!,'idempotency-key':'controlled-f01-draft'};
 const draft=await app.inject({method:'POST',url:'/api/v1/investigations',headers,payload:{originalQuestion:movieQuestion,basicMode:'identify',presentationMode:'evidence'}});expect(draft.statusCode).toBe(201);const investigation=draft.json().data;
 const start=await app.inject({method:'POST',url:`/api/v1/investigations/${investigation.id}/runs`,headers:{...headers,'idempotency-key':'controlled-f01-start'},payload:{action:'start',previousRunId:null}});expect(start.statusCode).toBe(202);
 const first=await poll(app,`/api/v1/runs/${start.json().data.runId}`,headers,data=>['partial','failed','completed','waiting_for_user'].includes(data.run.status));expect(first.run.status,JSON.stringify({first,calls:fixture.calls})).toBe('partial');
 const before=(await app.inject({url:`/api/v1/results/${first.run.createdResultVersionId}`,headers})).json().data.version;expect(before.payload.candidates.map((candidate:any)=>candidate.name)).toEqual(['Soul','Coco']);
 const submit=()=>app.inject({method:'POST',url:`/api/v1/investigations/${investigation.id}/followups`,headers:{...headers,'idempotency-key':'controlled-f01-new-clues'},payload:{resultVersionId:before.id,question:movieFollowup}});
 const submitted=await submit();expect(submitted.statusCode).toBe(202);expect((await submit()).json().data).toEqual(submitted.json().data);
 const turn=await poll(app,`/api/v1/followups/${submitted.json().data.followupTurnId}`,headers,data=>['completed','failed'].includes(data.status));expect(turn.status,JSON.stringify({turn,calls:fixture.calls})).toBe('completed');expect(turn.turn.route).toBe('research_same_scope');
 const next=await poll(app,`/api/v1/runs/${turn.turn.newRunId}`,headers,data=>['partial','failed','completed','waiting_for_user'].includes(data.run.status));
 expect(fixture.preparations[1]?.clarificationAnswer).toBeNull();expect(fixture.preparations[1]?.followup).toEqual({kind:'saved_followup',turnId:turn.id,resultVersionId:before.id,question:movieFollowup});
 expect(fixture.preparedScopes[1]?.scope?.knownClues).toContain('成年男老师');expect(fixture.preparedScopes[1]?.scope?.uncertainClues).toContain('弹钢琴');
 expect(next.run.status,JSON.stringify({runInputs:fixture.runs.length,preparedScope:fixture.preparedScopes[1]?.scope})).toBe('completed');expect(next.run.budgetWindowId).toBe(first.run.budgetWindowId);expect(next.run.scopeVersion).toBeGreaterThan(first.run.scopeVersion);
 const after=(await app.inject({url:`/api/v1/results/${next.run.createdResultVersionId}`,headers})).json().data.version;
 expect(after.payload.scope.knownClues).toContain('成年男老师');expect(after.payload.scope.uncertainClues).toContain('弹钢琴');expect(after.payload.scope.claimsToCheck).toEqual(['确定对象名称']);expect(after.payload.claims).toEqual([]);expect(after.payload.scope.objectText).toBe(before.payload.scope.objectText);expect(after.payload.scope.goal).toBe(movieQuestion);
 expect(after.payload.candidates.find((candidate:any)=>candidate.name==='Coco').conflictingClues).toContain('成年男老师');expect(after.payload.unknowns.join(' ')).not.toMatch(/核心目标未覆盖.*(?:成年|钢琴)/);
 const old=(await app.inject({url:`/api/v1/results/${before.id}`,headers})).json().data.version;expect(JSON.stringify(old)).toBe(JSON.stringify(before));
 expect(fixture.calls.filter(call=>call.promptVersion==='investigation.scope.saved-followup.v3'||call.promptVersion==='investigation.scope.saved-followup-review.v3')).toHaveLength(2);
});
