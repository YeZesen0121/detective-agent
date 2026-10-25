import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { openDatabase } from '../../src/server/platform/database.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import { FoundationStore } from '../../src/server/platform/repository.js';
import { budgetScenario } from '../helpers/budget-scenario.js';

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'detective-budget-'));
  const path = join(directory, 'state.db');
  return { path, cleanup: () => {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    rmdirSync(directory);
  } };
}

it('recovers unsent reservations but retains sent calls as unknown across a database reopen', () => {
  const temp = temporaryDatabase(); const fixture = budgetScenario(temp.path);
  const unsent = fixture.reservation(5); const sent = fixture.reservation(10);
  fixture.book.reserve(fixture.context, fixture.poolIds, unsent);
  fixture.book.reserve(fixture.context, fixture.poolIds, sent); fixture.book.markSent(sent.callId);
  fixture.db.close();
  const db = openDatabase(temp.path); const book = new BudgetBook(db);
  try {
    expect(book.recoverInFlight()).toEqual({ released: 1, unknown: 1 });
    expect(book.recoverInFlight()).toEqual({ released: 0, unknown: 0 });
    expect(book.inspectCall(unsent.callId).status).toBe('released');
    expect(book.inspectCall(sent.callId).status).toBe('unknown');
    expect(book.inspectPool('trial').reserved.moneyMicros).toBe(10);
    book.settle(sent.callId, { ...zeroAmounts(), moneyMicros: 7 });
    book.settle(sent.callId, { ...zeroAmounts(), moneyMicros: 7 });
    expect(book.inspectPool('trial').used.moneyMicros).toBe(7);
    expect(book.inspectPool('trial').used.searches).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM usage_reconciliations WHERE call_id=?').get(sent.callId)).toEqual({ count: 1 });
  } finally { db.close(); temp.cleanup(); }
});

it('upgrades a v1 database without losing its session, draft or retry identity', () => {
  const temp = temporaryDatabase();
  const old = new Database(temp.path);
  old.exec(readFileSync('migrations/001_initial.sql', 'utf8')); old.pragma('user_version = 1');
  const at = '2026-10-24T08:00:00.000Z'; const end = '2026-10-26T08:00:00.000Z';
  const session = { id: randomUUID(), tokenHash: 'a'.repeat(64), accessGroup: 'trial', createdAt: at, expiresAt: end, revokedAt: null };
  const input = { originalQuestion: '迁移保留样例', basicMode: 'truth', presentationMode: 'brief' };
  const draft = { ...input, id: randomUUID(), sessionId: session.id, scope: null, scopeVersion: 0, status: 'draft', attachmentIds: [], activeRunId: null, latestResultVersionId: null, createdAt: at, updatedAt: at };
  old.prepare('INSERT INTO sessions(id,token_hash,payload_json) VALUES (?,?,?)').run(session.id, session.tokenHash, JSON.stringify(session));
  old.prepare('INSERT INTO investigations(id,session_id,created_at,payload_json) VALUES (?,?,?,?)').run(draft.id, session.id, at, JSON.stringify(draft));
  old.prepare('INSERT INTO idempotency_records(session_id,operation,key,body_hash,response_ref,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(session.id, 'create_investigation', 'migration-retry', createHash('sha256').update(JSON.stringify(input)).digest('hex'), draft.id, at, end);
  old.close();
  let store = new FoundationStore(temp.path);
  try {
    store.close(); store = new FoundationStore(temp.path);
    expect(store.getInvestigation(draft.id, session.id)?.originalQuestion).toBe('迁移保留样例');
    expect(store.findSession('a'.repeat(64), '2026-10-25T00:00:00.000Z')?.id).toBe(session.id);
    expect(store.createDraft(session.id, 'migration-retry', { originalQuestion: '迁移保留样例', basicMode: 'truth', presentationMode: 'brief' }, '2026-10-25T00:00:00.000Z', '2026-10-26T08:00:00.000Z').id).toBe(draft.id);
  } finally { store.close(); temp.cleanup(); }
});

it('permits only one of two independent processes to reserve the same remaining balance', async () => {
  const temp = temporaryDatabase(); const fixture = budgetScenario(temp.path);
  const start = () => {
    const child = fork(resolve('tests/helpers/reserve-worker.ts'), [temp.path], { execArgv: ['--import', 'tsx'], silent: true });
    let ready!: () => void; let completed!: (result: { reserved: boolean }) => void;
    const isReady = new Promise<void>((done, fail) => { ready = done; child.once('error', fail); });
    const result = new Promise<{ reserved: boolean }>((done) => { completed = done; });
    const exited = new Promise<void>((done) => { child.once('exit', () => done()); });
    child.on('message', (message: { ready?: boolean; reserved?: boolean }) => {
      if (message.ready) ready(); else completed({ reserved: message.reserved === true });
    });
    return { child, isReady, result, exited };
  };
  const workers = [start(), start()];
  try {
    await Promise.all(workers.map((worker) => worker.isReady));
    for (const worker of workers) worker.child.send({ context: fixture.context, poolIds: fixture.poolIds, reservation: fixture.reservation(15) });
    const results = await Promise.all(workers.map((worker) => worker.result));
    await Promise.all(workers.map((worker) => worker.exited));
    expect(results.filter((result) => result.reserved)).toHaveLength(1);
    expect(fixture.book.inspectPool('trial').reserved.moneyMicros).toBe(15);
    expect(fixture.book.inspectPool('global').reserved.moneyMicros).toBe(15);
  } finally {
    for (const worker of workers) if (worker.child.exitCode === null) worker.child.kill();
    await Promise.all(workers.map((worker) => worker.exited));
    fixture.db.close(); temp.cleanup();
  }
}, 15000);
