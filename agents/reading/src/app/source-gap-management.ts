import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  AgentError,
  canonicalJson,
  sha256,
  type ExecutionScope,
} from "../contracts/index.js";
import { UtcInstantSchema } from "../contracts/utc.js";
import { parseSourceHealth, type SourceHealth } from "../monitor/contracts.js";
import { resolveGap } from "../collect/incidents.js";
import {parseRunReport} from './run-records.js';
import {parseSourceResult} from '../collect/records.js';
import type { WorkspaceJournal } from "./journal.js";
const id = Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$" }),
  text = Type.String({ minLength: 1, maxLength: 2000 });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" }),
  scope = Type.Union([Type.Literal("production"), Type.Literal("preview")]);
const source = Type.Union([
  Type.Literal("langchain_blog"),
  Type.Literal("claude_resources"),
]);
const exact = { additionalProperties: false };
/** Human host input only. This schema deliberately has no fill/validated_fill or Issue-command alternative. */
export const AcceptSourceGapRequestSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    action: Type.Literal("accept_gap"),
    management_id: id,
    workspace_id: text,
    execution_scope: scope,
    source_id: source,
    gap_id: text,
    expected_revision: id,
    expected_gap_hash: hash,
    reason: text,
    evidence_reference: text,
    acknowledge_missing_coverage: Type.Literal(true),
  },
  exact,
);
export type AcceptSourceGapRequest = Static<
  typeof AcceptSourceGapRequestSchema
>;
const VerifySourceBackfillSchema=Type.Object({schema_version:Type.Literal(1),action:Type.Literal('verify_backfill'),verification_id:id,workspace_id:text,execution_scope:scope,source_id:source,gap_id:text,expected_revision:id,expected_gap_hash:hash,evidence_refs:Type.Array(Type.Object({record_key:Type.String({pattern:'^(runs/[A-Za-z0-9_-]+|sources/(langchain_blog|claude_resources)/result)$'}),sha256:hash},exact),{minItems:1,maxItems:100})},exact);
export type VerifySourceBackfillRequest=Static<typeof VerifySourceBackfillSchema>;
const verifyRequest=TypeCompiler.Compile(VerifySourceBackfillSchema);
const auditSchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    origin: Type.Literal("trusted_management"),
    actor: text,
    request: AcceptSourceGapRequestSchema,
    request_hash: hash,
    recorded_at: UtcInstantSchema,
    gap_before: Type.Object(
      {
        from: UtcInstantSchema,
        to: UtcInstantSchema,
        status: Type.Literal("open"),
      },
      exact,
    ),
    gap_after: Type.Object(
      {
        from: UtcInstantSchema,
        to: UtcInstantSchema,
        status: Type.Literal("accepted"),
      },
      exact,
    ),
    event_id: text,
    event_position: Type.Integer({
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
  },
  exact,
);
const parseRequest = TypeCompiler.Compile(AcceptSourceGapRequestSchema),
  parseAudit = TypeCompiler.Compile(auditSchema);
