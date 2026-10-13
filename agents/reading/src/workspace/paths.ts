import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AgentError, type ExecutionScope } from "../contracts/index.js";
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export function validateWorkspaceIdentity(
  id: string,
  scope: ExecutionScope,
  trustedProductionId = "obs-notes-hub/reading",
): void {
  if (
    !["obs-notes-hub/reading", "obs-notes-hub/reading-integration"].includes(
      trustedProductionId,
    )
  )
    throw new AgentError(
      "configuration",
      "Unapproved production workspace identity",
    );
  if (
    scope === "production"
      ? id !== trustedProductionId
      : !/^obs-notes-hub\/reading-preview\/[a-zA-Z0-9_-]{1,80}$/.test(id)
  )
    throw new AgentError(
      "scope",
      "Workspace identity does not match trusted scope",
    );
}
export function validatePath(path: string): void {
  if (
    path.length > 1024 ||
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          p.startsWith(".") ||
          ["node_modules", "scratch", "venv", "__pycache__"].includes(p),
      )
  )
    throw new AgentError("corrupt", "Unsafe persisted path");
  if (!/^(state|inputs|projects|outputs|runs)\//.test(path))
    throw new AgentError("corrupt", "Path outside persistence allowlist");
  if (
    /\.(?:pem|key|exe|sh)$/.test(path) ||
    /(?:credentials|auth\.json|cookies)/i.test(path)
  )
    throw new AgentError("corrupt", "Sensitive or executable file is excluded");
}
export async function safeLocalPath(
  root: string,
  path: string,
): Promise<string> {
  validatePath(path);
  const dest = resolve(root, path);
  if (!dest.startsWith(resolve(root) + "/"))
    throw new AgentError("corrupt", "Path escape");
  const components = path.split("/");
  let current = resolve(root);
  for (const p of components) {
    current = join(current, p);
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink())
        throw new AgentError("corrupt", "Symlink in workspace path");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  await mkdir(dirname(dest), { recursive: true });
  return dest;
}
export function projectPath(projectId: string, path: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId))
    throw new AgentError("scope", "Invalid project identity");
  const full = `projects/${projectId}/${path}`;
  validatePath(full);
  return full;
}
