# Reading Agent implementation tasks

Updated: 2026-10-14. Objective: implement and verify all five plans without narrowing live validation requirements.

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
| A7 | runtime/root | in_progress | Versioned cloud contract and independent image review locally verified; fixed local proposal 38589eb passed real Linux rendering/isolation; target review/publication and live SDK/article quality pending |
| A8 | runtime/root | live_unverified | Actual driver replay, independent manual barriers and source/policy recovery locally verified; five varied real previews pending |
| A9 | runtime/root | in_progress | Frozen corpus/result binding and inspect/freeze/report locally verified; 30 labels and fixed body versions missing; real eval runner/model/human calibration pending |
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
| G0 | complete | Exact core DTO/UTC boundaries, shared states, 38 schema definitions and complete cross-module cold-recovery fixture locally verified; audit in docs/notes/g0-contract-audit.md |
| G1 | pending | Local persistence faults plus live OSS/RAM verification |
| G2 | pending | Live SDK isolation, five varied previews and recovery |
| G3 | pending | Isolated GitHub/image delivery and fault reconciliation |
| G4 | pending | Real sources, monitoring, capacity and human quality calibration |
| G5 | pending | Production permissions, manual smoke, defaults confirmed and first cron |

External configuration: implementation repository unirain/obs-auto-agent is connected on default branch master, preserving the initial Apache License. obs-agent in Beijing supplied and native OSS core probe passed. DEEPSEEK_API_KEY is visible to host; read-only model catalog confirms deepseek-flash. Distinct restricted RAM identities, separate GitHub test repository/App and public image test prefix remain unprepared. Human dataset labels and quality confirmation remain required. No secret values belong in this document.

Evidence checkpoint: 443 local tests in 81 files passed at 2026-10-14 12:02 Asia/Shanghai; typecheck/build, mapping and diff checks passed. Sanitized command results and implementation fingerprint: agents/reading/evals/results/local-verification.json. Four opt-in live tests were skipped by the default live command; the new isolated local Docker fault test was explicitly executed and passed separately. SDK child isolation and Docker JS/render probes are actual local evidence only. Core OSS evidence is partial; RAM/transport evidence and full service/human gates are still missing. All 87 spec cases remain pending complete layered proof.

