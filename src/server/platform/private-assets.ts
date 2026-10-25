import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { z } from 'zod';
import { AttachmentSchema, AttachmentSnapshotSchema, IdSchema, InvestigationSchema, type Attachment, type Extraction } from '../../shared/contracts.js';
import { ApiFault } from './errors.js';
import { hashValue } from './snapshots.js';
export const ASSET_LIMITS=Object.freeze({imageBytes:8*1024*1024,caseImageBytes:24*1024*1024,imagePixels:32000000,imageSide:8192,
 sessionBytes:96*1024*1024,totalBytes:512*1024*1024,sessionFiles:256,totalFiles:4096,audioChunkBytes:2*1024*1024});
const missing=()=>new ApiFault(404,'NOT_FOUND','未找到该私有文件。');
const invalid=()=>new ApiFault(400,'VALIDATION_ERROR','图片格式、大小或像素不符合要求。');
export const byteHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type AssetRow={id:string;session_id:string;investigation_id:string;kind:'attachment'|'audio';mime:string;byte_size:number;sha256:string;storage_key:string;expires_at:string|null};
type AttachmentRow={payload_json:string;questions_json:string};
let decoders=0;const decodeWaiters:Array<()=>void>=[];
async function imageSlot(){
 if(decoders>=2){if(decodeWaiters.length>=6)throw new ApiFault(429,'RATE_LIMITED','图片校验繁忙，请稍后重试。');await new Promise<void>(resolve=>decodeWaiters.push(resolve));}
 else decoders++;
 return()=>{const next=decodeWaiters.shift();if(next)next();else decoders--;};
}
function apng(bytes:Buffer){
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
 for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset);if(length>bytes.length-offset-12)return false;const type=bytes.toString('ascii',offset+4,offset+8);if(type==='acTL')return true;if(type==='IEND')return false;offset+=length+12;}return false;
}
export class PrivateAssets {
 readonly root:string;
 private lastCollection=0;
 constructor(private readonly db:Database.Database,root:string){this.root=resolve(root);}
 private path(key:string){
  if(!/^[0-9a-f-]{36}\.bin$/.test(key))throw missing();
  const path=resolve(this.root,key);if(!path.startsWith(this.root+sep))throw missing();return path;
 }
 private investigation(id:string,owner:string){
  const row=this.db.prepare('SELECT payload_json FROM investigations WHERE id=? AND session_id=?').get(id,owner) as {payload_json:string}|undefined;
  if(!row)throw missing();return InvestigationSchema.parse(JSON.parse(row.payload_json));
 }
 private editable(id:string,owner:string){
  const inv=this.investigation(id,owner);
  if(inv.activeRunId||!['draft','clarifying'].includes(inv.status))throw new ApiFault(409,'INVALID_STATE','调查开始后不能修改附件。');return inv;
 }
 private quota(owner:string,size:number){
  this.clearOrphans();const total=this.db.prepare('SELECT COALESCE(SUM(byte_size),0) n,count(*) files FROM private_assets WHERE purged_at IS NULL').get() as {n:number;files:number};
  const own=this.db.prepare('SELECT COALESCE(SUM(byte_size),0) n,count(*) files FROM private_assets WHERE purged_at IS NULL AND session_id=?').get(owner) as {n:number;files:number};
  if(total.n+size>ASSET_LIMITS.totalBytes||own.n+size>ASSET_LIMITS.sessionBytes||total.files>=ASSET_LIMITS.totalFiles||own.files>=ASSET_LIMITS.sessionFiles)throw new ApiFault(429,'RATE_LIMITED','私有文件空间暂时不足。');
 }
 private addAsset(owner:string,investigationId:string,kind:AssetRow['kind'],mime:string,bytes:Buffer,at:string,expiresAt:string|null,id=randomUUID()){
  this.quota(owner,bytes.length);mkdirSync(this.root,{recursive:true});const key=id+'.bin',path=this.path(key);writeFileSync(path,bytes,{flag:'wx',mode:0o600});
  try{this.db.prepare('INSERT INTO private_assets(id,session_id,investigation_id,kind,mime,byte_size,sha256,storage_key,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
   .run(id,owner,investigationId,kind,mime,bytes.length,byteHash(bytes),key,at,expiresAt);}
  catch(error){unlinkSync(path);throw error;}return{id,key,path};
 }
 async upload(owner:string,investigationId:string,key:string,bytes:Buffer,mime:string,at:string):Promise<Attachment>{
  z.string().min(8).max(128).parse(key);this.investigation(investigationId,owner);
  if(bytes.length===0||bytes.length>ASSET_LIMITS.imageBytes||!['image/png','image/jpeg','image/webp'].includes(mime))throw invalid();
  const bodyHash=hashValue({investigationId,mime,sha256:byteHash(bytes)});
  const previous=this.db.prepare('SELECT body_hash,attachment_id FROM attachment_submissions WHERE session_id=? AND key=?').get(owner,key) as {body_hash:string;attachment_id:string}|undefined;
  if(previous){if(previous.body_hash!==bodyHash)throw new ApiFault(409,'IDEMPOTENCY_CONFLICT','该上传标识已用于不同文件。');const saved=this.get(previous.attachment_id,owner);if(!saved)throw missing();return saved;}
  this.editable(investigationId,owner);
  let width:number,height:number;const release=await imageSlot();
  try{
   const image=sharp(bytes,{limitInputPixels:ASSET_LIMITS.imagePixels,failOn:'warning',sequentialRead:true});const meta=await image.metadata();
   const types:Record<string,string>={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'};
   if(!meta.width||!meta.height||types[meta.format??'']!==mime||(meta.pages??1)!==1||apng(bytes)||meta.width>ASSET_LIMITS.imageSide||meta.height>ASSET_LIMITS.imageSide||meta.width*meta.height>ASSET_LIMITS.imagePixels)throw invalid();
   width=meta.width;height=meta.height;await image.resize(1,1,{fit:'inside'}).toBuffer();
  }catch{throw invalid();}finally{release();}
  return this.db.transaction(()=>{
   const raced=this.db.prepare('SELECT body_hash,attachment_id FROM attachment_submissions WHERE session_id=? AND key=?').get(owner,key) as {body_hash:string;attachment_id:string}|undefined;
   if(raced){if(raced.body_hash!==bodyHash)throw new ApiFault(409,'IDEMPOTENCY_CONFLICT','上传标识冲突。');const saved=this.get(raced.attachment_id,owner);if(!saved)throw missing();return saved;}
   const inv=this.editable(investigationId,owner),items=this.list(investigationId,owner);
   if(items.length>=3||items.reduce((sum,a)=>sum+a.byteSize,0)+bytes.length>ASSET_LIMITS.caseImageBytes)throw invalid();
   const id=randomUUID();const asset=this.addAsset(owner,investigationId,'attachment',mime,bytes,at,null,id);
   try{
    const attachment=AttachmentSchema.parse({id,sessionId:owner,investigationId,order:items.length,mime,byteSize:bytes.length,width,height,sha256:byteHash(bytes),storageKey:asset.key,status:'uploaded',extraction:null});
    this.db.prepare('INSERT INTO attachments(id,investigation_id,session_id,sort_order,payload_json) VALUES (?,?,?,?,?)').run(id,investigationId,owner,attachment.order,JSON.stringify(attachment));
    this.db.prepare('INSERT INTO attachment_submissions VALUES (?,?,?,?)').run(owner,key,bodyHash,id);
    this.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify({...inv,attachmentIds:[...inv.attachmentIds,id],updatedAt:at}),inv.id);return attachment;
   }catch(error){unlinkSync(asset.path);throw error;}
  }).immediate();
 }
 private purgeDeleted(id:string,at:string){
  const row=this.db.prepare('SELECT storage_key FROM private_assets WHERE id=? AND deleted_at IS NOT NULL AND purged_at IS NULL').get(id) as {storage_key:string}|undefined;
  if(!row)return;
  try{unlinkSync(this.path(row.storage_key));}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))return;}
  this.db.prepare('UPDATE private_assets SET purged_at=? WHERE id=? AND deleted_at IS NOT NULL').run(at,id);
 }
 retireAudio(id:string,owner:string,at:string){const row=this.db.prepare("SELECT id FROM private_assets WHERE id=? AND session_id=? AND kind='audio'").get(id,owner);if(!row||this.db.prepare('SELECT 1 FROM audio_chunks WHERE asset_id=?').get(id))return;this.db.prepare('UPDATE private_assets SET deleted_at=COALESCE(deleted_at,?) WHERE id=?').run(at,id);}
 private clearOrphans(){if(!existsSync(this.root))return;for(const key of readdirSync(this.root)){if(!/^[0-9a-f-]{36}\.bin$/.test(key)||this.db.prepare('SELECT 1 FROM private_assets WHERE storage_key=?').get(key))continue;try{unlinkSync(this.path(key));}catch{/* orphan remains private; retry on the next collection */}}}
 collectGarbage(at:string,force=false){if(this.db.inTransaction||!force&&Date.parse(at)-this.lastCollection<60000)return;this.lastCollection=Date.parse(at);
  this.clearOrphans();const expired=this.db.prepare("SELECT id,session_id FROM private_assets WHERE kind='audio' AND expires_at<=? AND deleted_at IS NULL").all(at) as {id:string;session_id:string}[];
  this.db.transaction(()=>{for(const item of expired){this.db.prepare("UPDATE experience_jobs SET status='partial',error_code='AUDIO_CACHE_UNAVAILABLE' WHERE status='completed' AND id IN (SELECT job_id FROM audio_chunks WHERE asset_id=?)").run(item.id);this.db.prepare('DELETE FROM audio_chunks WHERE asset_id=?').run(item.id);this.retireAudio(item.id,item.session_id,at);}}).immediate();
  const deleted=this.db.prepare('SELECT id FROM private_assets a WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND NOT EXISTS(SELECT 1 FROM result_attachment_refs r WHERE r.attachment_id=a.id) AND NOT EXISTS(SELECT 1 FROM audio_chunks c WHERE c.asset_id=a.id)').all() as {id:string}[];for(const row of deleted)this.purgeDeleted(row.id,at);
 }
 get(id:string,owner:string){
  IdSchema.parse(id);const row=this.db.prepare('SELECT payload_json,questions_json FROM attachments WHERE id=? AND session_id=? AND deleted_at IS NULL').get(id,owner) as AttachmentRow|undefined;
  return row?AttachmentSchema.parse(JSON.parse(row.payload_json)):null;
 }
 list(investigationId:string,owner:string){this.investigation(investigationId,owner);return(this.db.prepare('SELECT payload_json FROM attachments WHERE investigation_id=? AND session_id=? AND deleted_at IS NULL ORDER BY sort_order').all(investigationId,owner) as AttachmentRow[]).map(row=>AttachmentSchema.parse(JSON.parse(row.payload_json)));}
 readAsset(id:string,owner:string,at=new Date().toISOString()){
  IdSchema.parse(id);const row=this.db.prepare('SELECT * FROM private_assets WHERE id=? AND session_id=? AND deleted_at IS NULL').get(id,owner) as AssetRow|undefined;
  if(!row||row.expires_at&&Date.parse(at)>=Date.parse(row.expires_at))throw missing();
  const path=this.path(row.storage_key);try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==row.byte_size)throw missing();const bytes=readFileSync(path);if(byteHash(bytes)!==row.sha256)throw missing();return{...row,bytes};}catch{throw missing();}
 }
 readAttachment(id:string,owner:string){if(!this.get(id,owner))throw missing();return this.readAsset(id,owner);}
 remove(owner:string,investigationId:string,id:string,at:string){
  this.db.transaction(()=>{
   const inv=this.investigation(investigationId,owner),item=this.get(id,owner);
   if(!item){const old=this.db.prepare('SELECT investigation_id FROM attachments WHERE id=? AND session_id=?').get(id,owner) as {investigation_id:string}|undefined;if(old?.investigation_id===investigationId)return;throw missing();}
   if(item.investigationId!==investigationId)throw missing();this.editable(investigationId,owner);
   if(this.db.prepare('SELECT 1 FROM result_attachment_refs WHERE attachment_id=?').get(id))throw new ApiFault(409,'INVALID_STATE','历史报告引用的附件不能删除。');
   this.db.prepare('UPDATE attachments SET deleted_at=? WHERE id=?').run(at,id);this.db.prepare('UPDATE private_assets SET deleted_at=? WHERE id=?').run(at,id);
   const items=this.list(investigationId,owner);for(const [order,a]of items.entries())this.db.prepare('UPDATE attachments SET sort_order=?,payload_json=? WHERE id=?').run(order,JSON.stringify({...a,order}),a.id);
   this.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify({...inv,attachmentIds:items.map(a=>a.id),updatedAt:at}),inv.id);
  }).immediate();
  this.purgeDeleted(id,at);
 }
 snapshots(investigationId:string,owner:string){return this.list(investigationId,owner).map(a=>AttachmentSnapshotSchema.strip().parse(a));}
 bytesRef(item:Attachment){return 'attachment:'+item.id+':'+item.sha256;}
 resolveImage(ref:{id:string;bytesRef:string;mime:string},owner:string,investigationId:string){
  const item=this.get(ref.id,owner);if(!item||item.investigationId!==investigationId||this.bytesRef(item)!==ref.bytesRef||item.mime!==ref.mime)throw missing();
  return{id:item.id,mime:item.mime,width:item.width,height:item.height,bytes:this.readAttachment(item.id,owner).bytes};
 }
 saveExtraction(id:string,owner:string,extraction:Extraction|null,questions:string[],failed=false){
  const item=this.get(id,owner);if(!item||extraction&&extraction.attachmentId!==id)throw missing();
  const updated=AttachmentSchema.parse({...item,extraction,status:failed?'failed':questions.length?'needs_confirmation':'ready'});
  this.db.prepare('UPDATE attachments SET payload_json=?,questions_json=? WHERE id=?').run(JSON.stringify(updated),JSON.stringify(questions),id);return updated;
 }
 questions(investigationId:string,owner:string){return[...new Set(this.list(investigationId,owner).flatMap(a=>{
  const row=this.db.prepare('SELECT questions_json FROM attachments WHERE id=?').get(a.id) as {questions_json:string};return JSON.parse(row.questions_json) as string[];
 }))];}
 confirm(investigationId:string,owner:string){for(const item of this.list(investigationId,owner))if(item.status==='needs_confirmation')this.saveExtraction(item.id,owner,item.extraction,[]);}
 writeAudio(owner:string,investigationId:string,bytes:Buffer,at:string){
  if(!bytes.length||bytes.length>ASSET_LIMITS.audioChunkBytes||!(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]!&224)===224))throw new ApiFault(400,'VALIDATION_ERROR','音频字节为空、过大或格式不符。');
  return this.addAsset(owner,investigationId,'audio','audio/mpeg',bytes,at,new Date(Date.parse(at)+7*86400000).toISOString()).id;
 }
}
