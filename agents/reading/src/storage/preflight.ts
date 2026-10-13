import { AgentError, type ObjectStore } from "../contracts/index.js";
export async function preflight(store: ObjectStore): Promise<void> {
  const config = await store.configuration();
  if (config.versioning !== "never")
    throw new AgentError(
      "configuration",
      "Workspace versioning must never have been enabled",
    );
  if (config.acl !== "private" || config.anonymous_readable)
    throw new AgentError("configuration", "Workspace must be private");
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname.includes("-internal.") ||
    !endpoint.hostname.endsWith(".aliyuncs.com")
  )
    throw new AgentError(
      "configuration",
      "Public native OSS HTTPS endpoint required",
    );
  if (config.lifecycle.some((r) => r.expires))
    throw new AgentError(
      "configuration",
      "Workspace lifecycle expiration is forbidden; GC owns reference safety",
    );
}
export async function listAll(store: ObjectStore, prefix: string) {
  const result = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await store.list(prefix, cursor);
    result.push(...page.objects);
    if (page.next_cursor === null) return result;
    if (cursors.has(page.next_cursor))
      throw new AgentError("corrupt", "Pagination did not advance");
    cursors.add(page.next_cursor);
    cursor = page.next_cursor;
  } while (true);
}
