import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { parseDeployment, executionTarget } from "./config/deployment.js";
import { parseCli, safeError } from "./app/cli-options.js";
import { loadOssCredentials } from "./config/credentials.js";
import { createObjectStore } from "./storage/oss.js";
import { preflight } from "./storage/preflight.js";
import { processCancellation } from "./app/signals.js";

async function main(): Promise<void> {
  const started_at = Date.now();
  const options = parseCli(process.argv.slice(2), process.env);
  const deployment = parseDeployment(
    JSON.parse(await readFile(resolve(options.deployment), "utf8")),
  );
  if (options.command === "validate-dispatch") {
    const target = executionTarget(deployment, options.dispatch!);
    console.log(
      JSON.stringify({
        valid: true,
        deployment: deployment.name,
        mode: target.dispatch.mode,
        scope: target.execution_scope,
        workspace_id: target.workspace_id,
        config_hash: target.config_hash,
      }),
    );
    return;
  }
  if (options.command === "verify-storage") {
    const credentials = await loadOssCredentials();
    const store = createObjectStore({
      ...credentials,
      bucket: deployment.workspace.bucket,
      region: deployment.workspace.region,
      endpoint: deployment.workspace.endpoint,
      allowed_prefix: deployment.workspace.prefix,
    });
    await preflight(store);
    console.log(
      JSON.stringify({
        verified: true,
        bucket: deployment.workspace.bucket,
        scope: deployment.execution_scope,
        checks: [
          "private_access",
          "versioning_never_enabled",
          "safe_lifecycle",
          "native_public_https",
        ],
        ram_isolation: "not_proven",
      }),
    );
    return;
  }
  if (options.command === "maintenance") {
    const { buildMaintenanceApplication } = await import("./app/bootstrap.js");
    const app = await buildMaintenanceApplication({
      deployment,
      dispatch: options.dispatch!,
      local: options.local,
      local_root: resolve(options.local_root),
      run_id: "maintenance-" + randomUUID(),
    });
    console.log(JSON.stringify(await app.maintenance(), null, 2));
    return;
  }
  if (
    options.command === "manage-source-gap" ||
    options.command === "inspect-source-gaps"
  ) {
    if (
      options.command === "manage-source-gap" &&
      !options.local &&
      process.env.READING_SHARED_MUTEX_HELD !== "true"
    )
      throw new Error("storage_writer_mutex_unverified");
    const { buildMaintenanceApplication } = await import("./app/bootstrap.js");
    const { acceptSourceGap, inspectSourceGaps } =
      await import("./app/source-gap-management.js");
    const app = await buildMaintenanceApplication({
      deployment,
      dispatch: options.dispatch!,
      local: options.local,
      local_root: resolve(options.local_root),
      run_id: "source-gap-" + randomUUID(),
    });
    if (options.command === "inspect-source-gaps")
      console.log(
        JSON.stringify(await inspectSourceGaps(app.journal), null, 2),
      );
    else {
      const text = await readFile(resolve(options.request_file!), "utf8");
      if (Buffer.byteLength(text) > 16000)
        throw new Error("source_gap_request_too_large");
      console.log(
        JSON.stringify(
          await acceptSourceGap(
            app.journal,
            JSON.parse(text),
            process.env.GITHUB_ACTOR ?? userInfo().username,
          ),
        ),
      );
    }
    return;
  }
  if (options.command === "recover") {
    if (!options.local && process.env.READING_SHARED_MUTEX_HELD !== "true")
      throw new Error("storage_writer_mutex_unverified");
    const text = await readFile(resolve(options.request_file!), "utf8");
    if (Buffer.byteLength(text) > 4_000_000)
      throw new Error("recovery_request_too_large");
    const { buildRecoveryApplication } =
      await import("./app/recovery-bootstrap.js");
    const { applyRecovery } = await import("./app/recovery.js");
    const app = await buildRecoveryApplication({
      deployment,
      dispatch: options.dispatch!,
      local: options.local,
      local_root: resolve(options.local_root),
      run_id: "recovery-" + randomUUID(),
      ...(options.notes_repository
        ? { notes_repository: resolve(options.notes_repository) }
        : {}),
    });
    console.log(
      JSON.stringify(
        await applyRecovery(
          app.journal,
          JSON.parse(text),
          process.env.GITHUB_ACTOR ?? userInfo().username,
          app.ports,
        ),
      ),
    );
    return;
  }
  if (options.command === "inspect") {
    const { buildMaintenanceApplication } = await import("./app/bootstrap.js");
    const { buildUsageLedger } = await import("./workspace/usage.js");
    const app = await buildMaintenanceApplication({
      deployment,
      dispatch: options.dispatch!,
      local: options.local,
      local_root: resolve(options.local_root),
      run_id: "inspection-" + randomUUID(),
    });
    const projects = [];
    for (const key of app.journal.keys("projects/")) {
      const project =
        await app.journal.load<import("./app/controller.js").HostProject>(key);
      if (project)
        projects.push({
          project_id: project.project_id,
          generation_version: project.generation_version,
          state: project.state,
          resume_policy: project.resume_policy,
          resume_stage: project.resume_stage,
          reason: project.reason,
          counters: project.counters,
        });
    }
    const invocations = [];
    for (const key of app.journal.keys("invocations/")) {
      const call =
        await app.journal.load<import("./contracts/index.js").InvocationRecord>(
          key,
        );
      if (call)
        invocations.push({
          invocation_id: call.invocation_id,
          subject_id: call.subject_id,
          input_hash: call.input_hash,
          status: call.status,
          capability: call.capability,
          request_started: call.request_started ?? null,
          usage: call.usage,
        });
    }
    console.log(
      JSON.stringify(
        {
          workspace_id: app.journal.handle.workspace_id,
          execution_scope: app.journal.handle.execution_scope,
          revision: app.journal.handle.revision,
          projects,
          invocations,
          usage: buildUsageLedger([app.journal.handle]).total,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (options.command === "watchdog") {
    const { runWatchdogApplication } = await import("./app/watchdog.js");
    console.log(JSON.stringify(await runWatchdogApplication({ deployment })));
    return;
  }
  if (options.command === "status") {
    const tasks = await readFile(
      resolve("docs/tasks/implementation.md"),
      "utf8",
    );
    console.log(tasks);
    return;
  }
  if (!options.notes_repository) throw new Error("notes_repository_required");
  let dispatch = options.dispatch!;
  if (dispatch.mode === "preview" && !dispatch.preview_id)
    dispatch = { ...dispatch, preview_id: randomUUID() };
  await mkdir(resolve(options.local_root), { recursive: true });
  const { buildApplication } = await import("./app/bootstrap.js");
  const cancellation = processCancellation();
  try {
    const application = await buildApplication({
      deployment,
      dispatch,
      started_at,
      abort_signal: cancellation.signal,
      local: options.local,
      local_root: resolve(options.local_root),
      notes_repository: resolve(options.notes_repository),
      run_id: process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
        : `local-${randomUUID()}`,
    });
    const report = await application.controller.run(
      dispatch,
      process.env.GITHUB_ACTOR ?? "local-user",
    );
    console.log(JSON.stringify(report, null, 2));
    if (
      ["failed_collection", "partial", "deferred_work"].includes(report.outcome)
    )
      process.exitCode = 2;
    if (cancellation.signal.aborted) process.exitCode = 130;
  } finally {
    cancellation.close();
  }
}
await main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
