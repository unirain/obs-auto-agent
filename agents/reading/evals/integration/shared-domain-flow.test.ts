import { it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileObjectStore } from "../../src/storage/filesystem.js";
import { ImmutableWorkspaceManager } from "../../src/workspace/manager.js";
import {
  WorkspaceJournal,
  ApplicationInvocationJournal,
} from "../../src/app/journal.js";
import { validateHostRecords } from "../../src/app/records.js";
import {ReadingController,type ControllerPorts} from '../../src/app/controller.js';
import {mappedState} from '../../src/app/bootstrap.js';
import {intakeManual} from '../../src/collect/intake.js';
import type {IdentityState} from '../../src/collect/identity.js';
import { parseRunReport, type RunReport } from "../../src/app/run-records.js";
import { buildUsageLedger } from "../../src/workspace/usage.js";
import {
  sealDelivery,
  verifySeal,
  type ArtifactSeal,
} from "../../src/workspace/seal.js";
import { canonicalJson, type JsonValue } from "../../src/contracts/index.js";
import { buildContext } from "../../src/context/index.js";
import {
  discoverCandidate,
  emptyIdentity,
  addCandidate,
} from "../../src/collect/identity.js";
import { emptySourceProgress } from "../../src/collect/sources.js";
import { parseSourceResult } from "../../src/collect/records.js";
import {
  emptySourceHealth,
  applySourceResult,
} from "../../src/collect/incidents.js";
import { parseSourceHealth } from "../../src/monitor/contracts.js";
import {
  PolicyGate,
  credentialValid,
  type PolicySubject,
} from "../../src/policy/gate.js";
import { policyFixture } from "../runtime/policy-fixtures.js";
import { newRuntimeProject } from "../../src/stages/driver.js";
import type { HostProject } from "../../src/app/controller.js";
import {
  StageExecutor,
  stageInputHash,
  type StageExecution,
} from "../../src/stages/executor.js";
import { RunDeadline } from "../../src/runtime/deadline.js";
import { type ModelAdapter } from "../../src/runtime/sdk.js";
import {
  ClassificationSchema,
  SelectionSchema,
  ResearchSchema,
  ReviewSchema,
  StageSchema,
  digest,
  parseModel,
  validateSelection,
  type Classification,
  type ResearchPacket,
  type StageResult,
} from "../../src/stages/contracts.js";
import {
  parseRuntimeProject,
  parseContextBundle,
} from "../../src/stages/records.js";
import { WritingSchema, parseWriting } from "../../src/stages/writing.js";
import {
  validateWriting,
  validateReview,
  type Writing,
} from "../../src/stages/validation.js";
import {
  EvidenceRegistry,
  type MaterialSnapshot,
} from "../../src/tools/evidence.js";
import {
  ResourcePublisher,
  type ImageStore,
  type ResourceCapacity,
} from "../../src/publish/resources.js";
import { Publisher } from "../../src/publish/publisher.js";
import {
  deliveryValidationHash,
  validateDelivery,
} from "../../src/publish/validate.js";
import {
  parseDeliveryRecord,
  parseResourceReceipt,
} from "../../src/publish/contracts.js";
import type {
  SealedDelivery,
  ResourceReceipt,
  PermissionCheck,
} from "../../src/publish/types.js";
import { FakeGitHub } from "../delivery/helpers.js";
import {
  parseDeployment,
  executionTarget,
} from "../../src/config/deployment.js";
import { parseDispatch, dailyLogicalKey } from "../../src/config/dispatch.js";
import {
  readonlyObjectStore,
  readMonitorProjection,
} from "../../src/app/watchdog.js";
import {
  IssueProjector,
  decodeMetadata,
  type IssuePort,
  type IssueFact,
} from "../../src/monitor/issues.js";
import { Watchdog } from "../../src/monitor/main.js";

class Images implements ImageStore {
  objects = new Map<
    string,
    { content: Uint8Array; mime: string; version_id: null }
  >();
  writes = 0;
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async create(key: string, content: Uint8Array, mime: string) {
    if (this.objects.has(key)) throw new Error("immutable image conflict");
    this.writes++;
    this.objects.set(key, { content, mime, version_id: null });
  }
  url(key: string) {
    return `https://images.example/${key}`;
  }
  async accessible(url: string, hash: string) {
    return [...this.objects.entries()].some(
      ([key, item]) => this.url(key) === url && digest(item.content) === hash,
    );
  }
}
class Issues implements IssuePort {
  items: IssueFact[] = [];
  writes = 0;
  notices: string[] = [];
  async list() {
    return structuredClone(this.items);
  }
  async create(_title: string, body: string) {
    this.writes++;
    const row: IssueFact = {
      number: this.items.length + 1,
      body,
      state: "open",
    };
    this.items.push(row);
    return structuredClone(row);
  }
  async update(number: number, body: string, state: "open" | "closed") {
    this.writes++;
    Object.assign(this.items.find((row) => row.number === number)!, {
      body,
      state,
    });
  }
  async comments() {
    return [...this.notices];
  }
  async comment(_number: number, body: string) {
    this.writes++;
    this.notices.push(body);
  }
}

