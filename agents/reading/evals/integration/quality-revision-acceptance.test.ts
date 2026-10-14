import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {expect, it, vi} from 'vitest';
import {FileObjectStore} from '../../src/storage/filesystem.js';
import {ImmutableWorkspaceManager} from '../../src/workspace/manager.js';
import {WorkspaceJournal, ApplicationInvocationJournal} from '../../src/app/journal.js';
import {validateHostRecords} from '../../src/app/records.js';
import {ReadingController, type ControllerPorts, type HostProject} from '../../src/app/controller.js';
import {buildContext} from '../../src/context/index.js';
import {addCandidate, discoverCandidate, emptyIdentity} from '../../src/collect/identity.js';
import {canonicalJson, type InvocationRecord} from '../../src/contracts/index.js';
import {digest, type Evidence, type ResearchPacket} from '../../src/stages/contracts.js';
import {newRuntimeProject} from '../../src/stages/driver.js';
import {StageExecutor} from '../../src/stages/executor.js';
import {type Writing} from '../../src/stages/validation.js';
import {PolicyGate} from '../../src/policy/gate.js';
import {RunDeadline} from '../../src/runtime/deadline.js';
import {type ModelAdapter} from '../../src/runtime/sdk.js';
import {UrlGateway} from '../../src/tools/fetch.js';
import {type MaterialSnapshot} from '../../src/tools/evidence.js';
import {type SkillBundle} from '../../src/tools/skills.js';
import {Publisher} from '../../src/publish/publisher.js';
import {ResourcePublisher, type ImageStore} from '../../src/publish/resources.js';
import {type ResourceReceipt, type SealedDelivery} from '../../src/publish/types.js';
import {deliveryValidationHash} from '../../src/publish/validate.js';
import {sealDelivery, verifySeal, type ArtifactSeal} from '../../src/workspace/seal.js';
import {parseDispatch} from '../../src/config/dispatch.js';
import {FakeGitHub} from '../delivery/helpers.js';
import {policyFixture} from '../runtime/policy-fixtures.js';

type Scenario = 'blocking_fact' | 'inline_fallback' | 'noncore_skipped' | 'core_skipped';
const at = '2026-10-13T00:00:00Z';
const sourceUrl = 'https://independent.dev/journal';
const imageUrl = 'https://independent.dev/journal-boundary.png';
const degradation = 'Fireworks renderer unavailable; Mermaid preserves the mechanism. The optional source image was not visually certified.';

