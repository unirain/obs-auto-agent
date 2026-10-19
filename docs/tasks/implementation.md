# Reading Agent implementation tasks

Updated: 2026-10-15. Objective: implement and verify all five plans without narrowing live validation requirements.

Statuses: pending, in_progress, implemented, local_verified, live_unverified, blocked_external, complete. A work package is complete only when its required evidence exists. Gate evidence is tracked separately.

| Package | Owner | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| S1 | storage/root | local_verified | TypeScript foundation and shared contracts |
| S2 | storage | local_verified | Fault-injectable persistent object store |
| S3 | storage | live_unverified | OSS adapter and live contract tests |
| S4 | storage | local_verified | Immutable commits, initialization and recovery |
| S5 | storage | local_verified | Scope/file views/sealing |
| S6 | storage | local_verified | Invocation journal and counters |
| S7 | storage | live_unverified | Global capacity, reservations and GC |
| S8 | storage/root | local_verified | Audited inspect/recover, fixed-input unknown replacement, receipt import, changed-input generation and atomic feedback management; live remote management remains unverified |
| A1 | runtime/root | local_verified | Domain schemas, modes and stage routing |
| A2 | runtime | local_verified | Latest policy and restricted classification |
| A3 | runtime | live_unverified | Manual URL and source collection |
| A4 | runtime | local_verified | Context, examples, index and fair scheduling |
| A5 | runtime | live_unverified | SDK execution and usage lifecycle |
| A6 | runtime/root | live_unverified | Bounded reading, material closure, retrieved-note versions, semantic progress and Docker JS fallback locally verified; actual model/research evidence pending |
| A7 | runtime/root | in_progress | Versioned cloud contract and independent image review locally verified; known writing/render/review continuation locally verified; original proposal 38589eb has Linux fixture evidence; updated draft PR #35 head f1053b4 awaits default-branch review/merge and live SDK/article quality |
| A8 | runtime/root | live_unverified | Actual driver replay, independent manual barriers and source/policy recovery locally verified; five varied real previews pending |
| A9 | runtime/root | live_unverified | Frozen host execute/merge/report implemented; whole-query known/unknown charges, split/scope aggregation and immutable cumulative snapshot reconciliation locally verified; 26 private primary bodies prepared; 4 unsupported video sources, all 30 human labels and live calibration still missing |
| O1 | operations | live_unverified | Trusted deployments and permissions |
| O2 | operations | live_unverified | Immutable resource upload |
| O3 | operations | live_unverified | Publisher and reconciliation |
| O4 | operations/root | live_unverified | Expiry, source-generation routing, reclassification-before-upload and exact primary-source dedup locally verified; real withdrawal/recovery pending |
| O5 | operations/root | live_unverified | Four-mode wiring, shared mutex guard, daily logical runs, SIGINT/SIGTERM SDK stop and trusted G1 evidence locally verified; actual reading Actions/concurrency/cancellation pending |
| O6 | operations | live_unverified | Watchdog, incident events and Issue dedup |
| O7 | operations/root | blocked_external | Isolated live delivery fault tests |
| O8 | operations/root | implemented | Deployment, pause and recovery runbooks |

| Gate | Status | Required evidence |
| --- | --- | --- |
| G0 | complete | Exact core DTO/UTC boundaries, shared states, 40 schema definitions and complete cross-module cold-recovery fixture locally verified; audit in docs/notes/g0-contract-audit.md |
| G1 | blocked_external | Workspace/watchdog and real image upload/public-read/declared capacity passed; GC Delete is403 AccountLevelIdentityBasedPolicy ExplicitDeny. Fixed canary retained for permission repair |
| G2 | pending | Live SDK isolation, five varied previews and recovery |
| G3 | pending | Isolated GitHub/image delivery and fault reconciliation |
| G4 | pending | Real sources, monitoring, capacity and human quality calibration |
| G5 | pending | Production permissions, manual smoke, defaults confirmed and first cron |

## Current verification

