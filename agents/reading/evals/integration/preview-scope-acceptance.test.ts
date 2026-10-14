import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileObjectStore } from '../../src/storage/filesystem.js';
import { ImmutableWorkspaceManager } from '../../src/workspace/manager.js';
import { WorkspaceJournal, ApplicationInvocationJournal } from '../../src/app/journal.js';
import { validateHostRecords } from '../../src/app/records.js';
import { ReadingController, type ControllerPorts, type HostProject } from '../../src/app/controller.js';
import { PolicyGate } from '../../src/policy/gate.js';
import { policyFixture } from '../runtime/policy-fixtures.js';
import { buildContext } from '../../src/context/index.js';
import { StageExecutor } from '../../src/stages/executor.js';
import { RunDeadline } from '../../src/runtime/deadline.js';
import { UrlGateway } from '../../src/tools/fetch.js';
import { digest, type Evidence, type ResearchPacket, type Scope } from '../../src/stages/contracts.js';
import { type QueryRequest, type ModelAdapter } from '../../src/runtime/sdk.js';
import { type SourceSlice } from '../../src/tools/segments.js';
import { emptySourceProgress } from '../../src/collect/sources.js';
import { type IdentityState } from '../../src/collect/identity.js';
import { type PreviewReport } from '../../src/preview/report.js';
import { parseDispatch } from '../../src/config/dispatch.js';
import { canonicalJson } from '../../src/contracts/index.js';
import { buildUsageLedger, usageForProject } from '../../src/workspace/usage.js';
import { CLOUD_CONTRACT_PATH, READING_CLOUD_CONTRACT, cloudSkillAdapted } from '../../src/tools/skills.js';
import type {Writing} from '../../src/stages/validation.js';

