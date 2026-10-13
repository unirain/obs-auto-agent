import {
  AgentError,
  canonicalJson,
  type CheckpointChange,
  type WorkspaceHandle,
} from "./index.js";
export type TransitionValidator = (
  handle: WorkspaceHandle,
  change: CheckpointChange,
) => void;
const validators = new Map<string, TransitionValidator>();
const builtinEvents = new Set([
  "collection_committed",
  "manual_submission_committed",
  "policy_checked",
  "invocation_prepared",
  "invocation_observed",
  "invocation_finished",
  "stage_completed",
  "batch_yielded",
  "storage_reserved",
  "storage_reconciled",
  "delivery_sealed",
  "delivery_recorded",
  "run_recorded",
]);
export function registerTransition(
  type: string,
  validator: TransitionValidator,
): void {
  if (validators.has(type))
    throw new AgentError("configuration", "Transition registered twice");
  validators.set(type, validator);
}
const lifecycle: Record<string, string[]> = {
  discovered: ["selected", "skipped", "deferred"],
  selected: ["researching", "researched", "skipped", "deferred"],
  researching: ["researched", "skipped", "deferred"],
  researched: ["drafted", "skipped", "deferred"],
  drafted: ["reviewing", "validated", "preview_ready", "skipped", "deferred"],
  reviewing: ["drafted", "validated", "preview_ready", "deferred"],
  validated: ["ready_for_delivery", "deferred"],
  ready_for_delivery: ["publishing", "deferred"],
  publishing: [
    "pr_open",
    "merged",
    "closed_unmerged",
    "ready_for_delivery",
    "deferred",
  ],
  pr_open: ["merged", "closed_unmerged"],
  deferred: [
    "selected",
    "researching",
    "researched",
    "drafted",
    "reviewing",
    "validated",
    "preview_ready",
    "ready_for_delivery",
    "publishing",
    "pr_open",
    "merged",
    "closed_unmerged",
    "skipped",
  ],
};
export function validateChange(
  handle: WorkspaceHandle,
  change: CheckpointChange,
): void {
  if (!change.reason || !change.run_id)
    throw new AgentError("corrupt", "Checkpoint reason/run required");
  const event = change.event;
  if (!event) return;
  if (
    typeof event.type !== "string" ||
    !event.type ||
    Object.keys(event).some(
      (key) => !["type", "subject_id", "from", "to"].includes(key),
    ) ||
    Object.values(event).some((value) => typeof value !== "string" || !value)
  )
    throw new AgentError("corrupt", "Invalid checkpoint event envelope");
  const v = validators.get(event.type);
  if (v) {
    v(handle, change);
    return;
  }
  if (!builtinEvents.has(event.type))
    throw new AgentError("corrupt", "Unknown checkpoint event type");
  if (event.from !== undefined || event.to !== undefined) {
    if (!event.from || !event.to || !lifecycle[event.from]?.includes(event.to))
      throw new AgentError("corrupt", "Illegal project transition");
    if (
      handle.execution_scope === "preview" &&
      [
        "validated",
        "ready_for_delivery",
        "publishing",
        "pr_open",
        "closed_unmerged",
        "merged",
      ].includes(event.to)
    )
      throw new AgentError("scope", "Preview cannot acquire delivery state");
  }
}

export const READING_PROJECT_STATES = [
  "discovered",
  "selected",
  "researching",
  "researched",
  "drafted",
  "reviewing",
  "validated",
  "preview_ready",
  "ready_for_delivery",
  "publishing",
  "pr_open",
  "merged",
  "closed_unmerged",
  "skipped",
  "deferred",
] as const;
export type ReadingProjectState = (typeof READING_PROJECT_STATES)[number];
const terminalReadingStates = new Set([
  "merged",
  "closed_unmerged",
  "skipped",
  "preview_ready",
]);
function row(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AgentError("corrupt", `${label} project record invalid`);
  return value as Record<string, unknown>;
}
const equivalent = (a: unknown, b: unknown) =>
  canonicalJson(a ?? null) === canonicalJson(b ?? null);