Implementation commit `95be532` is pushed to `origin/master`; [Linux Node 24 CI passed](https://github.com/unirain/obs-auto-agent/actions/runs/38407803369). The implementation repository is still separate from the missing delivery test repository/App.

Implemented in this continuation: audited fixed-input manual invocation recovery, confirmed-result import and readonly inspection; policy settlement before upload; source-change generation routing; bounded browser/related-note reading; material closure and semantic progress; project/day/run usage; observable storage/Actions/PR metrics; typed image GC with dedicated delete identity and complete reference checks; exact primary-source dedup; strict control-record envelopes and per-write policy receipts. See docs/notes/operations-audit.md for the requirement/evidence index.

Implemented in the latest continuation: logical file chunking above the physical blob limit; project-body references and bounded lazy loading; authenticated history GC; scoped control DTO validation; explicit changed-input generation and atomic feedback; actual installed SDK/native binary and tool-image binding; trusted runtime limits, freshness/watchdog durations and storage declarations; RSS/Atom and unsupported media receipts. Final local command evidence is recorded above; these changes do not prove live gates.

Implementation follow-ups before full acceptance: deliver and consume a fixed cloud-adapted skill commit; close the 40 explicitly identified local scenario gaps in docs/notes/spec-case-audit.md, then re-audit their assertions; run the frozen evaluation through real model execution and human calibration. Per-case evidence now records actual test names/proved scope and missing layers. External service/human gates above remain unchanged. Completion is still unproven.

Latest continuation: actual project transitions and fee/archive preservation are enforced before checkpoint; daily logical keys group physical runs without skipping new URLs; cancellation persists unknown outcomes; workflow G1 evidence is pinned to tracked default-branch bytes, and publish-only excludes model/image credentials. Cloud skill proposal and evidence: docs/notes/cloud-skill-proposal.md. The five G0 contract follow-ups are now closed; fuller plan-level host fault evidence and case-by-case layered acceptance mapping remain; external gates remain unchanged.

Continuation implementation 65cffd9 passed Linux CI (https://github.com/unirain/obs-auto-agent/actions/runs/38412794310). Follow-up explicitly binds SDK VAULT_ROOT to the existing project draft directory, rejects escape outside the trusted model view, and has SDK options/active-query wiring checks. Follow-up b49ab0a passed Linux Node 24 CI: https://github.com/unirain/obs-auto-agent/actions/runs/38413545670.

2026-10-13 23:16: G0 contract gate passed locally. Exact RunReport records unknown provenance rather than inventing commits, preserves all 11 usage fields and closes policy references. GitHub readonly environment metadata reports zero configured environments; no reading Actions/native delivery verification was performed. All 87 full layered cases remain pending and G1–G5 remain unpassed.

Implementation ec366b7 pushed to master and passed Linux Node 24 CI: https://github.com/unirain/obs-auto-agent/actions/runs/38421910653.

87-case audit: local covered 30, partial 54, missing 3; 57 cases have explicit local remaining requirements. These are scope assessments of actual assertions, not executed live passes. All full-layer statuses remain pending. Evaluation readiness inspected the actual candidate document: 30 samples, 10 holdout, 30 unlabeled, 30 lacking frozen source body versions.

Latest continuation: trusted inspect-source-gaps/manage-source-gap accept commands commit exact-revision health/event/human audit atomically; restoration verifies audit bindings and committed event closure. C029 backfill remains missing. C050 proves unsafe bucket configurations cause zero writes across cold restart. C053 commits checked JSON/SVG/receipt before PNG export, binds restored input/skill/tool hashes and has an actual isolated Docker exit42/recovery fixture. Audit now 32 covered / 54 partial / 1 missing locally, 55 with local requirements, and 87 pending full-layer proof. Fixed fault scripts are not native drawing/model/article quality acceptance.

Implementation 193a63a is pushed to origin/master; [Linux Node 24 CI passed](https://github.com/unirain/obs-auto-agent/actions/runs/38502049810). Local implementation fingerprint matches the recorded 296 files. Production cron remains disabled.

Latest collection continuation: an active disabled/not_attempted source now exits pagination after one attempt while preserving its bookmark. The prior loop repeated the same cursor; the new regression was executed against the prior code and detected both branches. C017/C025/C027/C031 local combinations now use actual source adapters/controller/scoped journal/FileStore/cold recovery/readonly HEAD monitor; selection and Issue API remain explicit local substitutes. Local audit is 36 covered / 50 partial / 1 missing, 51 with local requirements, 87 pending complete layers. C029 genuine history completeness evidence remains absent; ordinary list/feed success cannot certify it.

Collection implementation 4b6ddd7 pushed to origin/master; [Linux Node 24 CI passed](https://github.com/unirain/obs-auto-agent/actions/runs/38503701466). The recorded 299-file fingerprint matches current bytes.

Latest admission continuation: StageExecutor rechecks current policy after asynchronous preflight and before intent; disabled source, denied domain, paused project, semantic drift and unreadable policy cannot start a replay query. Strict delivery projection binds production/project/generation/delivery and synchronizes a known PR number into candidate/intake feedback. The complete domain fixture now checks lost manual receipt and distinct submission IDs against the original five queries and single Fake PR; all GitHub writer effects remain unchanged. C006/C011/C013 local evidence closed; audit 39 covered / 47 partial / 1 missing, 48 local follow-ups, all 87 full-layer cases pending.

Admission/intake implementation b56693a pushed to origin/master; [Linux Node 24 CI passed](https://github.com/unirain/obs-auto-agent/actions/runs/38505877284). The recorded 301-file fingerprint matches current bytes.

Latest active-query continuation: policy refresh also binds fixed semantic policy, including classify_only; late refresh callbacks no longer change a stopped query. Generation deadline is rechecked after a policy checkpoint. Unfinished SDK exceptions are typed request_unknown with cause; deadline/cancellation/policy abort reasons preserve manual reconciliation. Actual executor/timer/journal/FileStore with explicit blocking model replay and controlled clock proves prior evidence, unknown 11/3 usage, and zero replacement queries after cold restore. C037/C064 local gaps closed; 41 covered / 45 partial / 1 missing, 46 local follow-ups, 87 layered cases still pending.

Active-query CI follow-up: 81a8992 Linux CI failed because a policy checkpoint could complete after execute() returned, racing cold restore with stale HEAD. The executor now joins all already-started refresh tasks; a deterministic held-checkpoint regression fails without join and passes with it. All 435 local tests passed after repair. The C037 operations audit is included in this follow-up, keeping all committed audit/fingerprint bytes consistent.

Repaired active-query implementation 0ea5c1e pushed to origin/master; [Linux Node 24 CI passed](https://github.com/unirain/obs-auto-agent/actions/runs/38508155509), including the deterministic late-checkpoint join test. The complete 302-file fingerprint matches current bytes.

Latest classification continuation: one actual driver/StageExecutor/Controller/scoped journal/FileStore fixture covers product-name tutorial versus announcement, pure marketing, both official source provenances, unlabelled mixed body and allowed/excluded/unresolved routing. Two unresolved queries persist manual policy_review_required across cold restore. Actual sdkOptions.canUseTool denies follow_reference/render_diagram/write_note/publish plus native Read/Write/Bash/Skill; registered read_source rejects a forged supplementary hash. No classifier side effects or source refetch occur after manual hold. Replay semantic labels are not human/model quality proof. C002/C003/C004/C005/C007/C008 local scope closed; 47 covered / 40 partial / 0 missing, 40 local follow-ups, all 87 layered cases still pending.
