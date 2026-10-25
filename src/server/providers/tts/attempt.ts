import { SpeechError } from '../../companion/speech-errors.js';

/** One invocation only. Local timeout/cancel does not prove that the provider charged nothing. */
export async function speechAttempt<T>(send: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, deadlineAt?: string): Promise<T> {
  if (signal.aborted) throw new SpeechError('SPEECH_ABORTED', '语音已停止，文字内容仍可阅读。');
  const remaining = deadlineAt === undefined ? 20000 : Date.parse(deadlineAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new SpeechError('SPEECH_TIMEOUT', '语音请求期限已到，尚未发送合成。');
  const controller = new AbortController(); let invoked = false;
  let rejectStop!: (error: SpeechError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const stop = (code: string, message: string) => {
    if (controller.signal.aborted) return;
    controller.abort(); rejectStop(new SpeechError(code, message, invoked));
  };
  const abort = () => stop('SPEECH_ABORTED', '语音已停止；已发请求的费用由平台核对。');
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('SPEECH_TIMEOUT', '语音合成超时，结果和费用待平台核对，本次不自动重试。'), Math.min(20000, remaining));
  try {
    const result = await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted || controller.signal.aborted) throw new SpeechError('SPEECH_ABORTED', '语音已停止，未开始新的合成。');
      invoked = true; return send(controller.signal);
    }), stopped]);
    if (signal.aborted || controller.signal.aborted) throw new SpeechError('SPEECH_ABORTED', '语音已停止，迟到音频不交付。', invoked);
    return result;
  } catch (error) {
    if (error instanceof SpeechError) throw new SpeechError(error.code, error.publicMessage, invoked || error.mayHaveProviderCost, error.privateDiagnostic);
    throw new SpeechError('SPEECH_PROVIDER_FAILED', '语音合成失败，文字保留；本次不自动重试。', invoked);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
