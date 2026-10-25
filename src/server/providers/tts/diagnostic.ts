import { IdSchema } from '../../../shared/contracts.js';

/** Server-private allowlisted metadata, never a public error body or raw provider value. */
export interface SpeechProviderDiagnostic {
  readonly providerErrorCode?: string;
  readonly providerRequestId?: string;
}
// Tencent TTS common/business error families: https://cloud.tencent.com/document/api/1073/37996
const errorFamilies = new Set(['ActionOffline', 'AuthFailure', 'DryRunOperation', 'FailedOperation', 'InternalError',
  'InvalidAction', 'InvalidParameter', 'InvalidParameterValue', 'InvalidRequest', 'IpInBlacklist', 'IpNotInWhitelist',
  'LimitExceeded', 'MissingParameter', 'NoSuchProduct', 'NoSuchVersion', 'RequestLimitExceeded', 'RequestSizeLimitExceeded',
  'ResourceInUse', 'ResourceInsufficient', 'ResourceNotFound', 'ResourceUnavailable', 'ResponseSizeLimitExceeded',
  'ServiceUnavailable', 'UnauthorizedOperation', 'UnknownParameter', 'UnsupportedOperation', 'UnsupportedProtocol', 'UnsupportedRegion']);
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && 'value' in property ? property.value : undefined;
}
function safeCode(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && !/[^A-Za-z0-9.]/.test(value) && /^[A-Za-z]+(?:\.[A-Za-z][A-Za-z0-9]{0,63}){0,3}$/.test(value)
    && errorFamilies.has(value.split('.')[0]!);
}
/** Revalidate at each error boundary; retain valid independent fields only. */
export function checkedSpeechDiagnostic(value: unknown): Readonly<SpeechProviderDiagnostic> | undefined {
  const code = ownValue(value, 'providerErrorCode'), id = ownValue(value, 'providerRequestId');
  const providerErrorCode = safeCode(code) ? code : undefined;
  const providerRequestId = typeof id === 'string' && id.length === 36 && IdSchema.safeParse(id).success ? id : undefined;
  if (providerErrorCode === undefined && providerRequestId === undefined) return undefined;
  return Object.freeze({ ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
    ...(providerRequestId === undefined ? {} : { providerRequestId }) });
}
/** `value` is the known Response object (or SDK-unwrapped equivalent), not an arbitrary search tree. */
export function tencentErrorDiagnostic(value: unknown): Readonly<SpeechProviderDiagnostic> | undefined {
  return checkedSpeechDiagnostic({ providerErrorCode: ownValue(ownValue(value, 'Error'), 'Code'),
    providerRequestId: ownValue(value, 'RequestId') });
}
