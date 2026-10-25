import { z } from 'zod';
import { AttachmentPublicSchema, CompanionSessionSchema, IdSchema } from '../../shared/contracts.js';
import * as http from '../../shared/experience-http.js';
import * as recovery from '../../shared/experience-recovery-http.js';
import { ClientError, parseInput, request } from './client.js';

export type Attachment = z.infer<typeof AttachmentPublicSchema>;
export type CompanionView = z.infer<typeof http.CompanionViewSchema>;
export type TurnHistory = z.infer<typeof recovery.CompanionTurnHistoryItemSchema>;
export type MediaOperation = z.infer<typeof recovery.MediaOperationSchema>;
export type MediaSubmission = z.infer<typeof recovery.MediaSubmissionViewSchema>['submission'];
const id = (value: string) => parseInput(IdSchema, value);
const key = (value: string) => parseInput(z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/), value);
const afterQuery = (after: number | null) => after === null ? '' : `?after=${parseInput(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), after)}`;
export function createExperienceApi(transport: typeof fetch) {
  const get = <T>(path: string, schema: z.ZodType<T>, signal: AbortSignal) => request(`/api/v1${path}`, {signal}, schema, transport);
  const write = <T>(path: string, body: unknown, schema: z.ZodType<T>, signal: AbortSignal, token?: string, method = 'POST') =>
    request(`/api/v1${path}`, {method, signal, headers: {'Content-Type':'application/json', ...(token ? {'Idempotency-Key':key(token)} : {})}, body:JSON.stringify(body)}, schema, transport);
  async function raw(path: string, signal: AbortSignal, method = 'GET') {
    let response: Response;
    try { response = await transport(`/api/v1${path}`, {method, signal, credentials:'same-origin',mode:'same-origin',redirect:'error'}); }
    catch { throw new ClientError(signal.aborted ? 'ABORTED' : 'NETWORK_ERROR', signal.aborted ? '已停止本地读取。' : '连接中断，请重试。', null, null, true); }
    if (!response.ok) {
      if (response.status === 416) throw new ClientError('AUDIO_FAILED','音频范围不可读取，请重新读取已保存音频。',null,416);
      await request(`/api/v1${path}`, {signal}, z.unknown(), async()=>response);
    }
    return response;
  }
  return {
    listAttachments: async (caseId:string,signal:AbortSignal) => get(`/investigations/${id(caseId)}/attachments`,http.AttachmentsPageSchema,signal),
    uploadAttachment: (caseId:string,file:File,token:string,signal:AbortSignal) => {
      const path=`/api/v1/investigations/${id(caseId)}/attachments`; const validatedKey=key(token);
      if (!(file instanceof Blob) || file.size === 0 || file.size > 8*1024*1024) throw new ClientError('VALIDATION_ERROR','每张截图需大于 0 且不超过 8 MiB。');
      const body=new FormData();body.append('file',file);
      return request(path,{method:'POST',signal,headers:{'Idempotency-Key':validatedKey},body},AttachmentPublicSchema,transport);
    },
    async deleteAttachment(caseId:string,attachmentId:string,signal:AbortSignal) {
      const response=await raw(`/investigations/${id(caseId)}/attachments/${id(attachmentId)}`,signal,'DELETE');
      if(response.status!==204)throw new ClientError('INVALID_RESPONSE','删除结果尚未确认，请重新读取附件列表。');
    },
    attachmentUrl:(attachmentId:string)=>`/api/v1/attachments/${id(attachmentId)}/content`,
    audioUrl:(assetId:string)=>`/api/v1/audio-assets/${id(assetId)}`,
    async audioBytes(assetId:string,signal:AbortSignal) {
      const response=await raw(`/audio-assets/${id(assetId)}`,signal);
      if(![200,206].includes(response.status)||!response.headers.get('content-type')?.startsWith('audio/mpeg'))throw new ClientError('INVALID_RESPONSE','未读到可播放的音频。');
      try{return await response.blob();}catch{throw new ClientError('NETWORK_ERROR','音频读取中断，文字仍可阅读。',null,null,true);}
    },
    createCompanion:(versionId:string,token:string,signal:AbortSignal)=>write(`/results/${id(versionId)}/companions`,{personaId:'default'},http.CompanionAcceptedSchema,signal,token),
    listCompanions:(versionId:string,after:number|null,signal:AbortSignal)=>get(`/results/${id(versionId)}/companions${afterQuery(after)}`,recovery.CompanionHistoryPageSchema,signal),
    getCompanion:(sessionId:string,signal:AbortSignal)=>get(`/companions/${id(sessionId)}`,http.CompanionViewSchema,signal),
    patchCompanion:(sessionId:string,patch:z.infer<typeof http.CompanionPatchSchema>,signal:AbortSignal)=>write(`/companions/${id(sessionId)}`,parseInput(http.CompanionPatchSchema,patch),CompanionSessionSchema,signal,undefined,'PATCH'),
    ask:(sessionId:string,question:string,token:string,signal:AbortSignal)=>write(`/companions/${id(sessionId)}/turns`,parseInput(http.CompanionQuestionSchema,{question}),http.TurnAcceptedSchema,signal,token),
    getTurn:(sessionId:string,turnId:string,signal:AbortSignal)=>get(`/companions/${id(sessionId)}/turns/${id(turnId)}`,http.TurnViewSchema,signal),
    listTurns:(sessionId:string,after:number|null,signal:AbortSignal)=>get(`/companions/${id(sessionId)}/turns${afterQuery(after)}`,recovery.CompanionTurnHistoryPageSchema,signal),
    budget:(caseId:string,signal:AbortSignal)=>get(`/investigations/${id(caseId)}/interaction-budget`,http.InteractionBudgetViewSchema,signal),
    voices:(signal:AbortSignal)=>get('/voices',http.VoicesSchema,signal),
    requestAudio:(sessionId:string,input:z.infer<typeof http.RequestAudioSchema>,token:string,signal:AbortSignal)=>write(`/companions/${id(sessionId)}/audio`,parseInput(http.RequestAudioSchema,input),http.AudioAcceptedSchema,signal,token),
    getAudio:(jobId:string,signal:AbortSignal)=>get(`/audio-jobs/${id(jobId)}`,http.AudioViewSchema,signal),
    cancelAudio:(jobId:string,signal:AbortSignal)=>write(`/audio-jobs/${id(jobId)}/cancel`,{},http.AudioViewSchema,signal),
    recover:(caseId:string,operation:MediaOperation,token:string,signal:AbortSignal)=>request(`/api/v1/investigations/${id(caseId)}/media-submission?operation=${parseInput(recovery.MediaOperationSchema,operation)}`,{signal,headers:{'Idempotency-Key':key(token)}},recovery.MediaSubmissionViewSchema,transport),
  };
}
export type ExperienceApi = ReturnType<typeof createExperienceApi>;
