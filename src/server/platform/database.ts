import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const migrations = ['001_initial.sql', '002_budget.sql', '003_runs.sql', '004_results.sql', '005_admissions.sql', '006_watches.sql', '007_experience.sql', '008_followups.sql', '009_paid_campaign.sql', '010_scope_refinements.sql', '011_provider_model_traces.sql', '012_usage_policy.sql'];

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000');
    const current = Number(db.pragma('user_version', { simple: true }));
    if (current > migrations.length) throw new Error('Unsupported database migration version');
    for (let index = current; index < migrations.length; index++) db.transaction(() => {
      db.exec(readFileSync(resolve('migrations', migrations[index]!), 'utf8'));
      db.pragma(`user_version = ${index + 1}`);
    })();
    return db;
  } catch (error) { db.close(); throw error; }
}
