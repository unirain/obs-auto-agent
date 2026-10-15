import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect, it} from 'vitest';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal, ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {ReadingController, type ControllerPorts, type HostProject} from '../../src/app/controller.js';
import {mappedState} from '../../src/app/bootstrap.js';
import {buildContext} from '../../src/context/index.js';
import {discoverCandidate, emptyIdentity, addCandidate} from '../../src/collect/identity.js';
import {newRuntimeProject} from '../../src/stages/driver.js';
import {StageExecutor} from '../../src/stages/executor.js';
import {digest, type Evidence, type ResearchPacket} from '../../src/stages/contracts.js';
import {type Writing} from '../../src/stages/validation.js';
import {canonicalJson} from '../../src/contracts/index.js';
import {PolicyGate, type PolicySubject} from '../../src/policy/gate.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {type ModelAdapter} from '../../src/runtime/sdk.js';
import {UrlGateway, extractWebSnapshot} from '../../src/tools/fetch.js';
import {type SourceSlice} from '../../src/tools/segments.js';
import {EvidenceRegistry, reverifyCore} from '../../src/tools/evidence.js';
import {validateMaterialClosure} from '../../src/tools/materials.js';
import {readRepositoryFile} from '../../src/tools/repository.js';
import {type SkillBundle} from '../../src/tools/skills.js';
import {ResourcePublisher, type ImageStore} from '../../src/publish/resources.js';
import {Publisher} from '../../src/publish/publisher.js';
import {parseStoredDelivery} from '../../src/publish/contracts.js';
import {type SealedDelivery, type ResourceReceipt} from '../../src/publish/types.js';
import {deliveryValidationHash} from '../../src/publish/validate.js';
import {sealDelivery, verifySeal, type ArtifactSeal} from '../../src/workspace/seal.js';
import {parseDispatch} from '../../src/config/dispatch.js';
import {FakeGitHub} from '../delivery/helpers.js';
import {policyFixture} from '../runtime/policy-fixtures.js';

type Scenario = 'pinned_tree_missing' | 'complete' | 'paper_http_failure' | 'paper_extraction_failure';
type StoredDelivery = Omit<SealedDelivery, 'files'> & {
  files: (Omit<SealedDelivery['files'][number], 'content'> & {content_base64: string})[];
};
const sourceUrl = 'https://independent.dev/durable-journal';
const paperUrl = 'https://arxiv.org/html/2601.00001';
const commit = 'd'.repeat(40);
const repositoryUrl = `https://github.com/test/reading-fixture/blob/${commit}/src/journal.ts`;
const rawCodeUrl = `https://raw.githubusercontent.com/test/reading-fixture/${commit}/src/journal.ts`;
const treeUrl = `https://api.github.com/repos/test/reading-fixture/git/trees/${commit}?recursive=1`;
const imageUrl = 'https://independent.dev/journal-flow.png';
const code = 'export function writeIntent() { return persist("intent"); }\n// Only the trusted host applies the effect.\n';
const mainHtml = `<html><title>Journal protocol</title><body><main><h1>Journal protocol</h1><p>Persist intent before applying the effect.</p><p>Only a single writer is supported.</p><p><a href="${paperUrl}">Core paper</a><a href="${repositoryUrl}">Reference implementation</a></p><figure><img src="${imageUrl}"><figcaption>Intent before effect</figcaption></figure></main></body></html>`;
const paperHtml = '<html><title>Journal theorem</title><body><main><h1>Journal theorem</h1><p>A committed intent survives a worker interruption.</p><p>The theorem assumes one writer.</p></main></body></html>';

