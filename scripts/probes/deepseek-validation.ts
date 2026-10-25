import { z } from 'zod';

const ExtractSchema = z.strictObject({
  status: z.enum(['supported', 'insufficient']), claim: z.string().trim().min(1).max(1000),
  evidenceQuote: z.string().max(300), sourceId: z.literal('source_1'),
  limitations: z.array(z.string().min(1).max(1000)).max(10),
});

export function validateModelExtract(value: unknown, sourceText: string) {
  const extract = ExtractSchema.parse(value);
  if (extract.status === 'supported' && !extract.evidenceQuote.trim()) throw new Error('Supported claim needs a quote');
  if (extract.evidenceQuote && !sourceText.includes(extract.evidenceQuote)) throw new Error('Quote is not in the provided material');
  return extract;
}
