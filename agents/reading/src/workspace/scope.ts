import { AgentError, type WorkspaceHandle } from "../contracts/index.js";
export function assertProductionMode(
  handle: WorkspaceHandle,
  mode: "resume" | "publish-only",
): void {
  if (handle.execution_scope !== "production")
    throw new AgentError("scope", `${mode} refuses preview identity`);
}
export function modelFileView(
  handle: WorkspaceHandle,
  projectId: string,
): { read_roots: string[]; write_roots: string[] } {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId))
    throw new AgentError("scope", "Project identity unsafe");
  return {
    read_roots: [
      `${handle.root_dir}/inputs`,
      `${handle.root_dir}/projects/${projectId}`,
    ],
    write_roots: [
      `${handle.root_dir}/projects/${projectId}/research`,
      `${handle.root_dir}/projects/${projectId}/draft`,
      `${handle.root_dir}/projects/${projectId}/review`,
    ],
  };
}