/** All service/model replies are explicit local replay; driver/tool/persistence paths are production code. */
async function fixture(scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), 'reading-material-chain-'));
  const workspace = 'obs-notes-hub/reading-integration';
  const store = new FileObjectStore(join(root, 'objects'));
  let manager!: ImmutableWorkspaceManager;
  let journal!: WorkspaceJournal;
  let clock = Date.now();
  const now = () => new Date(Math.max(clock, Date.now()));
  const open = async (run: string, initialize = false) => {
    manager = new ImmutableWorkspaceManager({store, scope: 'production', trusted_workspace_id: workspace,
      local_root: join(root, run), verify_preflight: false, record_validator: validateHostRecords});
    journal = new WorkspaceJournal(manager, await manager.restore(workspace, {allow_initialize: initialize, run_id: run}), run);
  };
  await open('material-first', true);
  const policy = policyFixture();
  policy.allowed_domains.push('independent.dev', 'github.com', 'api.github.com', 'raw.githubusercontent.com');
  const gate = () => new PolicyGate(async () => policy, check => journal.commit('policy-checks/' + check.check_id, check), now);
  const skillRoot = join(root, 'trusted-skills');
  const skillTexts = {
    '.agents/skills/obsidian-note/SKILL.md': 'Explain the mechanism and its boundary with locatable evidence and a checked source figure.',
    '.agents/skills/obsidian-note/references/diagram-playbook.md': 'A source figure must retain its caption and pass explicit inspection; a simple mechanism can use Mermaid.',
  };
  const skillFiles = Object.fromEntries(Object.entries(skillTexts).map(([file, text]) => [file, digest(text)]));
  for (const [file, text] of Object.entries(skillTexts)) {
    await mkdir(dirname(join(skillRoot, file)), {recursive: true}); await writeFile(join(skillRoot, file), text);
  }
  const skills: SkillBundle = {root: skillRoot, commit: 'b'.repeat(40), hash: digest(canonicalJson(skillFiles)), files: skillFiles, adapted: true};
  const templates = Object.fromEntries(await Promise.all(['selection', 'research', 'writing', 'review'].map(async stage =>
    [stage, await readFile(`agents/reading/prompts/${stage}.md`, 'utf8')])));
  const context = buildContext({index: [], query: 'journal protocol', heldout: {urls: new Set(), note_paths: new Set()},
    preferences_hash: digest('material chain'), skill_commit: skills.commit, skill_hash: skills.hash,
    prompt_templates: templates, prompt_hash: digest(Buffer.concat(['selection', 'research', 'writing', 'review'].map(stage => Buffer.from(templates[stage]!)))),
    model: 'explicit-replay', evidence_versions: []});
  const candidate = discoverCandidate('manual_url', sourceUrl, 'Journal protocol', null, now().toISOString());
  candidate.project_id = 'material_project';
  const projectKey = 'projects/' + candidate.project_id;
  const project: HostProject = {...newRuntimeProject(candidate, {project_id: candidate.project_id, execution_scope: 'production',
    workspace_id: workspace, context, now: now()}), generation_version: 1, resume_stage: null, resume_policy: 'automatic',
    reason: null, last_run_id: null, batch_id: 'material-batch', delivery_id: null, sources_verified_at: null};
  if (scenario === 'pinned_tree_missing') project.repository_versions[repositoryUrl] = {owner: 'test', repository: 'reading-fixture', commit};
  const identity = emptyIdentity(); addCandidate(identity, candidate);
  await journal.commitMany({identity, [projectKey]: project, ['contexts/' + context.context_id]: context}, 'collection_committed');
  const png = await readFile('agents/reading/evals/runtime/evidence/linux-tools.png');
  const http: string[] = [];
  const paperErrors: string[] = [];
  const queries: string[] = [];
  const subject = async (url?: string): Promise<PolicySubject> => {
    const current = (await journal.load<HostProject>(projectKey))!;
    return {subject_ref: 'project:' + current.project_id, project_id: current.project_id, candidate_id: candidate.candidate_id,
      execution_scope: 'production', origin_source_ids: candidate.origin_source_ids, main_url: sourceUrl,
      urls: [sourceUrl, ...(url ? [url] : [])], ...(current.classification ? {source_snapshot_hash: current.classification.source_snapshot_hash} : {}),
      ...(current.classification?.credential ? {classification: current.classification.credential} : {})};
  };
  const gateway = new UrlGateway(async url => {await gate().require(await subject(url), url === sourceUrl ? 'main_read' : url === imageUrl ? 'write' : 'research', 'material_http');},
    async () => [{address: '8.8.8.8', family: 4}], async url => {
      http.push(url.href);
      const reply = (mime: string, body: string | Uint8Array, status = 200) => ({status, headers: {'content-type': mime}, body: typeof body === 'string' ? Buffer.from(body) : body});
      if (url.href === sourceUrl) return reply('text/html', mainHtml);
      if (url.href === paperUrl) {
        if (scenario === 'paper_http_failure') return reply('text/plain', 'Fixture paper service unavailable', 503);
        if (scenario === 'paper_extraction_failure') return reply('application/pdf', '%PDF-1.7\nThis fixture is truncated before EOF.');
        return reply('text/html', paperHtml);
      }
      if (url.href === treeUrl) return reply('application/json', JSON.stringify({truncated: false, tree: [{type: 'blob', path: 'src/journal.ts'}]}));
      if (url.href === rawCodeUrl) return reply('text/plain', code);
      if (url.href === imageUrl) return reply('image/png', png);
      throw new Error('unregistered replay HTTP URL');
    });
  const questions: ResearchPacket['questions'] = [{id: 'q1', text: 'How is ordering implemented?', priority: 'required'},
    {id: 'q2', text: 'What survives interruption?', priority: 'required'}, {id: 'q3', text: 'What writer boundary applies?', priority: 'required'}];
  const makeEvidence = (view: SourceSlice, id: string, excerpt: string, claim_type: Evidence['claim_type']): Evidence => {
    const line = view.lines.find(value => value.text.includes(excerpt))!;
    expect(line).toBeDefined();
    return {evidence_id: id, source_url: view.url, retrieved_at: view.retrieved_at, snapshot_hash: view.hash,
      locator: {start_line: line.line, end_line: line.line, ...(view.kind === 'code' ? {commit: view.commit!, file: view.file!} : {})},
      excerpt, claim: excerpt, claim_type, limits: [], based_on: []};
  };
  const model: ModelAdapter = {async *stream(request) {
    const payload = JSON.parse(request.prompt) as {task: string; data: Record<string, unknown>};
    const classification = Boolean((request.schema as {properties?: Record<string, unknown>}).properties?.content_eligibility);
    const stage = classification ? 'classification' : payload.task;
    queries.push(stage);
    const call = async (name: string, args: Record<string, unknown> = {}) => request.tools.find(tool => tool.name === name)!.run(args);
    let result: unknown;
    if (classification) {
      const view = await call('read_main') as SourceSlice;
      const evidence = makeEvidence(view, 'classification', 'Persist intent before applying the effect.', 'source_statement');
      result = {content_eligibility: 'allowed', content_type: 'engineering', topic: 'agents', reason_codes: [],
        evidence: [{start_line: evidence.locator.start_line, end_line: evidence.locator.end_line, excerpt: evidence.excerpt}]};
    } else if (stage === 'selection') {
      await call('read_main');
      result = {decision: 'research', reason_codes: [], reason: 'Combines ordering with a theorem and fixed implementation.',
        dimension_ratings: {relevance: 'strong', mechanism: 'strong', evidence: 'strong', transferability: 'strong', increment: 'strong'},
        questions: questions.map(question => question.text), related_note_ids: [], evidence_ids: []};
    } else if (stage === 'research') {
      const main = await call('read_main') as SourceSlice;
      await call('plan_research', {questions});
      let paper: SourceSlice | null = null;
      try {paper = await call('follow_reference', {from_hash: main.hash, url: paperUrl}) as SourceSlice;}
      catch (error) {const reason = error instanceof Error ? error.message : ''; expect(reason).toBe(scenario === 'paper_http_failure' ? 'source_http_503' : 'pdf_truncated_or_invalid'); paperErrors.push(reason);}
      const storedSnapshots = payload.data.snapshots as {kind: string; hash: string; url: string}[];
      const priorCode = storedSnapshots.find(snapshot => snapshot.kind === 'code');
      let implementation: SourceSlice;
      if (priorCode) implementation = await call('read_source', {snapshot_hash: priorCode.hash, source_url: priorCode.url}) as SourceSlice;
      else {
        const listing = await call('inspect_repository', {from_hash: main.hash, url: repositoryUrl}) as {commit: string; files: string[]};
        expect(listing).toMatchObject({commit, files: ['src/journal.ts']});
        implementation = await call('inspect_repository', {from_hash: main.hash, url: repositoryUrl, file: 'src/journal.ts'}) as SourceSlice;
      }
      const evidence = [makeEvidence(main, 'e-main', 'Persist intent before applying the effect.', 'source_statement'),
        makeEvidence(main, 'e-boundary', 'Only a single writer is supported.', 'source_statement'),
        makeEvidence(implementation, 'e-code', 'export function writeIntent() { return persist("intent"); }', 'code_observation'),
        ...(paper ? [makeEvidence(paper, 'e-paper', 'A committed intent survives a worker interruption.', 'source_statement')] : [])];
      const oldEvidence = payload.data.evidence as Evidence[];
      for (const item of evidence) if (!oldEvidence.some(old => old.evidence_id === item.evidence_id)) await call('record_evidence', {evidence: item});
      result = {project_id: project.project_id, questions,
        answers: [{question_id: 'q1', answer: 'writeIntent persists the intent before the effect.', evidence_ids: ['e-main', 'e-code'], source_not_provided: false},
          {question_id: 'q2', answer: paper ? 'The committed intent survives interruption.' : null, evidence_ids: paper ? ['e-paper'] : [], source_not_provided: false},
          {question_id: 'q3', answer: 'A single writer is required.', evidence_ids: ['e-boundary'], source_not_provided: false}],
        evidence, gaps: paper ? [] : [{url: paperUrl, reason: paperErrors.at(-1)!, core: true}],
        source_versions: [{url: sourceUrl, hash: main.hash, main: true, core: true, status: 'read'},
          {url: repositoryUrl, hash: implementation.hash, main: false, core: true, status: 'read'},
          ...(paper ? [{url: paperUrl, hash: paper.hash, main: false, core: true, status: 'read' as const}] : [])],
        mechanism_evidence_ids: ['e-main', 'e-code'], boundary_evidence_ids: ['e-boundary'],
        knowledge_increment: 'Relates a paper claim and fixed code observation to the ordered journal mechanism.'} satisfies ResearchPacket;
    } else if (stage === 'writing') {
      await call('activate_skill', {name: 'obsidian-note'});
      await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'});
      const current = (await journal.load<HostProject>(projectKey))!;
      const primary = current.snapshots.find(snapshot => snapshot.url === sourceUrl)!;
      const image = await call('download_source_image', {snapshot_hash: primary.hash, url: imageUrl, caption: 'Intent before effect', name: 'journal_order'}) as Writing['resources'][number];
      await call('read_image', {path: image.path});
      await call('record_visual_check', {path: image.path, passed: true, issues: []});
      const date = String(payload.data.created);
      const mechanism = 'Persist intent before applying the effect.';
      const paperClaim = 'The paper states: A committed intent survives a worker interruption.';
      const codeClaim = 'Code observation: writeIntent calls persist("intent").';
      const boundary = 'Only a single writer is supported.';
      const markdown = `---\ntitle: Journal protocol\nsource: ${sourceUrl}\ncreated: ${date}\ntags: [agents, engineering, persistence]\n---\n# Journal protocol\n\n> [!abstract] Intent persists before effects.\n\n## Mechanism\n${mechanism}\n${paperClaim}\n${codeClaim}\n![Intent before effect](../${image.path})\n\n[Paper](${paperUrl})\n[Fixed implementation](${repositoryUrl})\n\n## Boundary\n${boundary}\n<div>A single writer applies the effect.</div>\n`;
      result = {note_path: `Organize Notes By AI/${date.slice(2).replaceAll('-', '')}-Journal protocol.md`, markdown,
        claims: [[mechanism, 'e-main', 'source_statement'], [paperClaim, 'e-paper', 'source_statement'], [codeClaim, 'e-code', 'code_observation'],
          [boundary, 'e-boundary', 'source_statement']].map(([text, id, claim_type], index) => ({id: `c${index}`, text, line: markdown.split('\n').indexOf(text!) + 1, evidence_ids: [id], claim_type})),
        figure_plan: [{section: 'Mechanism', type: 'source_image', goal: 'Intent before effect', resource_path: image.path, no_figure_reason: null},
          {section: 'Boundary', type: 'html_card', goal: 'One writer', resource_path: null, no_figure_reason: null}],
        resources: [{...image, visual_check: 'passed', core: true, url: null}], degradations: []};
    } else {
      expect(stage).toBe('review');
      const writing = payload.data.writing as Writing;
      expect(writing.resources[0]!.url).toMatch(/^https:\/\/images\.example\//);
      expect(writing.markdown).toContain(writing.resources[0]!.url!);
      expect(writing.markdown).not.toContain(`../${writing.resources[0]!.path}`);
      for (const resource of writing.resources) await call('read_image', {path: resource.path});
      result = {issues: [], file_hashes: payload.data.file_hashes, resource_manifest_hash: payload.data.resource_manifest_hash};
    }
    yield {message_id: `materials-${queries.length}`, type: 'result', summary: true, success: true, result,
      usage: {input_tokens: 5, output_tokens: 6, cost_usd: null, cost_status: 'unknown'}, observable: {explicit_replay: true}};
  }};
  const images = new Map<string, {content: Uint8Array; mime: string; version_id: null}>();
  let imageWrites = 0;
  const imageStore: ImageStore = {get: async key => images.get(key) ?? null,
    create: async (key, content, mime) => {imageWrites++; images.set(key, {content, mime, version_id: null});},
    url: key => `https://images.example/${key}`,
    accessible: async (url, hash) => [...images].some(([key, image]) => imageStore.url(key) === url && digest(image.content) === hash)};
  const remote = new FakeGitHub();
  const receipts: ResourceReceipt[] = [];
  let sealed: SealedDelivery | null = null;
  const publisher = () => new Publisher(remote, journal, async () => {await gate().require(await subject(), 'publish', 'material_publish');},
    {workspace_id: workspace, committedRevision: async () => journal.handle.revision, now, identity: {name: 'Replay Bot', email: 'replay@example.com'},
      classificationCurrent: async () => (await gate().check(await subject(), 'publish', 'sealed_classification')).execution_permission === 'allowed',
      verifyCommittedDelivery: async delivery => {
        const seal = (await journal.load<ArtifactSeal>('artifact-seals/' + delivery.delivery_id))!;
        await verifySeal(await manager.restoreRevision(workspace, seal.workspace_revision), seal);
        for (const file of delivery.files) expect(seal.files.find(item => item.path === `projects/${delivery.project_id}/draft/${file.path}`)?.sha256).toBe(file.sha256);
      }});
  const storedDelivery = async (id: string): Promise<SealedDelivery> => {
    const stored = (await journal.load<StoredDelivery>('sealed-' + id))!;
    parseStoredDelivery(stored);
    return {...stored, files: stored.files.map(({content_base64, ...file}) => ({...file, content: Buffer.from(content_base64, 'base64')}))};
  };
  const ports = (): ControllerPorts => ({journal, gate: gate(), sources: [], deadline: new RunDeadline(now().getTime()), now,
    readArtifact: path => manager.readFile(journal.handle, path), context: async () => {throw new Error('unexpected new project');},
    environment: async (_project, commitProject) => ({root: skillRoot, model: context.model, gate: gate(), skills, gateway, deadline: new RunDeadline(),
      executor: new StageExecutor(model, gate(), new ApplicationInvocationJournal(journal)), commit: commitProject,
      read_snapshot_body: reference => manager.readFile(journal.handle, reference.path)}),
    prepareResources: async (current, files) => {
      const uploader = new ResourcePublisher(imageStore, journal, {
        reserve: async (key, bytes) => journal.commit('test-capacity/' + digest(key), {bytes, status: 'reserved'}),
        confirm: async (key, receipt) => journal.commit('test-capacity/' + digest(key), {bytes: receipt.bytes, status: 'confirmed'}),
      }, async () => {await gate().require(await subject(), 'upload', 'material_image_upload');}, 'material-test/', now);
      for (const resource of current.writing!.resources) {
        const receipt = await uploader.upload({project_id: current.project_id, first_generated_date: current.note_date!, article_slug: 'journal',
          description: 'intent-order', extension: 'png', mime: resource.mime, content: files[resource.path]!});
        receipts.push(receipt); resource.url = receipt.url;
        current.writing!.markdown = current.writing!.markdown.replace(`../${resource.path}`, receipt.url);
      }
      await journal.commitMany({}, 'final_note_bytes', [{path: `projects/${current.project_id}/draft/${current.writing!.note_path}`,
        bytes: Buffer.from(current.writing!.markdown), role: 'artifact', project_id: current.project_id}]);
      return current;
    },
    verifySources: async current => (await reverifyCore(current.research!, async url => {
      if (url === repositoryUrl) return readRepositoryFile(gateway, {owner: 'test', repository: 'reading-fixture', commit, file: 'src/journal.ts'}, Date.now() + 30_000);
      const response = await gateway.read(url);
      return extractWebSnapshot(response.url, Buffer.from(response.bytes).toString(), now().toISOString());
    }, now(), 'scheduled', true)).sources_verified_at,
    seal: async current => {
      const seal = await sealDelivery(journal.handle, current.project_id, {review_passed: !current.review!.issues.some(issue => issue.severity === 'blocking'),
        program_checks_passed: true, input_revision: journal.handle.revision, resources: JSON.parse(canonicalJson(receipts))});
      const content = Buffer.from(current.writing!.markdown);
      sealed = {schema_version: 1, delivery_id: current.delivery_id!, execution_scope: 'production', workspace_id: workspace,
        project_id: current.project_id, generation_version: current.generation_version, workspace_revision: seal.workspace_revision,
        context_id: context.context_id, base_commit: 'c'.repeat(40), sources_verified_at: current.sources_verified_at!,
        files: [{path: current.writing!.note_path, role: 'note', mime: 'text/markdown', bytes: content.length, sha256: digest(content), content}], resources: receipts,
        sources: current.research!.source_versions.map(version => version.url), quality_report: {passed: true, validated_hash: seal.validated_hash},
        rationale: current.selection!.reason, knowledge_increment: current.research!.knowledge_increment, gaps: [], image_degradations: [],
        usage: {status: 'unknown', estimated_usd: null}, warnings: ['Explicit local replay'], validated_hash: ''};
      sealed.validated_hash = deliveryValidationHash(sealed);
      await journal.commit('artifact-seals/' + current.delivery_id, seal);
    },
    publish: async current => mappedState(current, await publisher().publish(sealed!)),
    reconcile: async current => {
      if (!current.delivery_id) return current;
      const delivery = await storedDelivery(current.delivery_id);
      const records = await publisher().reconcile(delivery);
      return mappedState(current, records.find(record => record.delivery_id === current.delivery_id)!);
    },
  });
  return {root, store, queries, http, paperErrors, remote, get journal() {return journal;}, get manager() {return manager;},
    get imageWrites() {return imageWrites;}, get receipts() {return receipts;},
    current: () => journal.load<HostProject>(projectKey), run: () => new ReadingController(ports()).run(parseDispatch({mode: 'scheduled'}), 'owner'),
    cold: async (day: number) => {clock = Date.now() + day * 86_400_000; await rm(journal.handle.root_dir, {recursive: true, force: true}); await open('material-cold-' + day);},
    cleanup: () => rm(root, {recursive: true, force: true}),
  };
}

