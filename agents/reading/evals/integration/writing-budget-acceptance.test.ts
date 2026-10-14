import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {expect, it} from 'vitest';
import {renderFixture} from '../runtime/render-fixture.js';
import {policyFixture} from '../runtime/policy-fixtures.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal, ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {ReadingController, type HostProject, type ControllerPorts} from '../../src/app/controller.js';
import {buildContext} from '../../src/context/index.js';
import {discoverCandidate, emptyIdentity, addCandidate} from '../../src/collect/identity.js';
import {canonicalJson, type InvocationRecord, type JsonValue} from '../../src/contracts/index.js';
import {newRuntimeProject} from '../../src/stages/driver.js';
import {digest, parseModel, type Evidence, type ResearchPacket, type Review} from '../../src/stages/contracts.js';
import {ReviewStageSchema} from '../../src/stages/continuation.js';
import {StageExecutor} from '../../src/stages/executor.js';
import {type Writing} from '../../src/stages/validation.js';
import {type Counters, RunDeadline} from '../../src/runtime/deadline.js';
import {type ModelAdapter} from '../../src/runtime/sdk.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {UrlGateway} from '../../src/tools/fetch.js';
import {type SkillBundle} from '../../src/tools/skills.js';
import {parseRenderSourceReceipt, type RenderSourceReceipt, type RenderCommandPort} from '../../src/tools/render.js';
import {parseDispatch} from '../../src/config/dispatch.js';

const sourceUrl = 'https://example.org/render-recovery';
const sourceText = '# Render checkpoint\nCommit intent before effects.\nUnknown outcomes require reconciliation.';
const renderArgs = {mode: 'flow', name: 'core', diagram: {mode: 'flow', nodes: [{id: 'intent', label: 'Commit'}, {id: 'query', label: 'Query'}]}};
const relative = '图文件/render_project/core';