/** Local model and remote-service replay; actual controller, driver, tools, journal and immutable restore. */
async function fixture(scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), 'reading-quality-acceptance-'));
  const workspace = 'obs-notes-hub/reading-integration';
  const store = new FileObjectStore(join(root, 'objects'));
  let manager!: ImmutableWorkspaceManager;
  let journal!: WorkspaceJournal;
  let clock = new Date().toISOString();
  const now = () => new Date(Math.max(Date.parse(clock), Date.now()));
  const open = async (run: string, initialize = false) => {
    manager = new ImmutableWorkspaceManager({store, scope: 'production', trusted_workspace_id: workspace,
      verify_preflight: false, local_root: join(root, run), record_validator: validateHostRecords});
    journal = new WorkspaceJournal(manager, await manager.restore(workspace, {allow_initialize: initialize, run_id: run}), run);
  };
  await open('quality-first', true);
  const templates = Object.fromEntries(await Promise.all(['selection', 'research', 'writing', 'review'].map(async stage =>
    [stage, await readFile(`agents/reading/prompts/${stage}.md`, 'utf8')])));
  const skillTexts = {
    '.agents/skills/obsidian-note/SKILL.md': 'Use mechanism evidence. If Fireworks cannot render, use Mermaid with explicit disclosure. Missing core explanation blocks delivery.',
    '.agents/skills/obsidian-note/references/diagram-playbook.md': 'A simple ordered mechanism may use Mermaid. Optional images without certification require disclosure; core images require a passing check.',
    '.agents/skills/fireworks-tech-graph/SKILL.md': 'Only the trusted diagram wrapper may execute this fixed skill.',
    '.agents/skills/fireworks-tech-graph/scripts/fireworks.py': 'raise SystemExit(42)\n',
  };
  const skillHashes = Object.fromEntries(Object.entries(skillTexts).map(([path, text]) => [path, digest(text)]));
  const skillHash = digest(canonicalJson(skillHashes));
  const skillRoot = join(root, 'trusted-skills');
  for (const [path, text] of Object.entries(skillTexts)) {
    await mkdir(dirname(join(skillRoot, path)), {recursive: true});
    await writeFile(join(skillRoot, path), text);
  }
  const skills: SkillBundle = {root: skillRoot, commit: 'b'.repeat(40), hash: skillHash, files: skillHashes, adapted: true};
  const context = buildContext({index: [], query: 'journal', heldout: {urls: new Set(), note_paths: new Set()},
    preferences_hash: digest('quality fixture'), skill_commit: skills.commit, skill_hash: skills.hash,
    prompt_hash: digest(Buffer.concat(['selection', 'research', 'writing', 'review'].map(stage => Buffer.from(templates[stage]!)))), prompt_templates: templates, model: 'explicit-replay', evidence_versions: []});
  const sourceText = '# Journal\nIntent is written before the operation.\nOnly a single writer is supported.';
  const snapshot: MaterialSnapshot = {url: sourceUrl, text: sourceText, hash: digest(sourceText), retrieved_at: at,
    links: [], kind: 'web', figures: [{url: imageUrl, caption: 'Optional boundary illustration'}]};
  const candidate = discoverCandidate('manual_url', sourceUrl, 'Journal mechanism', null, at);
  candidate.project_id = 'quality_project';
  candidate.content_hash = snapshot.hash;
  const identity = emptyIdentity();
  addCandidate(identity, candidate);
  const policy = policyFixture();
  policy.allowed_domains.push('independent.dev');
  let project: HostProject = {...newRuntimeProject(candidate, {project_id: candidate.project_id, execution_scope: 'production',
    workspace_id: workspace, context, now: new Date(at)}), generation_version: 1, resume_stage: null, resume_policy: 'automatic',
    reason: null, last_run_id: null, batch_id: 'quality_batch', delivery_id: null, sources_verified_at: null, snapshots: [snapshot],
    read_ranges: {[snapshot.hash]: [{page: null, start_line: 1, end_line: 3, start_char: null, end_char: null}]}};
  const projectKey = 'projects/' + project.project_id;
  await journal.commitMany({identity, [projectKey]: project, ['contexts/' + context.context_id]: context}, 'collection_committed');
  project.classification = {candidate_id: candidate.candidate_id, source_snapshot_hash: snapshot.hash,
    semantic_policy_hash: policy.semantic_policy_hash, attempts: 1, format_repairs: 0, pending: false,
    credential: {candidate_id: candidate.candidate_id, source_snapshot_hash: snapshot.hash,
      semantic_policy_hash: policy.semantic_policy_hash, content_eligibility: 'allowed', evidence_hash: digest('classification fixture')}};
  project.selection = {decision: 'research', reason_codes: [], reason: 'The ordered effect mechanism adds knowledge.',
    dimension_ratings: {relevance: 'strong', mechanism: 'strong', evidence: 'strong', transferability: 'strong', increment: 'strong'},
    questions: ['Mechanism?', 'Boundary?', 'Independent validation?'], related_note_ids: [], evidence_ids: []};
  project.state = 'selected';
  await journal.commitMany({[projectKey]: project}, 'selection_result');
  const evidence: Evidence[] = [
    {evidence_id: 'e1', source_url: sourceUrl, retrieved_at: at, snapshot_hash: snapshot.hash,
      locator: {start_line: 2, end_line: 2}, excerpt: 'Intent is written before the operation.', claim: 'Intent precedes effects.',
      claim_type: 'source_statement', limits: [], based_on: []},
    {evidence_id: 'e2', source_url: sourceUrl, retrieved_at: at, snapshot_hash: snapshot.hash,
      locator: {start_line: 3, end_line: 3}, excerpt: 'Only a single writer is supported.', claim: 'One writer is supported.',
      claim_type: 'source_statement', limits: [], based_on: []},
  ];
  const research: ResearchPacket = {project_id: project.project_id,
    questions: [{id: 'q1', text: 'Mechanism?', priority: 'required'}, {id: 'q2', text: 'Boundary?', priority: 'required'},
      {id: 'q3', text: 'Independent validation?', priority: 'required'}],
    answers: [{question_id: 'q1', answer: 'Persist before effects.', evidence_ids: ['e1'], source_not_provided: false},
      {question_id: 'q2', answer: 'One writer.', evidence_ids: ['e2'], source_not_provided: false},
      {question_id: 'q3', answer: null, evidence_ids: [], source_not_provided: true}],
    evidence, gaps: [], source_versions: [{url: sourceUrl, hash: snapshot.hash, main: true, core: true, status: 'read'}],
    mechanism_evidence_ids: ['e1'], boundary_evidence_ids: ['e2'], knowledge_increment: 'Relates ordering to a single-writer boundary.'};
  project.research = research;
  project.partial_evidence = evidence;
  project.partial_questions = research.questions;
  project.state = 'researched';
  await journal.commitMany({[projectKey]: project}, 'research_complete');
  const png = await readFile('agents/reading/evals/runtime/evidence/linux-tools.png');
  const queries: {stage: string; revisions: number}[] = [];
  const rendererErrors: string[] = [];
  const downloads: string[] = [];
  const revisionInputs: unknown[][] = [];
  let reviewNumber = 0;
  const model: ModelAdapter = {async *stream(request) {
    const payload = JSON.parse(request.prompt) as {task: string; data: Record<string, unknown>};
    const persisted = (await journal.load<HostProject>(projectKey))!;
    expect(journal.keys('invocations/').some(key => (journal.handle.records[key] as unknown as InvocationRecord).status === 'prepared')).toBe(true);
    queries.push({stage: payload.task, revisions: persisted.counters.revisions});
    const call = async (name: string, args: Record<string, unknown>) => request.tools.find(tool => tool.name === name)!.run(args);
    let result: unknown;
    if (payload.task === 'writing') {
      revisionInputs.push(payload.data.review_issues as unknown[]);
      await call('activate_skill', {name: 'obsidian-note'});
      await call('read_skill_resource', {name: 'obsidian-note', path: 'references/diagram-playbook.md'});
      if (scenario !== 'blocking_fact') {
        try {await call('render_diagram', {mode: 'flow', name: 'journal_order', diagram: {nodes: []}});}
        catch (error) {
          const message = error instanceof Error ? error.message : '';
          expect(message).toBe('tool_sandbox_unconfigured');
          rendererErrors.push(message);
        }
        expect(rendererErrors.length).toBeGreaterThan(0);
      }
      const resources: Writing['resources'] = [];
      if (scenario === 'noncore_skipped' || scenario === 'core_skipped') {
        const downloaded = await call('download_source_image', {snapshot_hash: snapshot.hash, url: imageUrl,
          caption: snapshot.figures![0]!.caption, name: 'boundary_illustration'}) as Omit<Writing['resources'][number], 'core' | 'url' | 'visual_check'>;
        resources.push({...downloaded, core: scenario === 'core_skipped', visual_check: 'skipped', url: null});
      }
      const date = String(payload.data.created);
      const mechanism = 'Intent is written before the operation.';
      const boundary = scenario === 'blocking_fact' ? `All writers may safely update concurrently (revision ${persisted.counters.revisions}).` : 'Only a single writer is supported.';
      const markdown = `---\ntitle: Journal mechanism\nsource: ${sourceUrl}\ncreated: ${date}\ntags: [agents, engineering, recovery]\n---\n# Journal mechanism\n\n> [!abstract] Persist intent before effects.\n\n## Mechanism\n${mechanism}\n\n\`\`\`mermaid\nflowchart LR\n  Intent --> Effect\n\`\`\`\n\n## Boundary\n${boundary}\n<div>One writer controls persistent side effects.</div>\n${resources.length ? `![Optional boundary](../${resources[0]!.path})\n` : ''}${scenario !== 'blocking_fact' ? `\nDiagram degradation: ${degradation}\n` : ''}`;
      result = {note_path: `Organize Notes By AI/${date.slice(2).replaceAll('-', '')}-Journal mechanism.md`, markdown,
        claims: [{id: 'c1', text: mechanism, line: markdown.split('\n').indexOf(mechanism) + 1, evidence_ids: ['e1'], claim_type: 'source_statement'},
          {id: 'c2', text: boundary, line: markdown.split('\n').indexOf(boundary) + 1, evidence_ids: ['e2'], claim_type: 'source_statement'}],
        figure_plan: [{section: 'Mechanism', type: 'mermaid', goal: 'Intent then effect', resource_path: null, no_figure_reason: null},
          {section: 'Boundary', type: 'html_card', goal: 'The single writer restriction', resource_path: resources[0]?.path ?? null, no_figure_reason: null}],
        resources, degradations: scenario === 'blocking_fact' ? [] : [degradation]};
    } else {
      expect(payload.task).toBe('review');
      const writing = payload.data.writing as Writing;
      for (const resource of writing.resources) await call('read_image', {path: resource.path});
      reviewNumber++;
      result = {issues: scenario === 'blocking_fact' ? [{severity: 'blocking', file: writing.note_path, location: 'Boundary claim c2',
        evidence_ids: ['e2'], problem: `Revision ${persisted.counters.revisions} contradicts the single-writer source.`,
        correction: 'State that only one writer is supported; do not claim concurrent writers.'}] : [],
        file_hashes: payload.data.file_hashes, resource_manifest_hash: payload.data.resource_manifest_hash};
    }
    yield {message_id: `quality-${queries.length}`, type: 'result', summary: true, usage: {input_tokens: 3, output_tokens: 4,
      cost_usd: null, cost_status: 'unknown'}, success: true, result, observable: {explicit_replay: true}};
  }};
  const imageObjects = new Map<string, {content: Uint8Array; mime: string; version_id: null}>();
  let imageWrites = 0;
  const imageStore: ImageStore = {
    get: async key => imageObjects.get(key) ?? null,
    create: async (key, content, mime) => {imageWrites++; imageObjects.set(key, {content, mime, version_id: null});},
    url: key => `https://images.example/${key}`,
    accessible: async (url, hash) => [...imageObjects].some(([key, object]) => url === imageStore.url(key) && digest(object.content) === hash),
  };
  const remote = new FakeGitHub();
  const prBodies: string[] = [];
  const createPR = remote.createPR.bind(remote);
  remote.createPR = async (branch, title, body) => {prBodies.push(body); return createPR(branch, title, body);};
  const gate = () => new PolicyGate(async () => policy, check => journal.commit('policy-checks/' + check.check_id, check), now);
  const receipts = new Map<string, ResourceReceipt[]>();
  const seals = new Map<string, ArtifactSeal>();
  const deliveries = new Map<string, SealedDelivery>();
  const makePublisher = () => new Publisher(remote, journal, async () => {}, {
    workspace_id: workspace, committedRevision: async () => journal.handle.revision, classificationCurrent: async () => true,
    identity: {name: 'Replay Bot', email: 'replay@example.com'}, now,
    verifyCommittedDelivery: async delivery => {
      const seal = (await journal.load<ArtifactSeal>('artifact-seals/' + delivery.delivery_id))!;
      await verifySeal(await manager.restoreRevision(workspace, seal.workspace_revision), seal);
      expect(delivery.quality_report.passed).toBe(true);
      for (const file of delivery.files) expect(seal.files.find(item => item.path === `projects/${delivery.project_id}/draft/${file.path}`)?.sha256).toBe(file.sha256);
    },
  });
  const ports = (): ControllerPorts => ({journal, gate: gate(), sources: [], deadline: new RunDeadline(now().getTime()), now,
    readArtifact: path => manager.readFile(journal.handle, path),
    context: async () => {throw new Error('unexpected new project context');},
    environment: async (_project, commit) => ({root: skillRoot, skills, model: context.model, gate: gate(),
      read_snapshot_body: reference => manager.readFile(journal.handle, reference.path),
      executor: new StageExecutor(model, gate(), new ApplicationInvocationJournal(journal)), commit, deadline: new RunDeadline(),
      gateway: new UrlGateway(async () => {}, async () => [{address: '8.8.8.8', family: 4}], async url => {
        downloads.push(url.href);
        expect(url.href).toBe(imageUrl);
        return {status: 200, headers: {'content-type': 'image/png'}, body: png};
      })}),
    prepareResources: async (current, files) => {
      const resources: ResourceReceipt[] = [];
      const uploader = new ResourcePublisher(imageStore, journal, {
        reserve: async (key, bytes) => journal.commit('test-capacity/' + digest(key), {bytes, status: 'reserved'}),
        confirm: async (key, receipt) => journal.commit('test-capacity/' + digest(key), {bytes: receipt.bytes, status: 'confirmed'}),
      }, async () => {}, 'test-images/', now);
      for (const resource of current.writing!.resources) {
        const receipt = await uploader.upload({project_id: current.project_id, first_generated_date: current.note_date!,
          article_slug: 'journal', description: 'boundary', extension: 'png', mime: resource.mime, content: files[resource.path]!});
        resources.push(receipt);
        current.writing!.markdown = current.writing!.markdown.replace(`../${resource.path}`, receipt.url);
        resource.url = receipt.url;
      }
      receipts.set(current.project_id, resources);
      await journal.commitMany({}, 'final_note_bytes', [{path: `projects/${current.project_id}/draft/${current.writing!.note_path}`,
        bytes: Buffer.from(current.writing!.markdown), role: 'artifact', project_id: current.project_id}]);
      return current;
    },
    verifySources: async () => clock,
    seal: async current => {
      const seal = await sealDelivery(journal.handle, current.project_id, {review_passed: !current.review!.issues.some(issue => issue.severity === 'blocking'),
        program_checks_passed: true, input_revision: journal.handle.revision, resources: JSON.parse(canonicalJson(receipts.get(current.project_id) ?? []))});
      seals.set(current.project_id, seal);
      const content = Buffer.from(current.writing!.markdown);
      const delivery: SealedDelivery = {schema_version: 1, delivery_id: current.delivery_id!, execution_scope: 'production', workspace_id: workspace,
        project_id: current.project_id, generation_version: current.generation_version, workspace_revision: seal.workspace_revision,
        context_id: current.context.context_id, base_commit: 'c'.repeat(40), sources_verified_at: clock,
        files: [{path: current.writing!.note_path, role: 'note', mime: 'text/markdown', bytes: content.length, sha256: digest(content), content}],
        resources: receipts.get(current.project_id) ?? [], sources: [sourceUrl], quality_report: {passed: true, validated_hash: seal.validated_hash},
        rationale: current.selection!.reason, knowledge_increment: current.research!.knowledge_increment, gaps: [],
        image_degradations: current.writing!.degradations, usage: {status: 'unknown', estimated_usd: null}, warnings: ['Local replay only'], validated_hash: ''};
      delivery.validated_hash = deliveryValidationHash(delivery);
      deliveries.set(current.project_id, delivery);
      await journal.commit('artifact-seals/' + current.delivery_id, seal);
    },
    publish: async current => {const record = await makePublisher().publish(deliveries.get(current.project_id)!);
      return {...current, state: 'pr_open', candidate: {...current.candidate, pr_number: record.pr!.number}};},
    reconcile: async current => current,
  });
  return {root, store, remote, queries, rendererErrors, downloads, revisionInputs, prBodies, seals,
    get journal() {return journal;}, get imageWrites() {return imageWrites;}, get reviewNumber() {return reviewNumber;},
    current: () => journal.load<HostProject>(projectKey),
    run: () => new ReadingController(ports()).run(parseDispatch({mode: 'scheduled'}), 'owner'),
    cold: async (date: string, run: string) => {clock = date; await rm(journal.handle.root_dir, {recursive: true, force: true}); await open(run);},
    cleanup: () => rm(root, {recursive: true, force: true}),
  };
}

