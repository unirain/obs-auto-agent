import {
  AgentError,
  canonicalJson,
  type Usage,
  type InvocationMessage,
  type InvocationRecord,
  type WorkspaceHandle,
  type ExecutionScope,
  type JsonValue,
} from "../contracts/index.js";
import {
  validateSchema,
  type UsageTotalsSchemaValue,
} from "../contracts/schema.js";
export { UsageTotalsSchema } from "../contracts/schema.js";
import { assertUtcInstant } from "../contracts/utc.js";
export interface DetailedUsage extends Usage {
  /** Observed lower bound when total SDK cost is unavailable; null means no priced observation. */
  known_cost_usd: number | null;
  token_status: "known" | "partial" | "unknown";
  message_count: number;
}
function validUsage(value: Usage): void {
  if (
    !Number.isSafeInteger(value.input_tokens) ||
    value.input_tokens < 0 ||
    !Number.isSafeInteger(value.output_tokens) ||
    value.output_tokens < 0 ||
    (value.cost_usd !== null &&
      (!Number.isFinite(value.cost_usd) || value.cost_usd < 0)) ||
    !["known", "unknown"].includes(value.cost_status) ||
    (value.cost_status === "known" && value.cost_usd === null)
  )
    throw new AgentError("corrupt", "Invalid observed usage");
}
/** Idempotent replay is equal by canonical content, never by object insertion order. */
export function uniqueUsageMessages(
  messages: readonly InvocationMessage[],
): InvocationMessage[] {
  const unique = new Map<string, InvocationMessage>();
  for (const message of messages) {
    if (!message.message_id)
      throw new AgentError("corrupt", "Usage message identity missing");
    validUsage(message.usage);
    const old = unique.get(message.message_id);
    if (old && canonicalJson(old) !== canonicalJson(message))
      throw new AgentError("corrupt", "Replayed usage message changed");
    if (!old) unique.set(message.message_id, message);
  }
  return [...unique.values()];
}
export function detailedUsage(
  messages: readonly InvocationMessage[],
): DetailedUsage {
  const unique = uniqueUsageMessages(messages);
  const summaries = unique.filter((m) => m.summary);
  const steps = unique.filter((m) => !m.summary);
  const latest = summaries.at(-1);
  const priced = (values: InvocationMessage[]) =>
    values.filter(
      (m) => m.usage.cost_status === "known" && m.usage.cost_usd !== null,
    );
  const floorCandidates: number[] = [];
  const knownSteps = priced(steps);
  if (knownSteps.length)
    floorCandidates.push(knownSteps.reduce((n, m) => n + m.usage.cost_usd!, 0));
  floorCandidates.push(...priced(summaries).map((m) => m.usage.cost_usd!));
  const stepInput = steps.reduce((n, m) => n + m.usage.input_tokens, 0),
    stepOutput = steps.reduce((n, m) => n + m.usage.output_tokens, 0);
  const input = latest
    ? Math.max(...summaries.map((m) => m.usage.input_tokens), stepInput)
    : stepInput;
  const output = latest
    ? Math.max(...summaries.map((m) => m.usage.output_tokens), stepOutput)
    : stepOutput;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output))
    throw new AgentError("corrupt", "Usage token aggregate overflow");
  const floor = floorCandidates.length ? Math.max(...floorCandidates) : null;
  // A query summary covers the whole invocation, including steps delivered later in the stream.
  const selected = latest ? [latest] : steps;
  const complete =
    selected.length > 0 &&
    selected.every(
      (m) => m.usage.cost_status === "known" && m.usage.cost_usd !== null,
    ) &&
    (latest ? latest.usage.cost_usd! >= Math.max(0, ...floorCandidates) : true);
  const total = complete
    ? selected.reduce((n, m) => n + m.usage.cost_usd!, 0)
    : null;
  if (
    (total !== null && !Number.isFinite(total)) ||
    (floor !== null && !Number.isFinite(floor))
  )
    throw new AgentError("corrupt", "Usage price aggregate overflow");
  return {
    input_tokens: input,
    output_tokens: output,
    cost_usd: total,
    cost_status: total === null ? "unknown" : "known",
    known_cost_usd: total ?? floor,
    token_status: latest
      ? latest.usage.input_tokens >= input &&
        latest.usage.output_tokens >= output
        ? "known"
        : "partial"
      : input || output
        ? "partial"
        : "unknown",
    message_count: unique.length,
  };
}
export function aggregateUsage(messages: InvocationMessage[]): Usage {
  const value = detailedUsage(messages);
  return {
    input_tokens: value.input_tokens,
    output_tokens: value.output_tokens,
    cost_usd: value.cost_usd,
    cost_status: value.cost_status,
  };
}
export function invocationUsage(record: InvocationRecord): DetailedUsage {
  validateSchema("invocation", record);
  validUsage(record.usage);
  let observed = record.messages.length
    ? detailedUsage(record.messages)
    : {
        ...record.usage,
        known_cost_usd:
          record.usage.cost_status === "known" ? record.usage.cost_usd : null,
        token_status: "unknown" as const,
        message_count: 0,
      };
  const unresolved = ["prepared", "running", "unknown"].includes(record.status);
  const provenNotStarted =
    record.request_started === false &&
    observed.input_tokens === 0 &&
    observed.output_tokens === 0 &&
    observed.cost_usd === 0 &&
    record.messages.some(
      (m) => m.summary && m.message_id.startsWith("not_started_"),
    );
  if (unresolved && !provenNotStarted)
    observed = {
      ...observed,
      cost_usd: null,
      cost_status: "unknown",
      token_status:
        observed.input_tokens || observed.output_tokens ? "partial" : "unknown",
    };
  return observed;
}
export function aggregateInvocations(records: InvocationRecord[]): Usage {
  const values = new Map<string, InvocationRecord>();
  for (const record of records) {
    const old = values.get(record.invocation_id);
    if (old && canonicalJson(old) !== canonicalJson(record))
      throw new AgentError("corrupt", "Invocation alias conflicts");
    values.set(record.invocation_id, record);
  }
  const totals = sumUsage(
    [...values.values()].map((r) => ({
      usage: invocationUsage(r),
      unresolved: ["prepared", "running", "unknown"].includes(r.status),
    })),
  );
  return {
    input_tokens: totals.input_tokens,
    output_tokens: totals.output_tokens,
    cost_usd: totals.cost_usd,
    cost_status: totals.cost_status,
  };
}
export function beijingDay(utcTimestamp: string): string {
  assertUtcInstant(utcTimestamp, "Invocation started_at");
  const time = Date.parse(utcTimestamp);
  if (!Number.isFinite(time))
    throw new AgentError("corrupt", "Invalid usage date");
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}
export type UsageTotals = UsageTotalsSchemaValue;
export function parseUsageTotals(value: unknown): UsageTotals {
  return validateSchema<UsageTotals>("usage_totals", value);
}
export interface InvocationUsageFact {
  workspace_id: string;
  execution_scope: ExecutionScope;
  invocation_id: string;
  subject_id: string;
  project_id: string | null;
  run_id: string | null;
  beijing_day: string | null;
  capability: string;
  purpose: string;
  model: string;
  sdk_version: string;
  pricing_version: string | null;
  status: InvocationRecord["status"];
  usage: DetailedUsage;
}
export interface UsageGroup {
  execution_scope: ExecutionScope;
  workspace_id: string;
  key: string;
  totals: UsageTotals;
}
export interface UsageLedger {
  schema_version: 1;
  cost_policy: "observe_only";
  basis: "persisted_invocations_sdk_estimates";
  day_basis: "invocation_started_at_in_Asia_Shanghai";
  snapshots: {
    workspace_id: string;
    execution_scope: ExecutionScope;
    revision: string;
    commit_sha256: string;
  }[];
  total: UsageTotals;
  by_scope: Record<ExecutionScope, UsageTotals>;
  by_workspace: UsageGroup[];
  by_project: UsageGroup[];
  by_day: UsageGroup[];
  by_run: UsageGroup[];
  by_capability: UsageGroup[];
  by_purpose: UsageGroup[];
  facts: InvocationUsageFact[];
  unattributed: {
    invocation_id: string;
    workspace_id: string;
    missing: ("run_id" | "started_at" | "project_id")[];
  }[];
}
export function sumUsage(
  values: readonly { usage: DetailedUsage; unresolved: boolean }[],
): UsageTotals {
  const known = values.filter((v) => v.usage.known_cost_usd !== null);
  const knownTotal = known.reduce((n, v) => n + v.usage.known_cost_usd!, 0);
  const totalPrice = values.reduce((n, v) => n + (v.usage.cost_usd ?? 0), 0);
  if (!Number.isFinite(knownTotal) || !Number.isFinite(totalPrice))
    throw new AgentError("corrupt", "Usage price aggregate overflow");
  const allPriced = values.every(
    (v) => v.usage.cost_status === "known" && v.usage.cost_usd !== null,
  );
  const input = values.reduce((n, v) => n + v.usage.input_tokens, 0),
    output = values.reduce((n, v) => n + v.usage.output_tokens, 0);
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output))
    throw new AgentError("corrupt", "Usage aggregate overflow");
  return parseUsageTotals({
    input_tokens: input,
    output_tokens: output,
    cost_usd: allPriced
      ? values.reduce((n, v) => n + v.usage.cost_usd!, 0)
      : null,
    cost_status: allPriced ? "known" : "unknown",
    known_cost_usd: known.length ? knownTotal : values.length ? null : 0,
    token_status: values.every((v) => v.usage.token_status === "known")
      ? "known"
      : values.some((v) => v.usage.token_status !== "unknown")
        ? "partial"
        : "unknown",
    invocation_count: values.length,
    unknown_invocations: values.filter((v) => v.usage.cost_status === "unknown")
      .length,
    unresolved_invocations: values.filter((v) => v.unresolved).length,
    attribution_complete: true,
    unattributed_invocations: 0,
  });
}
const isObject = (
  value: JsonValue | undefined,
): value is { [key: string]: JsonValue } =>
  !!value && typeof value === "object" && !Array.isArray(value);
