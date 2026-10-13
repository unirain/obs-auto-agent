import {
  AgentError,
  canonicalJson,
  type WorkspaceManager,
  type InvocationJournal,
  type InvocationRecord,
  type WorkspaceHandle,
  type CheckpointResult,
  type InvocationMessage,
  type JsonValue,
} from "../contracts/index.js";
import { validateSchema } from "../contracts/schema.js";
import { aggregateUsage } from "./usage.js";
const key = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new AgentError("corrupt", "Invalid invocation identity");
  return `receipts/${id}`;
};
export function readInvocation(
  handle: WorkspaceHandle,
  id: string,
): InvocationRecord {
  const record = handle.records[key(id)];
  if (!record) throw new AgentError("not_found", "Invocation absent");
  return validateSchema<InvocationRecord>("invocation", record);
}
export function recoveredInvocations(
  handle: WorkspaceHandle,
): InvocationRecord[] {
  return Object.entries(handle.records)
    .filter(([k]) => k.startsWith("receipts/"))
    .map(([, v]) => {
      const r = validateSchema<InvocationRecord>("invocation", v);
      return ["prepared", "running"].includes(r.status)
        ? { ...r, status: "unknown" as const }
        : r;
    });
}
export class PersistentInvocationJournal implements InvocationJournal {
  constructor(private readonly manager: WorkspaceManager) {}
  async prepare(
    handle: WorkspaceHandle,
    record: InvocationRecord,
    runId: string,
  ): Promise<CheckpointResult> {
    validateSchema("invocation", record);
    if (
      record.execution_scope !== handle.execution_scope ||
      record.status !== "prepared" ||
      record.messages.length !== 0
    )
      throw new AgentError("scope", "Invalid invocation preparation");
    if (handle.records[key(record.invocation_id)])
      throw new AgentError("conflict", "Invocation identity already used");
    return this.save(handle, record, runId, "invocation_prepared");
  }
  async observe(
    handle: WorkspaceHandle,
    id: string,
    message: InvocationMessage,
    runId: string,
  ): Promise<CheckpointResult> {
    const record = readInvocation(handle, id);
    if (record.status === "unknown")
      throw new AgentError(
        "unknown",
        "Unknown invocation requires explicit reconciliation",
      );
    const existing = record.messages.find(
      (m) => m.message_id === message.message_id,
    );
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(message))
        throw new AgentError("corrupt", "Replayed SDK message changed");
      return { status: "committed", handle, snapshot: handle.snapshot };
    }
    if (!["prepared", "running"].includes(record.status))
      throw new AgentError(
        "conflict",
        "Terminal invocation cannot receive new message",
      );
    const messages = [...record.messages, message];
    return this.save(
      handle,
      {
        ...record,
        status: "running",
        messages,
        usage: aggregateUsage(messages),
      },
      runId,
      "invocation_observed",
    );
  }
  async finish(
    handle: WorkspaceHandle,
    id: string,
    status: "succeeded" | "failed" | "unknown",
    runId: string,
  ): Promise<CheckpointResult> {
    const record = readInvocation(handle, id);
    if (record.status === status)
      return { status: "committed", handle, snapshot: handle.snapshot };
    if (!["prepared", "running"].includes(record.status))
      throw new AgentError(
        "conflict",
        "Terminal invocation transition forbidden",
      );
    return this.save(
      handle,
      { ...record, status },
      runId,
      "invocation_finished",
    );
  }
  private save(
    handle: WorkspaceHandle,
    record: InvocationRecord,
    runId: string,
    reason: string,
  ): Promise<CheckpointResult> {
    validateSchema("invocation", record);
    return this.manager.checkpoint(handle, {
      expected_revision: handle.revision,
      reason,
      run_id: runId,
      records: { [key(record.invocation_id)]: record as unknown as JsonValue },
    });
  }
}
