export type RunMode = "scheduled" | "resume" | "publish-only" | "preview";
export interface DispatchInput {
  mode?: unknown;
  input_urls?: unknown;
  project_id?: unknown;
  preview_id?: unknown;
  submission_id?: unknown;
}
export interface Dispatch {
  mode: RunMode;
  input_urls: string[];
  project_id: string | null;
  preview_id: string | null;
  submission_id: string | null;
}
export function parseDispatch(
  input: DispatchInput,
  trigger: "manual" | "schedule" = "manual",
): Dispatch {
  const mode = trigger === "schedule" ? "scheduled" : (input.mode ?? "preview");
  if (
    !["scheduled", "resume", "publish-only", "preview"].includes(String(mode))
  )
    throw new Error("Unknown run mode");
  let urls: unknown = input.input_urls ?? [];
  if (typeof urls === "string") {
    try {
      urls = JSON.parse(urls || "[]");
    } catch {
      throw new Error("input_urls must be a JSON array");
    }
  }
  if (!Array.isArray(urls) || urls.some((u) => typeof u !== "string"))
    throw new Error("input_urls must be an array of URLs");
  const input_urls = [
    ...new Set(
      (urls as string[]).map((u) => {
        const parsed = new URL(u);
        if (
          !["https:", "http:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          !parsed.hostname.includes(".") ||
          /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(parsed.hostname)
        )
          throw new Error("Only public anonymous article URLs are allowed");
        return parsed.href;
      }),
    ),
  ];
  const identity = (value: unknown): string | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value))
      throw new Error("Invalid dispatch identity");
    return value;
  };
  const project_id = identity(input.project_id);
  const preview_id = identity(input.preview_id);
  const submission_id = identity(input.submission_id);
  if (
    trigger === "schedule" &&
    (input_urls.length ||
      project_id ||
      preview_id ||
      submission_id ||
      (input.mode && input.mode !== "scheduled"))
  )
    throw new Error("Cron accepts no manual parameters");
  if (
    (mode === "resume" || mode === "publish-only") &&
    (!project_id || input_urls.length || preview_id || submission_id)
  )
    throw new Error(
      "Resume/publish-only require an existing production project only",
    );
  if (
    mode === "scheduled" &&
    (project_id || preview_id || (submission_id && !input_urls.length))
  )
    throw new Error("Invalid production submission parameters");
  if (
    mode === "preview" &&
    (project_id || submission_id || (!preview_id && !input_urls.length))
  )
    throw new Error("Preview requires URL(s) or existing preview_id");
  return {
    mode: mode as RunMode,
    input_urls,
    project_id,
    preview_id,
    submission_id,
  };
}
export function dailyLogicalKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export const WRITER_CONCURRENCY_GROUP = "reading-workspace-writer";
