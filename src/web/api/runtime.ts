import { z } from 'zod';
import { IdSchema } from '../../shared/contracts.js';
import { StartRunSchema, StartedRunSchema, ClarificationAnswerSchema, AnsweredRunSchema, ResultViewSchema, CopyResultSchema } from '../../shared/runtime-http.js';
import { ClientError, parseInput, request } from './client.js';
import { createTaskHttpPort } from './task-http.js';
import type { TaskPort } from './task-port.js';

export interface RuntimeApi extends TaskPort {
  startRun(investigationId: string, input: z.infer<typeof StartRunSchema>, key: string, signal: AbortSignal): Promise<z.infer<typeof StartedRunSchema>>;
  answerClarification(runId: string, clarificationId: string, input: z.infer<typeof ClarificationAnswerSchema>, signal: AbortSignal): Promise<z.infer<typeof AnsweredRunSchema>>;
  getResult(versionId: string, signal: AbortSignal): Promise<z.infer<typeof ResultViewSchema>>;
  copyResult(versionId: string, signal: AbortSignal): Promise<z.infer<typeof CopyResultSchema>>;
}
const keySchema = z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/);
const protocol = () => new ClientError('PROTOCOL_ERROR', '响应不属于请求的任务或报告。');
export function createRuntimeApi(transport: typeof fetch): RuntimeApi {
  return {
    ...createTaskHttpPort(transport),
    async startRun(investigationId, input, key, signal) {
      const id = parseInput(IdSchema, investigationId);
      const body = parseInput(StartRunSchema, input);
      const fixedKey = parseInput(keySchema, key);
      return request(`/api/v1/investigations/${id}/runs`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': fixedKey }, body: JSON.stringify(body) }, StartedRunSchema, transport);
    },
    async answerClarification(runId, clarificationId, input, signal) {
      const id = parseInput(IdSchema, runId);
      const clarification = parseInput(IdSchema, clarificationId);
      const body = parseInput(ClarificationAnswerSchema, input);
      const ack = await request(`/api/v1/runs/${id}/clarifications/${clarification}`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, AnsweredRunSchema, transport);
      if (ack.runId !== id) throw protocol();
      return ack;
    },
    async getResult(versionId, signal) {
      const id = parseInput(IdSchema, versionId);
      const result = await request(`/api/v1/results/${id}`, { signal }, ResultViewSchema, transport);
      if (result.version.id !== id) throw protocol();
      return result;
    },
    async copyResult(versionId, signal) {
      const id = parseInput(IdSchema, versionId);
      return request(`/api/v1/results/${id}/copy`, { signal }, CopyResultSchema, transport);
    },
  };
}
