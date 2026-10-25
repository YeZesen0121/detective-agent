import { checkedSpeechDiagnostic, type SpeechProviderDiagnostic } from '../providers/tts/diagnostic.js';

export class SpeechError extends Error {
  declare readonly privateDiagnostic?: Readonly<SpeechProviderDiagnostic>;
  constructor(readonly code: string, readonly publicMessage: string, readonly mayHaveProviderCost = false, diagnostic?: unknown) {
    super(`${code}: ${publicMessage}`);
    const safe = checkedSpeechDiagnostic(diagnostic);
    if (safe) Object.defineProperty(this, 'privateDiagnostic', { value: safe, enumerable: false, writable: false, configurable: false });
  }
}
