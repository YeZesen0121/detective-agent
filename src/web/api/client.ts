import { z } from 'zod';
import { ApiErrorSchema, apiSuccessSchema, type ApiErrorCode } from '../../shared/contracts.js';

export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'ABORTED' | 'INVALID_RESPONSE' | 'PROTOCOL_ERROR' | 'AUDIO_FAILED';
export interface SafeError {
  code: ClientErrorCode;
  message: string;
  requestId: string | null;
  status: number | null;
  retryable: boolean;
}
export class ClientError extends Error implements SafeError {
  constructor(
    readonly code: ClientErrorCode, message: string,
    readonly requestId: string | null = null,
    readonly status: number | null = null,
    readonly retryable = false,
  ) { super(message); this.name = 'ClientError'; }
}
// Never attach raw exceptions, HTTP bodies, headers or schema diagnostics to view state.
export function safeError(error: unknown): SafeError {
  const value = error instanceof ClientError ? error : new ClientError('NETWORK_ERROR', '连接中断，请重试。', null, null, true);
  return { code: value.code, message: value.message, requestId: value.requestId, status: value.status, retryable: value.retryable };
}
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ClientError('VALIDATION_ERROR', '输入格式不正确，请检查后重试。');
  return parsed.data;
}
export async function request<T>(path: string, options: RequestInit, schema: z.ZodType<T>, transport: typeof fetch = fetch): Promise<T> {
  const base = 'https://same-origin.invalid';
  let url: URL;
  try { url = new URL(path, base); } catch { throw new ClientError('VALIDATION_ERROR', '请求路径无效。'); }
  if (!path.startsWith('/api/v1/') || path.includes('\\') || url.origin !== base || !url.pathname.startsWith('/api/v1/') || url.hash) {
    throw new ClientError('VALIDATION_ERROR', '请求路径无效。');
  }
  let response: Response;
  let body: unknown;
  try {
    response = await transport(path, { ...options, credentials: 'same-origin', mode: 'same-origin', redirect: 'error' });
  } catch {
    if (options.signal?.aborted) throw new ClientError('ABORTED', '已停止本地读取。');
    throw new ClientError('NETWORK_ERROR', '连接中断，请重试。', null, null, true);
  }
  try { body = await response.json(); } catch (error) {
    if (options.signal?.aborted) throw new ClientError('ABORTED', '已停止本地读取。');
    if (!(error instanceof SyntaxError)) throw new ClientError('NETWORK_ERROR', '连接中断，请重试。', null, response.status, true);
    throw new ClientError('INVALID_RESPONSE', '服务返回了无法读取的数据。', null, response.status);
  }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    if (!parsed.success) throw new ClientError('INVALID_RESPONSE', '服务错误响应格式不正确。', null, response.status);
    const { error, meta } = parsed.data;
    throw new ClientError(error.code, error.message, meta.requestId, response.status, error.retryable);
  }
  const parsed = apiSuccessSchema(schema).safeParse(body);
  if (!parsed.success) throw new ClientError('INVALID_RESPONSE', '服务数据或接口版本不兼容。', null, response.status);
  return parsed.data.data;
}