it('C084 real driver persists three blocking factual reviews and exactly two revisions; scheduled cold runs never query, upload or publish again', async () => {
  const f = await fixture('blocking_fact');
  try {
    const report = await f.run();
    expect(f.queries).toEqual([{stage: 'writing', revisions: 0}, {stage: 'review', revisions: 0},
      {stage: 'writing', revisions: 1}, {stage: 'review', revisions: 1}, {stage: 'writing', revisions: 2}, {stage: 'review', revisions: 2}]);
    expect(f.revisionInputs.map(issues => issues.length)).toEqual([0, 1, 1]);
    expect(f.reviewNumber).toBe(3);
    const blocked = (await f.current())!;
    expect(blocked).toMatchObject({state: 'deferred', resume_policy: 'manual', reason: 'quality_blocked', generation_version: 1,
      resume_stage: 'review', counters: {revisions: 2}, pending_query: null, review: {issues: [{severity: 'blocking', evidence_ids: ['e2']}]}});
    expect(blocked.writing!.markdown).toContain('revision 2');
    const draftPath = `projects/${blocked.project_id}/draft/${blocked.writing!.note_path}`;
    const draft = await readFile(join(f.journal.handle.root_dir, draftPath));
    expect(draft.toString()).toBe(blocked.writing!.markdown);
    expect(report.blocked_projects).toContainEqual(expect.objectContaining({project_id: blocked.project_id, reason: 'quality_blocked'}));
    expect(f.imageWrites).toBe(0); expect(f.remote.calls).toEqual([]); expect(f.seals.size).toBe(0);
    const invocations = f.journal.keys('invocations/');
    const facts = invocations.map(key => structuredClone(f.journal.handle.records[key]));
    expect(invocations).toHaveLength(6);
    const responses = f.journal.keys('responses/');
    const responseFacts = responses.map(key => structuredClone(f.journal.handle.records[key]));
    const blockingReviews: {issues?: {problem: string; severity: string; evidence_ids: string[]; location: string; correction: string}[]}[] = [];
    for (const key of responses) {
      const response = (await f.journal.load<(typeof blockingReviews)[number]>(key))!;
      if (response.issues) blockingReviews.push(response);
    }
    expect(blockingReviews).toHaveLength(3);
    expect(blockingReviews.map(review => review.issues![0]!.problem).sort()).toEqual([0, 1, 2].map(revision =>
      `Revision ${revision} contradicts the single-writer source.`));
    for (const review of blockingReviews) expect(review.issues![0]).toMatchObject({severity: 'blocking', evidence_ids: ['e2'],
      location: 'Boundary claim c2', correction: 'State that only one writer is supported; do not claim concurrent writers.'});
    const logicalDays = new Set([report.logical_key]);
    for (const day of [1, 2]) {
      await f.cold(new Date(Date.parse(report.started_at) + day * 86_400_000).toISOString(), `quality-day-${day + 1}`);
      expect(await readFile(join(f.journal.handle.root_dir, draftPath))).toEqual(draft);
      const resumed = await f.run();
      expect(logicalDays.has(resumed.logical_key)).toBe(false);
      logicalDays.add(resumed.logical_key);
      expect((await f.current())!).toMatchObject({state: 'deferred', reason: 'quality_blocked', resume_policy: 'manual',
        generation_version: 1, context: blocked.context, counters: blocked.counters, writing: blocked.writing, review: blocked.review});
      expect(f.queries).toHaveLength(6); expect(f.imageWrites).toBe(0); expect(f.remote.calls).toEqual([]);
      expect(f.journal.keys('invocations/')).toEqual(invocations);
      expect(invocations.map(key => f.journal.handle.records[key])).toEqual(facts);
      expect(responses.map(key => f.journal.handle.records[key])).toEqual(responseFacts);
      expect(resumed.blocked_projects).toContainEqual(expect.objectContaining({reason: 'quality_blocked'}));
    }
  } finally {await f.cleanup();}
}, 60_000);

