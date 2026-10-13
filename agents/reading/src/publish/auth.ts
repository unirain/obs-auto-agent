import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
export interface GitHubAppCredentials {
  app_id: string;
  installation_id: number;
  private_key: string;
}
/** Parse only on the trusted host; never include credentials in DTOs, thrown errors or logs. */
export function parseAppCredentials(
  encoded: string | undefined,
): GitHubAppCredentials {
  if (!encoded)
    throw new Error("GitHub App credential reference is not injected");
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error("Invalid GitHub App credential JSON");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("app_id" in value) ||
    !("installation_id" in value) ||
    !("private_key" in value) ||
    typeof value.app_id !== "string" ||
    !/^\d+$/.test(value.app_id) ||
    typeof value.installation_id !== "number" ||
    !Number.isSafeInteger(value.installation_id) ||
    value.installation_id < 1 ||
    typeof value.private_key !== "string" ||
    !value.private_key.includes("PRIVATE KEY")
  )
    throw new Error("Invalid GitHub App credential structure");
  return {
    app_id: value.app_id,
    installation_id: value.installation_id,
    private_key: value.private_key,
  };
}
export function createGitHubAppClient(
  credentials: GitHubAppCredentials,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: credentials.app_id,
      installationId: credentials.installation_id,
      privateKey: credentials.private_key,
    },
    request: { timeout: 30000 },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
}
