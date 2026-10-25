import { createHash, randomUUID } from 'node:crypto';
import type { Evidence, Scope, Source } from '../../shared/contracts.js';
import { EvidenceSchema, SourceSchema } from '../../shared/contracts.js';
import type { ReadResponse, SearchResponse } from '../../shared/ports.js';

export const hashText = (s: string) => createHash('sha256').update(s).digest('hex');
/** Diagnostic/raw captures can guide discovery, never supply answer or alias support. */
export const answerEvidence=(evidence:Evidence)=>!evidence.limitations.some(limit=>/^(?:raw_capture_only|capture_screen_unverified|capture_scope_unrelated|capture_context_risk)/.test(limit));
export function canonicalUrl(value: string) {
  const url = new URL(value); url.hash = '';
  for (const name of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(name)) url.searchParams.delete(name);
  return url.href;
}
/** View offsets always point to UTF-16 offsets in the unchanged captured string. */
export function normalizedView(raw: string): { text: string; offsets: number[] } {
  let text = ''; const offsets: number[] = []; let whitespace = false,inlineTicks=0,indentedLine=false,trailingProseSpace=false;let fence:{char:string;length:number}|null=null;
  const emit=(value:string,offset:number,preserve=false)=>{if(preserve){text+=value;for(let index=0;index<value.length;index++)offsets.push(offset);whitespace=/\s/.test(value);trailingProseSpace=false;return;}const normalized=value.normalize('NFKC');if(/\s/.test(normalized)){if(whitespace||!text)return;text+=' ';offsets.push(offset);whitespace=true;trailingProseSpace=true;}else{text+=normalized;for(let index=0;index<normalized.length;index++)offsets.push(offset);whitespace=false;trailingProseSpace=false;}};
  for (let i=0;i<raw.length;i++) {
    if(i===0||raw[i-1]==='\n')indentedLine=/^(?: {4}|\t)/.test(raw.slice(i));
    const char=raw[i]!;
    if(char==='`'||char==='~'){
      let end=i+1;while(raw[end]===char)end++;const length=end-i;
      const linePrefix=/^ {0,3}$/.test(raw.slice(raw.lastIndexOf('\n',i-1)+1,i));
      if(fence){if(char===fence.char&&length>=fence.length&&linePrefix&&/^[ \t]*(?:\r?\n|$)/.test(raw.slice(end))){fence=null;i=end-1;continue;}for(let at=i;at<end;at++)emit(raw[at]!,at,true);i=end-1;continue;}
      else if(inlineTicks){if(char==='`'&&length===inlineTicks){inlineTicks=0;i=end-1;continue;}for(let at=i;at<end;at++)emit(raw[at]!,at,true);i=end-1;continue;}
      else if(!indentedLine&&length>=3&&linePrefix){fence={char,length};i=end-1;continue;}
      else if(!indentedLine&&char==='`'){inlineTicks=length;i=end-1;continue;}
    }
    // Consume an escape pair once: an escaped backslash cannot escape again.
    if(!fence&&!inlineTicks&&!indentedLine&&char==='\\'&&/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(raw[i+1]??'')){emit(raw[i+1]!,i+1);i++;continue;}
    if(!fence&&!inlineTicks&&!indentedLine&&char==='*')continue;
    emit(char,i,!!fence||!!inlineTicks||indentedLine);
  }
  if (trailingProseSpace&&text.endsWith(' ')) { text = text.slice(0,-1); offsets.pop(); }
  return { text, offsets };
}
export function quoteRange(raw: string, quote: string): { start: number; end: number; normalized: boolean } | null {
  const direct = raw.indexOf(quote); if (quote && direct >= 0) return { start: direct, end: direct+quote.length, normalized: false };
  const view = normalizedView(raw), q = normalizedView(quote).text;
  const at = q ? view.text.indexOf(q) : -1;
  return at >= 0 ? { start: view.offsets[at]!, end: view.offsets[at+q.length-1]!+1, normalized: true } : null;
}
function segments(text: string, scope: Scope) {
  const needles = [...new Set((scope.goal + scope.objectText).match(/[A-Za-z0-9.]{2,}|[\p{Script=Han}]{2}/gu) ?? [])];
  const parts: { text: string; start: number; end: number; score: number; clipped: boolean }[] = [];
  const matches = [...text.matchAll(/\S[\s\S]*?(?=\r?\n\s*\r?\n|$)/g)];
  for (const match of matches) {
    const paragraph = match[0]; const base = match.index!;
    for (let start=0; start<paragraph.length;) {
      let end=Math.min(start+1400,paragraph.length),clipped=false;
      if(end<paragraph.length) {
        // A long HTML paragraph may contain many complete sentences. Keep their
        // capture offsets, rather than treating every such page as truncated.
        const boundary=[...paragraph.slice(start,end).matchAll(/[。！？!?\n]/g)].at(-1);
        if(boundary)end=start+boundary.index!+1;
        else clipped=true;
      }
      const raw = paragraph.slice(start,end); const leading = raw.length-raw.trimStart().length; const value = raw.trim();
      if(value) parts.push({ text:value, start:base+start+leading,end:base+start+leading+value.length,score:needles.filter(n=>value.includes(n)).length+(/仅|只限|例外|不适用|除外|但是|但|不同|另行|否认|更正/.test(value)?100:0),clipped });
      start=end;
    }
  }
  const ranked=parts.sort((a,b)=>b.score-a.score||a.start-b.start);
  const relevant=ranked.filter(part=>part.score>0);
  // Do not fill the model allowance with repeated zero-relevance background
  // merely to reach three excerpts. The original capture remains archived.
  const selected = (parts.length>3&&relevant.length?relevant:ranked).slice(0,3).sort((a,b)=>a.start-b.start);
  return { selected, omitted: parts.length>selected.length,omittedRisk:parts.some(part=>!selected.includes(part)&&/仅|只限|例外|不适用|除外|但是|但|不同|另行|否认|更正/.test(part.text)) };
}
export function capturedMaterial(item: SearchResponse['items'][number], read: ReadResponse, queryId: string, scope: Scope): { source: Source; evidence: Evidence[] } {
  const text = read.text;
  const readStatus = text?.trim()?read.readStatus:item.snippet?.trim()?'snippet_only':'inaccessible';
  const capturedHash = text?.trim() ? hashText(text) : null;
  const source = SourceSchema.parse({ id:read.sourceId,url:item.url,canonicalUrl:canonicalUrl(read.finalUrl),title:item.title,publisher:item.publisher,publishedAt:item.publishedAt,eventAt:null,fetchedAt:read.fetchedAt,readStatus,
    originGroup:capturedHash?'capture:'+capturedHash:null,originReason:capturedHash?'捕获正文相同仅视作共同内容组，不按链接数增加独立证明。':null,queryIds:[queryId],snippet:item.snippet?.trim()||null,contentHash:capturedHash,diagnostic:read.failureCode });
  const usable = text && ['full','partial'].includes(readStatus);
  const selection = usable ? segments(text,scope) : {selected:[],omitted:false,omittedRisk:false};
  const lines = text?.split(/\r?\n/).map(line=>line.trim()).filter(Boolean) ?? [];
  const dated = lines.filter(line=>/\b20\d{2}\b/.test(line));
  const header = (dated.find(line=>line.length<=200&&/通知|公告|报名|活动|届|版本/.test(line)) ?? dated[0] ?? '').slice(0,500);
  const headerYears = [...new Set(header.match(/\b20\d{2}\b/g) ?? [])];
  const evidence = selection.selected.map(segment=>EvidenceSchema.parse({id:randomUUID(),origin:{kind:'source',id:source.id},representation:'verbatim',excerpt:segment.text,locator:{kind:'char_range',value:`${segment.start}:${segment.end}`},capturedAt:read.fetchedAt,contentHash:capturedHash,
    limitations:[...(readStatus==='partial'?['capture_partial：正文截断，可能遗漏适用条件。']:[]),...(segment.clipped?['excerpt_only：此段仅选取捕获中的部分片段。']:[]),...(selection.omitted?['capture_selection_partial：捕获内另有未展示背景段落，需要语义复核选中材料足够回答。']:[]),...(selection.omittedRisk?['capture_context_risk：未能提供全部潜在例外，不能作无条件肯定。']:[]),...(headerYears.length?['capture_header_years:'+headerYears.join(',')]:[])]}));
  if(usable&&text&&!evidence.some(e=>e.excerpt===text)) evidence.push(EvidenceSchema.parse({id:randomUUID(),origin:{kind:'source',id:source.id},representation:'verbatim',excerpt:text,locator:{kind:'char_range',value:`0:${text.length}`},capturedAt:read.fetchedAt,contentHash:capturedHash,limitations:['raw_capture_only：原始捕获存档，不作为额外独立证据，不重复送模型。']}));
  return {source,evidence};
}
