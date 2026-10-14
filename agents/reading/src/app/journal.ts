import { canonicalJson } from "../contracts/index.js";
import type {
  CheckpointFile,
  JsonValue,
  WorkspaceHandle,
  WorkspaceManager,
  InvocationRecord,
  InvocationMessage,
  Usage,
} from "../contracts/index.js";
import type { OperationsJournal } from "../publish/types.js";
import type { JournalPort } from "../stages/executor.js";
import { retryAuthorized, type InvocationResolution } from "./recovery.js";
import { aggregateUsage } from "../workspace/usage.js";

function json(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("journal_non_json_value");
  return JSON.parse(encoded) as JsonValue;
}

/** A single host writer shares one advancing handle across every business module. */
export class WorkspaceJournal implements OperationsJournal {
  private tail: Promise<void> = Promise.resolve();
  private readonly committedKeys = new Set<string>();
  constructor(
    private readonly manager: WorkspaceManager,
    public handle: WorkspaceHandle,
    readonly run_id: string,
  ) {}
  async load<T>(key: string): Promise<T | undefined> {
    await this.tail;
    const value = this.handle.records[key];
    return value === undefined ? undefined : (structuredClone(value) as T);
  }
  keys(prefix = ""): string[] {
    return Object.keys(this.handle.records).filter((k) => k.startsWith(prefix));
  }
  committedRecordKeys(prefix = ""): string[] {
    return [...this.committedKeys].filter((key) => key.startsWith(prefix));
  }
  async commit<T>(key: string, value: T): Promise<void> {
    await this.commitMany({ [key]: value }, `record:${key}`);
  }
  async commitMany(
    records: Record<string, unknown>,
    reason: string,
    files: CheckpointFile[] = [],
    remove_paths: string[] = [],
    expected_revision?: string,
  ): Promise<void> {
    const task = this.tail.then(async () => {
      if (
        expected_revision !== undefined &&
        this.handle.revision !== expected_revision
      )
        throw new Error("checkpoint_revision_drift");
      const values: Record<string, JsonValue | null> = {};
      for (const [key, value] of Object.entries(records))
        values[key] = value === null ? null : json(value);
      const result = await this.manager.checkpoint(this.handle, {
        expected_revision: this.handle.revision,
        reason,
        run_id: this.run_id,
        records: values,
        files,
        remove_paths,
      });
      if (result.status !== "committed")
        throw new Error(`checkpoint_${result.status}`);
      this.handle = result.handle;
      for (const key of Object.keys(records)) this.committedKeys.add(key);
    });
    // A failed checkpoint poisons this writer; no subsequent queued effect can run on stale state.
    this.tail = task;
    await task;
  }
}

function totalUsage(messages: InvocationMessage[]): Usage {
  return aggregateUsage(messages);
}

