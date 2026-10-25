import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AttachmentSnapshotSchema, ResultPayloadSchema, ResultVersionSchema, type Investigation, type ResultPayload, type Run } from '../../shared/contracts.js';
import type { WorkingMaterial } from '../../shared/ports.js';
import { ApiFault } from './errors.js';

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}';
  return JSON.stringify(value);
}
export function hashValue(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
const invalid = () => new ApiFault(409, 'INVALID_STATE', '结果与已保存的任务、范围或证据不一致。');

/** Caller holds the RunStore transaction and has checked the current epoch. */
export function insertSnapshot(db: Database.Database, run: Run, investigation: Investigation, raw: ResultPayload, material: WorkingMaterial | null, at: string) {
  const payload = ResultPayloadSchema.parse(raw);
  const identity = (scope: typeof payload.scope) => { const { referenceTime: _time, ...rest } = scope; return rest; };
  const matchesScope=investigation.scope && (run.trigger==='watch' ? stableJson(identity(payload.scope))===stableJson(identity(investigation.scope)) : stableJson(payload.scope)===stableJson(investigation.scope));
  if (payload.investigationId !== investigation.id || payload.runId !== run.id || run.scopeVersion !== investigation.scopeVersion || !matchesScope) throw invalid();
  if ((payload.delta?.previousVersionId ?? null) !== investigation.latestResultVersionId) throw invalid();
  const attachments=(db.prepare('SELECT payload_json FROM attachments WHERE investigation_id=? AND session_id=? AND deleted_at IS NULL ORDER BY sort_order').all(investigation.id,investigation.sessionId) as Array<{payload_json:string}>).map(row=>AttachmentSnapshotSchema.strip().parse(JSON.parse(row.payload_json)));
  if(stableJson(payload.attachments)!==stableJson(attachments)||stableJson(attachments.map(a=>a.id))!==stableJson(investigation.attachmentIds))throw invalid();
  for(const evidence of payload.evidence)if(evidence.origin.kind==='attachment'){
    const attachment=attachments.find(a=>a.id===evidence.origin.id),capture=attachment?.extraction?.visibleText;
    if(!capture||evidence.representation!=='extracted'||!capture.includes(evidence.excerpt)||evidence.contentHash!==createHash('sha256').update(capture).digest('hex'))throw invalid();
  }
  // A structurally correct citation must still refer to material captured by this run.
  for (const category of ['sources', 'evidence'] as const) for (const item of payload[category]) {
    const captured = material?.[category].find(entry => entry.id === item.id);
    if (!captured || stableJson(item) !== stableJson(captured)) throw invalid();
  }
  const version = ResultVersionSchema.parse({
    id: randomUUID(), investigationId: investigation.id, runId: run.id, previousVersionId: investigation.latestResultVersionId,
    createdAt: at, payloadHash: hashValue(payload), payload,
  });
  db.prepare('INSERT INTO result_versions(id,investigation_id,run_id,previous_version_id,created_at,payload_hash,payload_json) VALUES (?,?,?,?,?,?,?)')
    .run(version.id, version.investigationId, version.runId, version.previousVersionId, at, version.payloadHash, JSON.stringify(version));
  for(const attachment of attachments)db.prepare('INSERT INTO result_attachment_refs VALUES (?,?)').run(version.id,attachment.id);
  return version;
}
export function readSnapshot(db: Database.Database, id: string, owner: string) {
  const row = db.prepare('SELECT r.payload_json FROM result_versions r JOIN investigations i ON i.id=r.investigation_id WHERE r.id=? AND i.session_id=?').get(id, owner) as { payload_json: string } | undefined;
  if (!row) return null;
  const version = ResultVersionSchema.parse(JSON.parse(row.payload_json));
  if (version.payloadHash !== hashValue(version.payload)) throw invalid();
  return version;
}
export function copySnapshot(version: NonNullable<ReturnType<typeof readSnapshot>>): string {
  const p = version.payload;
  const conditions = [...new Set([...p.conditions, ...p.claims.flatMap(claim => claim.conditions)])];
  const limitations = [...new Set([...p.unknowns, ...p.claims.flatMap(claim => claim.gaps), ...p.evidence.flatMap(evidence => evidence.limitations)])];
  return [p.summary, '适用条件', ...conditions, '未知与限制', ...limitations, '查询时间：' + p.queryTime,
    '来源', ...p.sources.map(source => source.title + ' (' + source.readStatus + ') ' + source.url)].join('\n');
}
