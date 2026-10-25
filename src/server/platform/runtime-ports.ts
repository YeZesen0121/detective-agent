import type { Run } from '../../shared/contracts.js';
import type { z } from 'zod';
import type { StartRunSchema } from '../../shared/runtime-http.js';
export interface TaskHost {
  start(sessionId: string, investigationId: string, key: string, input: z.infer<typeof StartRunSchema>): Promise<Run>;
  cancel(sessionId: string, runId: string): Promise<Run>;
  recover(): Promise<void>;
}
