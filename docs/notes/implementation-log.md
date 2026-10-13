# Reading Agent implementation log

## 2026-10-13 Continuation: recovery and cross-module audit

- Prior turn advanced authoritative state: commits 667fa1a/640894d pushed; both Linux Node 24 CI runs passed. This continuation retained the full goal and addressed identified implementation gaps with three module owners.
- Added inspect/recover CLI and a metadata-only recovery workflow sharing the writer mutex. Manual retry preserves old unknown/cost facts, requires fixed input and duplicate-charge acknowledgement, and a newly unknown replacement reblocks. Confirmed response import is atomic and bound to the original invocation; proof of no start cannot be inferred from an absent reply. Persistent replay/fault tests exercise the next process and preserve counters.
- Runtime now settles confirmed semantic bindings before reclassification, verifies material closure/read ranges, reads retrieved notes by version/hash, detects semantic no-progress, and runs a bounded browser fallback. The installed SDK's actual child spawn was tested with a sentinel process: only the model token is present, not controller secrets. Real Docker Chromium executed a JS fixture through the gateway; neither test contacted a model or proves real article quality.
- Host ports now consume settlement, related-note versions, browser scope and typed source change. Classification refresh precedes production upload; completed output plus manual/pending work is partial progress. SDK intents and remote writes link exact persisted policy receipts, and seals retain the policy check before revision capture.
- Usage is reconstructed from persisted calls by scope/workspace/project/Beijing start day/run; whole-query summaries cover late steps rather than being added to them. Missing attribution/prices remain unknown. Workspace adapter counts, Actions wall time and actual PR review outcomes are exposed with explicit limits; no account invoice or human review minutes were fabricated.
- Implemented native version-aware image GC with a distinct deletion identity, complete default/open-PR reference scans, unknown/active/merged protection and readback before releasing reservations. Missing identity or partial evidence reports incomplete. Reservation, upload and delivery records reject unversioned/unknown control state. No actual GC, RAM changes or external writes were performed in this continuation.
- Replaced substring duplicate detection with exact explicit primary-source metadata/aliases; citations, snippets and supplemental sources do not imply prior admission. Added a 25-package/G0–G5/87-case audit index without equating local tests to full layered acceptance.
- Further implementation and all external/human requirements remain tracked in the canonical task ledger. No gate was silently reduced and production generation cron remains disabled.

## 2026-10-13 Implementation started

- Read the five implementation plans and inspected the project: documentation only, no package or Git repository.
- Established `AGENTS.md` and the canonical task/gate ledger. The full S1–S8, A1–A9, O1–O8 and G0–G5 scope is retained.
- Requested non-secret isolated test configuration while starting local implementation. Missing live resources will be recorded as unverified, not replaced by fake test success.
- Local runtime currently provides Node 26 and npm 11. A reproducible supported version and dependencies will be fixed after checking package engine requirements.

## 2026-10-13 Local implementation and real storage evidence

- Three implementation agents produced storage, runtime and delivery/operations modules. Added host CLI, shared durable journal, lifecycle controller, task ledger and 87-case machine-readable acceptance mapping.
- Initial combined verification: 118 local tests passed; typecheck, build and preview dispatch validation passed. Subsequent changes must re-run these checks before updating the count.
- Real isolated OSS probe on obs-agent passed private/anonymous access, never-enabled versioning, safe lifecycle, immutable create/race, pagination and commit-chain restore. Controlled post-response loss also reconciled; distinct RAM identity denials and actual transport-loss remain unverified.
- Corrected integration risks: external manual URL permission across later stages, query result persistence before stage advance, stable canonical hashing, historical sealed revisions, pending query recovery and native image tool blocks.
- User selected DeepSeek deepseek-flash. Official docs provide Anthropic endpoint https://api.deepseek.com/anthropic and only partial output_config support. Provider-specific JSON validation is being adapted; model catalog read returned HTTP 200 and included the requested model. No generation was performed by that check.
- User requested setup guidance for GitHub App/test repository, test image prefix and RAM/STS. Concrete runbook/policy artifacts are in progress; production cron remains disabled pending G5.

## 2026-10-13 Implementation repository and integration checkpoint

- Connected the user-created public implementation repository `unirain/obs-auto-agent`; fetched its initial Apache License and checked out default branch `master`. Trusted policy now resolves the actual default branch rather than assuming `main`. This repository does not replace the separate test delivery repository or GitHub App.
- At 18:41 Asia/Shanghai, 180 local tests, typecheck and build passed; three live tests were skipped. The 87-case mapping passed its consistency check with all cases still awaiting complete layered evidence.
- Added CI, shared-writer maintenance entrypoint, original job deadline propagation and lazy artifact reads. Research partial results consume their persisted replies without advancing to complete; source bookmarks record observed identities to include same-day and backdated new articles without recrawling the initial historical backlog.
- Actual Linux Docker evidence confirms tool isolation and Chinese static rendering; SDK skill activation and human article/visual quality are still pending. Cloud skill adaptation is currently a reviewable patch, not a consumed adapted Git commit.
- Setup instructions and generated RAM policies are available in `docs/runbooks/test-environment-setup.md`. Restricted identities, test App/repository, image prefix, transport-loss verification and human labels remain outstanding. No production generation schedule was enabled.

- Final local checkpoint at 18:50: 187 tests passed, typecheck/build and mapping passed; three live tests skipped. Sanitized command results and implementation fingerprint are saved in `agents/reading/evals/results/local-verification.json`. Production-scope publish-only composition proves no model/image credential reads and no SDK construction.

- Initial implementation commit `667fa1a` was pushed to master; [Linux Node 24 CI passed](https://github.com/unirain/obs-auto-agent/actions/runs/38386402472). Cross-review then found and fixed host policy-subject propagation: gateway, source verification and Publisher now retain original tool domains; default subjects include actual aliases and snapshot URLs. Regression checks reject later scope expansion and revoked alias/core domains; the full 187-test suite, typecheck/build and mapping pass after the fix.

- Continuation checkpoint: 288 local tests passed; typecheck/build/mapping passed. Three live tests skipped. The sanitized evidence fingerprint was refreshed; this does not mark any of the 87 full acceptance cases complete.
