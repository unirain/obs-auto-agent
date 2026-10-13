import { it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha256,
  canonicalJson,
  type JsonValue,
  type CheckpointResult,
  type ScopedRecordValidator,
} from "../../src/contracts/index.js";
import {
  validateReadingProjectTransition,
  validateGenerationAuditPreservation,
  READING_PROJECT_STATES,
} from "../../src/contracts/transitions.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import { FileObjectStore } from "../../src/storage/filesystem.js";
const counters = () => ({
  tool_calls: 0,
  supplementary_materials: 0,
  revisions: 0,
  stalled_batches: 0,
  total_tool_calls: 0,
  total_materials: 0,
  download_bytes: 0,
  download_resources: 0,
  total_download_bytes: 0,
});
const base = () => ({
  schema_version: 1,
  project_id: "p",
  workspace_id: "obs-notes-hub/reading",
  execution_scope: "production",
  generation_version: 1,
  state: "discovered",
  created_at: "2026-10-13T00:00:00Z",
  filename: null as string | null,
  note_date: null as string | null,
  context: {
    context_id: sha256("context1"),
    evidence_versions: [sha256("body1")],
    model: "fixed",
    preferences_hash: "fixed",
  },
  candidate: { candidate_id: "c" },
  classification: {
    candidate_id: "c",
    source_snapshot_hash: sha256("body1"),
    semantic_policy_hash: sha256("policy1"),
    attempts: 1,
    format_repairs: 0,
    pending: false,
    credential: { content_eligibility: "allowed" },
  },
  counters: counters(),
  snapshots: [{ url: "https://example.com/article", hash: sha256("body1") }],
  read_ranges: {},
  selection: null as unknown,
  research: null as unknown,
  writing: null as unknown,
  review: null as unknown,
  pending_query: null as unknown,
  writing_activity: null,
  partial_evidence: [],
  partial_questions: [],
  format_blocked: [],
  format_repairs: {},
  delivery_id: null as string | null,
  sources_verified_at: null as string | null,
  resume_stage: null as string | null,
  reason: null as string | null,
  batch_id: "b1",
  last_run_id: "run1",
});
const ok = (r: CheckpointResult) => {
  if (r.status !== "committed") throw new Error(r.status);
  return r.handle;
};
function newGeneration(previous: ReturnType<typeof base>, operator = true) {
  const next = {
    ...base(),
    candidate: previous.candidate,
    generation_version: 2,
    filename: previous.filename,
    note_date: previous.note_date,
    resume_stage: "selection",
    context: {
      ...previous.context,
      context_id: sha256("context2"),
      evidence_versions: [
        ...previous.context.evidence_versions,
        canonicalJson(
          operator
            ? {
                kind: "operator_input",
                guidance: "Changed mechanism question",
                fingerprint: sha256("input2"),
              }
            : { url: "https://example.com/article", hash: sha256("body2") },
        ),
      ],
    },
    ...(operator
      ? {
          classification: previous.classification,
          snapshots: previous.snapshots,
          read_ranges: previous.read_ranges,
        }
      : { classification: null, snapshots: [], read_ranges: {} }),
  };
  return next;
}
it("validates every actual stage before a delivery can progress, and rejects skipped stages or unknown states", () => {
  let previous = base();
  validateReadingProjectTransition(undefined, previous, "project_created");
  const selected = {
    ...previous,
    state: "selected",
    selection: { decision: "research" },
  };
  validateReadingProjectTransition(previous, selected, "selection_result");
  const researched = {
    ...selected,
    state: "researched",
    research: { project_id: "p" },
  };
  validateReadingProjectTransition(selected, researched, "research_complete");
  const drafted = {
    ...researched,
    state: "drafted",
    writing: { note_path: "Organize Notes By AI/note.md" },
    filename: "Organize Notes By AI/note.md",
    note_date: "2026-10-13",
  };
  validateReadingProjectTransition(researched, drafted, "draft_complete");
  const validated = { ...drafted, state: "validated", review: { issues: [] } };
  validateReadingProjectTransition(drafted, validated, "review_result");
  const ready = {
    ...validated,
    state: "ready_for_delivery",
    delivery_id: "d",
    sources_verified_at: "2026-10-13T00:00:00Z",
  };
  validateReadingProjectTransition(validated, ready, "delivery_ready");
  const publishing = { ...ready, state: "publishing" };
  validateReadingProjectTransition(ready, publishing, "publishing_started");
  validateReadingProjectTransition(
    publishing,
    { ...publishing, state: "pr_open" },
    "delivery_result",
  );
  for (const bad of [
    { ...validated, state: "validated" },
    { ...publishing, state: "publishing" },
    { ...previous, state: "unknown_future" },
  ])
    expect(() =>
      validateReadingProjectTransition(previous, bad, "stage_completed"),
    ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      drafted,
      { ...validated, execution_scope: "preview" },
      "review_result",
    ),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      { ...publishing, state: "merged" },
      { ...publishing, state: "discovered" },
      "stage_completed",
    ),
  ).toThrow();
  expect(READING_PROJECT_STATES).toContain("preview_ready");
  expect(READING_PROJECT_STATES).not.toContain("queued");
});
it("committed batch yield resets only per-batch counters, while cumulative budgets and fixed context remain intact", () => {
  const previous = {
    ...base(),
    state: "deferred",
    resume_stage: "research",
    reason: "batch_yield",
    counters: {
      ...counters(),
      tool_calls: 40,
      total_tool_calls: 40,
      download_bytes: 500,
      total_download_bytes: 500,
    },
  };
  const next = {
    ...previous,
    batch_id: "b2",
    last_run_id: "run2",
    counters: { ...previous.counters, tool_calls: 0, download_bytes: 0 },
  };
  validateReadingProjectTransition(previous, next, "batch_claimed");
  expect(() =>
    validateReadingProjectTransition(previous, next, "tool_or_revision_budget"),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      previous,
      { ...next, counters: counters() },
      "batch_claimed",
    ),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      previous,
      { ...next, context: { ...next.context, model: "another" } },
      "batch_claimed",
    ),
  ).toThrow();
});
it("only explicit changed inputs produce g+1; operator preserves source allowance and source changes reset it with registered evidence", () => {
  const previous = {
    ...base(),
    state: "deferred",
    resume_stage: "writing",
    reason: "quality_blocked",
    filename: "Organize Notes By AI/fixed.md",
    note_date: "2026-10-13",
    counters: { ...counters(), revisions: 2, total_tool_calls: 123 },
  };
  const operator = newGeneration(previous);
  validateReadingProjectTransition(
    previous,
    operator,
    "operator_changed_input",
  );
  const changed = newGeneration(previous, false);
  validateReadingProjectTransition(
    previous,
    changed,
    "source_changed_new_generation",
  );
  expect(() =>
    validateReadingProjectTransition(previous, operator, "stage_completed"),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      previous,
      { ...operator, generation_version: 3 },
      "operator_changed_input",
    ),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      previous,
      {
        ...operator,
        classification: { ...previous.classification, attempts: 0 },
      },
      "operator_changed_input",
    ),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      previous,
      {
        ...changed,
        context: {
          ...changed.context,
          evidence_versions: [
            ...previous.context.evidence_versions,
            canonicalJson({
              url: "https://example.com/article",
              hash: sha256("body1"),
            }),
          ],
        },
      },
      "source_changed_new_generation",
    ),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      { ...previous, state: "publishing" },
      operator,
      "operator_changed_input",
    ),
  ).toThrow();
});
it("semantic settlement preserves fixed context/counters and archived binding instead of resetting a known query silently", () => {
  const previous = {
    ...base(),
    state: "researched",
    pending_query: { input_hash: sha256("query") },
  };
  const classification = {
    ...previous.classification,
    semantic_policy_hash: sha256("policy2"),
    attempts: 0,
    format_repairs: 0,
    credential: null,
  };
  const next = {
    ...previous,
    classification,
    pending_query: null,
    reclassification_history: [
      {
        old_binding: previous.classification,
        reason: "semantic_policy_changed",
        new_semantic_hash: classification.semantic_policy_hash,
        recorded_at: "2026-10-13T01:00:00Z",
      },
    ],
  };
  validateReadingProjectTransition(previous, next, "invocation_reconciled");
  expect(() =>
    validateReadingProjectTransition(
      previous,
      { ...next, reclassification_history: [] },
      "invocation_reconciled",
    ),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(previous, next, "classification_result"),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      previous,
      { ...next, counters: { ...next.counters, total_tool_calls: 1 } },
      "invocation_reconciled",
    ),
  ).toThrow();
  expect(() =>
    validateReadingProjectTransition(
      previous,
      {
        ...previous,
        classification: { ...previous.classification, attempts: 0 },
      },
      "classification_result",
    ),
  ).toThrow();
});
it("manager supplies previous full state to the scoped hook; a durable generation preserves unknown historical costs after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-transition-"));
  const store = new FileObjectStore(join(root, "objects"));
  const validator: ScopedRecordValidator = (records, _scope, _id, context) => {
    for (const [key, value] of Object.entries(records))
      if (key.startsWith("projects/") && value !== null) {
        if (context)
          validateReadingProjectTransition(
            context.previous_records[key],
            value,
            context.reason,
          );
      }
  };
  const options = {
    store,
    scope: "production" as const,
    local_root: join(root, "local"),
    verify_preflight: false,
    record_validator: validator,
  };
  const manager = new ImmutableWorkspaceManager(options);
  let h = await manager.restore("obs-notes-hub/reading", {
    allow_initialize: true,
  });
  const previous = base();
  const invocation = {
    schema_version: 1,
    invocation_id: "i",
    execution_scope: "production",
    subject_id: "project:p",
    capability: "research",
    input_hash: sha256("input"),
    context_hash: sha256("ctx"),
    policy_hash: sha256("policy"),
    model: "fixed",
    sdk_version: "fixture",
    status: "prepared",
    messages: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cost_status: "unknown",
      cost_usd: null,
    },
    limits: {},
  };
  h = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "project_created",
      run_id: "r",
      records: {
        "projects/p": previous as unknown as JsonValue,
        "invocations/i": invocation as JsonValue,
        "invocation_meta/i": {
          run_id: "r",
          started_at: "2026-10-13T00:00:00Z",
        },
      },
    }),
  );
  const oldRecords = h.records;
  const generation = newGeneration(previous),
    archive = { schema_version: 1, project: previous };
  const records = {
    "projects/p": generation as unknown as JsonValue,
    "generation-archives/p/g1": archive as unknown as JsonValue,
  };
  validateGenerationAuditPreservation(
    oldRecords,
    { ...oldRecords, ...records },
    "operator_changed_input",
  );
  expect(() =>
    validateGenerationAuditPreservation(
      oldRecords,
      { ...oldRecords, ...records, "invocations/i": null },
      "operator_changed_input",
    ),
  ).toThrow();
  expect(() =>
    validateGenerationAuditPreservation(
      oldRecords,
      { ...oldRecords, ...records, "invocation_meta/i": { run_id: "new" } },
      "operator_changed_input",
    ),
  ).toThrow();
  h = ok(
    await manager.checkpoint(h, {
      expected_revision: h.revision,
      reason: "operator_changed_input",
      run_id: "new",
      records,
    }),
  );
  const next = new ImmutableWorkspaceManager({
    ...options,
    store: new FileObjectStore(store.root),
    local_root: join(root, "restart"),
  });
  const restored = await next.restore(h.workspace_id);
  expect(restored.records["invocations/i"]).toEqual(invocation);
  expect(restored.records["invocation_meta/i"]).toEqual(
    oldRecords["invocation_meta/i"],
  );
  expect((restored.records["projects/p"] as any).generation_version).toBe(2);
});