function projectFor(
  handle: WorkspaceHandle,
  record: InvocationRecord,
  meta: { [key: string]: JsonValue } | undefined,
): string | null {
  if (typeof meta?.project_id === "string") return meta.project_id;
  if (record.subject_id.startsWith("project:"))
    return record.subject_id.slice(8) || null;
  if (handle.records[`projects/${record.subject_id}`]) return record.subject_id;
  if (record.subject_id.startsWith("candidate:")) {
    const identity = handle.records.identity;
    if (isObject(identity) && isObject(identity.candidates)) {
      const candidate = identity.candidates[record.subject_id.slice(10)];
      if (isObject(candidate) && typeof candidate.project_id === "string")
        return candidate.project_id;
    }
  }
  return null;
}
function groups(
  facts: InvocationUsageFact[],
  select: (fact: InvocationUsageFact) => string | null,
): UsageGroup[] {
  const map = new Map<
    string,
    {
      scope: ExecutionScope;
      workspace: string;
      key: string;
      facts: InvocationUsageFact[];
    }
  >();
  for (const fact of facts) {
    const key = select(fact);
    if (key === null) continue;
    const id = canonicalJson([fact.execution_scope, fact.workspace_id, key]);
    const group = map.get(id) ?? {
      scope: fact.execution_scope,
      workspace: fact.workspace_id,
      key,
      facts: [],
    };
    group.facts.push(fact);
    map.set(id, group);
  }
  return [...map.values()]
    .sort((a, b) =>
      canonicalJson([a.scope, a.workspace, a.key]).localeCompare(
        canonicalJson([b.scope, b.workspace, b.key]),
      ),
    )
    .map((g) => ({
      execution_scope: g.scope,
      workspace_id: g.workspace,
      key: g.key,
      totals: sumFacts(g.facts),
    }));
}
function sumFacts(facts: InvocationUsageFact[]): UsageTotals {
  return sumUsage(
    facts.map((f) => ({
      usage: f.usage,
      unresolved: ["prepared", "running", "unknown"].includes(f.status),
    })),
  );
}
/** Read-only aggregation. Callers may checkpoint this view in their own scope, never mutate other scope receipts. */
export function buildUsageLedger(
  handles: readonly WorkspaceHandle[],
): UsageLedger {
  const latest = new Map<string, WorkspaceHandle>();
  for (const handle of handles) {
    const old = latest.get(handle.workspace_id);
    if (old && old.revision !== handle.revision)
      throw new AgentError(
        "conflict",
        "Cannot aggregate multiple revisions of one workspace",
      );
    if (old && old.execution_scope !== handle.execution_scope)
      throw new AgentError("scope", "Workspace scope changed");
    latest.set(handle.workspace_id, handle);
  }
  const facts: InvocationUsageFact[] = [];
  const unattributed: UsageLedger["unattributed"] = [];
  for (const handle of latest.values()) {
    const calls = new Map<string, InvocationRecord>();
    for (const [key, value] of Object.entries(handle.records)) {
      if (!/^(invocations|receipts)\//.test(key)) continue;
      const record = validateSchema<InvocationRecord>("invocation", value);
      if (
        record.execution_scope !== handle.execution_scope ||
        key.slice(key.indexOf("/") + 1) !== record.invocation_id
      )
        throw new AgentError(
          "scope",
          "Invocation record identity or scope mismatch",
        );
      const old = calls.get(record.invocation_id);
      if (old && canonicalJson(old) !== canonicalJson(record))
        throw new AgentError("corrupt", "Invocation alias conflicts");
      calls.set(record.invocation_id, record);
    }
    for (const record of calls.values()) {
      const raw = handle.records[`invocation_meta/${record.invocation_id}`];
      const meta = isObject(raw) ? raw : undefined;
      const run =
        typeof meta?.run_id === "string" && meta.run_id ? meta.run_id : null;
      const started =
        typeof meta?.started_at === "string" ? meta.started_at : null;
      const project = projectFor(handle, record, meta);
      const missing: UsageLedger["unattributed"][number]["missing"] = [];
      if (!run) missing.push("run_id");
      if (!started) missing.push("started_at");
      if (!project) missing.push("project_id");
      if (missing.length)
        unattributed.push({
          invocation_id: record.invocation_id,
          workspace_id: handle.workspace_id,
          missing,
        });
      facts.push({
        workspace_id: handle.workspace_id,
        execution_scope: handle.execution_scope,
        invocation_id: record.invocation_id,
        subject_id: record.subject_id,
        project_id: project,
        run_id: run,
        beijing_day: started ? beijingDay(started) : null,
        capability: record.capability,
        purpose:
          typeof meta?.purpose === "string" ? meta.purpose : "unspecified",
        model: record.model,
        sdk_version: record.sdk_version,
        pricing_version:
          typeof meta?.pricing_version === "string"
            ? meta.pricing_version
            : null,
        status: record.status,
        usage: invocationUsage(record),
      });
    }
  }
  facts.sort((a, b) =>
    canonicalJson([
      a.execution_scope,
      a.workspace_id,
      a.invocation_id,
    ]).localeCompare(
      canonicalJson([b.execution_scope, b.workspace_id, b.invocation_id]),
    ),
  );
  return {
    schema_version: 1,
    cost_policy: "observe_only",
    basis: "persisted_invocations_sdk_estimates",
    day_basis: "invocation_started_at_in_Asia_Shanghai",
    snapshots: [...latest.values()].map((h) => ({
      workspace_id: h.workspace_id,
      execution_scope: h.execution_scope,
      revision: h.revision,
      commit_sha256: h.snapshot.commit_sha256,
    })),
    total: sumFacts(facts),
    by_scope: {
      production: sumFacts(
        facts.filter((f) => f.execution_scope === "production"),
      ),
      preview: sumFacts(facts.filter((f) => f.execution_scope === "preview")),
    },
    by_workspace: groups(facts, (f) => f.workspace_id),
    by_project: groups(facts, (f) => f.project_id),
    by_day: groups(facts, (f) => f.beijing_day),
    by_run: groups(facts, (f) => f.run_id),
    by_capability: groups(facts, (f) => f.capability),
    by_purpose: groups(facts, (f) => f.purpose),
    facts,
    unattributed,
  };
}
function selectedUsage(
  ledger: UsageLedger,
  scope: ExecutionScope,
  workspaceId: string,
  key: string,
  dimension: "run" | "project",
): UsageTotals {
  const groups = dimension === "run" ? ledger.by_run : ledger.by_project;
  const value =
    groups.find(
      (g) =>
        g.execution_scope === scope &&
        g.workspace_id === workspaceId &&
        g.key === key,
    )?.totals ?? sumUsage([]);
  const missing = ledger.facts.filter(
    (f) =>
      f.execution_scope === scope &&
      f.workspace_id === workspaceId &&
      (dimension === "run" ? f.run_id : f.project_id) === null,
  );
  if (!missing.length) return value;
  return {
    ...value,
    cost_usd: null,
    cost_status: "unknown",
    known_cost_usd: value.invocation_count ? value.known_cost_usd : null,
    token_status:
      value.input_tokens || value.output_tokens ? "partial" : "unknown",
    attribution_complete: false,
    unattributed_invocations: missing.length,
  };
}
export function usageForRun(
  ledger: UsageLedger,
  scope: ExecutionScope,
  workspaceId: string,
  runId: string,
): UsageTotals {
  return selectedUsage(ledger, scope, workspaceId, runId, "run");
}
export function usageForProject(
  ledger: UsageLedger,
  scope: ExecutionScope,
  workspaceId: string,
  projectId: string,
): UsageTotals {
  return selectedUsage(ledger, scope, workspaceId, projectId, "project");
}