export class ApplicationInvocationJournal implements JournalPort {
  constructor(private readonly journal: WorkspaceJournal) {}
  async find(
    subject_id: string,
    input_hash: string,
    capability: string,
  ): Promise<InvocationRecord | null> {
    const order = (await this.journal.load<string[]>("invocation_order")) ?? [];
    const records: InvocationRecord[] = [];
    for (const id of [...order].reverse()) {
      const record = await this.journal.load<InvocationRecord>(
        "invocations/" + id,
      );
      if (record?.subject_id === subject_id) records.push(record);
    }
    const authorized = new Set<string>();
    for (const record of records)
      if (await retryAuthorized(this.journal, record, input_hash, capability))
        authorized.add(record.invocation_id);
    const superseded = new Set<string>();
    for (const record of records) {
      const marker = await this.journal.load<{
        input_hash: string;
        subject_id: string;
      }>("binding-superseded/" + record.invocation_id);
      if (
        marker?.input_hash === record.input_hash &&
        marker.subject_id === subject_id &&
        record.input_hash !== input_hash
      )
        superseded.add(record.invocation_id);
    }
    const uncertain = records.find(
      (r) =>
        ["prepared", "running", "unknown"].includes(r.status) &&
        !authorized.has(r.invocation_id),
    );
    if (uncertain) return uncertain;
    const failed = records.find(
      (r) =>
        r.status === "failed" &&
        r.request_started !== false &&
        !authorized.has(r.invocation_id) &&
        !superseded.has(r.invocation_id),
    );
    if (failed) return failed;
    for (const record of records) {
      if (record.capability !== capability) continue;
      if (record.input_hash === input_hash && record.status === "succeeded")
        return record;
      if (
        record.input_hash === input_hash &&
        record.status === "failed" &&
        record.request_started !== false &&
        !authorized.has(record.invocation_id)
      )
        return record;
    }
    return null;
  }
  async result(id: string): Promise<unknown> {
    return this.journal.load(`responses/${id}`);
  }
  async prepare(record: InvocationRecord): Promise<void> {
    if (await this.journal.load(`invocations/${record.invocation_id}`))
      throw new Error("invocation_id_conflict");
    const order = (await this.journal.load<string[]>("invocation_order")) ?? [];
    const replacements: Record<string, unknown> = {};
    for (const key of this.journal.keys("invocation-resolutions/")) {
      const resolution = (await this.journal.load<InvocationResolution>(key))!;
      if (
        resolution.action === "authorize_retry" &&
        resolution.subject_id === record.subject_id &&
        resolution.input_hash === record.input_hash &&
        resolution.capability === record.capability
      ) {
        const old = resolution.invocation_id
          ? await this.journal.load<InvocationRecord>(
              "invocations/" + resolution.invocation_id,
            )
          : undefined;
        if (
          old &&
          (await retryAuthorized(
            this.journal,
            old,
            record.input_hash,
            record.capability,
          ))
        )
          replacements[key] = {
            ...resolution,
            replacement_invocation_id: record.invocation_id,
          };
      }
    }
    await this.journal.commitMany(
      {
        ["invocations/" + record.invocation_id]: record,
        ["invocation_meta/" + record.invocation_id]: {
          run_id: this.journal.run_id,
          started_at: new Date().toISOString(),
          purpose:
            typeof record.limits === "object" &&
            record.limits &&
            !Array.isArray(record.limits) &&
            typeof record.limits.purpose === "string"
              ? record.limits.purpose
              : "unspecified",
        },
        invocation_order: [...order, record.invocation_id],
        ...replacements,
      },
      "invocation_prepared",
    );
  }
  async observe(
    id: string,
    message: InvocationMessage,
    observable: Record<string, unknown>,
  ): Promise<void> {
    const record = await this.journal.load<InvocationRecord>(
      `invocations/${id}`,
    );
    if (!record) throw new Error("invocation_missing");
    const old = record.messages.find(
      (m) => m.message_id === message.message_id,
    );
    if (old) {
      if (canonicalJson(old) !== canonicalJson(message))
        throw new Error("invocation_message_conflict");
      return;
    }
    const messages = [...record.messages, message];
    const values: Record<string, unknown> = {
      [`invocations/${id}`]: {
        ...record,
        status: "running",
        messages,
        usage: totalUsage(messages),
        ...(typeof observable.request_started === "boolean"
          ? { request_started: observable.request_started }
          : {}),
      },
      [`observations/${id}/${message.message_id.replace(/[^A-Za-z0-9_-]/g, "_")}`]:
        observable,
    };
    if (Object.hasOwn(observable, "structured_response"))
      values[`responses/${id}`] = observable.structured_response;
    await this.journal.commitMany(values, "invocation_observed");
  }
  async finish(
    id: string,
    status: "succeeded" | "failed" | "unknown",
  ): Promise<void> {
    const record = await this.journal.load<InvocationRecord>(
      `invocations/${id}`,
    );
    if (!record) throw new Error("invocation_missing");
    if (record.status === "succeeded" && status !== "succeeded")
      throw new Error("terminal_invocation_conflict");
    await this.journal.commit(`invocations/${id}`, { ...record, status });
  }
}