// Real controller, driver, tools and persistent journals; model/HTTP replay only.
// No OSS/RAM, native SDK, cloud rendering, remote delivery or human quality proof.
async function fixture(previewOutcome: 'skip' | 'ready') {
  const root = await mkdtemp(join(tmpdir(), 'reading-preview-acceptance-'));
  const store = new FileObjectStore(join(root, 'objects'));
  const source = 'https://independent.dev/intent-ordering';
  const figureUrl = 'https://independent.dev/intent-ordering.png';
  const mechanism = 'Mechanism writes intent before an operation.';
  const boundary = 'Only a single writer is supported.';
  const caption = 'Intent precedes effects';
  const html = `<html><head><title>Durable journal</title></head><body><main><h1>Durable journal</h1><p>${mechanism}</p><p>${boundary}</p><figure><img src="${figureUrl}"><figcaption>${caption}</figcaption></figure></main></body></html>`;
  const png = await readFile('agents/reading/evals/runtime/evidence/linux-tools.png');
  const templates = Object.fromEntries(await Promise.all(['selection', 'research', 'writing', 'review'].map(async stage => [stage, await readFile(`agents/reading/prompts/${stage}.md`, 'utf8')])));
  const marker = `<!-- ${READING_CLOUD_CONTRACT.documentation_marker} -->`;
  const skillText: Record<string, string> = {
    '.agents/skills/obsidian-note/SKILL.md': `${marker}\nUse VAULT_ROOT. Write mechanism notes with evidence and inspect figures.`,
    '.agents/skills/obsidian-note/references/diagram-playbook.md': `${marker}\nUse relative images in preview and inspect their pixels.`,
    '.agents/skills/fireworks-tech-graph/SKILL.md': `${marker}\nTrusted fixed rendering only.`,
    [CLOUD_CONTRACT_PATH]: canonicalJson(READING_CLOUD_CONTRACT),
  };
  expect(cloudSkillAdapted(skillText)).toBe(true);
  const skillHashes = Object.fromEntries(Object.entries(skillText).map(([path, text]) => [path, digest(text)]));
  const calls: {scope: Scope; stage: string; subject: string}[] = [];
  const fetches: {scope: Scope; url: string}[] = [];
  const externalEffects: string[] = [];
  const modelErrors: string[] = [];
  let sequence = 0;
  const session = async (scope: Scope, initialize = false) => {
    const local = join(root, `${scope}-cold-${++sequence}`);
    const id = scope === 'preview' ? 'obs-notes-hub/reading-preview/acceptance' : 'obs-notes-hub/reading';
    const manager = new ImmutableWorkspaceManager({store, scope, verify_preflight: false, local_root: local, record_validator: validateHostRecords});
    const journal = new WorkspaceJournal(manager, await manager.restore(id, {allow_initialize: initialize}), `preview-acceptance-${sequence}`);
    const policy = policyFixture();
    policy.allowed_domains.push('independent.dev');
    const gate = new PolicyGate(async () => policy, check => journal.commit(`policy-checks/${check.check_id}`, check));
    const deadline = new RunDeadline();
    for (const [path, text] of Object.entries(skillText)) {
      await mkdir(dirname(join(local, path)), {recursive: true});
      await writeFile(join(local, path), text);
    }
    const model: ModelAdapter = {async *stream(request: QueryRequest) {
      const payload = JSON.parse(request.prompt) as {task: string; data: Record<string, unknown>};
      const classify = Object.hasOwn((request.schema as {properties?: object}).properties ?? {}, 'content_eligibility');
      const stage = classify ? 'classify' : payload.task;
      const projectId = (await journal.load<HostProject>(journal.keys('projects/')[0]!))!.project_id;
      calls.push({scope, stage, subject: projectId});
      const call = async (name: string, input: Record<string, unknown> = {}) => request.tools.find(tool => tool.name === name)!.run(input);
      let result: unknown;
      if (classify) {
        const main = await call('read_main') as SourceSlice;
        const line = main.lines.find(line => line.text === mechanism)!;
        expect(line).toBeDefined();
        result = {content_eligibility: 'allowed', content_type: 'engineering', topic: 'agents', reason_codes: [], evidence: [{start_line: line.line, end_line: line.line, excerpt: mechanism}]};
      } else if (stage === 'selection') {
        await call('read_main');
        result = {decision: scope === 'production' ? 'defer' : previewOutcome === 'skip' ? 'skip' : 'research', reason_codes: [scope === 'production' ? 'production_selection_reexecuted' : 'preview_selection'], reason: 'Explicit replay decision after this scope reads and classifies the article.', dimension_ratings: {relevance: 'strong', mechanism: 'strong', evidence: 'strong', transferability: 'strong', increment: 'strong'}, questions: scope === 'preview' && previewOutcome === 'ready' ? ['Mechanism?', 'Boundary?', 'Independent experiment?'] : [], related_note_ids: [], evidence_ids: []};
      } else if (stage === 'research') {
        const main = await call('read_main') as SourceSlice;
        const snapshot = (payload.data.snapshots as {hash: string; retrieved_at: string}[])[0]!;
        const questions = [{id: 'q1', text: 'Mechanism?', priority: 'required' as const}, {id: 'q2', text: 'Boundary?', priority: 'required' as const}, {id: 'q3', text: 'Independent experiment?', priority: 'required' as const}];
        await call('plan_research', {questions});
        const evidence: Evidence[] = [mechanism, boundary].map((text, index) => {
          const line = main.lines.find(line => line.text === text)!;
          return {evidence_id: `e${index + 1}`, source_url: source, retrieved_at: snapshot.retrieved_at, snapshot_hash: snapshot.hash, locator: {start_line: line.line, end_line: line.line}, excerpt: text, claim: text, claim_type: 'source_statement', limits: [], based_on: []};
        });
        for (const item of evidence) await call('record_evidence', {evidence: item});
        const packet: ResearchPacket = {project_id: projectId, questions, answers: [{question_id: 'q1', answer: mechanism, evidence_ids: ['e1'], source_not_provided: false}, {question_id: 'q2', answer: boundary, evidence_ids: ['e2'], source_not_provided: false}, {question_id: 'q3', answer: null, evidence_ids: [], source_not_provided: true}], evidence, gaps: [], source_versions: [{url: source, hash: snapshot.hash, main: true, core: true, status: 'read'}], mechanism_evidence_ids: ['e1'], boundary_evidence_ids: ['e2'], knowledge_increment: 'Failure recovery protocol'};
        result = packet;
      } else if (stage === 'writing') {
        await call('activate_skill', {name: 'obsidian-note'});
        await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'});
        const image = await call('download_source_image', {snapshot_hash: (payload.data.research as ResearchPacket).source_versions[0]!.hash, url: figureUrl, caption, name: 'intent-ordering'}) as {path: string; hash: string; mime: string; caption: string; source_path: null};
        const pixels = await call('read_image', {path: image.path}) as {content: {type: string; data: string}[]};
        expect(Buffer.from(pixels.content[0]!.data, 'base64')).toEqual(png);
        await call('record_visual_check', {path: image.path, passed: true, issues: []});
        const date = String(payload.data.created);
        const markdown = `---\ntitle: 持久日志机制\ntags: [agents, engineering, recovery]\ncreated: ${date}\nsource: ${source}\n---\n# 持久日志机制\n\n> [!abstract] 摘要\n> 意图持久化支持故障后的恢复。\n\n## 一、机制\n${mechanism}\n\n![${caption}](../${image.path})\n\n## 二、边界\n${boundary}\n<div>单写入者控制副作用</div>\n`;
        const line = (text: string) => markdown.split('\n').indexOf(text) + 1;
        result = {note_path: `Organize Notes By AI/${date.slice(2).replaceAll('-', '')}-持久日志机制.md`, markdown, claims: [{id: 'c1', text: mechanism, line: line(mechanism), evidence_ids: ['e1'], claim_type: 'source_statement'}, {id: 'c2', text: boundary, line: line(boundary), evidence_ids: ['e2'], claim_type: 'source_statement'}], figure_plan: [{section: '一、机制', type: 'source_image', goal: caption, resource_path: image.path, no_figure_reason: null}, {section: '二、边界', type: 'html_card', goal: 'Writer boundary', resource_path: null, no_figure_reason: null}], resources: [{...image, visual_check: 'passed', core: true, url: null}], degradations: []};
      } else {
        expect(stage).toBe('review');
        expect(request.tools.map(tool => tool.name)).toEqual(['read_image']);
        for (const image of (payload.data.writing as Writing).resources) {
          const pixels = await call('read_image', {path: image.path}) as {content: {type: string; data: string}[]};
          expect(pixels.content[0]!.type).toBe('image');
          expect(Buffer.from(pixels.content[0]!.data, 'base64')).toEqual(png);
        }
        result = {issues: [], file_hashes: payload.data.file_hashes, resource_manifest_hash: payload.data.resource_manifest_hash};
      }
      yield {message_id: `${scope}-message-${calls.length}`, type: 'result', summary: true, success: true, result, usage: {input_tokens: scope === 'preview' ? 11 : 3, output_tokens: 1, cost_status: 'unknown', cost_usd: null}, observable: {}};
    }};
    const executor = new StageExecutor({async *stream(request) {try {yield* model.stream(request);} catch (error) {modelErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)); throw error;}}}, gate, new ApplicationInvocationJournal(journal));
    const ports: ControllerPorts = {
      journal, gate, deadline, sources: [],
      context: async () => {
        const context = buildContext({index: [], query: 'intent ordering', heldout: {urls: new Set(), note_paths: new Set()}, preferences_hash: digest('preferences'), skill_commit: 'a'.repeat(40), skill_hash: digest(canonicalJson(skillHashes)), prompt_hash: digest(Buffer.concat(['selection', 'research', 'writing', 'review'].map(stage => Buffer.from(templates[stage]!)))), prompt_templates: templates, model: `scope-replay-${scope}`, evidence_versions: []});
        if (!await journal.load(`contexts/${context.context_id}`)) await journal.commitMany({[`contexts/${context.context_id}`]: context}, 'generation_context_fixed');
        return context;
      },
      readArtifact: path => manager.readFile(journal.handle, path),
      environment: async (_project, commit) => ({root: local, model: `scope-replay-${scope}`, gate, deadline, executor, commit, skills: {root: local, commit: 'a'.repeat(40), hash: digest(canonicalJson(skillHashes)), files: skillHashes, adapted: cloudSkillAdapted(skillText)}, read_snapshot_body: reference => manager.readFile(journal.handle, reference.path), read_current_knowledge: async () => [], gateway: new UrlGateway(async () => {}, async () => [{address: '8.8.8.8', family: 4}], async url => {
        fetches.push({scope, url: url.href});
        if (url.href === source) return {status: 200, headers: {'content-type': 'text/html'}, body: Buffer.from(html)};
        if (url.href === figureUrl) return {status: 200, headers: {'content-type': 'image/png'}, body: png};
        throw new Error('unregistered_fixture_request');
      })}),
      prepareResources: async project => {externalEffects.push('upload'); return project;},
      verifySources: async () => {externalEffects.push('formal_source_verification'); return new Date().toISOString();},
      seal: async () => {externalEffects.push('seal');},
      publish: async project => {externalEffects.push('publish'); return project;},
      reconcile: async project => {externalEffects.push('reconcile'); return project;},
    };
    const controller = new ReadingController(ports);
    return {local, manager, journal, run: (urls = true) => controller.run(parseDispatch({mode: scope === 'preview' ? 'preview' : 'scheduled', input_urls: urls ? [source] : [], ...(scope === 'preview' ? {preview_id: 'acceptance'} : {})}), 'fixture-owner'), project: async () => journal.load<HostProject>(journal.keys('projects/')[0]!), closeLocal: () => rm(local, {recursive: true, force: true})};
  };
  return {root, store, source, png, calls, fetches, externalEffects, modelErrors, session, cleanup: () => rm(root, {recursive: true, force: true})};
}

