import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {scenario} from './controlled.js';
import {runInvestigation} from '../../src/server/investigation/index.js';
import {capturedMaterial} from '../../src/server/investigation/evidence.js';

it('persists attempted source metadata before a throwing read without inventing a capture or evidence',async()=>{
 const s=scenario();let sent=0;s.services.read=async request=>{sent++;const saved=s.checkpoints.at(-1)!;expect(saved.sources).toHaveLength(1);expect(saved.sources[0]?.id).toBe(request.sourceId);expect(saved.sources[0]?.url).toBe(request.url);expect(saved.sources[0]?.fetchedAt).toBeNull();expect(saved.sources[0]?.contentHash).toBeNull();expect(saved.sources[0]?.diagnostic).toContain('拟读取，发送/费用及目标可达性未确认');expect(saved.sources[0]?.readStatus).not.toBe('full');throw Error('controlled_fixture unknown sent request');};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(sent).toBe(1);expect(result.stopReason).toBe('provider_error');expect(result.completion).toBe('partial');expect(result.draft?.sources).toHaveLength(1);expect(result.draft?.sources[0]?.queryIds).toEqual([s.checkpoints.at(-1)!.queries[0]!.id]);expect(result.draft?.evidence).toEqual([]);expect(result.draft?.claims).toEqual([]);expect(s.models).toHaveLength(0);
});
it.each(['abort','deadline'] as const)('does not send a read if the preflight checkpoint triggers %s',async reason=>{
 const s=scenario(),controller=new AbortController();let now='2026-10-25T00:00:00.000Z';s.services.clock.now=()=>now;const save=s.services.checkpoint.save;s.services.checkpoint.save=async(id,epoch,patch)=>{await save(id,epoch,patch);if(patch.sources?.some(source=>source.diagnostic?.includes('拟读取'))){if(reason==='abort')controller.abort();else now=s.input.context.deadlineAt;}};
 const result=await runInvestigation(s.input,s.services,controller.signal);expect(result.stopReason).toBe(reason==='abort'?'cancelled':'time_limit');expect(s.reads).toHaveLength(0);expect(result.draft?.sources).toHaveLength(1);expect(result.draft?.evidence).toEqual([]);expect(s.models).toHaveLength(0);
});
it('replaces a pending source by the successful capture with the same id exactly once',async()=>{
 const s=scenario();const read=s.services.read;let id:string|undefined;s.services.read=async(request,context,signal)=>{id=request.sourceId;expect(s.checkpoints.at(-1)?.sources[0]?.id).toBe(id);return read(request,context,signal);};const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(result.draft?.sources).toHaveLength(1);expect(result.draft?.sources[0]?.id).toBe(id);expect(result.draft?.sources[0]?.readStatus).toBe('full');expect(result.draft?.sources[0]?.fetchedAt).not.toBeNull();expect(result.draft?.sources[0]?.contentHash).not.toBeNull();expect(result.draft?.sources[0]?.diagnostic).toBeNull();expect(result.draft?.evidence.every(e=>e.origin.id===id)).toBe(true);
});
it('does not replay a pending source on resume or when a later explicit direction returns its URL',async()=>{
 const s=scenario();let sent=0;s.services.read=async()=>{sent++;throw Error('controlled_fixture sent unknown');};await runInvestigation(s.input,s.services,new AbortController().signal);s.input.checkpoint=s.checkpoints.at(-1)!;
 await runInvestigation(s.input,s.services,new AbortController().signal);expect(sent).toBe(1);const nextRun=randomUUID();s.input={...s.input,context:{...s.input.context,runId:nextRun},run:{...s.input.run,id:nextRun,previousRunId:s.input.run.id},intent:'followup',followupQuestion:'继续核对这个对象的官方原文',checkpoint:s.checkpoints.at(-1)!};await runInvestigation(s.input,s.services,new AbortController().signal);expect(sent).toBe(1);expect(s.models).toHaveLength(0);
});
function oldCapture(s:ReturnType<typeof scenario>){return capturedMaterial({url:'https://example.invalid/old',title:'旧线索',snippet:'',publisher:null,publishedAt:null,providerScore:null},{sourceId:randomUUID(),finalUrl:'https://example.invalid/old',title:null,text:'2026年受控活动的旧公开材料。',readStatus:'full',fetchedAt:s.services.clock.now(),contentHash:null,failureCode:null,usage:null},randomUUID(),s.input.scope);}
it('does not send a read when no source slot can retain its attempt',async()=>{
 const s=scenario(),cap=oldCapture(s);s.input.checkpoint={sources:Array.from({length:120},(_,index)=>({...cap.source,id:randomUUID(),url:'https://example.invalid/old'+index,canonicalUrl:'https://example.invalid/old'+index})),evidence:[],claims:[],candidates:[],queries:[]};const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('read_limit');expect(s.reads).toHaveLength(0);
});
it('does not send a read when its bounded capture cannot fit the evidence capacity',async()=>{
 const s=scenario(),cap=oldCapture(s);s.input.checkpoint={sources:[cap.source],evidence:Array.from({length:400},(_,index)=>({...cap.evidence[0]!,id:randomUUID(),limitations:index?['raw_capture_only：容量边界受控存档，不参与模型输入。']:[]})),claims:[],candidates:[],queries:[]};s.services.model=async request=>({value:request.schemaId==='investigation.review.v1'?{checks:[],queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[],reason:'原目标缺口'}]}:{claims:[],answerBlocks:[],nextQueries:[{query:'2026年受控活动 新原始通知',purpose:'原目标缺口',goalIndex:0}]},usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('read_limit');expect(s.reads).toHaveLength(0);
});
