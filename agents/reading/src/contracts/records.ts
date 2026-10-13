import {
  AgentError,
  canonicalJson,
  type JsonValue,
  type WorkspaceHandle,
  type InvocationRecord,
  type CheckpointChange,
} from "./index.js";
import { validateSchema } from "./schema.js";
export type RecordValidator = (
  next: JsonValue | null,
  previous: JsonValue | undefined,
  handle: WorkspaceHandle,
  change: CheckpointChange,
) => void;
const validators: { prefix: string; validate: RecordValidator }[] = [];
export function registerRecordValidator(
  prefix: string,
  validate: RecordValidator,
): void {
  if (validators.some((v) => v.prefix === prefix))
    throw new AgentError(
      "configuration",
      "Record validator already registered",
    );
  validators.push({ prefix, validate });
}
const invocation: RecordValidator = (value, old, handle, change) => {
  if (value === null)
    throw new AgentError(
      "corrupt",
      "Invocation audit record cannot be deleted",
    );
  const next = validateSchema<InvocationRecord>("invocation", value);
  const messageIds = new Set<string>();
  for (const message of next.messages) {
    if (messageIds.has(message.message_id))
      throw new AgentError("corrupt", "Duplicate invocation message identity");
    messageIds.add(message.message_id);
  }
  if (next.execution_scope !== handle.execution_scope)
    throw new AgentError("scope", "Invocation scope changed");
  if (!old) {
    if (next.status !== "prepared" || next.messages.length !== 0)
      throw new AgentError("corrupt", "Invocation must start prepared");
    return;
  }
  const previous = validateSchema<InvocationRecord>("invocation", old);
  for (const field of [
    "schema_version",
    "invocation_id",
    "execution_scope",
    "subject_id",
    "capability",
    "input_hash",
    "context_hash",
    "policy_hash",
    "model",
    "sdk_version",
    "limits",
  ] as const)
    if (canonicalJson(previous[field]) !== canonicalJson(next[field]))
      throw new AgentError("corrupt", "Immutable invocation binding changed");
  if (
    next.messages.length < previous.messages.length ||
    previous.messages.some(
      (message, index) =>
        canonicalJson(message) !== canonicalJson(next.messages[index]),
    )
  )
    throw new AgentError(
      "corrupt",
      "Invocation observations cannot be removed or changed",
    );
  const legal: Record<
    InvocationRecord["status"],
    InvocationRecord["status"][]
  > = {
    prepared: ["prepared", "running", "succeeded", "failed", "unknown"],
    running: ["running", "succeeded", "failed", "unknown"],
    succeeded: ["succeeded"],
    failed: ["failed"],
    unknown: ["unknown"],
  };
  if (
    !legal[previous.status].includes(next.status) &&
    !(
      previous.status === "unknown" && change.reason === "invocation_reconciled"
    )
  )
    throw new AgentError("corrupt", "Illegal invocation terminal transition");
};
registerRecordValidator("receipts/", invocation);
registerRecordValidator("invocations/", invocation);
export function validateRecords(
  handle: WorkspaceHandle,
  change: CheckpointChange,
): void {
  for (const [key, value] of Object.entries(change.records ?? {})) {
    for (const validator of validators)
      if (key.startsWith(validator.prefix))
        validator.validate(value, handle.records[key], handle, change);
  }
}
export function validateRestoredRecords(
  records: Record<string, JsonValue>,
  scope: WorkspaceHandle["execution_scope"],
): void {
  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith("invocations/") && !key.startsWith("receipts/"))
      continue;
    const record = validateSchema<InvocationRecord>("invocation", value);
    if (record.execution_scope !== scope)
      throw new AgentError("scope", "Restored invocation scope mismatch");
    const ids = new Set<string>();
    for (const message of record.messages) {
      if (ids.has(message.message_id))
        throw new AgentError(
          "corrupt",
          "Duplicate invocation message identity",
        );
      ids.add(message.message_id);
    }
  }
}
