import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTruthProbe, truthProbeFailureSummary, TRUTH_PROBE_QUESTION, selectProbeSource } from '../../src/server/platform/truth-probe.js';
const folders:string[]=[];
afterEach(()=>{for(const path of folders.splice(0))rmSync(path,{recursive:true,force:true});});
const folder=()=>{const path=mkdtempSync(join(tmpdir(),'controlled-truth-probe-'));folders.push(path);return path;};
function network(options:{deny?:boolean;outside?:boolean;overrun?:boolean}={}) {
 const calls:string[]=[];
 const send:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname;calls.push(path);
  if(options.deny)return Response.json({error:{message:'controlled_fixture_secret'}},{status:401});
  if(path==='/SearchPro')return Response.json({Response:{Pages:[JSON.stringify({url:options.outside?'https://example.invalid/no':'https://nodejs.org/en/about',title:'controlled_fixture official page',passage:'Node.js is open-source.'}),JSON.stringify({url:'https://nodejs.org/en',title:'controlled_fixture second',passage:'second'})]}});
  if(path==='/v1/tools/fetch')return Response.json({title:'controlled_fixture about',content:'Node.js is an open-source, cross-platform JavaScript runtime environment.'});
  const body=JSON.parse(String(init?.body));
  if(body.messages?.some((m:{content:string})=>m.content.includes('输出{canLocate,object:')))return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({canLocate:true,object:{text:'Node.js',inputRef:'question',quote:'Node.js'},clues:[{text:'开源',inputRef:'question',quote:'开源',certainty:'known'}],goals:[{text:'核对原始说法',inputRef:'question',quote:TRUTH_PROBE_QUESTION,kind:'fact'}],resolutions:[]})}}],usage:{prompt_tokens:options.overrun?50000:100,completion_tokens:options.overrun?1800:50}});
  return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims:[{statement:'Node.js 是开源、跨平台的 JavaScript 运行时环境',status:'supported',evidenceIndexes:[0],conditions:['仅依据所列官方页面'],gaps:[],reasonSummary:'官方正文明确说明'}],answerBlocks:[{text:'Node.js 官方页面支持这一说法。',claimIndexes:[0],evidenceIndexes:[0]}]})}}],usage:{prompt_tokens:options.overrun?50000:100,completion_tokens:options.overrun?1800:50}});
 };
 return {calls,config:{credentials:{search:{kind:'bearer' as const,apiKey:'controlled_fixture_key'},deepseekKey:'controlled_fixture_key'},fetch:send,resolve:async()=>['203.0.113.1']}};
}
it('retires real replay of the closed campaign without touching its historical report or sending a request',async()=>{
 const n=network(),directory=folder(),reportPath=join(directory,'report.json');
 const {writeFileSync}=await import('node:fs');writeFileSync(reportPath,'{"historical":"controlled_fixture archived receipt"}\n');
 const before=readFileSync(reportPath,'utf8');
 await expect(runTruthProbe({directory,network:n.config,materialKind:'real_provider'})).rejects.toThrow('CAMPAIGN_CLOSED');
 expect(n.calls).toEqual([]);expect(readFileSync(reportPath,'utf8')).toBe(before);
 expect(truthProbeFailureSummary(Error('CAMPAIGN_CLOSED')).providerAttemptsThisInvocation).toBe(0);
});
it('stops at necessary scope review when the closed probe budget permits only one model call, and refuses replay',async()=>{
 const n=network(),directory=folder();
 const result=await runTruthProbe({directory,network:n.config,materialKind:'controlled_fixture'});
 expect(result.status).toBe('PIPELINE_INCOMPLETE');expect(result.runStatus).toBe('failed');expect(result.stopReason).toBe('model_limit');expect(result.duplicateStartSameRun).toBe(true);expect(result.failureCode).toBeNull();
 expect(n.calls).toEqual(['/chat/completions']);
 expect(result.accounting).toMatchObject({used:{moneyMicros:600,searches:0,reads:0,modelCalls:1},reserved:{moneyMicros:0}});
 expect(result.sourceSelection).toMatchObject({returned:0,selected:null});expect(result.materialKind).toBe('controlled_fixture');expect(result.resultPath).toBeNull();expect(result.resultVersionId).toBeNull();expect(result.limits).toMatchObject({modelCalls:1,moneyMicros:100000});
 await expect(runTruthProbe({directory,network:n.config,materialKind:'controlled_fixture'})).rejects.toThrow('CAMPAIGN_ALREADY_STARTED');expect(n.calls).toHaveLength(1);
});
it('stops after an authentication error and retains its unknown reservation without leaking provider text',async()=>{
 const n=network({deny:true});
 const result=await runTruthProbe({directory:folder(),network:n.config,materialKind:'controlled_fixture'});
 expect(result.status).toBe('PIPELINE_INCOMPLETE');expect(n.calls).toEqual(['/chat/completions']);expect(result.calls[0]).toMatchObject({operation:'model',status:'unknown',actual:null});expect(result.accounting?.reserved.moneyMicros).toBe((result.calls[0]!.estimated as {moneyMicros:number}).moneyMicros);expect(result.accounting!.reserved.moneyMicros).toBeGreaterThan(0);
 expect(JSON.stringify(result)).not.toContain('controlled_fixture_secret');
});
it('does not invent a known URL or use fixture material when search returns no permitted official page',async()=>{
 const n=network({outside:true});
 // Return only a genuine but out-of-scope result in this controlled response.
 const original=n.config.fetch;n.config.fetch=async(url,init)=>{
  const response=await original(url,init);if(new URL(String(url)).pathname!=='/SearchPro')return response;const raw=await response.json();raw.Response.Pages=raw.Response.Pages.slice(0,1);return Response.json(raw);
 };
 const result=await runTruthProbe({directory:folder(),network:n.config,materialKind:'controlled_fixture'});
 expect(selectProbeSource([{url:'https://example.invalid/no'}])).toBeNull();expect(selectProbeSource([{url:'https://nodejs.org/third-party'},{url:'https://nodejs.org/en/about'}])?.url).toBe('https://nodejs.org/en/about');
 expect(result.status).toBe('PIPELINE_INCOMPLETE');expect(result.sourceSelection.selected).toBeNull();expect(n.calls).toEqual(['/chat/completions']);
});
it('reports over-reservation settlement as a budget failure even if the model returned a valid answer',async()=>{
 const n=network({overrun:true});
 const report=await runTruthProbe({directory:folder(),network:n.config,materialKind:'controlled_fixture'});
 expect(report.status).toBe('PIPELINE_INCOMPLETE');expect(report.failureCode).toBe('BUDGET_OVERRUN');expect(n.calls).toEqual(['/chat/completions']);
});
it('does not claim zero sends if final report persistence fails after paid work',async()=>{
 const n=network(),directory=folder();mkdirSync(join(directory,'report.json'));
 try{await runTruthProbe({directory,network:n.config,materialKind:'controlled_fixture'});throw Error('expected persistence error');}
 catch(error){expect(n.calls).toEqual(['/chat/completions']);expect(truthProbeFailureSummary(error).providerAttemptsThisInvocation).toBeNull();}
 expect(truthProbeFailureSummary(Error('CAMPAIGN_ALREADY_STARTED')).providerAttemptsThisInvocation).toBe(0);
});