export function parseSourceGapAudit(value:unknown):Static<typeof auditSchema>{
 if(!parseAudit.Check(value))throw new AgentError('corrupt','Unsupported or invalid source gap management audit');
 const audit=value as Static<typeof auditSchema>;const request=parseAcceptSourceGapRequest(audit.request);
 if(!audit.actor.trim()||audit.request_hash!==sha256(canonicalJson(request))||audit.gap_before.from!==audit.gap_after.from||audit.gap_before.to!==audit.gap_after.to||sourceGapFingerprint(request.source_id,request.gap_id,audit.gap_before)!==request.expected_gap_hash)throw new AgentError('corrupt','Source gap audit binding invalid');
 return audit;
}
export function parseAcceptSourceGapRequest(
  value: unknown,
): AcceptSourceGapRequest {
  if (!parseRequest.Check(value))
    throw new AgentError("corrupt", "Invalid source gap management request");
  const request = value as AcceptSourceGapRequest;
  if (
    !request.reason.trim() ||
    !request.evidence_reference.trim() ||
    !request.gap_id.startsWith(request.source_id + ":")
  )
    throw new AgentError(
      "corrupt",
      "Source gap request binding/reason invalid",
    );
  return request;
}
function validateHealthScope(
  health: SourceHealth,
  execution_scope: ExecutionScope,
  workspace_id: string,
): void {
  if (
    health.events.some(
      (event) =>
        event.execution_scope !== execution_scope ||
        event.workspace_id !== workspace_id,
    )
  )
    throw new AgentError("scope", "Source health contains a foreign event");
}
export function sourceGapFingerprint(
  source_id: string,
  gap_id: string,
  gap: SourceHealth["gaps"][string],
): string {
  return sha256(canonicalJson({ source_id, gap_id, ...gap }));
}
/** Read committed data for a reviewable management request, without changing the cursor or issuing notifications. */
export async function inspectSourceGaps(journal: WorkspaceJournal) {
  const health = parseSourceHealth(await journal.load("sources/health"));
  validateHealthScope(
    health,
    journal.handle.execution_scope,
    journal.handle.workspace_id,
  );
  const sourceReferences=new Map<string,{record_key:string;sha256:string}|null>();
  for(const source_id of [...new Set(Object.keys(health.gaps).map(key=>key.split(':')[0]!))]){
    const record_key='sources/'+source_id+'/result',raw=await journal.load(record_key);
    if(raw===undefined)sourceReferences.set(source_id,null);
    else{const result=parseSourceResult(raw);if(result.source_id!==source_id)throw new AgentError('corrupt','Source result identity mismatch');sourceReferences.set(source_id,{record_key,sha256:sha256(canonicalJson(raw))});}
  }
  return {
    schema_version: 1 as const,
    workspace_id: journal.handle.workspace_id,
    execution_scope: journal.handle.execution_scope,
    expected_revision: journal.handle.revision,
    gaps: Object.entries(health.gaps).map(([gap_id, gap]) => {
      const source_id = gap_id.split(":")[0]!;
      return {
        source_id,
        gap_id,
        ...gap,
        expected_gap_hash: sourceGapFingerprint(source_id, gap_id, gap),
        source_result_reference:sourceReferences.get(source_id)??null,
      };
    }),
  };
}
/** These adapters expose current lists, not a provider-certified exhaustive historical snapshot. */
export const SOURCE_HISTORY_CONTRACTS={langchain_blog:null,claude_resources:null} as const;
/** Read-only host verification. An observed date range is never a completeness certificate. */
export async function verifySourceBackfill(journal:WorkspaceJournal,input:unknown){
 if(!verifyRequest.Check(input))throw new AgentError('corrupt','Invalid source backfill verification request');
 const request=input as VerifySourceBackfillRequest;
 if(request.workspace_id!==journal.handle.workspace_id||request.execution_scope!==journal.handle.execution_scope)throw new AgentError('scope','Source backfill scope mismatch');
 if(!request.gap_id.startsWith(request.source_id+':')||journal.handle.revision!==request.expected_revision)throw new AgentError('conflict','Source backfill binding drift');
 const health=parseSourceHealth(await journal.load('sources/health'));validateHealthScope(health,request.execution_scope,request.workspace_id);
 const gap=health.gaps[request.gap_id];
 if(!gap||gap.status!=='open'||sourceGapFingerprint(request.source_id,request.gap_id,gap)!==request.expected_gap_hash)throw new AgentError('conflict','Source backfill gap drift');
 const seen=new Set<string>(),observations:{record_key:string;record_sha256:string;status:string;coverage:{from:string;to:string}|null;covers_gap:boolean}[]=[];
 for(const ref of request.evidence_refs){
  if(seen.has(ref.record_key))throw new AgentError('corrupt','Duplicate source backfill evidence');seen.add(ref.record_key);
  const raw=await journal.load(ref.record_key);if(raw===undefined)throw new AgentError('not_found','Source backfill evidence absent');
  if(sha256(canonicalJson(raw))!==ref.sha256)throw new AgentError('corrupt','Source backfill evidence hash mismatch');
  let results;
  if(ref.record_key.startsWith('runs/')){const report=parseRunReport(raw);if(ref.record_key!=='runs/'+report.run_id||report.workspace_id!==request.workspace_id||report.execution_scope!==request.execution_scope)throw new AgentError('scope','Source backfill run evidence mismatch');results=report.source_results.filter(result=>result.source_id===request.source_id);}
  else{const result=parseSourceResult(raw);if(ref.record_key!=='sources/'+request.source_id+'/result'||result.source_id!==request.source_id)throw new AgentError('scope','Source backfill source evidence mismatch');results=[result];}
  if(!results.length)throw new AgentError('corrupt','Source backfill evidence has no requested source');
  for(const result of results){const covered=result.coverage;observations.push({record_key:ref.record_key,record_sha256:ref.sha256,status:result.status,coverage:covered,covers_gap:!!covered&&['success','partial'].includes(result.status)&&Date.parse(covered.from)<=Date.parse(gap.from)&&Date.parse(covered.to)>=Date.parse(gap.to)});}
 }
 if(journal.handle.revision!==request.expected_revision)throw new AgentError('conflict','Source backfill revision changed during verification');
 return {schema_version:1 as const,verification_id:request.verification_id,workspace_id:request.workspace_id,execution_scope:request.execution_scope,source_id:request.source_id,gap_id:request.gap_id,revision:journal.handle.revision,expected_gap_hash:request.expected_gap_hash,status:'unverified' as const,can_fill:false as const,reason_code:'source_history_completeness_unsupported' as const,history_contract:SOURCE_HISTORY_CONTRACTS[request.source_id],observations};
}
/** Only the trusted CLI/host calls this function. A committed audit is the idempotency receipt. */
export async function acceptSourceGap(
  journal: WorkspaceJournal,
  input: unknown,
  actor: string,
  now: () => Date = () => new Date(),
) {
  const request = parseAcceptSourceGapRequest(input);
  if (!actor.trim() || actor.length > 2000)
    throw new AgentError("configuration", "Trusted management actor required");
  if (
    request.execution_scope !== journal.handle.execution_scope ||
    request.workspace_id !== journal.handle.workspace_id
  )
    throw new AgentError("scope", "Source gap management scope mismatch");
  const auditKey = "source-gap-management/" + request.management_id,
    request_hash = sha256(canonicalJson(request));
  const existing = await journal.load(auditKey);
  if (existing !== undefined) {
    const audit = parseSourceGapAudit(existing);
    if (audit.request_hash !== request_hash || audit.actor !== actor)
      throw new AgentError("conflict", "Source gap management identity reused");
    const health = parseSourceHealth(await journal.load("sources/health"));
    validateHealthScope(health, request.execution_scope, request.workspace_id);
    if (
      health.gaps[request.gap_id]?.status !== "accepted" ||
      !health.events.some(
        (event) =>
          event.event_id === audit.event_id &&
          event.position === audit.event_position &&
          event.gap_id === request.gap_id &&
          event.kind === "accepted_gap",
      )
    )
      throw new AgentError(
        "corrupt",
        "Source gap audit has no committed acceptance event",
      );
    return {
      management_id: request.management_id,
      status: "already_applied" as const,
      event_id: audit.event_id,
      revision: journal.handle.revision,
    };
  }
  if (journal.handle.revision !== request.expected_revision)
    throw new AgentError("conflict", "Source gap revision drift");
  const health = parseSourceHealth(await journal.load("sources/health"));
  validateHealthScope(health, request.execution_scope, request.workspace_id);
  const gap = health.gaps[request.gap_id];
  if (!gap) throw new AgentError("not_found", "Source gap absent");
  if (gap.status !== "open")
    throw new AgentError("conflict", "Source gap already disposed");
  if (
    sourceGapFingerprint(request.source_id, request.gap_id, gap) !==
    request.expected_gap_hash
  )
    throw new AgentError("conflict", "Source gap contents drift");
  const occurrence = health.events.find(
    (event) =>
      event.kind === "coverage_gap" &&
      event.gap_id === request.gap_id &&
      event.source_id === request.source_id,
  );
  if (!occurrence)
    throw new AgentError(
      "corrupt",
      "Source gap has no matching source occurrence",
    );
  const recorded_at = now().toISOString();
  const next = resolveGap(
      health,
      request.gap_id,
      { kind: "accepted", reason: request.reason, validated_fill: false },
      request.workspace_id,
      request.execution_scope,
      recorded_at,
    ),
    event = next.events.at(-1)!;
  const audit = {
    schema_version: 1,
    origin: "trusted_management",
    actor,
    request,
    request_hash,
    recorded_at,
    gap_before: gap,
    gap_after: next.gaps[request.gap_id],
    event_id: event.event_id,
    event_position: event.position,
  };
  parseSourceGapAudit(audit);
  await journal.commitMany(
    { "sources/health": next, [auditKey]: audit },
    "source_incidents_reconciled",
    [],
    [],
    request.expected_revision,
  );
  return {
    management_id: request.management_id,
    status: "applied" as const,
    event_id: event.event_id,
    revision: journal.handle.revision,
  };
}
