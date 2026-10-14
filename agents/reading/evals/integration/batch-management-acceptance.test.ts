import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect, it} from 'vitest';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal, ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {ReadingController, type HostProject, type ControllerPorts} from '../../src/app/controller.js';
import {mappedState} from '../../src/app/bootstrap.js';
import {applyRecovery} from '../../src/app/recovery.js';
import {buildContext, indexNote} from '../../src/context/index.js';
import {fixedOperatorGuidance} from '../../src/context/operator-input.js';
import {discoverCandidate, emptyIdentity, addCandidate} from '../../src/collect/identity.js';
import {canonicalJson} from '../../src/contracts/index.js';
import {newRuntimeProject} from '../../src/stages/driver.js';
import {StageExecutor} from '../../src/stages/executor.js';
import {digest, type Evidence, type ResearchPacket} from '../../src/stages/contracts.js';
import {type Writing} from '../../src/stages/validation.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {RunDeadline, type Counters} from '../../src/runtime/deadline.js';
import {type ModelAdapter} from '../../src/runtime/sdk.js';
import {UrlGateway} from '../../src/tools/fetch.js';
import {type SourceSlice} from '../../src/tools/segments.js';
import {type MaterialSnapshot, EvidenceRegistry} from '../../src/tools/evidence.js';
import {type SkillBundle} from '../../src/tools/skills.js';
import {parseDispatch} from '../../src/config/dispatch.js';
import {Publisher} from '../../src/publish/publisher.js';
import {type SealedDelivery} from '../../src/publish/types.js';
import {deliveryValidationHash} from '../../src/publish/validate.js';
import {sealDelivery, verifySeal, type ArtifactSeal} from '../../src/workspace/seal.js';
import {FakeGitHub, sealed as readinessProbe} from '../delivery/helpers.js';
import {policyFixture} from '../runtime/policy-fixtures.js';

type Scenario = 'tools' | 'materials' | 'stalled' | 'quality' | 'pause';
const sourceUrl = 'https://independent.dev/checkpoint';
const body = '# Checkpoint\nCommit intent before effects.\nOne writer is required.';
const questions: ResearchPacket['questions'] = [{id: 'q1', text: 'What comes first?', priority: 'required'},
  {id: 'q2', text: 'What writer boundary applies?', priority: 'required'}, {id: 'q3', text: 'What experiment is reported?', priority: 'required'}];
const guidance = 'Use the fixed single-writer evidence and finish the unresolved comparison; do not generalize to concurrent writers.';

