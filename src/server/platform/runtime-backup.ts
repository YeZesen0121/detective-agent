import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {chmodSync,constants,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,relative,resolve,isAbsolute} from 'node:path';
import Database from 'better-sqlite3';
import {z} from 'zod';
import {acquireRuntimeLock} from './runtime-lock.js';

const assetSchema=z.strictObject({storageKey:z.string().regex(/^[0-9a-f-]{36}\.bin$/),byteSize:z.number().int().positive().max(8*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const fingerprintSchema=z.strictObject({byteSize:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const manifestSchema=z.strictObject({formatVersion:z.literal(1),createdAt:z.iso.datetime(),schemaVersion:z.number().int().nonnegative(),database:fingerprintSchema,assets:z.array(assetSchema).max(4096)}).refine(value=>new Set(value.assets.map(asset=>asset.storageKey)).size===value.assets.length);
type Manifest=z.infer<typeof manifestSchema>;
const fail=(code:string):never=>{throw Error(code);};
const inside=(parent:string,child:string)=>{const path=relative(parent,child);return !path||!path.startsWith('..')&&!isAbsolute(path);};
function file(path:string){const value=lstatSync(path);if(!value.isFile()||value.isSymbolicLink())fail('UNSAFE_STORAGE_FILE');return value;}
function directory(path:string){const value=lstatSync(path);if(!value.isDirectory()||value.isSymbolicLink())fail('UNSAFE_STORAGE_DIRECTORY');}
async function fingerprint(path:string){file(path);const hash=createHash('sha256');let byteSize=0;for await(const chunk of createReadStream(path)){hash.update(chunk);byteSize+=chunk.length;}return{byteSize,sha256:hash.digest('hex')};}
function assets(db:Database.Database){return z.array(assetSchema).max(4096).parse(db.prepare('SELECT storage_key AS storageKey,byte_size AS byteSize,sha256 FROM private_assets WHERE purged_at IS NULL ORDER BY storage_key').all());}
function checkDatabase(db:Database.Database){if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)fail('DATABASE_INTEGRITY_FAILED');}
function paths(destination:string){const result=resolve(destination);return{directory:result,databasePath:join(result,'runtime.db'),assetsRoot:join(result,'private-assets')};}
function newDirectory(path:string){if(existsSync(path))fail('STORAGE_TARGET_EXISTS');mkdirSync(path,{mode:0o700});}
async function copyAsset(source:string,target:string,expected:z.infer<typeof assetSchema>){file(source);copyFileSync(source,target,constants.COPYFILE_EXCL);const actual=await fingerprint(target);if(actual.byteSize!==expected.byteSize||actual.sha256!==expected.sha256)fail('ASSET_HASH_MISMATCH');chmodSync(target,0o600);}

/** Offline, OS-locked backup. Never copies credentials or relies on copying only a WAL .db. */
export async function backupRuntime(input:{databasePath:string;assetsRoot:string;destination:string}){
 const source=resolve(z.string().trim().min(1).parse(input.databasePath)),root=resolve(z.string().trim().min(1).parse(input.assetsRoot));
 const target=paths(z.string().trim().min(1).parse(input.destination));file(source);
 if(source===target.databasePath||inside(root,target.directory)||inside(target.directory,root))fail('STORAGE_PATH_OVERLAP');
 const release=acquireRuntimeLock(source);
 try{
  newDirectory(target.directory);mkdirSync(target.assetsRoot,{mode:0o700});
  const db=new Database(source,{readonly:true,fileMustExist:true});try{await db.backup(target.databasePath);}finally{db.close();}
  const snapshot=new Database(target.databasePath,{fileMustExist:true});let rows:z.infer<typeof assetSchema>[],schemaVersion:number;
  try{snapshot.pragma('journal_mode=DELETE');checkDatabase(snapshot);schemaVersion=Number(snapshot.pragma('user_version',{simple:true}));rows=assets(snapshot);}finally{snapshot.close();}
  if(rows.length)directory(root);
  for(const row of rows)await copyAsset(join(root,row.storageKey),join(target.assetsRoot,row.storageKey),row);
  chmodSync(target.databasePath,0o600);
  const manifest=manifestSchema.parse({formatVersion:1,createdAt:new Date().toISOString(),schemaVersion,database:await fingerprint(target.databasePath),assets:rows});
  writeFileSync(join(target.directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return{...target,manifest};
 }finally{release();}
}

/** Validates every stored byte and its DB relationship, without starting a paid runtime. */
export async function verifyRuntimeBackup(backupDirectory:string){
 const source=paths(z.string().trim().min(1).parse(backupDirectory));directory(source.directory);directory(source.assetsRoot);
 const manifestPath=join(source.directory,'manifest.json');if(file(manifestPath).size>1024*1024)fail('BACKUP_MANIFEST_TOO_LARGE');
 const manifest=manifestSchema.parse(JSON.parse(readFileSync(manifestPath,'utf8')));
 const actual=await fingerprint(source.databasePath);if(actual.sha256!==manifest.database.sha256||actual.byteSize!==manifest.database.byteSize)fail('DATABASE_HASH_MISMATCH');
 const db=new Database(source.databasePath,{readonly:true,fileMustExist:true});try{checkDatabase(db);if(Number(db.pragma('user_version',{simple:true}))!==manifest.schemaVersion||JSON.stringify(assets(db))!==JSON.stringify(manifest.assets))fail('BACKUP_MANIFEST_MISMATCH');}finally{db.close();}
 for(const row of manifest.assets){const actual=await fingerprint(join(source.assetsRoot,row.storageKey));if(actual.sha256!==row.sha256||actual.byteSize!==row.byteSize)fail('ASSET_HASH_MISMATCH');}
 return{...source,manifest};
}

/** Restore into a fresh directory only. No overwrites, migrations, credentials, or provider calls. */
export async function restoreRuntime(input:{backupDirectory:string;destination:string}){
 const target=paths(z.string().trim().min(1).parse(input.destination)),source=await verifyRuntimeBackup(input.backupDirectory);
 if(inside(source.directory,target.directory)||inside(target.directory,source.directory))fail('STORAGE_PATH_OVERLAP');
 newDirectory(target.directory);const release=acquireRuntimeLock(target.databasePath);
 try{
  mkdirSync(target.assetsRoot,{mode:0o700});for(const row of source.manifest.assets)await copyAsset(join(source.assetsRoot,row.storageKey),join(target.assetsRoot,row.storageKey),row);
  file(source.databasePath);copyFileSync(source.databasePath,target.databasePath,constants.COPYFILE_EXCL);chmodSync(target.databasePath,0o600);
  const actual=await fingerprint(target.databasePath);if(actual.sha256!==source.manifest.database.sha256||actual.byteSize!==source.manifest.database.byteSize)fail('DATABASE_HASH_MISMATCH');
  writeFileSync(join(target.directory,'manifest.json'),JSON.stringify(source.manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return await verifyRuntimeBackup(target.directory);
 }finally{release();}
}