it.each(['skip', 'ready'] as const)('preview %s survives cold restore but the same URL receives fresh production admission, identity, classification and usage', async outcome => {
  const f = await fixture(outcome);
  try {
    const production = await f.session('production', true);
    const progress = {...emptySourceProgress(), last_complete_watermark: '2026-10-13T00:00:00Z', last_success_at: '2026-10-13T00:00:00Z', observed_ids: [digest('production-only-observed-id')]};
    await production.journal.commit('sources/langchain_blog/progress', progress);
    const pristineRevision = production.journal.handle.revision;
    const preview = await f.session('preview', true);
    await preview.run();
    const previewProject = (await preview.project())!;
    expect(previewProject.state, JSON.stringify(f.modelErrors) + (previewProject.reason ?? '')).toBe(outcome === 'skip' ? 'skipped' : 'preview_ready');
    const previewRecordBytes = canonicalJson(preview.journal.handle.records);
    await preview.closeLocal();
    const coldPreview = await f.session('preview');
    expect(canonicalJson(coldPreview.journal.handle.records)).toBe(previewRecordBytes);
    const callsBeforeResume = f.calls.length;
    await coldPreview.run(false);
    expect(f.calls).toHaveLength(callsBeforeResume);
    const unchanged = await production.manager.restore(production.journal.handle.workspace_id);
    expect(unchanged.revision).toBe(pristineRevision);
    expect(unchanged.records.identity).toBeUndefined();
    expect(unchanged.records['sources/langchain_blog/progress']).toEqual(progress);
    expect(Object.keys(unchanged.records).some(key => key.startsWith('projects/') || key.startsWith('invocations/'))).toBe(false);
    await production.closeLocal();
    const coldProduction = await f.session('production');
    await coldProduction.run();
    const formal = (await coldProduction.project())!;
    expect(formal).toMatchObject({execution_scope: 'production', state: 'deferred', reason: 'production_selection_reexecuted', generation_version: 1});
    // The deterministic URL ID can match; the authoritative identity includes its workspace/scope.
    expect(formal.workspace_id).not.toBe(previewProject.workspace_id);
    expect(formal.context.context_id).not.toBe(previewProject.context.context_id);
    expect(formal.context.model).toBe('scope-replay-production');
    expect(formal.classification?.attempts).toBe(1);
    expect(formal.classification?.credential?.content_eligibility).toBe('allowed');
    expect(formal.writing).toBeNull();
    expect(formal.review).toBeNull();
    expect(formal.delivery_id).toBeNull();
    expect(coldProduction.journal.keys('previews/')).toEqual([]);
    expect(coldProduction.journal.keys('delivery-')).toEqual([]);
    expect(await coldProduction.journal.load('sources/langchain_blog/progress')).toEqual(progress);
    const identity = (await coldProduction.journal.load<IdentityState>('identity'))!;
    expect(Object.values(identity.candidates)).toHaveLength(1);
    expect(identity.candidates[formal.candidate.candidate_id]).toMatchObject({project_id: formal.project_id, status: 'deferred'});
    expect(f.calls.filter(call => call.scope === 'production').map(call => call.stage)).toEqual(['classify', 'selection']);
    expect(f.fetches.filter(fetch => fetch.scope === 'production')).toEqual([{scope: 'production', url: f.source}]);
    const formalInvocations = coldProduction.journal.keys('invocations/');
    expect(formalInvocations).toHaveLength(2);
    expect(formalInvocations.some(key => coldPreview.journal.keys('invocations/').includes(key))).toBe(false);
    const usage = usageForProject(buildUsageLedger([coldProduction.journal.handle]), 'production', formal.workspace_id, formal.project_id);
    expect(usage.input_tokens).toBe(6);
    expect(usage.cost_status).toBe('unknown');
    expect(f.externalEffects).toEqual([]);
    const previewFinalRevision = coldPreview.journal.handle.revision;
    const secondCold = await f.session('production');
    expect((await secondCold.project())?.project_id).toBe(formal.project_id);
    expect((await secondCold.project())?.classification).toEqual(formal.classification);
    expect(await secondCold.journal.load('sources/langchain_blog/progress')).toEqual(progress);
    await secondCold.run();
    expect(secondCold.journal.keys('projects/')).toEqual([`projects/${formal.project_id}`]);
    expect((await secondCold.project())?.classification?.attempts).toBe(1);
    expect(f.calls.filter(call => call.scope === 'production').map(call => call.stage)).toEqual(['classify', 'selection', 'selection']);
    expect(f.fetches.filter(fetch => fetch.scope === 'production')).toEqual([{scope: 'production', url: f.source}]);
    expect(f.externalEffects).toEqual([]);
    expect((await coldPreview.manager.restore(coldPreview.journal.handle.workspace_id)).revision).toBe(previewFinalRevision);
  } finally {await f.cleanup();}
}, 60_000);