it('C001 one actual driver/controller chain binds the main article, full HTML paper and fixed code to checked image, final review and one Fake PR; cold runs reuse all facts', async () => {
  const f = await fixture('complete');
  try {
    const report = await f.run();
    const project = (await f.current())!;
    expect(project.state, project.reason ?? '').toBe('pr_open');
    expect(f.queries).toEqual(['classification', 'selection', 'research', 'writing', 'review']);
    expect(project.research!.gaps).toEqual([]);
    expect(project.material_registrations).toEqual(expect.arrayContaining([{url: paperUrl, from_hash: project.candidate.content_hash, kind: 'paper'},
      {url: repositoryUrl, from_hash: project.candidate.content_hash, kind: 'code'}]));
    expect(project.repository_versions[repositoryUrl]).toEqual({owner: 'test', repository: 'reading-fixture', commit});
    expect(project.research!.evidence).toHaveLength(4);
    expect(project.research!.evidence.find(item => item.evidence_id === 'e-code')).toMatchObject({claim_type: 'code_observation',
      source_url: rawCodeUrl, snapshot_hash: digest(code), locator: {commit, file: 'src/journal.ts', start_line: 1, end_line: 1}});
    expect(project.research!.evidence.find(item => item.evidence_id === 'e-paper')).toMatchObject({source_url: paperUrl,
      excerpt: 'A committed intent survives a worker interruption.'});
    expect(project.writing_activity).toMatchObject({skill_activated: true, playbook_read: true, visual_passed_hashes: [f.receipts[0]!.sha256]});
    expect(project.review_activity!.visual_read_hashes).toEqual([f.receipts[0]!.sha256]);
    expect(project.writing!.markdown).toContain(f.receipts[0]!.url);
    expect(project.review!.file_hashes[project.writing!.note_path]).toBe(digest(project.writing!.markdown));
    expect(f.imageWrites).toBe(1); expect(f.remote.calls.filter(action => action === 'pr')).toHaveLength(1);
    expect(f.remote.pr!.number).toBe(1); expect(f.remote.pr!.delivery_id).toBe(project.delivery_id);
    expect(report.delivery_results).toContainEqual({project_id: project.project_id, state: 'pr_open'});
    const keys = f.journal.keys().filter(key => /^(invocations|responses|resource-|artifact-seals|sealed-|delivery-)/.test(key));
    const facts = keys.map(key => structuredClone(f.journal.handle.records[key]));
    const http = [...f.http], effects = [...f.remote.calls], queries = [...f.queries];
    await f.cold(1);
    const restored = (await f.current())!;
    expect(restored).toEqual(project);
    expect(keys.map(key => f.journal.handle.records[key])).toEqual(facts);
    const registry = new EvidenceRegistry(restored.snapshots, reference => f.manager.readFile(f.journal.handle, reference.path), restored.project_id);
    await registry.validateResearchAsync(restored.research!);
    validateMaterialClosure(restored.research!, restored.material_registrations!, restored.snapshots, restored.read_ranges, restored.material_failures);
    expect(await registry.withSnapshot(restored.snapshots.find(snapshot => snapshot.kind === 'code')!, snapshot => snapshot.text)).toBe(code);
    expect(await registry.withSnapshot(restored.snapshots.find(snapshot => snapshot.url === paperUrl)!, snapshot => snapshot.text)).toContain('A committed intent survives a worker interruption.');
    await f.run();
    expect(f.queries).toEqual(queries); expect(f.http).toEqual(http); expect(f.remote.calls).toEqual(effects); expect(f.imageWrites).toBe(1);
    expect((await f.current())!).toMatchObject({state: 'pr_open', generation_version: 1, delivery_id: project.delivery_id, candidate: {pr_number: 1}});
    expect(f.journal.keys('invocations/')).toHaveLength(5); expect(f.journal.keys('resource-')).toHaveLength(1); expect(f.journal.keys('sealed-')).toHaveLength(1);
  } finally {await f.cleanup();}
}, 60_000);

