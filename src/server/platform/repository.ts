import { randomUUID, createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase } from './database.js';
import {
  BrowserSessionSchema, InvestigationSchema,
  type AccessGroup, type CreateInvestigation, type Investigation,
} from '../../shared/contracts.js';
import { ApiFault } from './errors.js';
import {InvestigationSummarySchema,InvestigationsPageSchema,ListInvestigationsQuerySchema} from '../../shared/investigations-http.js';

export function sha256(value: string) { return createHash('sha256').update(value).digest('hex'); }

export class FoundationStore {
  private readonly db: Database.Database;
  private readonly ownsDatabase: boolean;

  constructor(path: string | Database.Database) {
    this.ownsDatabase = typeof path === 'string';
    this.db = typeof path === 'string' ? openDatabase(path) : path;
  }

  close() { if (this.ownsDatabase) this.db.close(); }
  ready() { this.db.prepare('SELECT 1').get(); return true; }

  createSession(tokenHash: string, accessGroup: AccessGroup, createdAt: string, expiresAt: string) {
    const session = BrowserSessionSchema.parse({ id: randomUUID(), tokenHash, accessGroup, createdAt, expiresAt, revokedAt: null });
    this.db.prepare('INSERT INTO sessions(id, token_hash, payload_json) VALUES (?, ?, ?)').run(session.id, tokenHash, JSON.stringify(session));
    return session;
  }

  findSession(tokenHash: string, now: string) {
    const row = this.db.prepare('SELECT payload_json FROM sessions WHERE token_hash = ?').get(tokenHash) as { payload_json: string } | undefined;
    if (!row) return null;
    const session = BrowserSessionSchema.parse(JSON.parse(row.payload_json));
    return session.revokedAt === null && Date.parse(session.expiresAt) > Date.parse(now) ? session : null;
  }

  getInvestigation(id: string, sessionId: string): Investigation | null {
    const row = this.db.prepare('SELECT payload_json FROM investigations WHERE id = ? AND session_id = ?').get(id, sessionId) as { payload_json: string } | undefined;
    return row ? InvestigationSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listInvestigations(sessionId:string,raw:unknown){
    const input=ListInvestigationsQuerySchema.parse(raw);
    const before=input.before?this.getInvestigation(input.before,sessionId):null;
    if(input.before&&!before)throw new ApiFault(404,'NOT_FOUND','未找到该调查。');
    const rows=(before
      ?this.db.prepare('SELECT payload_json FROM investigations WHERE session_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?').all(sessionId,before.createdAt,before.createdAt,before.id,input.limit+1)
      :this.db.prepare('SELECT payload_json FROM investigations WHERE session_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(sessionId,input.limit+1)) as {payload_json:string}[];
    const items=rows.slice(0,input.limit).map(row=>{const value=InvestigationSchema.parse(JSON.parse(row.payload_json));return InvestigationSummarySchema.parse({id:value.id,originalQuestion:value.originalQuestion,basicMode:value.basicMode,presentationMode:value.presentationMode,status:value.status,latestResultVersionId:value.latestResultVersionId,createdAt:value.createdAt,updatedAt:value.updatedAt});});
    return InvestigationsPageSchema.parse({items,nextBefore:rows.length>input.limit?items.at(-1)!.id:null});
  }

  createDraft(sessionId: string, key: string, input: CreateInvestigation, at: string, expiresAt: string) {
    // Zod produces fields in schema order; whitespace has already been normalized.
    const bodyHash = sha256(JSON.stringify(input));
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT body_hash, response_ref FROM idempotency_records WHERE session_id = ? AND operation = ? AND key = ?')
        .get(sessionId, 'create_investigation', key) as { body_hash: string; response_ref: string } | undefined;
      if (prior) {
        if (prior.body_hash !== bodyHash) throw new ApiFault(409, 'IDEMPOTENCY_CONFLICT', '此提交标识已用于不同内容，请核对原提交。');
        const existing = this.getInvestigation(prior.response_ref, sessionId);
        if (!existing) throw new Error('Broken idempotency reference');
        return existing;
      }
      const investigation = InvestigationSchema.parse({
        ...input, id: randomUUID(), sessionId, scope: null, scopeVersion: 0, status: 'draft',
        attachmentIds: [], activeRunId: null, latestResultVersionId: null, createdAt: at, updatedAt: at,
      });
      this.db.prepare('INSERT INTO investigations(id, session_id, created_at, payload_json) VALUES (?, ?, ?, ?)')
        .run(investigation.id, sessionId, at, JSON.stringify(investigation));
      this.db.prepare('INSERT INTO idempotency_records(session_id, operation, key, body_hash, response_ref, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(sessionId, 'create_investigation', key, bodyHash, investigation.id, at, expiresAt);
      return investigation;
    })();
  }
}
