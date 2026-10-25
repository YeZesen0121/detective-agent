import type { ProgressEvent } from '../../shared/contracts.js';
import type { RunView } from '../api/task-port.js';
import type { SafeError } from '../api/client.js';
export interface TaskViewState {
  data: RunView | null;
  connection: 'idle' | 'loading' | 'connected' | 'reconnecting' | 'error';
  cancelPending: boolean;
  events: ProgressEvent[];
  lastSeq: number;
  error: SafeError | null;
}
