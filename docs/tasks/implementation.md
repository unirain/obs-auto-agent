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
| S8 | storage/root | implemented | Recovery integration and runbooks |
| A1 | runtime/root | local_verified | Domain schemas, modes and stage routing |
| A2 | runtime | local_verified | Latest policy and restricted classification |
| A3 | runtime | live_unverified | Manual URL and source collection |
| A4 | runtime | local_verified | Context, examples, index and fair scheduling |
| A5 | runtime | live_unverified | SDK execution and usage lifecycle |
| A6 | runtime | in_progress | Restricted reading and evidence |
| A7 | runtime | in_progress | Linux skill, rendering and review |
| A8 | runtime/root | in_progress | Preview integration and recovery |
| A9 | runtime/root | blocked_external | Evaluation set and human quality confirmation |
| O1 | operations | live_unverified | Trusted deployments and permissions |
| O2 | operations | live_unverified | Immutable resource upload |
| O3 | operations | live_unverified | Publisher and reconciliation |
| O4 | operations | in_progress | Expiry, revocation and recovery routing |
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

Evidence checkpoint: 187 local tests passed at 2026-10-13 18:50 Asia/Shanghai; sanitized evidence: agents/reading/evals/results/local-verification.json; typecheck/build passed. All three opt-in live tests were skipped. Safe OSS core evidence: agents/reading/evals/storage/fixtures/oss-live-evidence.json; required RAM denial and actual transport-loss evidence remain incomplete. Linux tools and actual source reads have separate limited evidence; the fixed cloud-adapted skill, live SDK execution and human quality acceptance remain unverified. The 87 spec cases are mapped, none is yet marked fully complete across its required layers. Re-run checks after further code changes.

Implementation follow-ups before full acceptance: deliver and consume a fixed cloud-adapted skill commit; finish the explicit audited manual invocation-resolution/unblock entrypoint and its recovery tests; verify project/day usage rollups and external storage/Actions metrics; attach concrete evidence to individual acceptance cases. These remain part of the objective alongside the external gates above.
