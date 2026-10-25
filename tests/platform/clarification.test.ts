import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { runtimeSeed, later, time } from '../helpers/runtime.js';
let s: ReturnType<typeof runtimeSeed>;
beforeEach(() => { s = runtimeSeed(); });
afterEach(() => s.db.close());
it('persists a clarification and queues the answered run without charging waiting time', () => {
  const question = { id: randomUUID(), runId: s.run.id, prompt: '哪一届？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null };
  s.runs.requestClarification(s.run.id, s.run.epoch, question, later(5));
  expect(s.runs.getClarification(s.run.id, s.owner)).toEqual(question);
  s.runs.answerClarification(s.run.id, question.id, s.owner, { answer: '2026', proceedWithUnknown: false }, later(100));
  expect(s.runs.get(s.run.id, s.owner)).toMatchObject({ status: 'queued', activeMs: 5000 });
  expect(s.runs.getClarification(s.run.id, s.owner)).toMatchObject({ answer: '2026', answeredAt: later(100) });
  const current = s.runs.claimNext(later(101))!;
  expect(current.epoch).toBeGreaterThan(s.run.epoch);
  expect(s.runs.cancel(current.id, s.owner, later(103)).activeMs).toBe(7000);
});
it('rejects other owners, mismatched question IDs and unknown answers when disallowed', () => {
  const q = { id: randomUUID(), runId: s.run.id, prompt: '请指明对象', missingFields: ['object'], options: [], canProceedWithUnknown: false, answer: null, answeredAt: null };
  s.runs.requestClarification(s.run.id, s.run.epoch, q, time);
  expect(() => s.runs.answerClarification(s.run.id, q.id, randomUUID(), { answer: '对象', proceedWithUnknown: false }, later(1))).toThrow();
  expect(() => s.runs.answerClarification(s.run.id, randomUUID(), s.owner, { answer: '对象', proceedWithUnknown: false }, later(1))).toThrow();
  expect(() => s.runs.answerClarification(s.run.id, q.id, s.owner, { answer: null, proceedWithUnknown: true }, later(1))).toThrow();
  expect(s.runs.get(s.run.id, s.owner)?.status).toBe('waiting_for_user');
});