it.each(['paper_http_failure', 'paper_extraction_failure'] as const)('C024 %s persists the actual tool failure and core gap; cold research remains deferred with no writing, image upload or PR', async scenario => {
  const f = await fixture(scenario);
  try {
    const first = await f.run();
    const project = (await f.current())!;
    const reason = scenario === 'paper_http_failure' ? 'source_http_503' : 'pdf_truncated_or_invalid';
    expect(project).toMatchObject({state: 'deferred', resume_stage: 'research', reason: 'core_material_gap', writing: null, review: null,
      research: {gaps: [{url: paperUrl, reason, core: true}]}, material_failures: {[paperUrl]: {reason, occurred_at: expect.any(String)}}});
    expect(project.snapshots.some(snapshot => snapshot.url === paperUrl)).toBe(false);
    expect(project.research!.source_versions.some(version => version.url === paperUrl && version.status === 'read')).toBe(false);
    expect(project.research!.evidence.some(evidence => evidence.source_url === paperUrl)).toBe(false);
    expect(project.research!.answers.find(answer => answer.question_id === 'q2')).toMatchObject({answer: null, evidence_ids: [], source_not_provided: false});
    expect(first.failures).toContainEqual({subject: project.project_id, reason: 'core_material_gap'});
    expect(f.queries).toEqual(['classification', 'selection', 'research']);
    expect(f.paperErrors).toEqual([reason]); expect(f.imageWrites).toBe(0); expect(f.remote.calls).toEqual([]);
    const packetPath = `projects/${project.project_id}/research/packet.json`;
    const packet = await f.manager.readFile(f.journal.handle, packetPath);
    expect(JSON.parse(Buffer.from(packet).toString())).toEqual(project.research);
    await f.cold(1);
    expect((await f.current())!).toEqual(project);
    expect(await f.manager.readFile(f.journal.handle, packetPath)).toEqual(packet);
    const resumed = await f.run();
    expect(await f.current()).toMatchObject({state: 'deferred', reason: 'core_material_gap', generation_version: 1, writing: null, review: null,
      research: {gaps: [{url: paperUrl, reason, core: true}]}, material_failures: {[paperUrl]: {reason}}});
    expect(resumed.failures).toContainEqual({subject: project.project_id, reason: 'core_material_gap'});
    expect(f.queries).toEqual(['classification', 'selection', 'research', 'research']);
    expect(f.paperErrors).toEqual([reason, reason]);
    expect(f.imageWrites).toBe(0); expect(f.remote.calls).toEqual([]);
    expect(f.http.filter(url => url === imageUrl)).toEqual([]);
    expect(f.journal.keys('sealed-')).toEqual([]); expect(f.journal.keys('resource-')).toEqual([]);
    expect(f.journal.keys('artifact-seals/')).toEqual([]);
  } finally {await f.cleanup();}
}, 60_000);