- Actual Node v24.19.0: all558 tests/102 files passed locally with sequential files;16 new payload/cold-recovery assertions and86 existing direct regressions passed. Typecheck/build, all40 exported schema documents, spec mapping and diff check passed. Native stream events and browser processes in the new tests are mocked; no live service inference.
- Current local case audit: 87 covered / 0 partial / 0 missing, with named assertions. All 87 full-layer cases remain pending / 0 complete; local coverage is not native service or human acceptance.
- Implementationa4d19da2eb9b7d06397bf86df1b17b69fae9e9cb is pushed; exact [LinuxNode24.10 four-worker CI38694162330](https://github.com/unirain/obs-auto-agent/actions/runs/38694162330) passed npm ci/typecheck/test/build/spec mapping,558tests/102files. Current337-file fingerprint matches scoped evidence: agents/reading/evals/results/local-verification.json.
- Production generation cron remains disabled. G0 permits local contracts/replays only; G1 awaits external RAM setup; G2–G5 stay pending.

## External resources and remaining acceptance

| Item | Current evidence | Still required |
| --- | --- | --- |
| Implementation repository | unirain/obs-auto-agent, default master, Apache License preserved | Separate isolated delivery test repository/App |
| Private OSS | Existing obs-agent, Beijing; native private/never-versioned/no-overwrite/pagination/chain probe passed | Native TLS transport loss now passed (2026-10-15); restricted RAM allow/deny still required. Broad test AK is not IAM proof |
| Restricted credentials | All6 users supplied; workspace/watchdog/image upload/public-read/declared capacity verified | Resolve conflicting GC identity ExplicitDeny, then delete/readback same canary; GitHub App and sole-writer confirmation still required |
| Model | DEEPSEEK_API_KEY present; readonly catalog confirms deepseek-flash | Live SDK only after complete G1; isolation/recovery and five varied previews |
| Notes skills | [Draft PR #35](https://github.com/unirain/obs-notes-hub/pull/35), current head f1053b4829747667a5263a4a77a0d7bb092252da | Human review/merge and pin actual published default-branch commit; a draft head is not publication |
| Quality corpus | 30 candidates / 10 holdout; 26 private bodies (9 holdout) prepared with SHA256; 4 video bodies unavailable and all labels unset | 4 accessible bodies or explicit new candidate choices, human labels/note exclusions, real evaluation/calibration and quality confirmation |
| Delivery/operations | Local adapters and cold fault replay | Native isolated image/PR reconciliation, sources/monitoring/Actions/cancellation, capacity and production manual smoke |

No cloud resources have been created to obtain passing tests. No paid model generation, real article PR/image delivery, production deployment or cron activation has been performed.

Setup: docs/runbooks/test-environment-setup.md. Quality workflow: docs/runbooks/quality-evaluation.md. Specific assertions and missing layers: docs/notes/spec-case-audit.md and agents/reading/evals/case-audits/. Decisions, historical implementation evidence and blockers: docs/notes/implementation-log.md; prior task snapshots are preserved in Git history.

## 2026-10-15 OSS transport evidence

- Actual ali-oss6.23.0/urllib2.44.1 on Node24.19.0, existing private obs-agent (Beijing), isolated prefix 523fac0d-c29c-4cbe-b0c7-ddfdd4254350. A durable local intent checkpoint preceded cloud writes.
- One commit PUT; authenticated TLS OSS200/request-id received, 309 bytes suppressed before HTTP parser, zero response events; actual SDK returned unknown. Manager read back the exact fixed commit twice, retained consecutive commits0/1 and cold-restored original records/artifact/revision via a fresh non-instrumented client. No adapter post-success throw.
- Source/SDK/Node hashes and sanitized evidence: agents/reading/evals/storage/fixtures/oss-transport-evidence.json. Restricted RAM was confirmed unprepared today; no IAM resource was created or production enabled.
- Targeted transport/storage tests13/13 and complete local Node24 sequential regression536/98 passed, together with typecheck/build/40 schemas/spec mapping. Exact implementation85d4f57 passed Linux Node24.10.0 four-worker CI38689381026 with the same536/98 assertions. Default live selection skips5 tests; the native transport probe was separately explicitly executed.

## 2026-10-15 Quality input preparation

Read-only controlled gateway captured26 distinct primary bodies/331853 characters from30 existing candidates, including9 of10 holdout bodies (11,268,939 final-response payload bytes). The other4 are reported unsupported_format:video; no fabricated body or automatic candidate replacement. All30 human labels remainnull and no corpus was frozen. Private editable sample file: `.reading-local/quality-corpus-20261015/samples.for-human-labeling.json`; snapshots and readable individual bodies are adjacent. Sanitized receipt: agents/reading/evals/results/quality-source-preparation.json.

Readonly target-library main was resolved to dc56cd67ee538759759ab28c02ac45ab504191e2.16 committed notes were scanned;2 candidate URLs have observed note matches, including the holdout associated with 261013-构建有效的Agent自动化.md. Those paths were added to the private annotation copy without clearing existing paths. Alias/note completeness still requires human review; draft skill PR35 remains open/unmerged.

A9 audit also found two required reliability counters absent from quality reports. The quality worker implemented frozen-bound report evidence for lost candidates and source failures misreported as empty, reusing duplicate PR metrics; targeted28 quality tests passed. Full current local542/99 and LinuxNode24.10 four-worker CI38691432367 passed for implementationeea734c. Source completeness remains unknown, so lost_candidates total is not zero or complete.

## Additional local requirement identified

Readonly source accounting audit found that UrlGateway follows3xx responses but driver/browser only charge the final response payload against max_download_bytes. Intermediate redirect payloads were omitted from total accounting. This is a plan/spec total-download invariant gap, separate from the87 named case assertions; their covered status does not prove this edge. Per-hop/chunk payload charging and cold persistent counters are now implemented, with no final-byte double count and one admitted logical resource per fetch. Final full regression/CI is pending below; earlier green case files did not prove this invariant.

## 2026-10-15 Download payload accounting follow-up

Host-only download budget ports now checkpoint logical fetch admission before HTTP and every observed response payload, including3xx bodies. Native streams pause while accounting commits; gateway/browser closure joins already-started accounting. Exhaustion stops subsequent URLs; an already-arrived over-limit chunk stays in cumulative facts. Main/reference/image and repository commit/tree/raw reads share the project batch budget. These counters cover HTTP payload bytes, not headers/TLS overhead; mocked stream/browser tests are not native service evidence.

Added actual Controller/FileStore cold tests for redirect totals, exhaustion/overrun, failed stream before model admission, unknown-query usage with no automatic replay, and repository recovery after a fixed commit checkpoint without its tree. Source discovery and host prepublication source verification retain their separate bounded host read paths; this change covers project stage downloads. Full local558/102 and typecheck/build/schema40/spec mapping passed; exact LinuxNode24.10 four-worker CI38694162330 passed the same558/102 assertions. RAM remains user-confirmed unprepared; no new question, IAM resource creation or paid call was made.

## Current goal status: blocked_external

The same restricted-RAM prerequisite was absent across the native transport, quality preparation and current payload-fix turns. Concrete local work from those turns is committed and verified; the next integration gate requires externally prepared identities. G1 stays blocked_external, G2–G5 pending, and the overall objective remains incomplete. Resume G1 after the operator prepares the scoped identities in docs/runbooks/test-environment-setup.md section4 (and the separate deletion identity in section9). Do not reuse the broad AK as permission evidence, create cloud resources, run paid models or enable cron to bypass this blocker. Later isolated delivery resources, published skill and human quality inputs remain required.

## 2026-10-19 Preview credential preparation

User supplied the RAM creation-result CSV. Local parsing found one expected reading-preview principal and a nonempty AccessKey ID/Secret; values were not printed. Credentials were copied to a host-only file outside the repository with directory0700/file0600. This is exported credential preparation only: attached policies, actual identity validity and native RAM allow/deny remain unverified. Preview policy creation/binding is the next operator step; G1 remains blocked_external. No cloud API, paid model call or production change was made.

## 2026-10-19 Preview RAM native permission verification

User confirmed ReadingPreviewWorkspace authorization. Explicit isolated native probe using only the new reading-preview credential passed19 checks on Node24.19.0/ali-oss6.23.0 against existing private obs-agent/Beijing. Preview canary Put/Get/Head/List,409 immutable overwrite refusal and disposable-manifest deletion passed.8 actual OSS403 responses covered production/integration Put/Get/List, bucket-root List and Delete of a nonexistent commits canary key; no real commit deletion was attempted. Native denial calls used the SDK directly without an adapter scope guard. Local immutable intent checkpoints preceded remote writes, zero SDK automatic retries. The local pending marker hash describes probe fixture bytes rather than all SDK-generated HTTP bodies; exact operation logic binds the private probe source hash. This is RAM scope evidence, not new transport-loss evidence.

Actual preview Manager initialized commit0, checkpointed commit1, and a fresh Manager cold-restored matching revision/artifact bytes. Both immutable commit records remain; no protocol commits were deleted or skipped. Sanitized19-check receipt: agents/reading/evals/results/ram-preview-verification.json. Private raw report/intent stay ignored; credentials stay outside Git. No paid model/cloud-resource creation/production configuration change. This completes the tested preview identity layer only; test workspace, monitor, capacity and image upload/GC identities remain unprepared/unverified, so G1 remains blocked_external and G2–G5 pending.

## 2026-10-19 Test workspace credential preparation

User supplied a second RAM creation export. Local parsing found exactly one expected reading-test-workspace principal and nonempty AccessKey ID/Secret; no credential values were printed. Credentials were saved outside Git in a host-only file (directory0700/file0600). No existing credential file was overwritten. Policy binding/native permission checks remain unverified; next operator action is attaching ReadingTestWorkspace from deploy/ram/test-workspace.json. The previously verified preview identity is unchanged. G1 remains blocked_external; no cloud API, model call or production change occurred in this preparation step.

## 2026-10-19 Integration RAM native permission verification

User confirmed ReadingTestWorkspace authorization. New restricted reading-test-workspace credential passed21 native checks on actualNode24.19.0/ali-oss6.23.0 against existing private obs-agent/Beijing. Allowed integration Put/Get/Head/List,409 forbid-overwrite followed by unchanged-byte readback, disposable-manifest Delete followed by actual404 readback passed.8 real OSS403 covered production/preview Put/Get/List, bucket-root List and a nonexistent commit-key Delete. No real protocol commit deletion attempted, and denial requests use SDK directly without adapter scope checks.

Local immutable intents preceded remote writes, SDK retryMax0; unknown results would stop without replacement. Intent probe_fixture_sha256 explicitly describes marker bytes rather than all generated HTTP bodies. The trusted integration Manager used a separate UUID namespace within the authorized integration root, fixed production scope and approved reading-integration identity; it did not touch or promote any preview state. Commits0/1 remain consecutive and intact; a fresh Manager cold-restored the exact revision and artifact bytes. No model call, IAM/bucket creation or production deployment change.

Sanitized receipt: agents/reading/evals/results/ram-integration-verification.json. Private report/intent remain ignored and credentials outside Git. Preview and integration workspace identities now have native evidence; monitor, capacity, image upload/GC remain unprepared/unverified, so G1 remains blocked_external and G2–G5 pending. No application source changed; targeted native verification21/21 and diff check apply, prior558/102 local/LinuxCI implementation evidence is unchanged rather than rerun.

## 2026-10-19 Remaining RAM credentials and native subset checks

User supplied3 creation CSVs containing4 unique expected users and confirmed authorization: reading-test-watchdog, reading-capacity-readonly, reading-test-images, reading-test-image-gc. All credentials were saved outside Git (directory0700/files0600), preserving existing files; no values printed. No identity or bucket was created by the agent.

ActualNode24.19.0/ali-oss6.23.0 isolated native verification passed49 scoped checks with38 realOSS403 and zero successful remote writes. Watchdog14/14: integration list/read and fresh readonly Manager cold restore of the prior immutable fixture; production/preview access and Put/Delete denied. Capacity15/15: workspace subset only, three managed private prefixes listable, known preview/integration fixture bytes readable and readonly cold restore passes; root/unmanaged listing and writes/deletes denied. Each image identity10/10: private-workspace reads/metadata, root listing and production/preview/integration writes/deletes denied. Native denial calls use SDK directly, local immutable intent checkpoints precede every negative write/delete, SDK retries0; no real commit deletion was attempted.

Only watchdog acceptance is complete for its tested identity scope. Capacity and both image identities remain partial: actual image bucket/region/public URL and managed-capacity bindings are absent. No image upload, version inventory or GC on a real image prefix has occurred; missing image capacity remains unknown, neverzero. Requested only nonsecret bucket/domain information while independent checks ran. Sanitized receipt: agents/reading/evals/results/ram-readonly-image-boundary-verification.json. G1 stays blocked_external pending image/capacity scope evidence; G2–G5 and paid model generation remain unpassed/disabled. Application source/fingerprint and prior558/102 CI evidence are unchanged; this turn adds native diagnostic evidence only.

## 2026-10-19 Supplied image target: native metadata denied

User supplied existing bucket osb-reading-public-imgs and its Beijing native HTTPS public URL, authorizing an isolated test. Three restricted identities (images/capacity/image-gc) each received actualOSS403 AccessDenied on required GetBucketAcl. Zero remote writes, no upload/delete or bucket/IAM mutation attempted; ACL/versioning/anonymous availability remain unverified, capacity remains unknown. This is a confirmed missing effective authorization, not proof of its exact RAM-vs-bucket-policy cause. Receipt: agents/reading/evals/results/ram-image-target-preflight.json.

Generated6 local policy JSONs with the actual supplied bucket;3 image-related replacements are ready under the operator host config directory. The generator performs no cloud calls, and no policy update was applied by the agent. Operator must update ReadingTestImages/ReadingTestImageGC/ReadingCapacityReadonly to the real-bucket documents and confirm the current policy versions. No new users or credentials required. G1 remains blocked_external; previous workspace/watchdog positive evidence remains valid. Full image upload/public-read/delete/versions and global capacity are not claimed passed. Application source unchanged; native3 metadata requests plus diff/secret checks are this turn's applicable validation.

## 2026-10-19 Real image upload/public-read/capacity passed; GC explicit deny

After the operator updated3 policies, all3 image-related GetBucketAcl requests returned200/public-read. Actual fixed-runtime native/adapter probe passed23 checks before the24th GC Delete failed. Current bucket versioning never, no lifecycle expiry. Unique68-byte diagnostic PNG upload200, exact content/MIME readback, anonymous HTTPS content hash, forbid-overwrite409, uploader Delete403, GC Put403, capacity Put/Delete403, preview/integration/watchdog image Put403 and out-of-prefix protections passed. Images/GC/capacity version inventories succeeded. Actual capacityBrokerFromEnvironment cold-read consecutive immutable control chains for all4 declared bindings and found13 objects/4992 occupied bytes/0 reservations, including exactly one68-byte PNG, under the shared50,000,000,000-byte limit. This is verified inventory for those declared bindings at the observed snapshot, not an account-wide completeness or semantic quality claim. Host-only capacity credential JSON now includes these tested nonsecret bindings, preserving keys; image binding records delete_verified=false and sole_writer_verified=false.

GC adapter initially returned classified permission without HTTP fields, which the private helper conservatively labelled unknown. Kept that original immutable observation. Reconciled the same fixed key/hash by GET200, then committed an audit before one native diagnostic retry of the definitively permission-classified failure (SDK retries0; no new upload/key). Raw service response was403/AccessDenied, EC0003-00000201, PolicyType AccountLevelIdentityBasedPolicy, NoPermissionType ExplicitDeny, AuthAction oss:DeleteObject. GET after rejection remained200/exact hash. The denied policy name was not exposed; no claim about which attached policy caused it. Exact upload and GC credentials match their creation exports and all6 keys are distinct.

Fixed canary remains at the key in the receipt, intentionally retained pending operator permission repair; do not rerun upload or invent absence. Next action: inspect reading-test-image-gc direct and inherited policies, preserve the dedicated GC policy, remove conflicting uploader/capacity Deny grants as appropriate, and verify the current GC document. Continue cleanup on this exact existing canary after repair. Native receipt: agents/reading/evals/results/ram-image-upload-capacity-verification.json, with separate reconciliation audit. Post-delete404 and post-delete capacity observations remain unexecuted; full maintenance/remote-reference/G3 semantics are not certified. G1 remains incomplete/blocked_external for GC identity; no paid model or production cron was enabled. No application source changed.