// This is a local, explicitly replayed domain fixture. It supplies no G1 proof, SDK transport,
// RAM permission, live PR or human/visual quality evidence.
it("one complete domain fixture crosses durable source, paid-reply, seal, delivery and readonly monitor boundaries across cold restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "reading-domain-flow-"));
  const at = "2026-10-13T00:00:00Z",
    later = "2026-10-13T01:00:00Z";
  const now = () => new Date(later),
    projectId = "p1",
    key = `projects/${projectId}`;
  const example = JSON.parse(
    await readFile("agents/reading/deploy/examples/integration.json", "utf8"),
  );
  const deployment = parseDeployment({
    ...example,
    target_repository: "test/repo",
    image: {
      ...example.image,
      bucket: "test-image-bucket",
      public_url: "https://images.example/",
    },
  });
  const workspace = deployment.workspace_id;
  const target = executionTarget(
    deployment,
    parseDispatch({ mode: "scheduled" }),
  );
  expect(target.execution_scope).toBe("production");
  const configuration = {
    versioning: "never" as const,
    acl: "private" as const,
    endpoint: "https://oss-cn-beijing.aliyuncs.com",
    lifecycle: [],
    anonymous_readable: false,
  };
  const store = new FileObjectStore(
    join(root, "objects"),
    50_000_000_000,
    configuration,
  );
  const open = async (name: string, initialize = false) => {
    const manager = new ImmutableWorkspaceManager({
      store,
      scope: "production",
      trusted_workspace_id: workspace,
      local_root: join(root, name),
      prefix: deployment.workspace.prefix.replace(/\/$/, ""),
      record_validator: validateHostRecords,
    });
    const handle = await manager.restore(workspace, {
      allow_initialize: initialize,
      run_id: name,
    });
    return { manager, journal: new WorkspaceJournal(manager, handle, name) };
  };
  let { manager, journal } = await open("domain-1", true);
  const policy = policyFixture();
  const url = "https://www.langchain.com/blog/replayed-checkpoints";
  const text =
    "# Durable checkpoint protocol\nIntent is committed before remote writes.\nUnknown response requires reconciliation.\n";
  const snapshot: MaterialSnapshot = {
    url,
    text,
    hash: digest(text),
    retrieved_at: at,
    links: [],
    kind: "web",
  };
  const source = parseSourceResult({
    source_id: "langchain_blog",
    status: "failed",
    reason_code: "fetch_failed",
    attempted_at: at,
    last_success_at: null,
    cursor_before: null,
    cursor_after: null,
    coverage: null,
    coverage_gap: null,
    unsupported: [],
  });
  const health = applySourceResult(
    emptySourceHealth(),
    source,
    workspace,
    "production",
    at,
  );
  const candidate = discoverCandidate(
    "langchain_blog",
    url,
    "Durable checkpoints",
    null,
    at,
  );
  candidate.project_id = projectId;
  candidate.content_hash = snapshot.hash;
  const identity = emptyIdentity();
  addCandidate(identity, candidate);
  const context = buildContext({
    index: [],
    query: "checkpoints",
    heldout: { urls: new Set([url]), note_paths: new Set() },
    preferences_hash: digest("fixture preferences"),
    skill_commit: "b".repeat(40),
    skill_hash: digest("fixture skill basis"),
    prompt_hash: digest("fixture prompts"),
    model: "explicit-replay",
    evidence_versions: [snapshot.hash],
  });
  parseContextBundle(context);
  let project: HostProject = {
    ...newRuntimeProject(candidate, {
      project_id: projectId,
      execution_scope: "production",
      workspace_id: workspace,
      context,
      now: new Date(at),
    }),
    generation_version: 1,
    resume_stage: "selection",
    resume_policy: "automatic",
    reason: null,
    last_run_id: null,
    batch_id: "batch-1",
    delivery_id: null,
    sources_verified_at: null,
    snapshots: [snapshot],
  };
  await journal.commitMany(
    {
      identity,
      [`contexts/${context.context_id}`]: context,
      [key]: project,
      "sources/health": health,
      "sources/langchain_blog/progress": emptySourceProgress(),
      "sources/langchain_blog/result": source,
    },
    "collection_committed",
    [
      {
        path: `projects/${projectId}/sources/main.txt`,
        bytes: Buffer.from(text),
        role: "evidence",
        project_id: projectId,
      },
    ],
  );
  const gate = () =>
    new PolicyGate(
      async () => policy,
      (check) => journal.commit(`policy-checks/${check.check_id}`, check),
      now,
    );
  const subject = (): PolicySubject => ({
    subject_ref: `project:${projectId}`,
    project_id: projectId,
    candidate_id: candidate.candidate_id,
    execution_scope: "production",
    origin_source_ids: candidate.origin_source_ids,
    urls: [url],
    main_url: url,
    source_snapshot_hash: snapshot.hash,
    ...(project.classification?.credential
      ? { classification: project.classification.credential }
      : {}),
  });
  const png = await readFile(
    "agents/reading/evals/runtime/evidence/linux-tools.png",
  );
  const pngPath = "图文件/p1/261013-checkpoint.png",
    svgPath = "图文件/p1/261013-checkpoint.svg";
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="40"><text x="10" y="25">Intent, effect, reconcile</text></svg>',
  );
  const notePath = "Organize Notes By AI/261013-Durable checkpoints.md";
  const markdown = `---\ntitle: Durable checkpoints\nsource: ${url}\ncreated: 2026-10-13\ntags: [agents, persistence, safety]\n---\n# Durable checkpoints\n\n> [!abstract] A replayed protocol example.\n\n## Mechanism\nIntent is committed before remote writes.\n\n![Checkpoint flow](../${pngPath})\n\n## Boundary\nUnknown response requires reconciliation.\n\n| Result | Next step |\n| --- | --- |\n| Unknown | Reconcile |\n\n[Original source](${url})\n`;
  const evidence = [
    {
      evidence_id: "e1",
      source_url: url,
      retrieved_at: at,
      snapshot_hash: snapshot.hash,
      locator: { start_line: 2, end_line: 2 },
      excerpt: "Intent is committed before remote writes.",
      claim: "Intent is committed before remote writes.",
      claim_type: "source_statement" as const,
      limits: [],
      based_on: [],
    },
    {
      evidence_id: "e2",
      source_url: url,
      retrieved_at: at,
      snapshot_hash: snapshot.hash,
      locator: { start_line: 3, end_line: 3 },
      excerpt: "Unknown response requires reconciliation.",
      claim: "Unknown response requires reconciliation.",
      claim_type: "source_statement" as const,
      limits: [],
      based_on: [],
    },
  ];
  const research: ResearchPacket = {
    project_id: projectId,
    questions: [
      { id: "q1", text: "What precedes the effect?", priority: "required" },
      {
        id: "q2",
        text: "What follows an unknown response?",
        priority: "required",
      },
      { id: "q3", text: "What limits blind retry?", priority: "required" },
    ],
    answers: [
      {
        question_id: "q1",
        answer: evidence[0]!.claim,
        evidence_ids: ["e1"],
        source_not_provided: false,
      },
      {
        question_id: "q2",
        answer: evidence[1]!.claim,
        evidence_ids: ["e2"],
        source_not_provided: false,
      },
      {
        question_id: "q3",
        answer: evidence[1]!.claim,
        evidence_ids: ["e2"],
        source_not_provided: false,
      },
    ],
    evidence,
    gaps: [],
    source_versions: [
      { url, hash: snapshot.hash, main: true, core: true, status: "read" },
    ],
    mechanism_evidence_ids: ["e1"],
    boundary_evidence_ids: ["e2"],
    knowledge_increment:
      "Connects durable intent with recovery of uncertain remote results.",
  };
  const writing: Writing = {
    note_path: notePath,
    markdown,
    claims: evidence.map((item, index) => ({
      id: `c${index}`,
      text: item.claim,
      line: markdown.split("\n").indexOf(item.claim) + 1,
      evidence_ids: [item.evidence_id],
      claim_type: "source_statement",
    })),
    figure_plan: [
      {
        section: "Mechanism",
        type: "diagram",
        goal: "Explain intent before effect",
        resource_path: pngPath,
        no_figure_reason: null,
      },
      {
        section: "Boundary",
        type: "table",
        goal: "State the unknown-result boundary",
        resource_path: null,
        no_figure_reason: "The table expresses the boundary.",
      },
    ],
    resources: [
      {
        path: pngPath,
        hash: digest(png),
        mime: "image/png",
        source_path: svgPath,
        caption: "Checkpoint flow",
        visual_check: "passed",
        core: true,
        url: null,
      },
    ],
    degradations: [],
  };
  const classification: Classification = {
    content_eligibility: "allowed",
    content_type: "engineering",
    topic: "agents",
    reason_codes: [],
    evidence: [{ start_line: 2, end_line: 2, excerpt: evidence[0]!.excerpt }],
  };
  const selection = {
    decision: "research",
    reason_codes: [],
    reason: "A concrete recovery mechanism.",
    dimension_ratings: {
      relevance: "strong",
      mechanism: "strong",
      evidence: "strong",
      transferability: "strong",
      increment: "strong",
    },
    questions: research.questions.map((q) => q.text),
    related_note_ids: [],
    evidence_ids: [],
  };
  const outputs: Record<string, unknown> = {
    classification,
    selection,
    research,
    writing,
  };
  const calls: string[] = [];
  const replay: ModelAdapter = {
    async *stream(request) {
      expect(
        journal.keys("invocations/").some((k) => {
          const record = journal.handle.records[k] as { status?: string };
          return record.status === "prepared";
        }),
      ).toBe(true);
      calls.push(request.prompt);
      yield {
        message_id: `replayed-${request.prompt}`,
        type: "result",
        summary: true,
        usage: {
          input_tokens: 5,
          output_tokens: 8,
          cost_usd: null,
          cost_status: "unknown",
        },
        success: true,
        result: outputs[request.prompt],
        observable: { explicit_replay: true },
      };
    },
  };
  const recipes: StageExecution[] = [];
  const stageArtifact = (stage: StageResult["stage"], value: unknown) => {
    const path = `projects/${projectId}/stages/${stage}.json`;
    const bytes = Buffer.from(canonicalJson(value));
    const result = parseModel<StageResult>(StageSchema, {
      project_id: projectId,
      stage,
      decision: "complete",
      artifact_refs: [{ path, hash: digest(bytes) }],
      issues: [],
      resume_hint: null,
    });
    return {
      records: { [`stage-results/${projectId}/${stage}`]: result },
      file: { path, bytes, role: "evidence" as const, project_id: projectId },
    };
  };
  const execute = async (
    name: string,
    schema: object,
    stage: StageExecution["task"]["stage"],
    capability: StageExecution["task"]["capability"],
  ) => {
    const deadline = new RunDeadline();
    const request: StageExecution = {
      task: {
        project_id: projectId,
        stage,
        execution_scope: "production",
        context_id: context.context_id,
        input_hash: "",
        checkpoint: `${name}_query`,
        capability,
        deadline: deadline.generation_deadline,
        workspace_id: workspace,
        state: project.state,
      },
      subject: subject(),
      prompt: name,
      system_prompt:
        "Explicit domain replay; no live quality or transport claim.",
      schema,
      cwd: journal.handle.root_dir,
      model: context.model,
      tools: [],
      deadline,
      semantic_policy_hash: policy.semantic_policy_hash,
      purpose: name === "classification" ? "classification" : "stage",
    };
    request.task.input_hash = stageInputHash(request);
    recipes.push(request);
    const result = await new StageExecutor(
      replay,
      gate(),
      new ApplicationInvocationJournal(journal),
    ).execute(request);
    return result;
  };
  try {
    const classified = await execute(
      "classification",
      ClassificationSchema,
      "selection",
      "classify_only",
    );
    parseModel(ClassificationSchema, classified.result);
    project.classification = {
      candidate_id: candidate.candidate_id,
      source_snapshot_hash: snapshot.hash,
      semantic_policy_hash: policy.semantic_policy_hash,
      attempts: 1,
      format_repairs: 0,
      pending: false,
      credential: {
        candidate_id: candidate.candidate_id,
        source_snapshot_hash: snapshot.hash,
        semantic_policy_hash: policy.semantic_policy_hash,
        content_eligibility: "allowed",
        evidence_hash: digest(canonicalJson(classification.evidence)),
      },
    };
    await journal.commitMany({ [key]: project }, "classification_result");
    const selected = await execute(
      "selection",
      SelectionSchema,
      "selection",
      "select",
    );
    project.selection = validateSelection(selected.result);
    project.state = "selected";
    project.resume_stage = "research";
    const selectionArtifact = stageArtifact("selection", project.selection);
    await journal.commitMany(
      { [key]: project, ...selectionArtifact.records },
      "stage_completed",
      [selectionArtifact.file],
    );
    const researched = await execute(
      "research",
      ResearchSchema,
      "research",
      "research",
    );
    expect(calls).toEqual(["classification", "selection", "research"]);
    // Simulate termination after a complete paid reply, before its stage artifact/project checkpoint.
    ({ manager, journal } = await open("domain-2"));
    project = (await journal.load<HostProject>(key))!;
    parseRuntimeProject(project);
    expect(project.research).toBeNull();
    const oldResearch = recipes.at(-1)!;
    const researchDeadline = new RunDeadline();
    const restoredRequest = {
      ...oldResearch,
      cwd: journal.handle.root_dir,
      deadline: researchDeadline,
      task: {
        ...oldResearch.task,
        deadline: researchDeadline.generation_deadline,
      },
    };
    const resumed = await new StageExecutor(
      replay,
      gate(),
      new ApplicationInvocationJournal(journal),
    ).execute(restoredRequest);
    expect(resumed.invocation_id).toBe(researched.invocation_id);
    expect(calls).toHaveLength(3);
    project.research = new EvidenceRegistry(project.snapshots).validateResearch(
      resumed.result,
    );
    project.partial_evidence = project.research.evidence;
    project.partial_questions = project.research.questions;
    project.state = "researched";
    project.resume_stage = "writing";
    const researchArtifact = stageArtifact("research", project.research);
    await journal.commitMany(
      { [key]: project, ...researchArtifact.records },
      "stage_completed",
      [
        researchArtifact.file,
        {
          path: `projects/${projectId}/research/packet.json`,
          bytes: Buffer.from(canonicalJson(project.research)),
          role: "evidence",
          project_id: projectId,
        },
      ],
    );
    const written = await execute("writing", WritingSchema, "writing", "write");
    project.writing = parseWriting(written.result);
    project.filename = notePath;
    project.note_date = "2026-10-13";
    project.state = "drafted";
    project.resume_stage = "review";
    const assets = { [pngPath]: png, [svgPath]: svg };
    validateWriting(
      project.writing,
      project.research.evidence,
      "production",
      assets,
      false,
      [url],
      [url],
    );
    const writingArtifact = stageArtifact("writing", project.writing);
    await journal.commitMany(
      { [key]: project, ...writingArtifact.records },
      "stage_completed",
      [writingArtifact.file],
    );
    const images = new Images();
    const permission: PermissionCheck = async (capability) =>
      gate().require(
        subject(),
        capability === "upload_resource" ? "upload" : "publish",
        "domain_external_write",
      );
    const capacity: ResourceCapacity = {
      reserve: async (objectKey, bytes) => {
        const id = digest(objectKey);
        await journal.commit(`storage/reservations/${id}`, {
          schema_version: 1,
          reservation_id: id,
          execution_scope: "production",
          bucket: "test-image-bucket",
          key: objectKey,
          version: null,
          expected_bytes: bytes,
          state: "pending",
        });
      },
      confirm: async (objectKey, receipt) => {
        const id = digest(objectKey);
        const old = (await journal.load<Record<string, unknown>>(
          `storage/reservations/${id}`,
        ))!;
        await journal.commitMany(
          {
            [`storage/reservations/${id}`]: {
              ...old,
              version: receipt.version_id,
              state: "confirmed",
            },
            [`resources/${projectId}`]: [receipt],
          },
          "storage_reconciled",
        );
      },
    };
    const resource = await new ResourcePublisher(
      images,
      journal,
      capacity,
      permission,
      deployment.image!.prefix,
      now,
    ).upload({
      project_id: projectId,
      first_generated_date: "2026-10-13",
      article_slug: "checkpoints",
      description: "protocol",
      extension: "png",
      mime: "image/png",
      content: png,
    });
    parseResourceReceipt(resource);
    project.writing = {
      ...project.writing,
      markdown: project.writing.markdown.replace(`../${pngPath}`, resource.url),
      resources: project.writing.resources.map((item) => ({
        ...item,
        url: resource.url,
      })),
    };
    validateWriting(
      project.writing,
      project.research.evidence,
      "production",
      assets,
      true,
      [url],
      [url, resource.url],
    );
    outputs.review = {
      issues: [],
      file_hashes: {
        [notePath]: digest(project.writing.markdown),
        [pngPath]: digest(png),
        [svgPath]: digest(svg),
      },
      resource_manifest_hash: digest(canonicalJson([resource])),
    };
    const reviewed = await execute("review", ReviewSchema, "review", "review");
    project.review = validateReview(
      reviewed.result,
      project.writing,
      assets,
      digest(canonicalJson([resource])),
    );
    project.state = "validated";
    project.resume_stage = null;
    const draftPrefix = `projects/${projectId}/draft/`;
    const reviewArtifact = stageArtifact("review", project.review);
    await journal.commitMany(
      { [key]: project, ...reviewArtifact.records },
      "stage_completed",
      [
        reviewArtifact.file,
        {
          path: draftPrefix + notePath,
          bytes: Buffer.from(project.writing.markdown),
          role: "output",
          project_id: projectId,
        },
        {
          path: draftPrefix + svgPath,
          bytes: svg,
          role: "artifact",
          project_id: projectId,
        },
        {
          path: draftPrefix + pngPath,
          bytes: png,
          role: "input",
          project_id: projectId,
        },
      ],
    );
    const seal = await sealDelivery(journal.handle, projectId, {
      review_passed: true,
      program_checks_passed: true,
      input_revision: journal.handle.revision,
      resources: JSON.parse(canonicalJson([resource])) as JsonValue,
    });
    await verifySeal(journal.handle, seal);
    const note = Buffer.from(project.writing.markdown);
    const delivery: SealedDelivery = {
      schema_version: 1,
      delivery_id: "domain_delivery",
      execution_scope: "production",
      workspace_id: workspace,
      project_id: projectId,
      generation_version: 1,
      workspace_revision: seal.workspace_revision,
      context_id: context.context_id,
      base_commit: "b".repeat(40),
      sources_verified_at: later,
      files: [
        {
          path: notePath,
          role: "note",
          mime: "text/markdown",
          bytes: note.length,
          sha256: digest(note),
          content: note,
        },
        {
          path: svgPath,
          role: "diagram_source",
          mime: "image/svg+xml",
          bytes: svg.length,
          sha256: digest(svg),
          content: svg,
        },
      ],
      resources: [resource],
      sources: [url],
      quality_report: {
        program_checks: "passed",
        review: "explicit_model_replay",
        live_quality: "not_exercised",
        artifact_seal_hash: seal.validated_hash,
      },
      rationale: project.selection!.reason,
      knowledge_increment: project.research.knowledge_increment,
      gaps: [],
      image_degradations: [],
      usage: { status: "unknown", estimated_usd: null },
      warnings: [
        "Explicit replay: no G1, live transport or human quality proof.",
      ],
      validated_hash: "",
    };
    delivery.validated_hash = deliveryValidationHash(delivery);
    validateDelivery(delivery, {
      id: workspace,
      revision: seal.workspace_revision,
    });
    project.delivery_id = delivery.delivery_id;
    project.sources_verified_at = later;
    project.state = "ready_for_delivery";
    await journal.commitMany(
      { [key]: project, [`artifact-seals/${delivery.delivery_id}`]: seal },
      "delivery_ready",
    );
    project.state = "publishing";
    await journal.commitMany({ [key]: project }, "publishing_started");
    const remote = new FakeGitHub();
    remote.failure = "pr";
    const publisher = () =>
      new Publisher(remote, journal, permission, {
        workspace_id: workspace,
        committedRevision: async () => journal.handle.revision,
        classificationCurrent: async (value) =>
          value.context_id === project.context.context_id &&
          credentialValid(subject(), await gate().current()) &&
          project.classification?.credential?.content_eligibility === "allowed",
        identity: { name: "Replay Bot", email: "replay@example.com" },
        now,
        verifyCommittedDelivery: async (value) => {
          const artifact = (await journal.load<ArtifactSeal>(
            `artifact-seals/${value.delivery_id}`,
          ))!;
          const historical = await manager.restoreRevision(
            workspace,
            value.workspace_revision,
          );
          await verifySeal(historical, artifact);
          for (const file of value.files)
            expect(
              artifact.files.find((f) => f.path === draftPrefix + file.path)
                ?.sha256,
            ).toBe(file.sha256);
        },
      });
    await expect(publisher().publish(delivery)).rejects.toThrow(
      "PR response lost",
    );
    expect(remote.calls.filter((action) => action === "pr")).toHaveLength(1);
    expect(
      await journal.load(`delivery-${delivery.delivery_id}`),
    ).toMatchObject({ uncertain_action: "create_pr" });
    // Cold restart after the remote PR exists but its response was lost. No replacement PR or query.
    ({ manager, journal } = await open("domain-3"));
    project = (await journal.load<HostProject>(key))!;
    remote.failure = null;
    const delivered = await publisher().publish(delivery);
    parseDeliveryRecord(delivered);
    expect(delivered.status).toBe("awaiting_review");
    expect(delivered.pr?.number).toBe(1);
    project.state = "pr_open";
    await journal.commitMany({ [key]: project }, "delivery_result");
    expect(calls).toEqual([
      "classification",
      "selection",
      "research",
      "writing",
      "review",
    ]);
    const report = (): RunReport =>
      parseRunReport({
        schema_version: 1,
        run_id: journal.run_id,
        logical_key: dailyLogicalKey(now()),
        workspace_id: workspace,
        execution_scope: "production",
        mode: "scheduled",
        input_commit: null,
        versions: {
          implementation_commit: null,
          projects: [
            {
              project_id: projectId,
              generation_version: 1,
              context_id: context.context_id,
              skill_commit: context.skill_commit,
              skill_hash: context.skill_hash,
              prompt_hash: context.prompt_hash,
              model: context.model,
              runtime_versions: null,
            },
          ],
        },
        policy_check_refs: journal
          .keys("policy-checks/")
          .map((key) => key.slice("policy-checks/".length)),
        started_at: at,
        finished_at: later,
        outcome: "partial",
        source_results: [source],
        project_ids: [projectId],
        usage: buildUsageLedger([journal.handle]).total,
        failures: [{ subject: "langchain_blog", reason: "fetch_failed" }],
        delivery_results: [{ project_id: projectId, state: "pr_open" }],
        blocked_projects: [],
      });
    await journal.commit(`runs/${journal.run_id}`, report());
    const issues = new Issues();
    const monitor = async () => {
      const view = await readMonitorProjection(
        readonlyObjectStore(store),
        deployment,
      );
      return new Watchdog(
        new IssueProjector(issues, async () => {}),
        async () => view.events,
        async () => ({ global: false, disabled_sources: [] }),
      ).run();
    };
    store.calls.length = 0;
    await monitor();
    expect(issues.items).toHaveLength(1);
    expect(issues.items[0]?.state).toBe("open");
    expect(decodeMetadata(issues.items[0]!.body)?.reason_code).toBe(
      "fetch_failed",
    );
    expect(
      store.calls.some((call) => call.key.endsWith("/blobs/" + snapshot.hash)),
    ).toBe(false);
    expect(
      store.calls.every(
        (call) => !["create", "delete"].includes(call.operation),
      ),
    ).toBe(true);
    const external = {
      model: calls.length,
      images: images.writes,
      github: [...remote.calls],
      issues: issues.writes,
      notices: [...issues.notices],
    };
    // A full second round starts with a separate manager and validated consecutive immutable chain.
    ({ manager, journal } = await open("domain-4"));
    project = (await journal.load<HostProject>(key))!;
    parseRuntimeProject(project);
    for (const stage of [
      "selection",
      "research",
      "writing",
      "review",
    ] as const) {
      const result = parseModel<StageResult>(
        StageSchema,
        await journal.load(`stage-results/${projectId}/${stage}`),
      );
      expect(result.decision).toBe("complete");
      for (const ref of result.artifact_refs) {
        expect(
          digest(await readFile(join(journal.handle.root_dir, ref.path))),
        ).toBe(ref.hash);
        expect(
          journal.handle.snapshot.manifest.files.some(
            (file) =>
              file.path === ref.path &&
              file.sha256 === ref.hash &&
              file.project_id === projectId,
          ),
        ).toBe(true);
      }
    }
    for (const recipe of recipes) {
      const deadline = new RunDeadline();
      const cached = await new StageExecutor(
        replay,
        gate(),
        new ApplicationInvocationJournal(journal),
      ).execute({
        ...recipe,
        cwd: journal.handle.root_dir,
        deadline,
        task: { ...recipe.task, deadline: deadline.generation_deadline },
      });
      expect(cached.invocation_id).toMatch(/^inv_/);
    }
    expect(
      (await publisher().publish(delivery, "publish-only")).pr?.number,
    ).toBe(1);
    expect(
      await new ResourcePublisher(
        images,
        journal,
        capacity,
        permission,
        deployment.image!.prefix,
        now,
      ).upload({
        project_id: projectId,
        first_generated_date: "2026-10-13",
        article_slug: "checkpoints",
        description: "protocol",
        extension: "png",
        mime: "image/png",
        content: png,
      }),
    ).toEqual(resource);
    const secondHealth = applySourceResult(
      parseSourceHealth(await journal.load("sources/health")),
      { ...source, attempted_at: later },
      workspace,
      "production",
      later,
    );
    expect(
      secondHealth.active["langchain_blog:fetch_failed"]?.consecutive_failures,
    ).toBe(2);
    await journal.commitMany(
      {
        "sources/health": secondHealth,
        "sources/langchain_blog/result": { ...source, attempted_at: later },
        [`runs/${journal.run_id}`]: report(),
      },
      "run_recorded",
    );
    await monitor();
    expect({
      model: calls.length,
      images: images.writes,
      github: remote.calls,
      issues: issues.writes,
      notices: issues.notices,
    }).toEqual(external);
    expect(decodeMetadata(issues.items[0]!.body)?.status).toBe("active");
    expect((await journal.load<HostProject>(key))?.state).toBe("pr_open");
    expect(buildUsageLedger([journal.handle]).total).toMatchObject({
      invocation_count: 5,
      cost_status: "unknown",
      cost_usd: null,
    });
    expect(
      parseRunReport(await journal.load(`runs/${journal.run_id}`)).versions
        .projects[0]?.context_id,
    ).toBe(context.context_id);
    expect(journal.keys("invocations/")).toHaveLength(5);
    expect(journal.keys("policy-checks/").length).toBeGreaterThan(5);
    // The first real replayed research and Fake PR already exist. Manual receipt
    // response loss and a second submission ID must reuse that logical delivery.
    const manualInput={submission_id:'manual-repeat-1',urls:[url+'?utm_source=manual'],submitted_by:'owner',submitted_at:later,execution_scope:'production' as const};
    const intakePort=()=>({read:async()=>await journal.load<IdentityState>('identity')??emptyIdentity(),commit:async(value:IdentityState,reason:string)=>{await journal.commitMany({identity:value},reason);throw new Error('manual_receipt_reply_lost');}});
    await expect(intakeManual(intakePort(),gate(),manualInput)).rejects.toThrow('manual_receipt_reply_lost');
    await rm(journal.handle.root_dir,{recursive:true,force:true});({manager,journal}=await open('domain-manual-cold'));project=(await journal.load<HostProject>(key))!;
    const prEffects=[...remote.calls];
    const ports:ControllerPorts={journal,gate:gate(),deadline:new RunDeadline(),sources:[],now:()=>new Date(),
      context:async()=>{throw new Error('duplicate_project_context');},environment:async()=>{throw new Error('duplicate_research_environment');},prepareResources:async()=>{throw new Error('duplicate_image_upload');},verifySources:async()=>{throw new Error('duplicate_source_verification');},seal:async()=>{throw new Error('duplicate_seal');},publish:async()=>{throw new Error('duplicate_pr');},
      reconcile:async current=>{const facts=await publisher().reconcile(delivery);const record=facts.find(fact=>fact.delivery_id===current.delivery_id)!;return mappedState(current,record);},
    };
    const controller=new ReadingController(ports);
    await controller.run(parseDispatch({mode:'scheduled',input_urls:manualInput.urls,submission_id:manualInput.submission_id}),'owner');
    await controller.run(parseDispatch({mode:'scheduled',input_urls:[url],submission_id:'manual-repeat-2'}),'owner');
    const currentIdentity=(await journal.load<IdentityState>('identity'))!;
    expect(Object.values(currentIdentity.candidates)).toHaveLength(1);expect(journal.keys('projects/')).toEqual([key]);
    expect(currentIdentity.candidates[candidate.candidate_id]).toMatchObject({status:'pr_open',project_id:projectId,pr_number:1});
    expect(currentIdentity.candidates[candidate.candidate_id]!.submission_refs).toEqual(['manual-repeat-1','manual-repeat-2']);
    expect(currentIdentity.submissions['manual-repeat-2']!.items[0]).toMatchObject({status:'already_known',project_id:projectId,pr_number:1,candidate_status:'pr_open'});
    // The first immutable receipt can predate synchronization, but replay returns
    // the current confirmed PR rather than changing or recreating the receipt.
    const replayPort={read:async()=>currentIdentity,commit:async()=>{throw new Error('duplicate_intake_commit');}};
    expect((await intakeManual(replayPort,gate(),manualInput)).items[0]).toMatchObject({project_id:projectId,pr_number:1,candidate_status:'pr_open'});
    expect(calls).toEqual(['classification','selection','research','writing','review']);expect(journal.keys('invocations/')).toHaveLength(5);expect(remote.calls).toEqual(prEffects);
    expect(()=>mappedState(project,{...delivered,generation_version:2})).toThrow('delivery_project_binding_mismatch');
    expect(() =>
      executionTarget(deployment, parseDispatch({ input_urls: [url] })),
    ).toThrow("scope mismatch");
    const previewStore = new FileObjectStore(
      join(root, "preview-objects"),
      50_000_000_000,
      configuration,
    );
    const previewManager = new ImmutableWorkspaceManager({
      store: previewStore,
      scope: "preview",
      local_root: join(root, "preview"),
      prefix: "reading-agent/preview",
      record_validator: validateHostRecords,
    });
    const previewHandle = await previewManager.restore(
      "obs-notes-hub/reading-preview/domain-preview",
      { allow_initialize: true },
    );
    await expect(
      sealDelivery(previewHandle, projectId, {
        review_passed: true,
        program_checks_passed: true,
        input_revision: previewHandle.revision,
        resources: [],
      }),
    ).rejects.toThrow("Preview cannot seal");
    const previewJournal = new WorkspaceJournal(
      previewManager,
      previewHandle,
      "preview-guard",
    );
    const previewGate = new PolicyGate(
      async () => policy,
      (check) =>
        previewJournal.commit(`policy-checks/${check.check_id}`, check),
      now,
    );
    await expect(
      previewGate.require(
        { ...subject(), execution_scope: "preview" },
        "publish",
        "preview_publish_guard",
      ),
    ).rejects.toThrow("preview_no_write");
    expect(remote.calls).toEqual(external.github);
    expect(images.writes).toBe(external.images);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