it.each(['inline_fallback', 'noncore_skipped'] as const)('C083 %s follows actual renderer availability failure, persists disclosed fallback and creates one reviewed Fake PR', async scenario => {
  vi.stubEnv('READING_TOOLS_IMAGE', '');
  const f = await fixture(scenario);
  try {
    const report = await f.run();
    const current = (await f.current())!;
    expect(current.state, current.reason ?? '').toBe('pr_open');
    expect(f.rendererErrors).toEqual(['tool_sandbox_unconfigured']);
    expect(current.writing!.markdown).toContain('```mermaid');
    expect(current.writing!.markdown).toContain('<div>One writer');
    expect(current.writing!.markdown).toContain(degradation);
    expect(current.writing!.degradations).toEqual([degradation]);
    const disclosure = [{project_id: current.project_id, generation_version: current.generation_version,
      context_id: current.context.context_id, details: [degradation]}];
    expect(report.image_degradations).toEqual(disclosure);
    expect(await f.journal.load('runs/' + report.run_id)).toEqual(report);
    expect(f.prBodies).toHaveLength(1); expect(f.prBodies[0]).toContain(degradation);
    expect(f.remote.calls.filter(call => call === 'pr')).toHaveLength(1);
    expect(f.queries.map(query => query.stage)).toEqual(['writing', 'review']);
    if (scenario === 'noncore_skipped') {
      expect(current.writing!.resources[0]).toMatchObject({visual_check: 'skipped', core: false, url: expect.stringMatching(/^https:\/\/images\.example\//)});
      expect(current.review_activity!.visual_read_hashes).toEqual([current.writing!.resources[0]!.hash]);
      expect(f.downloads).toEqual([imageUrl]); expect(f.imageWrites).toBe(1);
      expect(f.journal.keys('resource-')).toHaveLength(1);
    } else {expect(f.downloads).toEqual([]); expect(f.imageWrites).toBe(0);}
    const effects = [...f.remote.calls]; const queries = [...f.queries]; const imageWrites = f.imageWrites;
    await f.cold(new Date(Date.now() + 86_400_000).toISOString(), 'quality-fallback-cold');
    expect((await f.current())!.writing).toEqual(current.writing);
    expect(await f.journal.load('runs/' + report.run_id)).toEqual(report);
    const resumed = await f.run();
    expect(resumed.image_degradations).toEqual(disclosure);
    expect(await f.journal.load('runs/' + resumed.run_id)).toEqual(resumed);
    expect(f.remote.calls).toEqual(effects); expect(f.queries).toEqual(queries); expect(f.imageWrites).toBe(imageWrites);
  } finally {vi.unstubAllEnvs(); await f.cleanup();}
}, 60_000);

it('C083 a core skipped visual check preserves the exact manual block across cold days without replacement queries, upload, review, seal or Fake PR', async () => {
  vi.stubEnv('READING_TOOLS_IMAGE', '');
  const f = await fixture('core_skipped');
  try {
    const first = await f.run();
    const blocked = (await f.current())!;
    expect(blocked).toMatchObject({state: 'deferred', resume_policy: 'manual', reason: 'visual_check_required_or_disclosed', generation_version: 1,
      writing: {resources: [{visual_check: 'skipped', core: true}]}});
    const disclosure = [{project_id: blocked.project_id, generation_version: blocked.generation_version,
      context_id: blocked.context.context_id, details: [degradation]}];
    expect(first.image_degradations).toEqual(disclosure);
    expect(await f.journal.load('runs/' + first.run_id)).toEqual(first);
    expect(f.queries.map(query => query.stage)).toEqual(['writing']);
    expect(f.imageWrites).toBe(0); expect(f.remote.calls).toEqual([]); expect(f.seals.size).toBe(0);
    const invocationKeys = f.journal.keys('invocations/');
    const facts = invocationKeys.map(key => structuredClone(f.journal.handle.records[key]));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({status: 'succeeded', capability: 'write'});
    const logicalDays = new Set([first.logical_key]);
    for (const day of [1, 2]) {
      await f.cold(new Date(Date.parse(first.started_at) + day * 86_400_000).toISOString(), `quality-core-day-${day + 1}`);
      const resumed = await f.run();
      expect(resumed.image_degradations).toEqual(disclosure);
      expect(await f.journal.load('runs/' + resumed.run_id)).toEqual(resumed);
      expect(await f.journal.load('runs/' + first.run_id)).toEqual(first);
      expect(logicalDays.has(resumed.logical_key)).toBe(false);
      logicalDays.add(resumed.logical_key);
      expect(await f.current()).toMatchObject({state: 'deferred', generation_version: 1, resume_policy: 'manual',
        reason: 'visual_check_required_or_disclosed', context: blocked.context, counters: blocked.counters,
        writing: blocked.writing, writing_activity: blocked.writing_activity, filename: blocked.filename, note_date: blocked.note_date});
      expect(resumed.blocked_projects).toContainEqual(expect.objectContaining({reason: 'visual_check_required_or_disclosed'}));
      expect(f.journal.keys('invocations/')).toEqual(invocationKeys);
      expect(invocationKeys.map(key => f.journal.handle.records[key])).toEqual(facts);
      expect(f.queries.map(query => query.stage)).toEqual(['writing']);
      expect(f.imageWrites).toBe(0); expect(f.remote.calls).toEqual([]); expect(f.seals.size).toBe(0);
      expect(f.journal.keys('resource-')).toEqual([]); expect(f.reviewNumber).toBe(0);
    }
  } finally {vi.unstubAllEnvs(); await f.cleanup();}
}, 60_000);
