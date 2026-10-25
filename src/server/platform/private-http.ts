import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AttachmentPublicSchema, IdSchema } from '../../shared/contracts.js';
import { AttachmentsPageSchema } from '../../shared/experience-http.js';
import { ApiFault } from './errors.js';
import { ASSET_LIMITS, type PrivateAssets } from './private-assets.js';
export type HttpDependencies={requireSession(request:FastifyRequest):{id:string};envelope<T>(request:FastifyRequest,data:T):unknown;now():string};
export function sendPrivateBinary(reply:FastifyReply,asset:{bytes:Buffer;mime:string;sha256:string},range?:string,ifRange?:string){
 const etag='"'+asset.sha256+'"',size=asset.bytes.length;
 reply.header('Cache-Control','private, no-store').header('ETag',etag).header('Content-Type',asset.mime).header('X-Content-Type-Options','nosniff');
 if(asset.mime==='audio/mpeg')reply.header('Accept-Ranges','bytes');
 if(range&&(!ifRange||ifRange===etag)){
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  let start=0,end=size-1;
  if(!match||!match[1]&&!match[2])return reply.code(416).header('Content-Range','bytes */'+size).send();
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return reply.code(416).header('Content-Range','bytes */'+size).send();start=Math.max(0,size-suffix);}
  else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)return reply.code(416).header('Content-Range','bytes */'+size).send();
  return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${size}`).header('Content-Length',end-start+1).send(asset.bytes.subarray(start,end+1));
 }
 return reply.header('Content-Length',size).send(asset.bytes);
}
export function registerAttachmentRoutes(app:FastifyInstance,assets:PrivateAssets,deps:HttpDependencies){
 const {requireSession,envelope,now}=deps;
 const publicAttachment=(value:unknown)=>AttachmentPublicSchema.strip().parse(value);
 const params=(request:FastifyRequest)=>z.strictObject({id:IdSchema}).parse(request.params);
 app.post('/api/v1/investigations/:id/attachments',{bodyLimit:ASSET_LIMITS.imageBytes+65536},async(request,reply)=>{
  const owner=requireSession(request).id,{id}=params(request);assets.list(id,owner);
  const key=z.string().min(8).max(128).parse(request.headers['idempotency-key']);
  let file:{bytes:Buffer;mime:string}|null=null;
  for await(const part of request.parts({limits:{files:1,fields:0,parts:1,fileSize:ASSET_LIMITS.imageBytes}})){
   if(part.type!=='file'||part.fieldname!=='file')throw new ApiFault(400,'VALIDATION_ERROR','请上传一张图片。');
   file={bytes:await part.toBuffer(),mime:part.mimetype};
  }
  if(!file)throw new ApiFault(400,'VALIDATION_ERROR','没有收到图片。');
  const attachment=await assets.upload(owner,id,key,file.bytes,file.mime,now());return reply.code(201).send(envelope(request,publicAttachment(attachment)));
 });
 app.get('/api/v1/investigations/:id/attachments',async request=>envelope(request,AttachmentsPageSchema.parse({items:assets.list(params(request).id,requireSession(request).id).map(publicAttachment)})));
 app.delete('/api/v1/investigations/:id/attachments/:attachmentId',async(request,reply)=>{
  const owner=requireSession(request).id,p=z.strictObject({id:IdSchema,attachmentId:IdSchema}).parse(request.params);assets.remove(owner,p.id,p.attachmentId,now());return reply.code(204).send();
 });
 app.get('/api/v1/attachments/:id/content',async(request,reply)=>sendPrivateBinary(reply,assets.readAttachment(params(request).id,requireSession(request).id)));
}