/** Explicit model/HTTP/GitHub replay, real driver/controller/manager/recovery. No live service credentials. */
async function fixture(scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), 'reading-batch-management-'));
  const scope = scenario === 'stalled' || scenario === 'quality' ? 'production' as const : 'preview' as const;
  const workspace = scope === 'production' ? 'obs-notes-hub/reading-integration' : 'obs-notes-hub/reading-preview/batch-' + scenario;
  const store = new FileObjectStore(join(root, 'objects'));
  let manager!: ImmutableWorkspaceManager;
  let journal!: WorkspaceJournal;
  let clock = Date.now();
  const now = () => new Date(Math.max(clock, Date.now()));
  const open = async (run: string, initialize = false) => {
    manager = new ImmutableWorkspaceManager({store, scope, trusted_workspace_id: 'obs-notes-hub/reading-integration',
      verify_preflight: false, local_root: join(root, run), record_validator: validateHostRecords});
    journal = new WorkspaceJournal(manager, await manager.restore(workspace, {allow_initialize: initialize, run_id: run}), run);
  };
  await open('batch-first', true);
  const templates = Object.fromEntries(await Promise.all(['selection', 'research', 'writing', 'review'].map(async stage =>
    [stage, await readFile(`agents/reading/prompts/${stage}.md`, 'utf8')])));
  const skillRoot = join(root, 'trusted-skills');
  const skillTexts = {
    '.agents/skills/obsidian-note/SKILL.md': 'Write the fixed checkpoint mechanism and show its single-writer boundary.',
    '.agents/skills/obsidian-note/references/diagram-playbook.md': 'A simple ordering may use Mermaid; use an inline card for a boundary.',
  };
  const hashes = Object.fromEntries(Object.entries(skillTexts).map(([file, text]) => [file, digest(text)]));
  for (const [file, text] of Object.entries(skillTexts)) {
    await mkdir(dirname(join(skillRoot, file)), {recursive: true}); await writeFile(join(skillRoot, file), text);
  }
  const skills: SkillBundle = {root: skillRoot, commit: 'b'.repeat(40), hash: digest(canonicalJson(hashes)), files: hashes, adapted: true};
  const exampleText = '---\ntitle: Checkpoint quality example\ncreated: 2026-10-13\ntags: [agents, recovery, engineering]\nsource: https://example.org/quality-example\n---\n# Checkpoint quality example\nExplain ordering and its boundary.';
  const example = indexNote({path: 'Organize Notes By AI/261013-Checkpoint quality example.md', text: exampleText,
    commit: 'c'.repeat(40), first_added_at: '2026-10-13T00:00:00Z'});
  const context = buildContext({index: [example], query: 'checkpoint', heldout: {urls: new Set([sourceUrl]), note_paths: new Set()},
    preferences_hash: digest('fixed batch preferences'), skill_commit: skills.commit, skill_hash: skills.hash,
    prompt_templates: templates, prompt_hash: digest(Buffer.concat(['selection', 'research', 'writing', 'review'].map(stage => Buffer.from(templates[stage]!)))),
    model: 'explicit-replay', evidence_versions: []});
  const candidate = discoverCandidate('manual_url', sourceUrl, 'Checkpoint', null, now().toISOString());
  candidate.project_id = 'batch_project'; candidate.content_hash = digest(body);
  const materialUrls = scenario === 'materials' ? Array.from({length: 9}, (_, index) => `https://arxiv.org/html/batch-fixture-${index}`) : [];
  const snapshot: MaterialSnapshot = {url: sourceUrl, text: body, hash: digest(body), retrieved_at: now().toISOString(), links: materialUrls, kind: 'web'};
  const evidence: Evidence[] = [
    {evidence_id: 'e1', source_url: sourceUrl, retrieved_at: snapshot.retrieved_at, snapshot_hash: snapshot.hash,
      locator: {start_line: 2, end_line: 2}, excerpt: 'Commit intent before effects.', claim: 'Intent precedes effects.', claim_type: 'source_statement', limits: [], based_on: []},
    {evidence_id: 'e2', source_url: sourceUrl, retrieved_at: snapshot.retrieved_at, snapshot_hash: snapshot.hash,
      locator: {start_line: 3, end_line: 3}, excerpt: 'One writer is required.', claim: 'One writer is required.', claim_type: 'source_statement', limits: [], based_on: []},
  ];
  const packet = (supplementary: {url: string; hash: string}[] = [], incomplete = false): ResearchPacket => ({project_id: candidate.project_id!, questions,
    answers: [{question_id: 'q1', answer: 'Commit intent before effects.', evidence_ids: ['e1'], source_not_provided: false},
      {question_id: 'q2', answer: 'One writer.', evidence_ids: ['e2'], source_not_provided: false},
      {question_id: 'q3', answer: null, evidence_ids: [], source_not_provided: true}],
    evidence, gaps: incomplete ? [{url: materialUrls[8]!, reason: 'batch_yield', core: true}] : [],
    source_versions: [{url: sourceUrl, hash: snapshot.hash, main: true, core: true, status: 'read'},
      ...supplementary.map(material => ({...material, main: false, core: true, status: 'read' as const}))],
    mechanism_evidence_ids: ['e1'], boundary_evidence_ids: ['e2'], knowledge_increment: 'An explicit ordering with the single-writer boundary.'});
  let project: HostProject = {...newRuntimeProject(candidate, {project_id: candidate.project_id, execution_scope: scope,
    workspace_id: workspace, context, now: now()}), generation_version: 1, resume_stage: null, resume_policy: 'automatic', reason: null,
    last_run_id: null, batch_id: 'batch-seed', delivery_id: null, sources_verified_at: null, snapshots: [snapshot],
    read_ranges: {[snapshot.hash]: [{page: null, start_line: 1, end_line: 3, start_char: null, end_char: null}]}};
  const projectKey = 'projects/' + candidate.project_id;
  const identity = emptyIdentity(); addCandidate(identity, candidate);
  await journal.commitMany({identity, [projectKey]: project, ['contexts/' + context.context_id]: context}, 'collection_committed');
  const policy = policyFixture();
  project.classification = {candidate_id: candidate.candidate_id, source_snapshot_hash: snapshot.hash,
    semantic_policy_hash: policy.semantic_policy_hash, attempts: 1, format_repairs: 0, pending: false,
    credential: {candidate_id: candidate.candidate_id, source_snapshot_hash: snapshot.hash,
      semantic_policy_hash: policy.semantic_policy_hash, content_eligibility: 'allowed', evidence_hash: digest('fixed classification')}};
  project.selection = {decision: 'research', reason_codes: [], reason: 'A concrete ordering and boundary.',
    dimension_ratings: {relevance: 'strong', mechanism: 'strong', evidence: 'strong', transferability: 'strong', increment: 'strong'},
    questions: questions.map(question => question.text), related_note_ids: [], evidence_ids: []};
  project.state = 'selected';
  await journal.commitMany({[projectKey]: project}, 'selection_result');
  if (scenario === 'stalled') {
    // An existing, valid earlier subtask is the baseline. Repeating it is not new progress.
    project.research = packet(); project.partial_questions = questions; project.partial_evidence = evidence;
    await journal.commitMany({[projectKey]: project}, 'research_incomplete');
  }
  const gate = () => new PolicyGate(async () => policy, check => journal.commit('policy-checks/' + check.check_id, check), now);
  const queries: {stage: string; generation: number; counters: Counters}[] = [];
  const http: string[] = [];
  let pauseApplied = false;
  const external = {uploads: 0, seals: 0, prs: 0};
  const remote = new FakeGitHub();
  const createPR = remote.createPR.bind(remote);
  remote.createPR = async (branch, title, body) => {external.prs++; return createPR(branch, title, body);};
  let delivery: SealedDelivery | null = null;
  const publisher = () => new Publisher(remote, journal, async () => {}, {workspace_id: workspace,
    committedRevision: async () => journal.handle.revision, classificationCurrent: async () => true, now,
    identity: {name: 'Replay Bot', email: 'replay@example.com'}, verifyCommittedDelivery: async value => {
      const seal = (await journal.load<ArtifactSeal>('artifact-seals/' + value.delivery_id))!;
      await verifySeal(await manager.restoreRevision(workspace, seal.workspace_revision), seal);
      for (const file of value.files) expect(seal.files.find(item => item.path === `projects/${value.project_id}/draft/${file.path}`)?.sha256).toBe(file.sha256);
    }});
  const model: ModelAdapter = {async *stream(request) {
    const current = (await journal.load<HostProject>(projectKey))!;
    const payload = JSON.parse(request.prompt) as {task: string; data: Record<string, unknown>; context: typeof context};
    queries.push({stage: payload.task, generation: current.generation_version, counters: structuredClone(current.counters)});
    expect(current.context.skill_commit).toBe(skills.commit); expect(current.context.skill_hash).toBe(skills.hash);
    expect(current.context.example_texts).toEqual(context.example_texts);
    if (current.generation_version > 1) expect(request.system_prompt).toContain(guidance);
    const call = async (name: string, args: Record<string, unknown> = {}) => request.tools.find(tool => tool.name === name)!.run(args);
    let result: unknown;
    if (payload.task === 'selection') {
      await call('read_main');
      result = project.selection;
    } else if (payload.task === 'research') {
      const main = await call('read_main') as SourceSlice;
      expect(main.lines.map(line => line.text).join('\n')).toBe(body);
      await call('plan_research', {questions});
      const priorEvidence = payload.data.evidence as Evidence[];
      for (const item of evidence) if (!priorEvidence.some(prior => prior.evidence_id === item.evidence_id)) await call('record_evidence', {evidence: item});
      if (scenario === 'tools' && !payload.data.checkpoint) {
        while ((await journal.load<HostProject>(projectKey))!.counters.tool_calls < 40) await call('read_candidate');
        await expect(call('read_candidate')).rejects.toThrow('batch_yield');
        result = {decision: 'batch_yield', reason: 'batch_yield', packet: packet()};
      } else if (scenario === 'materials') {
        const previous = (payload.data.snapshots as {url: string; hash: string}[]).filter(material => material.url !== sourceUrl)
          .map(material => ({url: material.url, hash: material.hash}));
        const supplementary = [...previous];
        const remaining = materialUrls.filter(url => !previous.some(material => material.url === url));
        let exhausted = false;
        for (const url of remaining) {
          try {const material = await call('follow_reference', {from_hash: main.hash, url}) as SourceSlice;
            supplementary.push({url: material.url, hash: material.hash});}
          catch (error) {expect(error instanceof Error ? error.message : '').toBe('batch_yield'); exhausted = true; break;}
        }
        result = exhausted ? {decision: 'batch_yield', reason: 'batch_yield', packet: packet(supplementary, true)} : packet(supplementary);
      } else if (scenario === 'stalled' && current.generation_version === 1) {
        result = {decision: 'defer', reason: 'additional_validation_needed', packet: packet()};
      } else result = packet();
    } else if (payload.task === 'writing') {
      const activated = await call('activate_skill', {name: 'obsidian-note'}) as {text: string};
      expect(activated.text).toBe(skillTexts['.agents/skills/obsidian-note/SKILL.md']);
      const playbook = await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'}) as {text: string};
      expect(playbook.text).toBe(skillTexts['.agents/skills/obsidian-note/references/diagram-playbook.md']);
      expect(payload.context.example_texts).toEqual(context.example_texts);
      const date = String(payload.data.created);
      const mechanism = 'Commit intent before effects.';
      const boundary = scenario === 'quality' && current.generation_version === 1 ? `Concurrent writers are safe (revision ${current.counters.revisions}).` : 'One writer is required.';
      const markdown = `---\ntitle: 检查点机制\ncreated: ${date}\nsource: ${sourceUrl}\ntags: [agents, persistence, recovery]\n---\n# 检查点机制\n\n> [!abstract] 意图先于外部操作。\n\n## 一、机制\n${mechanism}\n\n\`\`\`mermaid\nflowchart LR\n  Intent --> Effect\n\`\`\`\n\n## 二、边界\n${boundary}\n<div>单写入者控制外部副作用。</div>\n`;
      result = {note_path: `Organize Notes By AI/${date.slice(2).replaceAll('-', '')}-检查点机制.md`, markdown,
        claims: [{id: 'c1', text: mechanism, line: markdown.split('\n').indexOf(mechanism) + 1, evidence_ids: ['e1'], claim_type: 'source_statement'},
          {id: 'c2', text: boundary, line: markdown.split('\n').indexOf(boundary) + 1, evidence_ids: ['e2'], claim_type: 'source_statement'}],
        figure_plan: [{section: '一、机制', type: 'mermaid', goal: 'Intent before effect', resource_path: null, no_figure_reason: null},
          {section: '二、边界', type: 'html_card', goal: 'One writer', resource_path: null, no_figure_reason: null}], resources: [], degradations: []};
    } else {
      expect(payload.task).toBe('review');
      const writing = payload.data.writing as Writing;
      const basis = payload.data.norm_basis as {obsidian_note: string; diagram_playbook: string};
      expect(basis.obsidian_note).toBe(skillTexts['.agents/skills/obsidian-note/SKILL.md']);
      expect(basis.diagram_playbook).toBe(skillTexts['.agents/skills/obsidian-note/references/diagram-playbook.md']);
      result = {issues: scenario === 'quality' && current.generation_version === 1 ? [{severity: 'blocking', file: writing.note_path,
        location: 'c2 / 二、边界', evidence_ids: ['e2'], problem: `Revision ${current.counters.revisions} contradicts one-writer evidence.`,
        correction: 'Use the fixed one-writer source statement.'}] : [], file_hashes: payload.data.file_hashes, resource_manifest_hash: payload.data.resource_manifest_hash};
    }
    yield {message_id: `batch-${queries.length}`, type: 'result', summary: true, success: true, result,
      usage: {input_tokens: 2, output_tokens: 3, cost_status: 'unknown', cost_usd: null}, observable: {explicit_replay: true}};
  }};
  const gateway = new UrlGateway(async () => {}, async () => [{address: '8.8.8.8', family: 4}], async url => {
    expect(materialUrls).toContain(url.href); http.push(url.href);
    return {status: 200, headers: {'content-type': 'text/html'}, body: Buffer.from(`<html><main><h1>Registered supplement</h1><p>Supplement ${url.href} supports the checkpoint discussion.</p></main></html>`)};
  });
  const ports = (): ControllerPorts => ({journal, gate: gate(), now, sources: [], deadline: new RunDeadline(now().getTime()),
    readArtifact: path => manager.readFile(journal.handle, path), context: async () => {throw new Error('unexpected new project context');},
    environment: async (_project, commit) => ({root: skillRoot, model: context.model, skills, gate: gate(), gateway, deadline: new RunDeadline(),
      executor: new StageExecutor(model, gate(), new ApplicationInvocationJournal(journal)), read_snapshot_body: reference => manager.readFile(journal.handle, reference.path),
      commit: async (updated, files, reason) => {
        await commit(updated, files, reason);
        if (scenario === 'pause' && reason === 'research_complete' && !pauseApplied) {policy.paused = true; pauseApplied = true;}
      }}),
    prepareResources: async current => {expect(scope).toBe('production'); expect(current.writing!.resources).toEqual([]); return current;},
    verifySources: async () => {expect(scope).toBe('production'); return now().toISOString();},
    seal: async current => {
      expect(scope).toBe('production'); external.seals++;
      const seal = await sealDelivery(journal.handle, current.project_id, {review_passed: !current.review!.issues.some(issue => issue.severity === 'blocking'),
        program_checks_passed: true, input_revision: journal.handle.revision, resources: []});
      const bytes = Buffer.from(current.writing!.markdown);
      delivery = {schema_version: 1, delivery_id: current.delivery_id!, execution_scope: 'production', workspace_id: workspace,
        project_id: current.project_id, generation_version: current.generation_version, workspace_revision: seal.workspace_revision,
        context_id: current.context.context_id, base_commit: 'c'.repeat(40), sources_verified_at: current.sources_verified_at!,
        files: [{path: current.writing!.note_path, role: 'note', mime: 'text/markdown', bytes: bytes.length, sha256: digest(bytes), content: bytes}],
        resources: [], sources: [sourceUrl], quality_report: {passed: true, validated_hash: seal.validated_hash}, rationale: current.selection!.reason,
        knowledge_increment: current.research!.knowledge_increment, gaps: [], image_degradations: [], usage: {status: 'unknown', estimated_usd: null},
        warnings: ['Explicit local replay'], validated_hash: ''};
      delivery.validated_hash = deliveryValidationHash(delivery);
      await journal.commit('artifact-seals/' + current.delivery_id, seal);
    },
    publish: async current => mappedState(current, await publisher().publish(delivery!)), reconcile: async current => current,
  });
  const run = (mode: 'scheduled' | 'resume' = 'scheduled') => new ReadingController(ports()).run(parseDispatch(scope === 'production'
    ? mode === 'scheduled' ? {mode: 'scheduled'} : {mode: 'resume', project_id: candidate.project_id}
    : mode === 'scheduled' ? {mode: 'preview', preview_id: 'batch-' + scenario, input_urls: []}
      : {mode: 'preview', preview_id: 'batch-' + scenario, project_id: candidate.project_id}), 'owner');
  return {root, http, queries, external, context, skills, snapshot, materialUrls, policy, get journal() {return journal;}, get manager() {return manager;},
    current: () => journal.load<HostProject>(projectKey), run,
    readiness: async (current: HostProject) => {
      const history = await publisher().history(current.project_id);
      const fact = await remote.inspect(readinessProbe({workspace_id: workspace, project_id: current.project_id}));
      return {complete: true, allowed: history.length === 0 && fact.prs.length === 0 && fact.branch_sha === null,
        evidence: {kind: 'explicit_readonly_fake_github', history, fact}};
    },
    cold: async (day: number, suffix = '') => {clock = Date.now() + day * 86_400_000; await rm(journal.handle.root_dir, {recursive: true, force: true}); await open(`batch-cold-${day}${suffix}`);},
    cleanup: () => rm(root, {recursive: true, force: true}),
  };
}

