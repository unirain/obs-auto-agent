# Reading Agent implementation guidance

## Authority and scope

Read `intent.md`, `docs/specs/reading-agent-spec.md` and `docs/plans/README.md` before changing behavior. User instructions take precedence. Preserve observe_only model costs, no article or pending PR count cap, the shared 50 GB storage bound, human PR merging, and production/preview separation.

## Implementation and verification

- Use TypeScript ESM, npm with a committed lockfile, strict type checking and Vitest. Pin dependencies; verify SDK behavior against installed declarations or official documentation.
- Keep side effects behind typed adapters. Model tools never receive OSS, GitHub or model API secrets. Source text never becomes executable configuration.
- A committed checkpoint is required before paid calls or remote writes. Unknown results require reconciliation; never treat unknown as absent or zero.
- Restore only a validated consecutive immutable commit chain. Never delete commits, skip sequence numbers or silently initialize after an error.
- Scope and deployment targets come from trusted configuration. Preview never receives production write capabilities and never becomes production.
- Tests must assert persistent state and external effects, including the next run after failure. A fake test does not prove live OSS, SDK, RAM or GitHub behavior.
- Real integrations use explicit isolated test resources. Production cron stays disabled until the G5 evidence is complete. Do not create cloud resources or expose credentials to obtain a green test.

## Coordination and task records

`docs/tasks/implementation.md` is the canonical work-package/gate status. `docs/notes/implementation-log.md` records decisions, results and blockers. Update both when work changes authoritative state; distinguish implemented, local_verified, live_unverified, blocked_external and complete.

Parallel workers edit only assigned module paths. Shared contracts belong to the storage worker until handed off; package/config files and integration entrypoints belong to the coordinating worker. Coordinate contract changes before consumers change them. Do not discard another worker's edits.

Before reporting completion, run the applicable typecheck, tests and build, inspect plan-to-test coverage and record evidence. All 25 work packages, G0–G5 and live quality checks remain in scope even if external setup is missing. Keep this file synchronized with actual commands and module boundaries as implementation develops.

## Commands and module boundaries

- Node 24; `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run coverage:spec` verify the local implementation. `npm run test:live` selects explicitly gated integrations; skipped tests are not evidence.
- `agents/reading/src/app` composes the trusted host controller, journal, bootstrap and maintenance. Storage/workspace/contracts define persistent state; runtime/stages/tools/policy own restricted model capabilities; publish/monitor/config own external delivery and operations.
- The implementation repository is `unirain/obs-auto-agent`. Resolve its default branch from GitHub metadata or local `origin/HEAD`; do not assume `main`. Preserve the initial Apache License.
- Production generation cron remains disabled. Before any public commit, scan tracked candidates for actual locally available credentials without printing their values. Keep private test outputs in ignored `.reading-local/`.
