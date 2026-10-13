import { parseArgs } from "node:util";
import { parseDispatch, type Dispatch } from "../config/dispatch.js";

export type CliOptions = {
  command:
    | "run"
    | "validate-dispatch"
    | "watchdog"
    | "status"
    | "verify-storage"
    | "maintenance"
    | "recover"
    | "inspect";
  deployment: string;
  dispatch: Dispatch | null;
  request_file: string | null;
  local: boolean;
  local_root: string;
  notes_repository: string | null;
  from_actions: boolean;
};
export function parseCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): CliOptions {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      deployment: { type: "string" },
      "from-actions": { type: "boolean", default: false },
      mode: { type: "string" },
      "input-url": { type: "string", multiple: true },
      "input-urls": { type: "string" },
      "project-id": { type: "string" },
      "preview-id": { type: "string" },
      "submission-id": { type: "string" },
      local: { type: "boolean", default: false },
      "local-root": { type: "string", default: ".reading-local" },
      "notes-repository": { type: "string" },
      "request-file": { type: "string" },
    },
  });
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !command ||
    ![
      "run",
      "validate-dispatch",
      "watchdog",
      "status",
      "verify-storage",
      "maintenance",
      "recover",
      "inspect",
    ].includes(command)
  )
    throw new Error("invalid_command");
  if (!values.deployment) throw new Error("deployment_file_required");
  const from_actions = Boolean(values["from-actions"]);
  const actionInput = {
    mode: env.READING_MODE,
    input_urls: env.READING_INPUT_URLS_JSON ?? "[]",
    project_id: env.READING_PROJECT_ID,
    preview_id: env.READING_PREVIEW_ID,
    submission_id: env.READING_SUBMISSION_ID,
  };
  const explicit = {
    mode: values.mode,
    input_urls: values["input-urls"] ?? values["input-url"] ?? [],
    project_id: values["project-id"],
    preview_id: values["preview-id"],
    submission_id: values["submission-id"],
  };
  const useAction =
    from_actions ||
    (command === "validate-dispatch" && env.READING_MODE !== undefined);
  if (values["input-url"] && values["input-urls"])
    throw new Error("ambiguous_url_inputs");
  const dispatch = [
    "run",
    "validate-dispatch",
    "maintenance",
    "recover",
    "inspect",
  ].includes(command)
    ? parseDispatch(
        useAction ? actionInput : explicit,
        useAction && env.READING_TRIGGER === "schedule" ? "schedule" : "manual",
      )
    : null;
  if (
    ["maintenance", "recover", "inspect"].includes(command) &&
    (dispatch?.input_urls.length ||
      dispatch?.project_id ||
      dispatch?.submission_id ||
      (dispatch?.mode === "preview" && !dispatch.preview_id))
  )
    throw new Error("maintenance_existing_workspace_only");
  if (command === "recover" && !values["request-file"])
    throw new Error("recovery_request_file_required");
  if (command !== "recover" && values["request-file"])
    throw new Error("recovery_request_wrong_command");
  if (values.local && dispatch?.mode !== "preview")
    throw new Error("local_adapter_is_preview_only");
  return {
    command: command as CliOptions["command"],
    deployment: values.deployment,
    dispatch,
    request_file: values["request-file"] ?? null,
    local: Boolean(values.local),
    local_root: values["local-root"]!,
    notes_repository:
      values["notes-repository"] ?? env.READING_NOTES_REPOSITORY ?? null,
    from_actions,
  };
}
export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "operation_failed";
  let safe = message;
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      value.length >= 8 &&
      /(API_KEY|ACCESS_KEY|AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN|CREDENTIALS|PRIVATE_KEY)/.test(
        name,
      )
    ) {
      safe = safe.split(value).join("[redacted]");
      if (name.endsWith("CREDENTIALS")) {
        try {
          const credentials = JSON.parse(value) as Record<string, unknown>;
          for (const key of ["accessKeyId", "accessKeySecret", "stsToken"])
            if (
              typeof credentials[key] === "string" &&
              credentials[key].length >= 8
            )
              safe = safe.split(credentials[key]).join("[redacted]");
        } catch {
          /* Credentials are not diagnostic data. */
        }
      }
    }
  }
  return safe
    .replace(/LTAI[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .replace(/-----BEGIN[\s\S]*?-----END[^\n]*-----/g, "[redacted]")
    .replace(
      /([?&](?:Signature|SecurityToken|AccessKeyId)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .slice(0, 300);
}
