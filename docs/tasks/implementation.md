# Reading Agent implementation tasks

Updated: 2026-10-13. Objective: implement and verify all five plans without narrowing live validation requirements.

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
| S8 | storage/root | in_progress | Audited inspect/recover, unknown replacement and receipt import locally verified; explicit changed-input generation management remains |
| A1 | runtime/root | local_verified | Domain schemas, modes and stage routing |
| A2 | runtime | local_verified | Latest policy and restricted classification |
| A3 | runtime | live_unverified | Manual URL and source collection |
| A4 | runtime | local_verified | Context, examples, index and fair scheduling |
| A5 | runtime | live_unverified | SDK execution and usage lifecycle |
| A6 | runtime/root | live_unverified | Bounded reading, material closure, retrieved-note versions, semantic progress and Docker JS fallback locally verified; actual model/research evidence pending |
| A7 | runtime | in_progress | Linux skill, rendering and review |
| A8 | runtime/root | live_unverified | Actual driver replay, independent manual barriers and source/policy recovery locally verified; five varied real previews pending |
| A9 | runtime/root | blocked_external | Evaluation set and human quality confirmation |
| O1 | operations | live_unverified | Trusted deployments and permissions |
| O2 | operations | live_unverified | Immutable resource upload |
| O3 | operations | live_unverified | Publisher and reconciliation |
| O4 | operations/root | live_unverified | Expiry, source-generation routing, reclassification-before-upload and exact primary-source dedup locally verified; real withdrawal/recovery pending |
| O5 | operations/root | in_progress | Four-mode Actions and CLI wiring |
| O6 | operations | live_unverified | Watchdog, incident events and Issue dedup |
| O7 | operations/root | blocked_external | Isolated live delivery fault tests |
| O8 | operations/root | implemented | Deployment, pause and recovery runbooks |

| Gate | Status | Required evidence |
| --- | --- | --- |
| G0 | in_progress | Shared schema/fixtures, typecheck, test and build |
| G1 | pending | Local persistence faults plus live OSS/RAM verification |
| G2 | pending | Live SDK isolation, five varied previews and recovery |
| G3 | pending | Isolated GitHub/image delivery and fault reconciliation |
| G4 | pending | Real sources, monitoring, capacity and human quality calibration |
| G5 | pending | Production permissions, manual smoke, defaults confirmed and first cron |

External configuration: implementation repository unirain/obs-auto-agent is connected on default branch master, preserving the initial Apache License. obs-agent in Beijing supplied and native OSS core probe passed. DEEPSEEK_API_KEY is visible to host; read-only model catalog confirms deepseek-flash. Distinct restricted RAM identities, separate GitHub test repository/App and public image test prefix remain unprepared. Human dataset labels and quality confirmation remain required. No secret values belong in this document.

Evidence checkpoint: 288 local tests passed at 2026-10-13 20:52 Asia/Shanghai; typecheck/build and mapping passed. Sanitized command results and implementation fingerprint: agents/reading/evals/results/local-verification.json. Three opt-in live tests remain skipped. SDK child isolation and Docker JS/render probes are actual local evidence only. Core OSS evidence is partial; RAM/transport evidence and full service/human gates are still missing. All 87 spec cases remain pending complete layered proof.

Implemented in this continuation: audited fixed-input manual invocation recovery, confirmed-result import and readonly inspection; policy settlement before upload; source-change generation routing; bounded browser/related-note reading; material closure and semantic progress; project/day/run usage; observable storage/Actions/PR metrics; typed image GC with dedicated delete identity and complete reference checks; exact primary-source dedup; strict control-record envelopes and per-write policy receipts. See docs/notes/operations-audit.md for the requirement/evidence index.

Implementation follow-ups before full acceptance: explicit human changed-input/new-generation management and review-feedback command; deliver and consume a fixed cloud-adapted skill commit; audit configured limits and tool/runtime version binding; complete explicitly scoped RSS and no-text/unsupported-format handling; exercise the host composition of newly added semantic/source/browser/GC ports against their full failure cases; attach concrete evidence to individual acceptance cases. External service/human gates above remain unchanged. Completion is still unproven.
