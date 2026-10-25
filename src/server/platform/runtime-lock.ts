import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Hold an OS-backed SQLite lock in a separate file, without blocking runtime transactions.
 * A crash releases the lock automatically; the persistent file is safe to reuse. */
export function acquireRuntimeLock(databasePath:string):()=>void{
 if(databasePath===':memory:')throw Error('Persistent runtime database required');
 const path=resolve(databasePath)+'.host-lock';mkdirSync(dirname(path),{recursive:true});
 const db=new Database(path,{timeout:0});
 try{
  db.pragma('journal_mode=DELETE');
  db.exec('CREATE TABLE IF NOT EXISTS host_lock(singleton INTEGER PRIMARY KEY CHECK(singleton=1))');
  db.exec('BEGIN EXCLUSIVE');
 }catch{db.close();throw Error('Runtime database is already owned or unavailable');}
 let released=false;
 return()=>{if(released)return;released=true;try{db.exec('ROLLBACK');}finally{db.close();}};
}

/** Do not use a late onClose hook: Fastify runs those in reverse registration order. */
export function createRuntimeShutdown(close:()=>Promise<unknown>,release:()=>void):()=>Promise<void>{
 let closing:Promise<void>|undefined;
 return()=>closing??=(async()=>{await close();release();})();
}
