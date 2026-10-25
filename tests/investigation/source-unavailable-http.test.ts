import {afterEach,expect,it,vi} from 'vitest';
import {buildApp} from '../../src/server/app.js';
import {createTruthRuntime} from '../../src/server/platform/truth-runtime.js';
import {zeroAmounts} from '../../src/server/platform/budget.js';
afterEach(()=>vi.useRealTimers());
it('continues actual transport network failure to the next body through production wrapper/HTTP while the first ledger read remains unknown',async()=>{
 const at='2026-10-25T04:14:00.000Z',origin='http://127.0.0.1:5173',stages:string[]=[],readUrls:string[]=[];vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
 const funds={...zeroAmounts(),activeMs:10000000,searches:200,reads:200,modelCalls:200,inputTokens:1000000,outputTokens:1000000,moneyMicros:100000000};
 const runtime=createTruthRuntime({credentials:{search:{kind:'bearer',apiKey:'controlled_fixture'},deepseekKey:'controlled_fixture'},funding:{global:funds,trial:funds,demo:funds},resolve:async()=>['203.0.113.10'],now:()=>at,fetch:async(url,init)=>{
  const path=new URL(String(url)).pathname,body=JSON.parse(String(init?.body));if(path==='/SearchPro')return Response.json({Response:{Version:'standard',RequestId:'controlled_fixture',Pages:[0,1].map(index=>JSON.stringify({url:`https://example.invalid/notice/${index}`,title:'controlled_fixture 公告',passage:'未核验摘要线索'}))}});
  if(path==='/v1/tools/fetch'){readUrls.push(body.url);if(body.url.endsWith('/0'))throw Error('controlled_fixture_private_network_error');return Response.json({title:'controlled_fixture 公告',content:'公告说明：报名截止2026年10月30日，仅限本科生。'});}
  const stage=stages.at(-1);let value:unknown;
  if(stage==='investigation.scope.grounded.v1')value={canLocate:true,object:{text:'controlled_fixture',inputRef:'question',quote:'controlled_fixture'},clues:[],goals:[{kind:'fact',text:'报名截止日期是什么？',inputRef:'question',quote:'报名截止日期是什么？'}],resolutions:[]};
  else if(stage==='investigation.scope.review.v1')value={objectSupported:true,allUserGoalsRepresented:true,clueChecks:[],goalChecks:[{goalIndex:0,inScope:true,reason:'controlled_fixture 原始目标'}],criticalChecks:[]};
  else if(stage==='investigation.review.v1')value={checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'独立核对后续完整正文'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'日期和限定已核对'}]};
  else {expect(stage).toBe('investigation.evaluate.v2');const index=JSON.parse(body.messages.find((message:{role:string})=>message.role==='user').content).evidence[0].index;value={claims:[{statement:'报名截止2026年10月30日',status:'supported',links:[{evidenceIndex:index,relation:'supports',quote:'报名截止2026年10月30日，仅限本科生。'}],conditions:['仅限本科生'],gaps:[],reasonSummary:'只引用后续正文'}],answerBlocks:[]};}
  return Response.json({id:'controlled_fixture',model:'deepseek-flash',choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50}});
 }});
 const model=runtime.providers.model;runtime.providers.model=async(...args)=>{stages.push(args[0].schemaId);return model(...args);};
 const app=buildApp({databasePath:':memory:',allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:'2026-10-28T00:00:00.000Z',now:()=>at,secureCookies:false,investigationRuntime:runtime});try{
  const login=await app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin},payload:{code:'controlled-trial-code'}}),headers={origin,cookie:String(login.headers['set-cookie']).split(';')[0]!};
  const created=await app.inject({method:'POST',url:'/api/v1/investigations',headers:{...headers,'idempotency-key':'controlled-source-local-create'},payload:{originalQuestion:'controlled_fixture 报名截止日期是什么？',basicMode:'truth',presentationMode:'evidence'}});expect(created.statusCode).toBe(201);const id=created.json().data.id;
  const start=()=>app.inject({method:'POST',url:`/api/v1/investigations/${id}/runs`,headers:{...headers,'idempotency-key':'controlled-source-local-start'},payload:{action:'start',previousRunId:null}}),started=await start();expect(started.statusCode).toBe(202);let terminal:any;
  for(let count=0;count<400;count++){terminal=(await app.inject({url:`/api/v1/runs/${started.json().data.runId}`,headers})).json().data;if(['partial','failed','completed','waiting_for_user'].includes(terminal.run.status))break;await new Promise(resolve=>setTimeout(resolve,5));}
  expect(terminal.run.status,JSON.stringify({terminal,stages,readUrls})).toBe('completed');expect(terminal.remainingBudget.reserved.reads).toBe(1);expect(terminal.remainingBudget.used.reads).toBe(1);expect(readUrls).toEqual(['https://example.invalid/notice/0','https://example.invalid/notice/1']);expect(stages).toEqual(['investigation.scope.grounded.v1','investigation.scope.review.v1','investigation.evaluate.v2','investigation.review.v1']);
  const result=(await app.inject({url:`/api/v1/results/${terminal.run.createdResultVersionId}`,headers})).json().data.version;expect(result.payload.sources[0].diagnostic).toMatch(/^read_attempt_unresolved:/);expect(result.payload.evidence.every((e:any)=>e.origin.id===result.payload.sources[1].id)).toBe(true);expect(result.payload.claims[0].links[0].quote).toBeTruthy();expect(JSON.stringify(result)).not.toContain('controlled_fixture_private_network_error');
  expect((await start()).json().data.runId).toBe(started.json().data.runId);expect(readUrls).toHaveLength(2);expect((await app.inject({url:`/api/v1/results/${result.id}`,headers})).json().data.version).toEqual(result);
 }finally{await app.close();}
});
