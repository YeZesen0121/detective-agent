import type Database from 'better-sqlite3';
import { BudgetAmountsSchema, type BudgetAmounts } from '../../shared/contracts.js';
import { BudgetBook } from './budget.js';
import { ApiFault } from './errors.js';
import { hashValue } from './snapshots.js';
export type RuntimeFunding={global:BudgetAmounts;trial:BudgetAmounts;demo:BudgetAmounts};
export function ensureRuntimeFunding(db:Database.Database,funding:RuntimeFunding){
 db.transaction(()=>{const book=new BudgetBook(db);for(const name of ['global','trial','demo'] as const){const limits=BudgetAmountsSchema.parse(funding[name]);
  const old=db.prepare('SELECT limits_json FROM budget_pools WHERE id=?').get('runtime:'+name) as {limits_json:string}|undefined;
  if(old){if(hashValue(JSON.parse(old.limits_json))!==hashValue(limits))throw new ApiFault(409,'INVALID_STATE','运行资金配置与已保存额度不一致，需显式迁移。');}
  else book.createPool({id:'runtime:'+name,kind:name==='global'?'global':'access_group',accessGroup:name==='global'?null:name,sessionId:null,investigationId:null,limits});
 }}).immediate();
}
