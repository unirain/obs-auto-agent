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
| A7 | runtime/root | in_progress | Versioned cloud contract and independent image review locally verified; known writing/render/review continuation locally verified; original proposal 38589eb has Linux fixture evidence; updated draft PR #35 head f1053b4 awaits default-branch review/merge and live SDK/article quality |
| A8 | runtime/root | live_unverified | Actual driver replay, independent manual barriers and source/policy recovery locally verified; five varied real previews pending |
| A9 | runtime/root | live_unverified | Frozen host execute/merge/report implemented; whole-query known/unknown charges, split/scope aggregation and immutable cumulative snapshot reconciliation locally verified; 30 human labels/fixed bodies and live model calibration still missing |
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
| G1 | pending | Local persistence faults plus live OSS/RAM verification |
| G2 | pending | Live SDK isolation, five varied previews and recovery |
| G3 | pending | Isolated GitHub/image delivery and fault reconciliation |
| G4 | pending | Real sources, monitoring, capacity and human quality calibration |
| G5 | pending | Production permissions, manual smoke, defaults confirmed and first cron |

## Current verification

- Targeted verification on actual Node v24.19.0: writing/render/review budget and cold failures 8/8; quality execute/merge/report 22/22. Typecheck/build, all 40 exported schema documents and spec mapping passed. Complete regression is running; the previous full verification remains 519 tests / 95 files at 17:21 Asia/Shanghai.
- Current local case audit: 87 covered / 0 partial / 0 missing, with named assertions. All 87 full-layer cases remain pending / 0 complete; local coverage is not native service or human acceptance.
- Last fully verified implementation `5dd37e571045311d9b790c443679a87570b2e777`: [Linux Node 24.10.0 CI](https://github.com/unirain/obs-auto-agent/actions/runs/38542003642). Current modifications await full regression and their own implementation CI. Sanitized evidence: agents/reading/evals/results/local-verification.json.
- Production generation cron remains disabled. G0 permits local contracts/replays only; G1–G5 stay pending.

## External resources and remaining acceptance

| Item | Current evidence | Still required |
| --- | --- | --- |
| Implementation repository | unirain/obs-auto-agent, default master, Apache License preserved | Separate isolated delivery test repository/App |
| Private OSS | Existing obs-agent, Beijing; native private/never-versioned/no-overwrite/pagination/chain probe passed | Actual transport-level response loss and restricted RAM allow/deny; broad test AK is not IAM proof |
| Restricted credentials | No preview/test workspace/image/capacity/monitor/App test identities currently injected | Scope-bound RAM identities, GitHub App and image upload/delete/read identities from setup runbook |
| Model | DEEPSEEK_API_KEY present; readonly catalog confirms deepseek-flash | Live SDK only after complete G1; isolation/recovery and five varied previews |
| Notes skills | [Draft PR #35](https://github.com/unirain/obs-notes-hub/pull/35), current head f1053b4829747667a5263a4a77a0d7bb092252da | Human review/merge and pin actual published default-branch commit; a draft head is not publication |
| Quality corpus | 30 candidates / 10 holdout; labels and frozen body hashes missing | Human labels/body versions, real evaluation, calibration and quality confirmation |
| Delivery/operations | Local adapters and cold fault replay | Native isolated image/PR reconciliation, sources/monitoring/Actions/cancellation, capacity and production manual smoke |

No cloud resources have been created to obtain passing tests. No paid model generation, real article PR/image delivery, production deployment or cron activation has been performed.

Setup: docs/runbooks/test-environment-setup.md. Quality workflow: docs/runbooks/quality-evaluation.md. Specific assertions and missing layers: docs/notes/spec-case-audit.md and agents/reading/evals/case-audits/. Decisions, historical implementation evidence and blockers: docs/notes/implementation-log.md; prior task snapshots are preserved in Git history.