it.each(['tools', 'materials'] as const)('C035 actual %s budget commits a yield; cold controller resets only batch counters, reuses research subtasks and completes the remaining work', async scenario => {
  const f = await fixture(scenario);
  try {
    await f.run();
    const yielded = (await f.current())!;
    expect(yielded).toMatchObject({state: 'deferred', reason: 'batch_yield', resume_stage: 'research', resume_policy: 'automatic', generation_version: 1});
    expect(yielded.counters[scenario === 'tools' ? 'tool_calls' : 'supplementary_materials']).toBe(scenario === 'tools' ? 40 : 8);
    expect(yielded.partial_evidence).toHaveLength(2);
    const firstBatch = yielded.batch_id;
    const evidencePaths = f.journal.handle.snapshot.manifest.files.filter(file => file.path.includes('/research/evidence-')).map(file => file.path);
    const evidenceBytes = await Promise.all(evidencePaths.map(path => f.manager.readFile(f.journal.handle, path)));
    const invocations = f.journal.keys('invocations/'); const oldFacts = invocations.map(key => structuredClone(f.journal.handle.records[key]));
    if (scenario === 'materials') {expect(yielded.snapshots).toHaveLength(9); expect(f.http).toEqual(f.materialUrls.slice(0, 8));}
    await f.cold(1);
    expect(await f.current()).toEqual(yielded);
    expect(invocations.map(key => f.journal.handle.records[key])).toEqual(oldFacts);
    expect(await Promise.all(evidencePaths.map(path => f.manager.readFile(f.journal.handle, path)))).toEqual(evidenceBytes);
    await f.run();
    const complete = (await f.current())!;
    const resumed = f.queries.filter(query => query.stage === 'research')[1]!;
    expect(resumed.counters).toMatchObject({tool_calls: 0, supplementary_materials: 0, download_bytes: 0, download_resources: 0,
      total_tool_calls: yielded.counters.total_tool_calls, total_materials: yielded.counters.total_materials,
      total_download_bytes: yielded.counters.total_download_bytes, revisions: yielded.counters.revisions});
    expect(complete.state, complete.reason ?? '').toBe('preview_ready');
    expect(complete.batch_id).not.toBe(firstBatch); expect(complete.generation_version).toBe(1); expect(complete.context).toEqual(yielded.context);
    expect(complete.partial_evidence).toEqual(yielded.partial_evidence);
    expect(complete.counters.total_tool_calls).toBeGreaterThan(yielded.counters.total_tool_calls);
    expect(f.queries.map(query => query.stage)).toEqual(['research', 'research', 'writing', 'review']);
    if (scenario === 'materials') {expect(f.http).toEqual(f.materialUrls); expect(complete.snapshots).toHaveLength(10); expect(complete.counters.total_materials).toBe(9);}
    const registry = new EvidenceRegistry(complete.snapshots, reference => f.manager.readFile(f.journal.handle, reference.path), complete.project_id);
    expect(await registry.withSnapshot(complete.snapshots[0]!, snapshot => snapshot.text)).toBe(body);
    await registry.validateResearchAsync(complete.research!);
    expect(await Promise.all(evidencePaths.map(path => f.manager.readFile(f.journal.handle, path)))).toEqual(evidenceBytes);
    expect(f.external).toEqual({uploads: 0, seals: 0, prs: 0});
  } finally {await f.cleanup();}
}, 60_000);

