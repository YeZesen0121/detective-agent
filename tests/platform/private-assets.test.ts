import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../src/server/platform/database.js';
import { FoundationStore } from '../../src/server/platform/repository.js';
import { PrivateAssets } from '../../src/server/platform/private-assets.js';
const fixtures:Array<()=>void>=[];
afterEach(()=>{for(const close of fixtures.splice(0))close();});
function setup(){
 const root=mkdtempSync(join(tmpdir(),'controlled-private-assets-')),db=openDatabase(':memory:');
 const f=new FoundationStore(db),at=new Date().toISOString(),end=new Date(Date.now()+86400000).toISOString();
 const a=f.createSession('a'.repeat(64),'trial',at,end),b=f.createSession('b'.repeat(64),'trial',at,end);
 const inv=f.createDraft(a.id,'controlled-draft',{originalQuestion:'controlled_fixture 图片',basicMode:'truth',presentationMode:'evidence'},at,end);
 const assets=new PrivateAssets(db,root);fixtures.push(()=>{db.close();rmSync(root,{recursive:true,force:true});});return{db,assets,inv,a,b,at};
}
async function png(width=2,height=2,color='#112233'){
 const {default:sharp}=await import('sharp');return sharp({create:{width,height,channels:3,background:color}}).png().toBuffer();
}
it('stores real decoded original bytes, protects ownership and returns the original idempotent attachment',async()=>{
 const s=setup(),bytes=await png();const first=await s.assets.upload(s.a.id,s.inv.id,'controlled-upload',bytes,'image/png',s.at);
 expect(first).toMatchObject({mime:'image/png',width:2,height:2,order:0,status:'uploaded'});
 expect((await s.assets.upload(s.a.id,s.inv.id,'controlled-upload',bytes,'image/png',s.at)).id).toBe(first.id);
 expect(s.assets.readAttachment(first.id,s.a.id).bytes).toEqual(bytes);
 expect(()=>s.assets.readAttachment(first.id,s.b.id)).toThrow();
 await expect(s.assets.upload(s.a.id,s.inv.id,'controlled-upload',await png(2,2,'#223344'),'image/png',s.at)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
});
it('rejects a forged format, corrupt image, oversize capture and excessive decoded dimension',async()=>{
 const s=setup();
 await expect(s.assets.upload(s.a.id,s.inv.id,'controlled-type',await png(),'image/jpeg',s.at)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
 await expect(s.assets.upload(s.a.id,s.inv.id,'controlled-corrupt',Buffer.from('not a png'),'image/png',s.at)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
 await expect(s.assets.upload(s.a.id,s.inv.id,'controlled-large',Buffer.alloc(8*1024*1024+1),'image/png',s.at)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
 await expect(s.assets.upload(s.a.id,s.inv.id,'controlled-width',await png(8193,1),'image/png',s.at)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
it('enforces three attachments under concurrent uploads and keeps deletion idempotent',async()=>{
 const s=setup(),bytes=await png();
 const outcomes=await Promise.allSettled(Array.from({length:4},(_,i)=>s.assets.upload(s.a.id,s.inv.id,'controlled-upload-'+i,bytes,'image/png',s.at)));
 expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(3);
 const first=s.assets.list(s.inv.id,s.a.id)[0]!;s.assets.remove(s.a.id,s.inv.id,first.id,s.at);s.assets.remove(s.a.id,s.inv.id,first.id,s.at);
 expect(()=>s.assets.readAttachment(first.id,s.a.id)).toThrow();expect(s.assets.list(s.inv.id,s.a.id).map(a=>a.order)).toEqual([0,1]);
 expect(()=>s.assets.remove(s.b.id,s.inv.id,randomUUID(),s.at)).toThrow();
});
it('removes unreferenced physical files rather than only clearing the live quota',async()=>{
 const s=setup(),bytes=await png(),a=await s.assets.upload(s.a.id,s.inv.id,'controlled-delete',bytes,'image/png',s.at);
 s.assets.remove(s.a.id,s.inv.id,a.id,s.at);expect(readdirSync(s.assets.root).filter(n=>n.endsWith('.bin'))).toHaveLength(0);
});
it('replays a successful upload after the case becomes immutable without allowing a new upload',async()=>{
 const s=setup(),bytes=await png(),kept=await s.assets.upload(s.a.id,s.inv.id,'controlled-kept',bytes,'image/png',s.at);
 const inv=JSON.parse((s.db.prepare('SELECT payload_json FROM investigations WHERE id=?').get(s.inv.id) as {payload_json:string}).payload_json);
 s.db.prepare('UPDATE investigations SET payload_json=? WHERE id=?').run(JSON.stringify({...inv,status:'completed'}),s.inv.id);
 expect((await s.assets.upload(s.a.id,s.inv.id,'controlled-kept',bytes,'image/png',s.at)).id).toBe(kept.id);
 await expect(s.assets.upload(s.a.id,s.inv.id,'controlled-new-after',bytes,'image/png',s.at)).rejects.toMatchObject({code:'INVALID_STATE'});
});
it('rejects a real two-frame APNG even when decoder metadata does not report pages',async()=>{
 const s=setup();const animated=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAAEACgAAWn8w0AAAAA1JREFUeJxj+M/A8B8ABQAB/4mZPR0AAAAaZmNUTAAAAAEAAAABAAAAAQAAAAAAAAAAAAEACgAAwQzaBAAAABFmZEFUAAAAAnicY2D4z/AfAAQBAf9i5+mcAAAAAElFTkSuQmCC','base64');
 await expect(s.assets.upload(s.a.id,s.inv.id,'controlled-apng',animated,'image/png',s.at)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
});