/** Uses the existing fixed local fault process, never the real drawing skill or a paid model. */
async function fixture(outcome: 'known_yield' | 'unknown' | 'checkpoint_loss' | 'after_yield_commit_loss' | 'mid_resume_crash' | 'repeat_yield' | 'repeat_yield_after_commit_loss' | 'review_checkpoint' | 'revision_yield') {
  const f = await renderFixture();
  let manager = new ImmutableWorkspaceManager({store: f.store, scope: 'preview', verify_preflight: false,
    local_root: join(f.root, 'initial-reader'), record_validator: validateHostRecords});
  let journal = new WorkspaceJournal(manager, await manager.restore(f.journal.handle.workspace_id), 'writing-run-1');
  let coldCount = 0;
  let failYieldCommit = outcome === 'checkpoint_loss';
  let failAfterYieldCommit = outcome === 'after_yield_commit_loss' || outcome === 'repeat_yield_after_commit_loss';
  let failMidResume = outcome === 'mid_resume_crash';
  let clock = Date.now();
  const now = () => new Date(Math.max(clock, Date.now()));
  const skillTexts = {
    '.agents/skills/obsidian-note/SKILL.md': 'Use a registered checked diagram source. A known budget yield preserves writing activity; unknown model replies require manual reconciliation.',
    '.agents/skills/obsidian-note/references/diagram-playbook.md': 'Generate through the fixed wrapper, read the actual PNG and record visual checks. Never invent a rendering receipt.',
  };
  const augment = async (bundle: SkillBundle): Promise<SkillBundle> => {
    const files = {...bundle.files};
    for (const [file, text] of Object.entries(skillTexts)) {
      await mkdir(dirname(join(bundle.root, file)), {recursive: true}); await writeFile(join(bundle.root, file), text); files[file] = digest(text);
    }
    return {...bundle, files, hash: digest(canonicalJson(files))};
  };
  let skills = await augment(f.bundle);
  const templates = Object.fromEntries(await Promise.all(['selection', 'research', 'writing', 'review'].map(async stage =>
    [stage, await readFile(`agents/reading/prompts/${stage}.md`, 'utf8')])));
  const context = buildContext({index: [], query: 'checkpoint', heldout: {urls: new Set(), note_paths: new Set()},
    preferences_hash: digest('writing budget'), skill_commit: skills.commit, skill_hash: skills.hash,
    prompt_hash: digest(Buffer.concat(['selection', 'research', 'writing', 'review'].map(stage => Buffer.from(templates[stage]!)))),
    prompt_templates: templates, model: 'explicit-replay', evidence_versions: []});
  const candidate = discoverCandidate('manual_url', sourceUrl, 'Render checkpoint', null, now().toISOString());
  candidate.project_id = 'render_project'; candidate.content_hash = digest(sourceText);
  const retrieved = now().toISOString();
  const evidence: Evidence[] = [
    {evidence_id: 'e1', source_url: sourceUrl, retrieved_at: retrieved, snapshot_hash: candidate.content_hash,
      locator: {start_line: 2, end_line: 2}, excerpt: 'Commit intent before effects.', claim: 'Commit intent before effects.', claim_type: 'source_statement', limits: [], based_on: []},
    {evidence_id: 'e2', source_url: sourceUrl, retrieved_at: retrieved, snapshot_hash: candidate.content_hash,
      locator: {start_line: 3, end_line: 3}, excerpt: 'Unknown outcomes require reconciliation.', claim: 'Unknown outcomes require reconciliation.', claim_type: 'source_statement', limits: [], based_on: []},
  ];
  const research: ResearchPacket = {project_id: 'render_project', questions: [{id: 'q1', text: 'What is first?', priority: 'required'},
    {id: 'q2', text: 'What happens with unknown outcomes?', priority: 'required'}, {id: 'q3', text: 'What experiment is reported?', priority: 'required'}],
    answers: [{question_id: 'q1', answer: 'Commit intent first.', evidence_ids: ['e1'], source_not_provided: false},
      {question_id: 'q2', answer: 'Reconcile unknown outcomes.', evidence_ids: ['e2'], source_not_provided: false},
      {question_id: 'q3', answer: null, evidence_ids: [], source_not_provided: true}], evidence, gaps: [],
    source_versions: [{url: sourceUrl, hash: candidate.content_hash, main: true, core: true, status: 'read'}],
    mechanism_evidence_ids: ['e1'], boundary_evidence_ids: ['e2'], knowledge_increment: 'Ordering with explicit reconciliation.'};
  const key = 'projects/render_project';
  let project: HostProject = {...newRuntimeProject(candidate, {project_id: 'render_project', execution_scope: 'preview',
    workspace_id: journal.handle.workspace_id, context, now: now()}), generation_version: 1, resume_stage: null, resume_policy: 'automatic', reason: null,
    last_run_id: null, batch_id: 'render-batch-1', delivery_id: null, sources_verified_at: null,
    snapshots: [{url: sourceUrl, text: sourceText, hash: candidate.content_hash, retrieved_at: retrieved, links: [], kind: 'web'}],
    read_ranges: {[candidate.content_hash]: [{page: null, start_line: 1, end_line: 3, start_char: null, end_char: null}]}};
  const identity = emptyIdentity(); addCandidate(identity, candidate);
  await journal.commitMany({identity, [key]: project, ['contexts/' + context.context_id]: context}, 'collection_committed');
  const policy = policyFixture();
  project.classification = {candidate_id: candidate.candidate_id, source_snapshot_hash: candidate.content_hash, semantic_policy_hash: policy.semantic_policy_hash,
    attempts: 1, format_repairs: 0, pending: false, credential: {candidate_id: candidate.candidate_id, source_snapshot_hash: candidate.content_hash,
      semantic_policy_hash: policy.semantic_policy_hash, content_eligibility: 'allowed', evidence_hash: digest('trusted fixture classification')}};
  project.selection = {decision: 'research', reason_codes: [], reason: 'Ordering and unknown outcomes are concrete.',
    dimension_ratings: {relevance: 'strong', mechanism: 'strong', evidence: 'strong', transferability: 'strong', increment: 'strong'},
    questions: research.questions.map(question => question.text), related_note_ids: [], evidence_ids: []};
  project.state = 'selected'; await journal.commitMany({[key]: project}, 'selection_result');
  project.research = research; project.partial_evidence = evidence; project.partial_questions = research.questions;
  project.state = 'researched'; await journal.commitMany({[key]: project}, 'research_complete');
  const gate = () => new PolicyGate(async () => policy, check => journal.commit('policy-checks/' + check.check_id, check), now);
  const calls: {stage: string; counters: Counters; prompt: string; input_hash: string | null}[] = [];
  const exports: string[] = [];
  let receiptBefore: RenderSourceReceipt | null = null;
  let reviewCheckpoint: Review | null = null;
  const fixedCommands = (): RenderCommandPort => ({run: async (args, deadline) => {
    const script = '.agents/skills/fireworks-tech-graph/scripts/fireworks.py';
    expect(digest(await readFile(join(skills.root, script)))).toBe(skills.files[script]);
    exports.push(args[0]!);
    return f.native(skills).run(args, deadline);
  }});
  const model: ModelAdapter = {async *stream(request) {
    expect(request.max_turns).toBe(44);
    const current = (await journal.load<HostProject>(key))!;
    const payload = JSON.parse(request.prompt) as {task: string; data: Record<string, unknown>};
    calls.push({stage: payload.task, counters: structuredClone(current.counters), prompt: request.prompt, input_hash: current.pending_query?.input_hash ?? null});
    const call = async (name: string, args: Record<string, unknown> = {}) => request.tools.find(tool => tool.name === name)!.run(args);
    if (outcome === 'repeat_yield' || outcome === 'repeat_yield_after_commit_loss') {
      if (!current.writing_activity?.skill_activated) await call('activate_skill', {name: 'obsidian-note'});
      await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'});
      yield {message_id: 'same-reading-' + calls.length, type: 'result', summary: true, success: true,
        result: {schema_version: 1, decision: 'batch_yield', reason: 'no_effective_artifact'},
        usage: {input_tokens: 1, output_tokens: 1, cost_status: 'unknown', cost_usd: null}, observable: {explicit_replay: true}};
      return;
    }
    if (payload.task === 'writing' && calls.filter(call => call.stage === 'writing').length === 1) {
      await call('activate_skill', {name: 'obsidian-note'});
      await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'});
      await expect(call('render_diagram', renderArgs)).rejects.toMatchObject({code: 42});
      const bytes = await manager.readFile(journal.handle, `projects/render_project/draft/${relative}.render-check.json`);
      receiptBefore = parseRenderSourceReceipt(JSON.parse(Buffer.from(bytes).toString()));
      expect(receiptBefore.source_hash).toBe(digest(await manager.readFile(journal.handle, `projects/render_project/draft/${relative}.svg`)));
      while ((await journal.load<HostProject>(key))!.counters.tool_calls < 40)
        await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'});
      await expect(call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'})).rejects.toThrow('batch_yield');
      if (outcome === 'unknown') {
        yield {message_id: 'writing-partial', type: 'assistant', summary: false,
          usage: {input_tokens: 7, output_tokens: 2, cost_status: 'unknown', cost_usd: null}, observable: {explicit_replay: true}};
        return;
      }
      yield {message_id: 'writing-known-yield', type: 'result', summary: true, success: true,
        result: {schema_version: 1, decision: 'batch_yield', reason: 'batch_yield'}, usage: {input_tokens: 7, output_tokens: 2, cost_status: 'unknown', cost_usd: null},
        observable: {explicit_replay: true}};
      return;
    }
    if (outcome === 'mid_resume_crash' && payload.task === 'writing') {
      yield {message_id: 'resumed-writing-partial', type: 'assistant', summary: false,
        usage: {input_tokens: 11, output_tokens: 3, cost_status: 'unknown', cost_usd: null}, observable: {explicit_replay: true}};
    }
    let result: unknown;
    if (payload.task === 'writing') {
      const continuation = payload.data.continuation as {writing_activity: NonNullable<HostProject['writing_activity']>; checkpoint: Writing | null} | null;
      if (current.counters.revisions === 0 || continuation) {
        expect(continuation).toMatchObject({writing_activity: {round: current.counters.revisions, skill_activated: true, playbook_read: true}});
      } else {
        await call('activate_skill', {name: 'obsidian-note'});
        await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'});
      }
      if (current.counters.revisions === 0) expect(payload.data.batch_budget).toEqual({remaining_tools: 40, max_tools: 40});
      const artifacts = payload.data.resume_artifacts as {path: string; hash: string; render_source?: {receipt: RenderSourceReceipt; diagram: unknown}}[];
      expect(artifacts.map(artifact => artifact.path)).toEqual(expect.arrayContaining([relative + '.json', relative + '.svg', relative + '.render-check.json']));
      const registered = artifacts.find(artifact => artifact.render_source)!;
      expect(registered.render_source).toEqual({receipt: receiptBefore, diagram: renderArgs.diagram});
      for (const artifact of artifacts) expect(artifact.hash).toBe(digest(await manager.readFile(journal.handle, 'projects/render_project/draft/' + artifact.path)));
      const image = continuation?.checkpoint ? {path: continuation.checkpoint.resources[0]!.path, source_path: continuation.checkpoint.resources[0]!.source_path!,
        png_hash: continuation.checkpoint.resources[0]!.hash, source_hash: receiptBefore!.source_hash}
        : await call('render_diagram', renderArgs) as {path: string; source_path: string; png_hash: string; source_hash: string};
      expect(image.source_hash).toBe(receiptBefore!.source_hash);
      const viewed = await call('read_image', {path: image.path}) as {content: {type: string}[]};
      expect(viewed.content[0]!.type).toBe('image');
      await call('record_visual_check', {path: image.path, passed: true, issues: []});
      const date = String(payload.data.created), mechanism = 'Commit intent before effects.', boundary = 'Unknown outcomes require reconciliation.';
      const markdown = `---\ntitle: 渲染检查点\ncreated: ${date}\nsource: ${sourceUrl}\ntags: [agents, persistence, recovery]\n---\n# 渲染检查点\n\n> [!abstract] 提交意图后执行操作，未知结果先对账。\n\n## 一、机制\n${mechanism}\n![已检查源图](../${image.path})\n\n## 二、边界\n${boundary}\n<div>结果不明时先核对既有事实。</div>\n${outcome === 'revision_yield' ? `\n修订轮次：${current.counters.revisions}\n` : ''}`;
      result = {note_path: `Organize Notes By AI/${date.slice(2).replaceAll('-', '')}-渲染检查点.md`, markdown,
        claims: [{id: 'c1', text: mechanism, line: markdown.split('\n').indexOf(mechanism) + 1, evidence_ids: ['e1'], claim_type: 'source_statement'},
          {id: 'c2', text: boundary, line: markdown.split('\n').indexOf(boundary) + 1, evidence_ids: ['e2'], claim_type: 'source_statement'}],
        figure_plan: [{section: '一、机制', type: 'diagram', goal: 'Commit before effect', resource_path: image.path, no_figure_reason: null},
          {section: '二、边界', type: 'html_card', goal: 'Reconcile unknown outcomes', resource_path: null, no_figure_reason: null}],
        resources: [{path: image.path, source_path: image.source_path, hash: image.png_hash, mime: 'image/png', caption: '已检查源图',
          visual_check: 'passed', core: true, url: null}], degradations: []};
      if (outcome === 'revision_yield' && current.counters.revisions === 1 && !continuation)
        result = {schema_version: 1, decision: 'batch_yield', reason: 'revision_subtask_committed', checkpoint: result};
    } else {
      expect(payload.task).toBe('review');
      const writing = payload.data.writing as Writing;
      for (const image of writing.resources) await call('read_image', {path: image.path});
      const issue = {severity: 'blocking' as const, file: writing.note_path, location: '二、边界', evidence_ids: ['e2'],
        problem: `Round ${current.counters.revisions}: 缺少可核查的对账确认条件。`, correction: '补充确认条件证据或明确中心缺口。'};
      const reviews = calls.filter(call => call.stage === 'review').length;
      if (outcome === 'review_checkpoint' && reviews === 1) {
        for (const invalid of [{schema_version: 1, decision: 'batch_yield', reason: 'missing_checkpoint'},
          {schema_version: 1, decision: 'batch_yield', reason: 'null_checkpoint', checkpoint: null}])
          expect(() => parseModel(ReviewStageSchema, invalid)).toThrow('invalid_model_result');
        reviewCheckpoint = {issues: [issue], file_hashes: payload.data.file_hashes as Record<string, string>, resource_manifest_hash: String(payload.data.resource_manifest_hash)};
        result = {schema_version: 1, decision: 'batch_yield', reason: 'review_checkpoint_committed', checkpoint: reviewCheckpoint};
      } else {
        if (outcome === 'review_checkpoint') expect(payload.data.continuation).toMatchObject({checkpoint: reviewCheckpoint});
        result = {issues: outcome === 'revision_yield' ? [issue] : [], file_hashes: payload.data.file_hashes, resource_manifest_hash: payload.data.resource_manifest_hash};
      }
    }
    yield {message_id: 'writing-complete-' + calls.length, type: 'result', summary: true, success: true, result,
      usage: {input_tokens: 3, output_tokens: 4, cost_status: 'unknown', cost_usd: null}, observable: {explicit_replay: true}};
  }};
  const external: string[] = [];
  const ports = (): ControllerPorts => ({journal, gate: gate(), now, deadline: new RunDeadline(now().getTime()), sources: [],
    readArtifact: path => manager.readFile(journal.handle, path), context: async () => {throw new Error('unexpected new context');},
    environment: async (_project, commit) => ({root: skills.root, skills, model: context.model, gate: gate(), deadline: new RunDeadline(),
      executor: new StageExecutor(model, gate(), new ApplicationInvocationJournal(journal)),
      commit: async (updated, files, reason) => {
        if (reason === 'writing_batch_yield' && failYieldCommit) {failYieldCommit = false; f.store.faults.push({operation: 'create', kind: 'permission'});}
        await commit(updated, files, reason);
        if (reason === 'tool_or_revision_budget' && failMidResume && calls.filter(call => call.stage === 'writing').length === 2) {
          failMidResume = false;
          f.store.faults.push({operation: 'create', kind: 'permission'});
          await journal.commit('test-mid-query-stop', {stopped_after_one_resumed_tool: true});
        }
        if (reason === 'writing_batch_yield' && failAfterYieldCommit &&
          (outcome === 'after_yield_commit_loss' || updated.counters.stalled_batches === 3)) {
          failAfterYieldCommit = false;
          f.store.faults.push({operation: 'create', kind: 'permission'});
          // Poison the writer after the atomic yield CP, before the controller's
          // outer stage_yielded CP. This models a host that cannot continue saving.
          await journal.commit('test-process-stop', {stopped_after_atomic_yield: true});
        }
        if (outcome === 'review_checkpoint' && reason === 'review_result') policy.paused = true;
      }, gateway: new UrlGateway(async () => {}),
      read_snapshot_body: reference => manager.readFile(journal.handle, reference.path), render_commands: fixedCommands()}),
    prepareResources: async () => {external.push('upload'); throw new Error('preview upload forbidden');},
    verifySources: async () => {throw new Error('preview source verification forbidden');},
    seal: async () => {external.push('seal'); throw new Error('preview seal forbidden');},
    publish: async () => {external.push('PR'); throw new Error('preview PR forbidden');}, reconcile: async current => current,
  });
  return {f, calls, exports, external, get journal() {return journal;}, get manager() {return manager;}, get skills() {return skills;},
    current: () => journal.load<HostProject>(key), run: () => new ReadingController(ports()).run(parseDispatch({mode: 'preview', preview_id: 'render'}), 'owner'),
    cold: async () => {coldCount++; clock = Date.now() + coldCount * 86_400_000;
      await rm(skills.root, {recursive: true, force: true}); await rm(journal.handle.root_dir, {recursive: true, force: true});
      const restored = await f.cold(); manager = restored.manager;
      journal = new WorkspaceJournal(manager, restored.journal.handle, 'writing-cold-' + coldCount);
      skills = await augment(restored.bundle); expect(skills.hash).toBe(context.skill_hash);},
    cleanup: f.cleanup,
  };
}

it('C035 a known writing-budget yield cold-restores the actual checked render source, resets only batch counters and completes a new writing query with export-only reuse and independent image review', async () => {
  const f = await fixture('known_yield');
  try {
    await f.run();
    const yielded = (await f.current())!;
    expect(yielded).toMatchObject({state: 'deferred', reason: 'batch_yield', resume_stage: 'writing', resume_policy: 'automatic',
      generation_version: 1, writing: null, pending_query: null, counters: {tool_calls: 40, total_tool_calls: 40, revisions: 0},
      writing_activity: {round: 0, skill_activated: true, playbook_read: true}});
    expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png']);
    const sourcePaths = ['.json', '.svg', '.render-check.json'].map(extension => `projects/render_project/draft/${relative}${extension}`);
    const bytes = await Promise.all(sourcePaths.map(path => f.manager.readFile(f.journal.handle, path)));
    const manifest = sourcePaths.map(path => f.journal.handle.snapshot.manifest.files.find(file => file.path === path)!);
    expect(manifest.every(file => file.sha256 === digest(bytes[sourcePaths.indexOf(file.path)]!))).toBe(true);
    const receipt = parseRenderSourceReceipt(JSON.parse(Buffer.from(bytes[2]!).toString()));
    expect(receipt.skill_hash).toBe(yielded.context.skill_hash); expect(receipt.source_hash).toBe(digest(bytes[1]!));
    expect(f.journal.handle.snapshot.manifest.files.some(file => file.path.endsWith('.png'))).toBe(false);
    const invoiceKey = f.journal.keys('invocations/')[0]!;
    const invoice = (await f.journal.load<InvocationRecord>(invoiceKey))!;
    expect(invoice).toMatchObject({status: 'succeeded', capability: 'write', usage: {input_tokens: 7, output_tokens: 2, cost_status: 'unknown', cost_usd: null}});
    const responseKey = 'responses/' + invoice.invocation_id;
    const response = await f.journal.load(responseKey);
    expect(response).toEqual({schema_version: 1, decision: 'batch_yield', reason: 'batch_yield'});
    const probe = new ImmutableWorkspaceManager({store: f.f.store, scope: 'preview', verify_preflight: false,
      local_root: join(f.f.root, 'tamper-probe'), record_validator: validateHostRecords});
    const handle = await probe.restore(f.journal.handle.workspace_id);
    const commitKeys = async () => {
      const keys: string[] = []; let cursor: string | undefined;
      do {const page = await f.f.store.list(probe.prefix(handle.workspace_id) + '/commits/', cursor);
        keys.push(...page.objects.map(object => object.key)); cursor = page.next_cursor ?? undefined;} while (cursor);
      return keys;
    };
    const immutableKeys = await commitKeys();
    const marker = yielded.stage_continuation!;
    const mutations: Record<string, unknown>[] = [
      ...[{invocation_id: 'fabricated-query'}, {input_hash: '0'.repeat(64)}, {round: 1}, {context_id: '0'.repeat(64)}].map(change =>
        ({'projects/render_project': {...yielded, stage_continuation: {...marker, ...change}}})),
      {['consumed/' + marker.invocation_id]: {project_id: 'render_project', reason: 'draft_complete'}},
      {[responseKey]: {invalid_known_response: true}},
    ];
    for (const records of mutations) {
      const start = f.f.store.calls.length;
      await expect(probe.checkpoint(handle, {expected_revision: handle.revision, run_id: 'tamper-local', reason: 'project_transition',
        records: JSON.parse(JSON.stringify(records)) as Record<string, JsonValue>})).rejects.toThrow();
      expect(f.f.store.calls.slice(start).some(call => call.operation === 'create' || call.operation === 'delete')).toBe(false);
      expect(await commitKeys()).toEqual(immutableKeys);
      expect((await probe.restore(handle.workspace_id)).revision).toBe(handle.revision);
    }
    await f.cold();
    expect(await f.current()).toEqual(yielded);
    expect(await Promise.all(sourcePaths.map(path => f.manager.readFile(f.journal.handle, path)))).toEqual(bytes);
    expect(await f.journal.load(invoiceKey)).toEqual(invoice); expect(await f.journal.load(responseKey)).toEqual(response);
    await f.run();
    const complete = (await f.current())!;
    expect(complete.state, complete.reason ?? '').toBe('preview_ready');
    expect(f.calls.map(call => call.stage)).toEqual(['writing', 'writing', 'review']);
    expect(f.calls[1]!.input_hash).not.toBe(f.calls[0]!.input_hash);
    expect(f.calls[1]!.counters).toMatchObject({tool_calls: 0, supplementary_materials: 0, download_bytes: 0, download_resources: 0,
      total_tool_calls: 40, total_materials: yielded.counters.total_materials, total_download_bytes: yielded.counters.total_download_bytes, revisions: 0});
    expect(complete.batch_id).not.toBe(yielded.batch_id); expect(complete.context).toEqual(yielded.context);
    expect(complete.note_date).toBe(yielded.note_date); expect(complete.counters.revisions).toBe(0); expect(complete.counters.total_tool_calls).toBe(44);
    expect(await Promise.all(sourcePaths.map(path => f.manager.readFile(f.journal.handle, path)))).toEqual(bytes);
    expect(sourcePaths.map(path => f.journal.handle.snapshot.manifest.files.find(file => file.path === path)!)).toEqual(manifest);
    expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png', 'export-png']);
    expect(await f.f.commands(f.skills)).toEqual(['export-png']);
    expect(await f.journal.load(invoiceKey)).toEqual(invoice); expect(await f.journal.load(responseKey)).toEqual(response);
    expect(complete.writing_activity!.visual_passed_hashes).toEqual([complete.writing!.resources[0]!.hash]);
    expect(complete.review_activity!.visual_read_hashes).toEqual([complete.writing!.resources[0]!.hash]);
    expect(complete.review!.file_hashes[complete.writing!.note_path]).toBe(digest(complete.writing!.markdown));
    expect(f.journal.keys('invocations/')).toHaveLength(3); expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);

it('a resumed batch consumes its old yield reason before a mid-query crash; the next cold host retains its new tool counters, pending input and partial usage without resetting or querying again', async () => {
  const f = await fixture('mid_resume_crash');
  try {
    await f.run(); await f.cold(); await expect(f.run()).rejects.toThrow();
    const mid = structuredClone(f.journal.handle.records['projects/render_project']) as unknown as HostProject;
    expect(mid).toMatchObject({reason: null, counters: {tool_calls: 1, total_tool_calls: 41},
      pending_query: {stage: 'writing', input_hash: f.calls[1]!.input_hash, prompt: f.calls[1]!.prompt}});
    const invoices = f.journal.keys('invocations/').map(key => f.journal.handle.records[key] as unknown as InvocationRecord);
    const active = invoices.find(invoice => invoice.status === 'running')!;
    expect(active).toBeDefined();
    expect(active.usage).toMatchObject({input_tokens: 11, output_tokens: 3, cost_status: 'unknown', cost_usd: null});
    const recorded = structuredClone(active);
    const batch = mid.batch_id;
    await f.cold(); expect(await f.current()).toEqual(mid);
    await f.run();
    expect(await f.current()).toMatchObject({state: 'deferred', reason: 'request_unknown', resume_policy: 'manual',
      batch_id: batch, counters: mid.counters, pending_query: mid.pending_query});
    const reconciled = (await f.journal.load<InvocationRecord>('invocations/' + active.invocation_id))!;
    // The host marks the project outcome uncertain without inventing a new
    // terminal provider observation; the persisted running invoice stays exact.
    expect(reconciled).toEqual(recorded);
    expect(f.calls.map(call => call.stage)).toEqual(['writing', 'writing']);
    expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png']); expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);

it('C035 an atomic writing-yield checkpoint survives a stop before outer stage_yielded, so the cold next batch resets its tools and resumes the checked source', async () => {
  const f = await fixture('after_yield_commit_loss');
  try {
    await expect(f.run()).rejects.toThrow();
    const atomic = structuredClone(f.journal.handle.records['projects/render_project']) as unknown as HostProject;
    expect(atomic).toMatchObject({state: 'deferred', reason: 'batch_yield', resume_stage: 'writing', resume_policy: 'automatic',
      pending_query: null, counters: {tool_calls: 40, total_tool_calls: 40, stalled_batches: 0}, stage_continuation: {stage: 'writing'}});
    const key = 'invocations/' + atomic.stage_continuation!.invocation_id;
    const invoice = structuredClone(f.journal.handle.records[key]);
    expect(invoice).toMatchObject({status: 'succeeded'});
    expect(f.journal.handle.records['consumed/' + atomic.stage_continuation!.invocation_id]).toMatchObject({reason: 'writing_batch_yield'});
    await f.cold(); expect(await f.current()).toEqual(atomic);
    await f.run();
    expect(await f.current()).toMatchObject({state: 'preview_ready', counters: {total_tool_calls: 44, revisions: 0}});
    expect(f.calls[1]!.counters).toMatchObject({tool_calls: 0, total_tool_calls: 40});
    expect(f.calls.map(call => call.stage)).toEqual(['writing', 'writing', 'review']);
    expect(await f.journal.load(key)).toEqual(invoice);
    expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png', 'export-png']); expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);

it('three unchanged writing-yield batches count repeated skill reads as no progress; the atomic third checkpoint stays manual after a stop and a cold next day never starts another query', async () => {
  const f = await fixture('repeat_yield_after_commit_loss');
  try {
    for (const batch of [1, 2]) {
      if (batch > 1) await f.cold(); await f.run();
      expect(await f.current()).toMatchObject({state: 'deferred', reason: 'batch_yield', counters: {stalled_batches: batch}});
    }
    await f.cold(); await expect(f.run()).rejects.toThrow();
    const blocked = structuredClone(f.journal.handle.records['projects/render_project']) as unknown as HostProject;
    expect(blocked).toMatchObject({state: 'deferred', reason: 'research_stalled', resume_policy: 'manual',
      counters: {stalled_batches: 3, revisions: 0}, stage_continuation: {stage: 'writing'}});
    // The third batch consumes an unchanged known reply; it does not charge a third query.
    expect(f.calls.map(call => call.stage)).toEqual(['writing', 'writing']);
    const facts = f.journal.keys('invocations/').map(key => structuredClone(f.journal.handle.records[key]));
    await f.cold(); expect(await f.current()).toEqual(blocked);
    await f.run(); expect(await f.current()).toMatchObject({state: 'deferred', reason: 'research_stalled', resume_policy: 'manual', counters: blocked.counters});
    expect(f.calls).toHaveLength(2); expect(f.journal.keys('invocations/').map(key => f.journal.handle.records[key])).toEqual(facts);
    expect(f.exports).toEqual([]); expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);

it('a cold review continuation retains its previous blocking issue when the final model reply omits it; missing or null review checkpoints are rejected', async () => {
  const f = await fixture('review_checkpoint');
  try {
    await f.run(); await f.cold(); await f.run();
    const yielded = (await f.current())!;
    expect(yielded).toMatchObject({state: 'deferred', resume_stage: 'review', reason: 'batch_yield',
      stage_continuation: {stage: 'review', review_checkpoint: {issues: [{severity: 'blocking', evidence_ids: ['e2']}]}}});
    const checkpoint = yielded.stage_continuation!.review_checkpoint!;
    const marker = yielded.stage_continuation!;
    expect(checkpoint.file_hashes[yielded.writing!.note_path]).toBe(digest(yielded.writing!.markdown));
    await f.cold(); expect((await f.current())!.stage_continuation).toEqual(marker);
    await f.run();
    const blocked = (await f.current())!;
    expect(blocked.review!.issues).toEqual(checkpoint.issues);
    expect(blocked.review!.file_hashes).toEqual(checkpoint.file_hashes);
    expect(blocked.review!.resource_manifest_hash).toBe(checkpoint.resource_manifest_hash);
    expect(blocked).toMatchObject({state: 'deferred', resume_stage: 'writing', reason: expect.stringContaining('paused'), stage_continuation: null});
    expect(f.calls.map(call => call.stage)).toEqual(['writing', 'writing', 'review', 'review']);
    expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);

it('a revision writing checkpoint yields and cold-resumes the same round without incrementing twice, then persistent blocking reviews still stop at two revisions', async () => {
  const f = await fixture('revision_yield');
  try {
    await f.run(); await f.cold(); await f.run();
    const yielded = (await f.current())!;
    expect(yielded).toMatchObject({state: 'deferred', reason: 'batch_yield', resume_stage: 'writing', counters: {revisions: 1},
      writing_activity: {round: 1}, stage_continuation: {stage: 'writing', round: 1, checkpoint: {markdown: expect.stringContaining('修订轮次：1')}}});
    expect(yielded.writing!.markdown).toContain('修订轮次：0');
    const oldPath = `projects/render_project/draft/${yielded.filename}`;
    expect(Buffer.from(await f.manager.readFile(f.journal.handle, oldPath)).toString()).toBe(yielded.writing!.markdown);
    await f.cold(); expect((await f.current())!.counters.revisions).toBe(1);
    await f.run();
    const blocked = (await f.current())!;
    expect(blocked).toMatchObject({state: 'deferred', reason: 'quality_blocked', resume_policy: 'manual', counters: {revisions: 2}, stage_continuation: null});
    expect(f.calls.filter(call => call.stage === 'writing').map(call => call.counters.revisions)).toEqual([0, 0, 1, 1, 2]);
    expect(f.calls.filter(call => call.stage === 'review')).toHaveLength(3);
    expect(blocked.writing!.markdown).toContain('修订轮次：2'); expect(blocked.filename).toBe(yielded.filename);
    const calls = f.calls.length; await f.cold(); await f.run();
    expect(f.calls).toHaveLength(calls); expect((await f.current())!.counters.revisions).toBe(2); expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);

it('C035 an unknown writing reply with the same checked source and exhausted budget stays manual on a cold host without resetting counters, repeating the query or exporting again', async () => {
  const f = await fixture('unknown');
  try {
    await f.run();
    const unknown = (await f.current())!;
    expect(unknown).toMatchObject({state: 'deferred', reason: 'request_unknown', resume_policy: 'manual', resume_stage: 'writing',
      counters: {tool_calls: 40, total_tool_calls: 40, revisions: 0}, writing_activity: {skill_activated: true, playbook_read: true}});
    expect(unknown.pending_query).not.toBeNull();
    const invoiceKey = f.journal.keys('invocations/')[0]!;
    const invoice = (await f.journal.load<InvocationRecord>(invoiceKey))!;
    expect(invoice).toMatchObject({status: 'unknown', usage: {input_tokens: 7, output_tokens: 2, cost_status: 'unknown', cost_usd: null}});
    const sourcePaths = ['.json', '.svg', '.render-check.json'].map(extension => `projects/render_project/draft/${relative}${extension}`);
    const bytes = await Promise.all(sourcePaths.map(path => f.manager.readFile(f.journal.handle, path)));
    expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png']);
    await f.cold();
    expect(await f.current()).toEqual(unknown);
    await f.run();
    expect(await f.current()).toMatchObject({state: 'deferred', reason: 'request_unknown', resume_policy: 'manual',
      counters: unknown.counters, context: unknown.context, writing_activity: unknown.writing_activity, pending_query: unknown.pending_query,
      note_date: unknown.note_date, filename: unknown.filename, batch_id: unknown.batch_id});
    expect(f.calls.map(call => call.stage)).toEqual(['writing']); expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png']);
    expect(await Promise.all(sourcePaths.map(path => f.manager.readFile(f.journal.handle, path)))).toEqual(bytes);
    expect(await f.journal.load(invoiceKey)).toEqual(invoice); expect(f.journal.keys('invocations/')).toHaveLength(1);
    expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);

it('C035 a lost consumption checkpoint replays the original known writing prompt without a new query or false stall, then the next physical batch reuses its checked source', async () => {
  const f = await fixture('checkpoint_loss');
  try {
    await expect(f.run()).rejects.toThrow();
    const persisted = structuredClone(f.journal.handle.records['projects/render_project']) as unknown as HostProject;
    expect(persisted.pending_query).toMatchObject({stage: 'writing', prompt: f.calls[0]!.prompt, input_hash: f.calls[0]!.input_hash,
      progress_hash: expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(persisted.stage_continuation).toBeNull();
    const invoiceKey = f.journal.keys('invocations/')[0]!;
    const invoice = structuredClone(f.journal.handle.records[invoiceKey]);
    expect(invoice).toMatchObject({status: 'succeeded'});
    await f.cold();
    expect(await f.current()).toEqual(persisted);
    const paths = ['.json', '.svg', '.render-check.json'].map(extension => `projects/render_project/draft/${relative}${extension}`);
    const bytes = await Promise.all(paths.map(path => f.manager.readFile(f.journal.handle, path)));
    await f.run();
    const consumed = (await f.current())!;
    expect(consumed).toMatchObject({state: 'deferred', reason: 'batch_yield', resume_stage: 'writing', pending_query: null,
      counters: {tool_calls: 40, total_tool_calls: 40, stalled_batches: 0}, stage_continuation: {stage: 'writing'}});
    expect(f.calls).toHaveLength(1); expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png']);
    expect(await f.journal.load(invoiceKey)).toEqual(invoice);
    await f.cold(); await f.run();
    expect(await f.current()).toMatchObject({state: 'preview_ready', counters: {revisions: 0, stalled_batches: 0, total_tool_calls: 44}});
    expect(f.calls.map(call => call.stage)).toEqual(['writing', 'writing', 'review']);
    expect(f.calls[1]!.input_hash).not.toBe(f.calls[0]!.input_hash);
    expect(await Promise.all(paths.map(path => f.manager.readFile(f.journal.handle, path)))).toEqual(bytes);
    expect(f.exports).toEqual(['validate', 'render', 'check', 'export-png', 'export-png']);
    expect(await f.journal.load(invoiceKey)).toEqual(invoice); expect(f.external).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);