it.each(['stalled', 'quality'] as const)('C036 actual %s guard stays manual across Beijing days and plain resume; only audited changed operator input starts g+1', async scenario => {
  const f = await fixture(scenario);
  try {
    if (scenario === 'stalled') {
      for (const day of [0, 1, 2]) {if (day) await f.cold(day); await f.run();}
    } else await f.run();
    const blocked = (await f.current())!;
    const reason = scenario === 'stalled' ? 'research_stalled' : 'quality_blocked';
    expect(blocked).toMatchObject({state: 'deferred', reason, resume_policy: 'manual', generation_version: 1});
    expect(blocked.counters[scenario === 'stalled' ? 'stalled_batches' : 'revisions']).toBe(scenario === 'stalled' ? 3 : 2);
    expect(f.queries.filter(query => query.stage === (scenario === 'stalled' ? 'research' : 'review'))).toHaveLength(3);
    const oldQueries = [...f.queries];
    const keys = f.journal.keys().filter(key => /^(invocations|responses|invocation_meta)\//.test(key));
    const facts = keys.map(key => structuredClone(f.journal.handle.records[key]));
    const dates = new Set<string>();
    for (const day of [3, 4]) {
      await f.cold(day);
      const report = await f.run();
      expect(dates.has(report.logical_key)).toBe(false); dates.add(report.logical_key);
      await f.run('resume');
      expect(await f.current()).toMatchObject({state: 'deferred', reason, resume_policy: 'manual', generation_version: 1,
        context: blocked.context, counters: blocked.counters, research: blocked.research, writing: blocked.writing, review: blocked.review});
      expect(f.queries).toEqual(oldQueries); expect(keys.map(key => f.journal.handle.records[key])).toEqual(facts);
    }
    const request = {schema_version: 1, action: 'new_generation', recovery_id: 'changed-' + scenario, project_id: blocked.project_id,
      expected_revision: f.journal.handle.revision, reason: 'Human supplied a specific correction after inspecting the fixed evidence.',
      evidence_reference: 'local-acceptance/' + scenario, guidance};
    expect(f.external).toEqual({uploads: 0, seals: 0, prs: 0});
    const result = await applyRecovery(f.journal, request, 'human-operator', {readiness: f.readiness});
    expect(result).toMatchObject({status: 'applied', generation_version: 2});
    const next = (await f.current())!;
    expect(next.counters.revisions).toBe(0); expect(next.counters.stalled_batches).toBe(0);
    expect(next.context.context_id).not.toBe(blocked.context.context_id);
    expect(next.classification).toEqual(blocked.classification);
    expect(fixedOperatorGuidance(next.context)).toMatchObject({guidance, actor: 'human-operator', evidence_reference: 'local-acceptance/' + scenario});
    expect(await f.journal.load('generation-archives/' + blocked.project_id + '/g1')).toMatchObject({project: blocked,
      actor: 'human-operator', recovery_id: request.recovery_id});
    expect(await f.journal.load('recoveries/' + request.recovery_id)).toMatchObject({request, actor: 'human-operator'});
    expect(keys.map(key => f.journal.handle.records[key])).toEqual(facts);
    await f.cold(5, '-changed'); await f.run();
    expect(await f.current()).toMatchObject({state: 'pr_open', generation_version: 2});
    expect(f.queries.slice(oldQueries.length).map(query => query.stage)).toEqual(['selection', 'research', 'writing', 'review']);
    expect(keys.map(key => f.journal.handle.records[key])).toEqual(facts);
    expect(f.external).toEqual({uploads: 0, seals: 1, prs: 1});
  } finally {await f.cleanup();}
}, 60_000);

it('C067 pause after committed research blocks writing; cold lifting of the same restriction resumes the original stage, context, skill and example bytes without repeating research', async () => {
  const f = await fixture('pause');
  try {
    await f.run();
    const paused = (await f.current())!;
    expect(paused).toMatchObject({state: 'deferred', resume_stage: 'writing', resume_policy: 'when_policy_allows'});
    expect(paused.reason).toContain('paused');
    expect(f.queries.map(query => query.stage)).toEqual(['research']);
    expect(paused.research!.evidence).toHaveLength(2);
    const policyHash = f.policy.semantic_policy_hash;
    const evidencePaths = f.journal.handle.snapshot.manifest.files.filter(file => file.path.includes('/research/evidence-')).map(file => file.path);
    const bytes = await Promise.all(evidencePaths.map(path => f.manager.readFile(f.journal.handle, path)));
    await f.cold(1); await f.run();
    expect(f.queries.map(query => query.stage)).toEqual(['research']);
    expect(await f.current()).toMatchObject({context: paused.context, counters: paused.counters, research: paused.research, generation_version: 1});
    f.policy.paused = false;
    await f.cold(2); const restored = (await f.current())!;
    expect(restored.context).toEqual(paused.context); expect(restored.counters).toEqual(paused.counters);
    expect(restored.research).toEqual(paused.research); expect(restored.classification).toEqual(paused.classification);
    expect(f.policy.semantic_policy_hash).toBe(policyHash);
    expect(await Promise.all(evidencePaths.map(path => f.manager.readFile(f.journal.handle, path)))).toEqual(bytes);
    for (const [file, hash] of Object.entries(f.skills.files)) expect(digest(await readFile(join(f.skills.root, file)))).toBe(hash);
    await f.run();
    const complete = (await f.current())!;
    expect(complete.state, complete.reason ?? '').toBe('preview_ready'); expect(complete.generation_version).toBe(1);
    expect(complete.context).toEqual(paused.context); expect(complete.research).toEqual(paused.research);
    expect(complete.context.example_texts).toEqual(f.context.example_texts);
    expect(complete.counters.total_tool_calls).toBeGreaterThan(paused.counters.total_tool_calls);
    expect(complete.counters.total_materials).toBe(paused.counters.total_materials);
    expect(complete.counters.revisions).toBe(paused.counters.revisions);
    expect(f.queries.map(query => query.stage)).toEqual(['research', 'writing', 'review']);
    expect(f.http).toEqual([]); expect(f.external).toEqual({uploads: 0, seals: 0, prs: 0});
  } finally {await f.cleanup();}
}, 60_000);