it('a cold restored fixed repository commit without its tree resumes listing before reading code, preserving the fixed commit', async () => {
  const f = await fixture('pinned_tree_missing');
  try {
    await f.cold(0);
    expect((await f.current())!.repository_versions[repositoryUrl]).toEqual({owner: 'test', repository: 'reading-fixture', commit});
    expect((await f.current())!.repository_files[repositoryUrl]).toBeUndefined();
    await f.run();
    const project = (await f.current())!;
    expect(project.state, project.reason ?? '').toBe('pr_open');
    expect(project.repository_versions[repositoryUrl]).toEqual({owner: 'test', repository: 'reading-fixture', commit});
    expect(project.repository_files[repositoryUrl]).toEqual(['src/journal.ts']);
    expect(f.http.filter(url => url === treeUrl)).toHaveLength(1);
    expect(f.http.indexOf(treeUrl)).toBeLessThan(f.http.indexOf(rawCodeUrl));
    expect(f.http.some(url => url.includes('/commits/'))).toBe(false);
    expect(f.remote.calls.filter(action => action === 'pr')).toHaveLength(1);
    const http = [...f.http], queries = [...f.queries], counters = structuredClone(project.counters);
    await f.cold(1); await f.run();
    expect(f.http).toEqual(http); expect(f.queries).toEqual(queries);
    expect((await f.current())!.counters).toEqual(counters);
  } finally {await f.cleanup();}
});
