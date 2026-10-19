# Reading Agent implementation tasks

Updated: 2026-10-19. Objective: implement and verify all five plans without narrowing live validation requirements.

Statuses: pending, in_progress, implemented, local_verified, live_unverified, blocked_external, complete. A work package is complete only when its required evidence exists. Gate evidence is tracked separately.

| Package | Owner | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| S1 | storage/root | local_verified | TypeScript foundation and shared contracts |
| S2 | storage | local_verified | Fault-injectable persistent object store |
| S3 | storage/root | live_unverified | Native core/transport/RAM G1 evidence accepted; further SDK timeout/cancellation coverage must remain explicitly reported |
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
| A7 | runtime/root | live_unverified | Human-merged skill published at default main de6cba6; exact contract/markers and Linux validation passed. Actual SDK writing/review and article quality remain unverified |
| A8 | runtime/root | live_unverified | Actual driver replay, independent manual barriers and source/policy recovery locally verified; five varied real previews pending |
| A9 | runtime/root | live_unverified | Frozen host execute/merge/report implemented; whole-query known/unknown charges, split/scope aggregation and immutable cumulative snapshot reconciliation locally verified; 26 private primary bodies prepared; 4 unsupported video sources, all 30 human labels and live calibration still missing |
| O1 | operations | live_unverified | Trusted deployments and permissions |
| O2 | operations | live_unverified | Immutable resource upload |
| O3 | operations | live_unverified | Publisher and reconciliation |
| O4 | operations/root | live_unverified | Expiry, source-generation routing, reclassification-before-upload and exact primary-source dedup locally verified; real withdrawal/recovery pending |
| O5 | operations/root | live_unverified | Actual default-branch preview reached committed source fetching; G1/environment/read identity verified. Native tool archive/fresh Docker roundtrip passed; actual article/project-context recovery and cancellation acceptance remain pending |
| O6 | operations | live_unverified | Watchdog, incident events and Issue dedup |
| O7 | operations/root | blocked_external | Isolated live delivery fault tests |
| O8 | operations/root | implemented | Deployment, pause and recovery runbooks |

| Gate | Status | Required evidence |
| --- | --- | --- |
| G0 | complete | Exact core DTO/UTC boundaries, shared states, 40 schema definitions and complete cross-module cold-recovery fixture locally verified; audit in docs/notes/g0-contract-audit.md |
| G1 | complete | All10 required native persistence/RAM assertions mapped and accepted by host assertG1Evidence; same-canary GC204/404/inventory/capacity confirmation passed |
| G2 | in_progress | Published skill/default commit and readonly cloud identity verified; reading-preview configured. Actual live SDK/article/isolation/recovery acceptance still pending |
| G3 | pending | Isolated GitHub/image delivery and fault reconciliation |
| G4 | pending | Real sources, monitoring, capacity and human quality calibration |
| G5 | pending | Production permissions, manual smoke, defaults confirmed and first cron |

## Current verification