it('controller seals the reviewed relative PNG and preview report with all formal delivery checks not_exercised, preserving exact outputs across cold resume', async () => {
  const f = await fixture('ready');
  try {
    const preview = await f.session('preview', true);
    const run = await preview.run();
    const project = (await preview.project())!;
    expect(run.outcome, JSON.stringify(f.modelErrors) + (project.reason ?? JSON.stringify(run.failures))).toBe('success_preview');
    expect(project.state).toBe('preview_ready');
    expect(f.calls.map(call => call.stage)).toEqual(['classify', 'selection', 'research', 'writing', 'review']);
    const report = (await preview.journal.load<PreviewReport>(`previews/${project.project_id}`))!;
    expect(report).toMatchObject({execution_scope: 'preview', workspace_id: project.workspace_id, project_id: project.project_id, state: 'preview_ready', checks: {formal_upload: 'not_exercised', formal_url: 'not_exercised', github_pr: 'not_exercised'}});
    const resource = project.writing!.resources[0]!;
    expect(resource.url).toBeNull();
    expect(resource.visual_check).toBe('passed');
    expect(project.writing_activity!.visual_passed_hashes).toEqual([digest(f.png)]);
    expect(project.review_activity!.visual_read_hashes).toEqual([digest(f.png)]);
    expect(project.writing!.markdown).toContain(`](../${resource.path})`);
    const outputNote = `outputs/${project.project_id}/${project.writing!.note_path}`;
    const outputImage = `outputs/${project.project_id}/${resource.path}`;
    expect(Buffer.from(await preview.manager.readFile(preview.journal.handle, outputNote)).toString()).toBe(project.writing!.markdown);
    expect(await preview.manager.readFile(preview.journal.handle, outputImage)).toEqual(f.png);
    expect(report.file_hashes[resource.path]).toBe(digest(f.png));
    expect(report.file_hashes[project.writing!.note_path]).toBe(digest(project.writing!.markdown));
    expect(preview.journal.keys('delivery-')).toEqual([]);
    expect(f.externalEffects).toEqual([]);
    await preview.closeLocal();
    const cold = await f.session('preview');
    expect(await cold.journal.load(`previews/${project.project_id}`)).toEqual(report);
    expect(await cold.manager.readFile(cold.journal.handle, outputImage)).toEqual(f.png);
    expect(Buffer.from(await cold.manager.readFile(cold.journal.handle, outputNote)).toString()).toContain(`](../${resource.path})`);
    await cold.run(false);
    expect(await cold.journal.load(`previews/${project.project_id}`)).toEqual(report);
    expect(f.calls).toHaveLength(5);
    expect(f.externalEffects).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);
