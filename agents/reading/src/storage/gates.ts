import { readFile } from "node:fs/promises";
import { sha256, AgentError } from "../contracts/index.js";
export const G1_REQUIRED_ASSERTIONS = [
  "immutable_race",
  "forbid_overwrite",
  "response_loss_transport",
  "complete_pagination",
  "private_anonymous_deny",
  "versioning_never",
  "preview_ram_write_deny",
  "commit_ram_delete_deny",
  "monitor_read_only",
  "gc_constrained_delete",
] as const;
/** The expected digest comes from trusted deployment config, never model output or restored workspace. */
export async function assertG1Evidence(
  path: string | undefined,
  expectedHash: string | undefined,
): Promise<void> {
  if (!path || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash))
    throw new AgentError("configuration", "G1 live evidence is not configured");
  const bytes = await readFile(path);
  if (sha256(bytes) !== expectedHash)
    throw new AgentError("corrupt", "G1 evidence hash mismatch");
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8")) as {
      schema_version?: number;
      gate?: string;
      status?: string;
      isolated_resources?: boolean;
      assertions?: Record<string, string>;
      sdk?: string;
      observed_at?: string;
    };
  } catch {
    throw new AgentError("corrupt", "G1 evidence invalid");
  }
  if (
    value.schema_version !== 1 ||
    value.gate !== "G1" ||
    value.status !== "complete" ||
    value.isolated_resources !== true ||
    value.sdk !== "ali-oss@6.23.0" ||
    !value.observed_at ||
    !Number.isFinite(Date.parse(value.observed_at)) ||
    G1_REQUIRED_ASSERTIONS.some((name) => value.assertions?.[name] !== "passed")
  )
    throw new AgentError(
      "configuration",
      "G1 live assertions remain incomplete",
    );
}
