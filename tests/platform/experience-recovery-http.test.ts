import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { buildApp } from '../../src/server/app.js';
import { experienceSeed, experienceDraft } from '../helpers/experience.js';
import { ExperienceAudio } from '../../src/server/platform/experience-audio.js';
import { PrivateAssets } from '../../src/server/platform/private-assets.js';
import { listenLoopback } from '../helpers/loopback-http.js';

const clean: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of clean.splice(0)) await fn(); });
const origin = 'http://127.0.0.1:5173';
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'controlled-media-recovery-'));
  const s = experienceSeed(join(root, 'state.db'));
  const assets = new PrivateAssets(s.db, join(root, 'assets'));
  const companion = s.store.createCompanion(s.owner, s.version.id, 'controlled-companion', s.at);
  const job = s.store.claim(s.at)!;
  s.store.finishCompanion(job.id, job.epoch, experienceDraft(s), s.at);
  const ready = s.store.companion(companion.id, s.owner).session;
  const audio = new ExperienceAudio(s.store, assets).create(s.owner, companion.id, 'controlled-audio',
    {segmentId:ready.segments[0]!.id,voiceId:'controlled_voice',speed:0},
    {id:'controlled_voice',providerVersion:'controlled_fixture',splitVersion:'controlled_fixture'},s.at);
  s.store.cancel(audio.id, s.owner, s.at);
  const options = {databasePath:join(root,'state.db'),privateStorageRoot:join(root,'assets'),allowedOrigin:origin,
    trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:s.ends,secureCookies:false};
  const app = buildApp(options);
  clean.push(async () => { await app.close(); s.db.close(); rmSync(root,{recursive:true,force:true}); });
  const cookie = 'detective_session='+s.token;
  const query = (operation:string,key:string,id=s.investigationId,owner=cookie) => app.inject({
    url:`/api/v1/investigations/${id}/media-submission?operation=${operation}`,
    headers:{cookie:owner,'idempotency-key':key}});
  return {...s, app, options, assets, companion:ready, audio, cookie, query};
}
it('recovers lost companion, turn and audio responses by original key without generating or spending',async()=>{
  const s=setup();
  const turn=s.store.createTurn(s.owner,s.companion.id,'controlled-turn','controlled_fixture 问题',s.at);
  const before=s.db.prepare('SELECT count(*) n FROM experience_jobs').get();
  for(const [op,key,expected] of [
    ['companion','controlled-companion',{operation:'companion',companionSessionId:s.companion.id,resultVersionId:s.version.id}],
    ['turn','controlled-turn',{operation:'turn',turnId:turn.id,companionSessionId:s.companion.id,resultVersionId:s.version.id}],
    ['audio','controlled-audio',{operation:'audio',audioJobId:s.audio.id,companionSessionId:s.companion.id,resultVersionId:s.version.id}],
  ] as const){const r=await s.query(op,key);expect(r.statusCode).toBe(200);expect(r.json().data.submission).toEqual(expected);}
  expect((await s.query('audio','controlled-missing')).json().data.submission).toBeNull();
  expect((await s.query('audio','controlled-companion')).json().data.submission).toBeNull();
  expect(s.db.prepare('SELECT count(*) n FROM experience_jobs').get()).toEqual(before);
  expect(s.db.prepare('SELECT count(*) n FROM usage_ledger').get()).toEqual({n:0});
});
it('finds historical companions and paginates every turn state even with generation disabled',async()=>{
  const s=setup(), ids:string[]=[];
  for(let i=0;i<51;i++){
    const turn=s.store.enqueue(s.owner,s.companion,'turn',{question:'controlled_fixture '+i},new Date(Date.parse(s.at)+i*61000).toISOString());
    s.store.cancel(turn.id,s.owner,s.at);ids.push(turn.id);
  }
  const base='/api/v1/companions/'+s.companion.id+'/turns';
  const page=await s.app.inject({url:base,headers:{cookie:s.cookie}});
  expect(page.statusCode).toBe(200);const data=page.json().data;
  expect(data.items).toHaveLength(50);expect(data.items[0]).toMatchObject({turnId:ids[0],question:'controlled_fixture 0',view:{status:'cancelled',reply:null,newRunId:null}});
  const next=await s.app.inject({url:base+'?after='+data.nextAfter,headers:{cookie:s.cookie}});
  expect(next.json().data.items.map((t:any)=>t.turnId)).toEqual(ids.slice(50));expect(next.json().data.nextAfter).toBeNull();
  const found=await s.app.inject({url:'/api/v1/results/'+s.version.id+'/companions',headers:{cookie:s.cookie}});
  expect(found.statusCode).toBe(200);expect(found.json().data.items).toHaveLength(1);
  expect(found.json().data.items[0].session).toMatchObject({id:s.companion.id,resultVersionId:s.version.id});
  expect(found.body+page.body).not.toMatch(/voiceType|storageKey|request_json|body_hash/);
  expect((await s.app.inject({url:base+'?after=-1',headers:{cookie:s.cookie}})).statusCode).toBe(400);
  expect((await s.app.inject({url:base+'?after=1.5',headers:{cookie:s.cookie}})).statusCode).toBe(400);
});
it('authenticates recovery, validates inputs and isolates the owner and case',async()=>{
  const s=setup(),other=await s.app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin},payload:{code:'controlled-trial-code'}});
  const foreign=String(other.headers['set-cookie']).split(';')[0]!;
  expect((await s.query('companion','controlled-companion',s.investigationId,foreign)).statusCode).toBe(404);
  expect((await s.query('companion','controlled-companion',randomUUID())).statusCode).toBe(404);
  expect((await s.query('companion','short')).statusCode).toBe(400);
  expect((await s.query('model','controlled-companion')).statusCode).toBe(400);
  expect((await s.app.inject({url:'/api/v1/results/'+s.version.id+'/companions',headers:{cookie:foreign}})).statusCode).toBe(404);
  expect((await s.app.inject({url:'/api/v1/companions/'+s.companion.id+'/turns',headers:{cookie:foreign}})).statusCode).toBe(404);
  expect((await s.query('companion','controlled-companion',s.investigationId,'')).statusCode).toBe(401);
  const draft=await s.app.inject({method:'POST',url:'/api/v1/investigations',headers:{origin,cookie:s.cookie,'idempotency-key':'controlled-other-case'},payload:{originalQuestion:'controlled_fixture 另一案',basicMode:'truth',presentationMode:'evidence'}});
  expect((await s.query('companion','controlled-companion',draft.json().data.id)).json().data.submission).toBeNull();
});
it('recovers an upload by key including its deleted tombstone, not by equal file content',async()=>{
  const s=setup(),draft=await s.app.inject({method:'POST',url:'/api/v1/investigations',headers:{origin,cookie:s.cookie,'idempotency-key':'controlled-images-case'},payload:{originalQuestion:'controlled_fixture 图片',basicMode:'truth',presentationMode:'evidence'}});
  const id=draft.json().data.id;
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();
  const a=await s.assets.upload(s.owner,id,'controlled-upload-a',bytes,'image/png',s.at);
  const b=await s.assets.upload(s.owner,id,'controlled-upload-b',bytes,'image/png',s.at);
  expect((await s.query('attachment','controlled-upload-a',id)).json().data.submission).toEqual({operation:'attachment',attachmentId:a.id,deleted:false});
  expect((await s.query('attachment','controlled-upload-b',id)).json().data.submission.attachmentId).toBe(b.id);
  s.assets.remove(s.owner,id,a.id,s.at);
  expect((await s.query('attachment','controlled-upload-a',id)).json().data.submission).toEqual({operation:'attachment',attachmentId:a.id,deleted:true});
});
it('recovers persisted identities over real HTTP after reopening with no runtime',async()=>{
  const s=setup();await s.app.close();const app=buildApp(s.options);
  try{
    const address=await listenLoopback(app);
    const response=await fetch(address+`/api/v1/investigations/${s.investigationId}/media-submission?operation=audio`,{headers:{cookie:s.cookie,'idempotency-key':'controlled-audio'}});
    expect(response.status).toBe(200);expect((await response.json()).data.submission.audioJobId).toBe(s.audio.id);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(s.db.prepare('SELECT count(*) n FROM usage_ledger').get()).toEqual({n:0});
  }finally{await app.close();}
});