const required = (value: unknown, label: string) => {
  if (!value)
    throw new AgentError("corrupt", `Project transition requires ${label}`);
};
const changedGenerationReasons = new Set([
  "operator_changed_input",
  "source_changed_new_generation",
  "core_source_changed",
]);
const resumedFrom = (
  previous: Record<string, unknown>,
  allowed: string[],
  stage: string,
) =>
  allowed.includes(String(previous.state)) ||
  (previous.state === "deferred" && previous.resume_stage === stage);
function validateStageOutcome(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  reason: string,
): boolean {
  const to = String(next.state);
  if (
    reason === "selection_result" ||
    (reason === "stage_completed" && to === "selected")
  ) {
    if (
      !resumedFrom(previous, ["discovered", "selected"], "selection") ||
      !["selected", "skipped", "deferred"].includes(to)
    )
      return false;
    const selection = row(next.selection, "Selection");
    required(
      selection.decision ===
        (
          {
            selected: "research",
            skipped: "skip",
            deferred: "defer",
          } as Record<string, string>
        )[to],
      "selection decision",
    );
    if (to === "selected")
      required(
        row(row(next.classification, "Classification").credential, "Credential")
          .content_eligibility === "allowed",
        "allowed classification",
      );
    return true;
  }
  if (
    reason === "research_complete" ||
    (reason === "stage_completed" && to === "researched")
  ) {
    if (
      !resumedFrom(
        previous,
        ["selected", "researching", "researched"],
        "research",
      ) ||
      to !== "researched"
    )
      return false;
    required(next.research, "research packet");
    required(
      row(next.selection, "Selection").decision === "research",
      "research selection",
    );
    return true;
  }
  if (
    reason === "draft_complete" ||
    (reason === "stage_completed" && to === "drafted")
  ) {
    if (
      !resumedFrom(previous, ["researched", "drafted"], "writing") ||
      to !== "drafted"
    )
      return false;
    required(next.research, "research packet");
    required(next.writing, "writing artifact");
    return true;
  }
  if (
    reason === "review_result" ||
    (reason === "stage_completed" &&
      ["validated", "preview_ready"].includes(to))
  ) {
    if (
      !resumedFrom(
        previous,
        ["drafted", "reviewing", "validated", "preview_ready"],
        "review",
      ) ||
      !["drafted", "validated", "preview_ready"].includes(to)
    )
      return false;
    required(next.writing, "writing artifact");
    const review = row(next.review, "Review");
    required(Array.isArray(review.issues), "review issues");
    const blocked = (review.issues as unknown[]).some(
      (issue) => row(issue, "Review issue").severity === "blocking",
    );
    if (to !== "drafted") required(!blocked, "review without blocking issues");
    return true;
  }
  return false;
}
function validateClassificationContinuity(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  reason: string,
): void {
  if (!previous.classification) return;
  const old = row(previous.classification, "Previous classification"),
    current = row(next.classification, "Classification");
  if (
    old.candidate_id !== current.candidate_id ||
    old.source_snapshot_hash !== current.source_snapshot_hash
  )
    throw new AgentError("corrupt", "Source binding requires a new generation");
  const semanticChanged =
    old.semantic_policy_hash !== current.semantic_policy_hash;
  const credentialCleared = !!old.credential && !current.credential;
  if (semanticChanged || credentialCleared) {
    required(
      reason === "invocation_reconciled",
      "semantic settlement checkpoint",
    );
    required(
      next.state === previous.state &&
        equivalent(previous.context, next.context) &&
        equivalent(previous.counters, next.counters) &&
        next.pending_query === null,
      "fixed semantic settlement inputs",
    );
    const history = next.reclassification_history as unknown[],
      oldHistory = (previous.reclassification_history ?? []) as unknown[];
    required(
      Array.isArray(history) &&
        history.length === oldHistory.length + 1 &&
        equivalent(history.slice(0, -1), oldHistory),
      "append-only semantic settlement history",
    );
    const entry = row(history.at(-1), "Semantic settlement");
    required(
      equivalent(entry.old_binding, old) &&
        entry.new_semantic_hash === current.semantic_policy_hash &&
        ["semantic_policy_changed", "classification_conflict"].includes(
          String(entry.reason),
        ),
      "previous semantic binding",
    );
    required(
      current.credential === null && current.pending === false,
      "unclassified replacement binding",
    );
    if (semanticChanged)
      required(
        current.attempts === 0 && current.format_repairs === 0,
        "new semantic classification allowance",
      );
  } else
    for (const key of ["attempts", "format_repairs"])
      if (Number(current[key]) < Number(old[key]))
        throw new AgentError(
          "corrupt",
          "Classification allowance cannot reset",
        );
}
function validateNewGeneration(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  reason: string,
): void {
  required(
    changedGenerationReasons.has(reason),
    "explicit changed-input reason",
  );
  if (
    terminalReadingStates.has(String(previous.state)) ||
    ["publishing", "pr_open"].includes(String(previous.state))
  )
    throw new AgentError(
      "corrupt",
      "Remote or terminal project cannot restart",
    );
  required(
    next.generation_version === Number(previous.generation_version) + 1 &&
      next.state === "discovered",
    "next consecutive generation",
  );
  for (const key of [
    "selection",
    "research",
    "writing",
    "review",
    "pending_query",
    "writing_activity",
  ])
    required(next[key] === null, "fresh " + key);
  for (const key of ["partial_evidence", "partial_questions", "format_blocked"])
    required(
      Array.isArray(next[key]) && (next[key] as unknown[]).length === 0,
      "fresh " + key,
    );
  required(equivalent(next.format_repairs, {}), "fresh format repairs");
  required(
    Object.values(row(next.counters, "Counters")).every((value) => value === 0),
    "fresh generation counters",
  );
  required(
    next.delivery_id === null &&
      next.sources_verified_at === null &&
      next.resume_stage === "selection",
    "cleared delivery and stage",
  );
  const prior = row(previous.context, "Previous context"),
    context = row(next.context, "Context");
  required(
    prior.context_id !== context.context_id,
    "changed generation context",
  );
  const oldVersions = prior.evidence_versions as unknown[],
    versions = context.evidence_versions as unknown[];
  required(
    Array.isArray(oldVersions) &&
      Array.isArray(versions) &&
      versions.length > oldVersions.length &&
      equivalent(versions.slice(0, oldVersions.length), oldVersions),
    "append-only generation evidence",
  );
  const additions = versions.slice(oldVersions.length).map((value) => {
    try {
      return row(JSON.parse(String(value)), "Changed input");
    } catch {
      throw new AgentError("corrupt", "Changed generation evidence invalid");
    }
  });
  const fixedFields = [
    "preferences_hash",
    "examples",
    "example_texts",
    "tool_domains",
    "model",
    "model_provider",
    "model_base_url",
    "prompt_hash",
    "prompt_templates",
  ];
  for (const key of fixedFields)
    required(equivalent(prior[key], context[key]), "fixed context " + key);
  if (reason === "operator_changed_input") {
    required(
      additions.some(
        (entry) =>
          entry.kind === "operator_input" &&
          typeof entry.guidance === "string" &&
          entry.guidance.trim() &&
          typeof entry.fingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(entry.fingerprint),
      ),
      "explicit operator guidance",
    );
    required(
      equivalent(previous.classification, next.classification) &&
        equivalent(previous.snapshots, next.snapshots) &&
        equivalent(previous.read_ranges, next.read_ranges),
      "preserved source/classification binding",
    );
  } else {
    for (const key of [
      "skill_commit",
      "skill_hash",
      "runtime_limits",
      "runtime_versions",
      "related_notes",
    ])
      required(
        equivalent(prior[key], context[key]),
        "fixed source-change context " + key,
      );
    required(
      next.classification === null &&
        equivalent(next.snapshots, []) &&
        equivalent(next.read_ranges, {}),
      "fresh source binding",
    );
    const oldSources = [
      ...((previous.snapshots ?? []) as unknown[]),
      ...(((previous.research
        ? row(previous.research, "Research").source_versions
        : []) ?? []) as unknown[]),
    ].map((source) => row(source, "Source"));
    required(
      additions.some(
        (entry) =>
          typeof entry.url === "string" &&
          typeof entry.hash === "string" &&
          /^[a-f0-9]{64}$/.test(entry.hash) &&
          oldSources.some(
            (source) =>
              (source.url === entry.url ||
                source.requested_url === entry.url) &&
              source.hash !== entry.hash,
          ),
      ),
      "changed registered source hash",
    );
  }
}
/** Validates actual host project state changes; business DTO parsing and external fact checks remain with their owners. */
export function validateReadingProjectTransition(
  previous: unknown,
  next: unknown,
  reason: string,
): void {
  const current = row(next, "Next");
  if (
    !READING_PROJECT_STATES.includes(current.state as ReadingProjectState) ||
    !Number.isSafeInteger(current.generation_version) ||
    Number(current.generation_version) < 1
  )
    throw new AgentError("corrupt", "Unknown reading project state/generation");
  if (
    current.execution_scope === "preview" &&
    [
      "validated",
      "ready_for_delivery",
      "publishing",
      "pr_open",
      "merged",
      "closed_unmerged",
    ].includes(String(current.state))
  )
    throw new AgentError("scope", "Preview cannot acquire delivery state");
  if (previous === undefined || previous === null) {
    required(
      current.state === "discovered" && current.generation_version === 1,
      "new discovered project",
    );
    return;
  }
  const old = row(previous, "Previous");
  if (!READING_PROJECT_STATES.includes(old.state as ReadingProjectState))
    throw new AgentError("corrupt", "Unknown previous reading project state");
  for (const key of [
    "schema_version",
    "project_id",
    "workspace_id",
    "execution_scope",
    "created_at",
  ])
    if (!equivalent(old[key], current[key]))
      throw new AgentError("scope", "Immutable project identity changed");
  required(
    row(old.candidate, "Candidate").candidate_id ===
      row(current.candidate, "Candidate").candidate_id,
    "fixed primary candidate",
  );
  for (const key of ["filename", "note_date"])
    if (
      old[key] !== null &&
      old[key] !== undefined &&
      !equivalent(old[key], current[key])
    )
      throw new AgentError("corrupt", "Fixed project filename/date changed");
  if (old.generation_version !== current.generation_version) {
    validateNewGeneration(old, current, reason);
    return;
  }
  if(old.retention_pruned===true) {
    required(equivalent(old,current),"unchanged retained project audit");
    return;
  }
  if (current.retention_pruned === true) {
    required(
      reason === "maintenance_references_detached" &&
        old.state === current.state &&
        terminalReadingStates.has(String(current.state)),
      "terminal retention pruning",
    );
    return;
  }
  required(
    equivalent(old.context, current.context),
    "fixed generation context",
  );
  validateClassificationContinuity(old, current, reason);
  if (old.counters && current.counters) {
    const before = row(old.counters, "Previous counters"),
      after = row(current.counters, "Counters");
    for (const [key, value] of Object.entries(before))
      if (
        typeof value === "number" &&
        (!Number.isSafeInteger(after[key]) || Number(after[key]) < 0)
      )
        throw new AgentError(
          "corrupt",
          "Counter missing or invalid after transition",
        );
    for (const key of [
      "total_tool_calls",
      "total_materials",
      "total_download_bytes",
      "revisions",
    ])
      if (before[key] !== undefined && Number(after[key]) < Number(before[key]))
        throw new AgentError(
          "corrupt",
          "Generation cumulative counters cannot reset",
        );
    const batchReset = [
      "tool_calls",
      "supplementary_materials",
      "download_bytes",
      "download_resources",
    ].some(
      (key) =>
        before[key] !== undefined && Number(after[key]) < Number(before[key]),
    );
    if (batchReset)
      required(
        reason === "batch_claimed" &&
          old.reason === "batch_yield" &&
          old.batch_id !== current.batch_id &&
          old.last_run_id !== current.last_run_id,
        "committed batch yield before counter reset",
      );
  }
  if (old.state === current.state) return;
  if (terminalReadingStates.has(String(old.state)))
    throw new AgentError("corrupt", "Terminal project cannot advance");
  if (validateStageOutcome(old, current, reason)) return;
  const active = [
    "discovered",
    "selected",
    "researching",
    "researched",
    "drafted",
    "reviewing",
    "validated",
    "ready_for_delivery",
    "deferred",
  ];
  if (
    current.state === "deferred" &&
    active.includes(String(old.state)) &&
    [
      "project_transition",
      "stage_yielded",
      "invocation_reconciled",
      "fixed_generation_input_unavailable",
    ].includes(reason)
  ) {
    required(
      current.reason && current.resume_stage,
      "explicit deferred reason/stage",
    );
    return;
  }
  if (
    current.state === "skipped" &&
    active.includes(String(old.state)) &&
    ["stage_yielded", "source_snapshot"].includes(reason)
  ) {
    required(current.reason, "explicit skip reason");
    return;
  }
  if (
    old.state === "selected" &&
    current.state === "researching" &&
    reason === "stage_input_prepared"
  ) {
    required(
      row(current.pending_query, "Pending query").stage === "research",
      "research input",
    );
    return;
  }
  if (
    old.state === "drafted" &&
    current.state === "reviewing" &&
    reason === "stage_input_prepared"
  ) {
    required(
      row(current.pending_query, "Pending query").stage === "review",
      "review input",
    );
    return;
  }
  if (
    current.state === "drafted" &&
    ["reviewing", "validated", "deferred"].includes(String(old.state)) &&
    reason === "review_requires_revision"
  ) {
    required(
      current.resume_stage === "writing" &&
        current.reason === "revision_required",
      "explicit review revision",
    );
    return;
  }
  if (
    old.state === "validated" &&
    current.state === "ready_for_delivery" &&
    reason === "delivery_ready"
  ) {
    required(
      current.delivery_id && current.sources_verified_at,
      "sealed verified delivery",
    );
    return;
  }
  if (
    old.state === "ready_for_delivery" &&
    current.state === "publishing" &&
    reason === "publishing_started"
  ) {
    required(
      current.delivery_id && current.delivery_id === old.delivery_id,
      "existing delivery intent",
    );
    return;
  }
  if (
    [
      "github_reconciled",
      "delivery_result",
      "project_transition",
      "invocation_reconciled",
      "delivery_verification_refreshed",
    ].includes(reason) &&
    ["publishing", "pr_open", "deferred", "ready_for_delivery"].includes(
      String(old.state),
    ) &&
    [
      "publishing",
      "pr_open",
      "merged",
      "closed_unmerged",
      "ready_for_delivery",
      "deferred",
    ].includes(String(current.state))
  ) {
    required(
      old.delivery_id && current.delivery_id,
      "delivery reconciliation binding",
    );
    if (current.delivery_id !== old.delivery_id)
      required(
        reason === "delivery_verification_refreshed" &&
          old.state === "deferred" &&
          current.state === "ready_for_delivery",
        "immutable refreshed delivery",
      );
    return;
  }
  throw new AgentError(
    "corrupt",
    `Illegal reading project transition ${String(old.state)} -> ${String(current.state)} (${reason})`,
  );
}

/** A generation reset cannot erase prior paid facts even if a caller bypasses the app's DTO validator. */
export function validateGenerationAuditPreservation(
  previous: Readonly<Record<string, import("./index.js").JsonValue>>,
  next: Record<string, import("./index.js").JsonValue | null>,
  reason: string,
): void {
  if (!changedGenerationReasons.has(reason)) return;
  for (const [key, value] of Object.entries(previous))
    if (
      /^(invocations|receipts|invocation_meta)\//.test(key) &&
      (!Object.hasOwn(next, key) || !equivalent(value, next[key]))
    )
      throw new AgentError(
        "corrupt",
        "Generation reset cannot change historical invocation/fee facts",
      );
  for (const [key, value] of Object.entries(next)) {
    if (!key.startsWith("projects/") || value === null || !previous[key])
      continue;
    const before = row(previous[key], "Previous"),
      after = row(value, "Next");
    if (before.generation_version === after.generation_version) continue;
    const archive =
      next[
        `generation-archives/${String(before.project_id)}/g${String(before.generation_version)}`
      ];
    required(
      archive && row(archive, "Generation archive").schema_version === 1,
      "versioned previous-generation archive",
    );
  }
}