- Current implementation `d0ffe1db03f69b83019c9dc14c7021d6db8d06ea`: [Linux Node24.10 four-worker CI39244416943](https://github.com/unirain/obs-auto-agent/actions/runs/39244416943) passed npm ci/typecheck/test/build/spec mapping, **602tests/104files**. Local Node24.19 targeted58/5files, typecheck/build,40schema checks and diff check passed. Two earlier full local failures and their repairs are retained below; they are not reported as successful full local runs.
- Current341-file fingerprint `9ac2aa42d83bd535e63d026f5c8a4099428a73b802f6a15fe92b796147a90a49`; scoped evidence: agents/reading/evals/results/local-verification.json.
- Local case audit:87 covered/0partial/0missing, with named assertions. All87full-layer cases remain pending/0complete; local coverage is not native service or human acceptance.
- G0/G1 complete; G2 in_progress, G3–G5 pending. Real preview39240721564 reached committed source fetching but stopped source_timeout with0SDK invocations. Its fixed runtime is unavailable; state and counters are preserved. Native GitHub tool-archive upload and fresh-runner exact Docker restore passed in two separate empty previews, not a successful article/project-context/SDK preview.
- Production cron remains disabled. No paid model query, actual article PR or human-quality acceptance has occurred.

## External resources and remaining acceptance

| Item | Current evidence | Still required |
| --- | --- | --- |
| Implementation repository | unirain/obs-auto-agent, default master, Apache License preserved | Separate isolated delivery test repository/App |
| Private OSS | Existing obs-agent/Beijing; native core/transport and restricted RAM scopes passed; G1 complete | Further G2–G5 integration and production acceptance remain required; no broad AK is used as IAM proof |
| Restricted credentials | All6 users supplied; native workspace/watchdog/image upload/GC and declared capacity scopes verified; G1 complete | GitHub App, production permission checks, sole-writer confirmation and full maintenance acceptance remain required |
| Model | DEEPSEEK_API_KEY present; readonly catalog confirms deepseek-flash | G1 admission complete; actual SDK isolation/recovery and five varied previews still pending |
| Notes skills | [Merged PR #35](https://github.com/unirain/obs-notes-hub/pull/35), actual published default commit de6cba6c9408ac532e5929282b3f14fc35a07f14; fixed bundle/Linux check passed | Actual model skill activation, real article and image quality |
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

## 2026-10-15 Goal blocker snapshot (historical)

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

## 2026-10-19 Same-canary cleanup passed; G1 complete

User screenshot confirmed reading-test-image-gc had both ReadingTestImages (explicit Delete deny) and ReadingTestImageGC. User removed the upload policy. Continued the exact existing canary, never uploaded another image:11/11 native/adapter checks passed. Fresh exact-hash GET and version inventory preceded one deletion through the actual OSSImageGCStore; captured native204. Exact-version adapter readback=null, native GET404, anonymous HTTPS404, fresh version inventory absence and actual capacityBroker absence all confirmed deletion. Out-of-prefix and private-workspace Delete remained native403 after the policy change. Declared capacity now12objects/4924occupied bytes/0reservations, exactly68bytes lower; four bindings retain one shared50,000,000,000-byte limit. No protocol commit deletion, SDK automatic retry, paid model, cloud resource creation or production activation. Native receipt: agents/reading/evals/results/ram-image-gc-final-verification.json. Original failure/reconciliation receipts remain unchanged.

G1's10 named required assertions are now individually mapped to source receipts in agents/reading/evals/results/g1-evidence.json: immutable race, no-overwrite, authenticated native transport loss/reconciliation, complete pagination, private anonymous deny, never-versioned workspace, preview production-write denial, commit-prefix deletion denial, monitor readonly and constrained image GC deletion. The aggregate composes separately source-bound environments rather than claiming all native probes ran on one binary. Existing baseline real OSS evidence and fresh RAM receipts together resolve the historical permission blockers. The actual assertG1Evidence guard accepted the local host copy and its trusted SHA25613fe85cf2e451984f3a3d265d9575770aab608a103846ee54b022fd1b846a7e2. This completes G1 only; all25 packages, G2–G5, actual SDK/quality and full Publisher/maintenance acceptance remain in scope.

ActualNode24.19.0 typecheck/build/schema40/spec mapping passed; G1-consuming storage bootstrap/workflow regressions15/15 passed in2files. No application source changed; prior full558/102 LinuxCI remains the implementation baseline, not a new full-suite run. Private host image binding now records delete_verified=true, while sole_writer_verified remainsfalse pending operator confirmation; no image maintenance capability is implied by a permission probe.

Readonly current skill PR35 remains OPEN/isDraft=true, headf1053b4829747667a5263a4a77a0d7bb092252da, base main. A draft head is not a published skill version; human review/merge is the next fixed-skill prerequisite for actual G2 previews. No paid query was started after G1 completion and no human quality label was manufactured.

## 2026-10-19 Published skill verified after human merge

User merged notes PR35. Readonly GitHub metadata confirms MERGED at2026-10-19T10:12:36Z, actual notes default main and merge/default commitde6cba6c9408ac532e5929282b3f14fc35a07f14. Fetched objects only into ignored proposal clone; original notes checkout unchanged. Materialized the actual published commit into new readonly .agents/.claude views: exact cloud contract and3markers pass, skill bundlef0da7dd51e934a21624d81168fd6f85153e3d82c2822b339447958a3d3099a5a. Fixed installed SDK/native versions and actual tool image/manifest hashes were read; actual network-none/readonly Linux container successfully ran published Fireworks version and JSON validate on an existing technical fixture. No new PNG export/model activation/article writing or human-quality claim. Receipt: agents/reading/evals/results/published-skill-verification.json.

Checked real cloud setup rather than spoofing the shared writer guard: implementation repository has only reading-watchdog Environment; reading-preview and required repository-level secrets/vars are absent. Notes repository is PRIVATE. No dedicated READING_REPOSITORY_READ_TOKEN/GITHUB_TOKEN is injected locally. Existing maintainer OAuth can push and is not a preview read identity. Production/preview separation requires a dedicated fine-grained token scoped to obs-auto-agent and obs-notes-hub, Contents/Pull requests/Actions read only (Metadata implicit read); Pull requests read is required by bootstrap actual pending-PR recall. No token or write-capable credential was forwarded to a model/tool.

Prepared a protected empty host token file and nonsecret .reading-local/cloud-preview-plan.json binding the scoped preview/capacity/model/read-secret references, checked-in G1 receipt hash and actual Actions concurrency group. validate-dispatch confirms preview namespace with no image/Publisher credentials. No cloud Environment/secrets were created or workflow dispatched, no mutex flag was forged, and no paid query started. Next operator input is only a dedicated readonly GitHub credential saved to the protected host file; cloud wiring can follow with existing RAM/model credentials. G1 remains complete; G2–G5 remain pending, all25packages/live quality still in scope.

## 2026-10-19 Dedicated readonly GitHub identity and cloud preview configured

User saved the requested dedicated fine-grained token.11 native GitHub checks passed: metadata/default commit, actual private-repository Contents, Pull requests and Actions reads; Contents write probes returned403 for both selected repositories. Negative POST git/blobs carried{} without required content, so no blob/branch could be created even with excess privileges. Local immutable intents preceded requests; no token/body/error secrets printed. Read-only source: private probe-8YFkfS; sanitized receipt is included in agents/reading/evals/results/cloud-preview-admission.json.

Configured reading-preview Environment in the existing implementation repository, restricted to its actual default master branch. Only4 secrets: preview-scoped OSS, global capacity readonly (with4declared bindings), DeepSeek model key, dedicated readonly GitHub token. Stored2 trusted G1 path/hash variables and read back branch policy, exact secret names and variable values. No production/image/App write credential was injected, no production Environment or cron changed, and no OSS bucket/RAM/service infrastructure was provisioned. Repository configuration writes were preceded by immutable local checkpoints; CLI encrypted secrets locally and received plaintext only on stdin. No secret values are in the receipt.

Cloud admission is prepared for a manual single-URL engineering preview of How to Build a Model Router in the Harness, using existing workflow concurrency rather than a forged local mutex flag. This is a G2 manual preview, not frozen quality evaluation or a product article-count limit. G1 remains complete; G2 moves in_progress, while G3–G5 and human quality remain pending. This record precedes workflow dispatch; no paid query has started yet.

## 2026-10-19 First real cloud preview dispatched

Initial readonly maintainer metadata GET timed out before any dispatch or intent allocation; a safe retry of that not-started operation succeeded. Committed a new local immutable dispatch intent before the one workflow_dispatch POST. Exact run39239390372 is identified against pre-dispatch run IDs and implementation headd18c0d876ecd8217f8383d5a3f90f2527a2a38bf; do not redispatch after any unknown result. Actual preview namespace: obs-notes-hub/reading-preview/g2-router-55a7ff0c-27c6-4e5f-8866-c818d654706b. Input URL https://www.langchain.com/blog/how-to-build-a-model-router-in-the-harness.

Run URL https://github.com/unirain/obs-auto-agent/actions/runs/39239390372. Scope is preview only, actual Actions shared concurrency, model deepseek-flash, current policy and committed G1 admission. Workflow first installs/verifies dependencies and tool image; model-call/usage/output facts are pending until committed records can be inspected. Starting the workflow is not actual SDK success, article quality acceptance or G2 completion. This is a standalone manual G2 preview, not a frozen holdout quality evaluation; no human labels were supplied or manufactured. Production cron remains disabled.

## 2026-10-19 Cloud pre-generation test failure and fixture clock isolation

Actual Actions39239390372 failed in typecheck/test/build step:557/558 tests passed, the expired-start test failed. It inherited READING_JOB_STARTED_AT from the real workflow, so trusted fresh job time correctly overrode that fixture's expired options.started_at. The production clock precedence is intentional and unchanged. The fixture now owns env explicitly; two cases verify expired caller start and expired trusted Actions origin even with a fresh caller start. Both assert zero SDK queries and cold FileStore initial sequence0 with no invocation facts. Actual Node24.19 targeted bootstrap8/8 passed while the parent process injected a fresh job clock; typecheck/build/schema40/spec mapping passed.

The actual Run isolated preview step was skipped; no model secret was exposed to that test step. Readonly native OSS reconciliation found the exact preview namespace empty and zero commit NoSuchKey, confirming no project state to skip/reset and no SDK query started. Receipt: agents/reading/evals/results/cloud-preview-startup-failure.json. This is not a provider/paid-query failure, and no uncertain generation is being replaced. Retry will reuse previewg2-router-55a7ff0c-27c6-4e5f-8866-c818d654706b after committing the fixture repair; it must record a distinct actual Actions run and preserve this failure. New full559-assertion CI/real workflow evidence remains pending.

## 2026-10-19 Repaired preview run identified

Clock-fixture repair2490aec59a932d386e31fbc805ec2112b06cc926 is pushed. Normal four-worker LinuxCI39240574071 is in progress. One new workflow dispatch after an immutable local retry intent identified actual reading run39240721564 at the same implementation commit, same input URL and same preview namespace g2-router-55a7ff0c-27c6-4e5f-8866-c818d654706b. Prior run39239390372 and its no-query/empty-namespace evidence remain preserved. Native API accepted the dispatch; no unknown/paid query was replaced.

New run https://github.com/unirain/obs-auto-agent/actions/runs/39240721564. CI https://github.com/unirain/obs-auto-agent/actions/runs/39240574071. Runtime/workflow and real project checkpoint semantics were not changed to fix a test; only fixture env/extra persistent assertions and AGENTS guidance changed. Full559 checks and actual live preview remain pending.

Clock-fixture implementation2490aec59a932d386e31fbc805ec2112b06cc926 passed exact LinuxNode24.10 four-worker CI39240574071:559tests/102files, npm ci/typecheck/test/build/spec mapping. Current337-file fingerprint963610bd7040eed86afc9cc26c18ee3ba823bf8f52f4ca93c5040c445d8fa091. Actual repaired preview run39240721564 remains in progress; this full CI is local-contract evidence, not live SDK/quality acceptance.

## 2026-10-19 Actual preview source failure and exact runtime preservation

Actual reading run39240721564 passed559/102 tests, G1 admission, published private skill checkout and Docker build, then the host returned deferred_work/source_timeout before any SDK invocation. A readonly validated cold snapshot at sequence14/revision50b05407-0a65-43fa-a28d-46fb81acdd9d retained the same candidate in deferred/automatic,3929 observed download bytes,1 logical fetch and1 tool call; pending_query=null, invocation rows empty, usage remains null. No paid request is being replaced. Run URL https://github.com/unirain/obs-auto-agent/actions/runs/39240721564; private inspection-ZmaCgo contains the snapshot-bound evidence.

Deterministic native-response regressions reproduced a timeout while awaited host accounting held the stream paused. The transport now excludes that backpressure from one cumulative network budget, retains an independent absolute project deadline and joins already-started accounting on either failure. This is an identified implementation defect consistent with the observed source timeout, not a claim that per-chunk cloud latency has been measured. Three added assertions prove slow accounting success, deadline failure after persisted bytes and cumulative network timeout across chunks.

The finished Actions run exposes0 artifacts and its ephemeral image was not retained. The fixed context binds image sha256:7f10ebe0d0cfc5423b44b6defd59e89edd95c16b4b874ee007df3d62ddb18032 and manifest ba67c847284ce0ef2c38defd78940abd0273ac3ebe83c3989360a4efa0518fe3. Do not silently rebuild or replace that runtime, reinitialize the namespace or discard counters. Existing case remains blocked on exact runtime availability; a new generation requires the existing management contract including changed operator input and archived prior revision.

Preview workflow now restores retained exact OCI archives before generation, or builds and uploads a trusted fresh archive before beginning a new context. Default-branch manual workflow provenance, ZIP digest, archive hash/size, schema1, actual loaded image/tool manifest and worker/lock bindings are checked. Failed/incomplete listing is not absence. Expired/missing fixed archives stop before Docker build/model calls. The readonly binding probe validates immutable host records and distinguishes a proven empty namespace from missing referenced data. Existing GitHub artifact storage is used; no new bucket/RAM/service was created. Retention90days is bounded and is not indefinite executable availability. Production/integration deployment changes and their live acceptance remain pending.

Targeted3files45tests passed on Node24.19.0. Full typecheck/test/build/spec coverage/schema40 verification is in progress. G1 remains complete; G2 in_progress with this actual failure and native cache roundtrip still unverified. G3–G5 and human quality remain pending. No new workflow/model dispatch has occurred after the failure.

The first full local regression attempt retained600/601 assertions with one workflow condition assertion failing; restored the explicit publish-only condition and added the archive-before-host boundary assertion. The second full four-worker attempt retained601/602 assertions, with only the existing newly added cold repository/tree persistent-I/O case hitting the global15-second test timeout. Its sibling material-chain cases already use60seconds; aligned this case with that same fixture budget and documented the module boundary. This changes no product deadline or assertion. Targeted replay and full LinuxCI remain pending; no failed run is being reported green.

Node24.19.0 final targeted58/58 in5files passed, including the entire material-chain file and workflow boundaries. Typecheck/build,40exported schema checks and87case mappings passed. Current341-file implementation fingerprint9ac2aa42d83bd535e63d026f5c8a4099428a73b802f6a15fe92b796147a90a49. Full Linux602-assertion CI and native artifact roundtrip remain pending before any successful live-runtime claim.

Exact implementationd0ffe1db03f69b83019c9dc14c7021d6db8d06ea passed LinuxNode24.10 four-worker CI39244416943:602tests/104files, npm ci/typecheck/test/build/spec mapping. Current341-file fingerprint9ac2aa42d83bd535e63d026f5c8a4099428a73b802f6a15fe92b796147a90a49. Native empty-preview archive producer run39244436141 is in progress; it cannot count as article/SDK/quality acceptance. No production cron change.

## 2026-10-19 Native tool-image archive and fresh-runner restore passed

At exact implementationd0ffe1db03f69b83019c9dc14c7021d6db8d06ea, source-free producer39244436141 succeeded and uploaded artifact12183680585 before the host ran. GitHub ZIP digest32f73b31db631121adb43bf3cabda3c4b73626fba6f64d9f9013c358cfc56eb7,814728840bytes. A distinct fresh runner39245305923 downloaded that artifact, verified provenance/ZIP digest/schema1/tar bytes and hashes, loaded exact imagesha256:fdc1374bb1c910f61322454e3f9e44c30a05e470f9e927c83abb78e734719496, and inspected actual tool manifestba67c847284ce0ef2c38defd78940abd0273ac3ebe83c3989360a4efa0518fe3 plus worker/lock. Restore returned restored; Build/Prepare/Upload steps were skipped, consumer artifacts0. Both workflows succeeded. Native receipt: agents/reading/evals/results/cloud-tool-image-cache.json.

Readonly validated OSS cold snapshots progressed sequence2 to4 and preserved both actual run reports, each success_no_selection; projects0, SDK invocations0. These are native OCI/GitHub/OSS technical roundtrip facts, not successful fixed article-context recovery or model/quality evidence. Negative artifact paths remain local tests.90day retention is bounded. Original source-failed article sequence14/revision50b05407-0a65-43fa-a28d-46fb81acdd9d still binds its unavailable old image; no alias/rebuild/substitution/new namespace for that same article was made, no counters or records were discarded.

Prepared and schema-validated a protected host new_generation draft with exact original revision, failure evidence reference, changed operator guidance and explicit refresh_runtime=true; not applied. Applying that changed operator input requires user confirmation and an actual trusted writer context. It must archive the prior generation and retain prior invocation/charge facts. G1 complete, G2 in_progress, G3–G5/human quality pending; production cron disabled, no paid model call.
