import { randomUUID } from "node:crypto";
import {
  AgentError,
  canonicalJson,
  type ObjectStore,
  type ObjectMetadata,
  type ObjectPage,
  type BucketConfiguration,
  type ExecutionScope,
} from "../contracts/index.js";
import type { InventoryObject } from "./inventory.js";
export type StoreOperation =
  | "create"
  | "read"
  | "stat"
  | "list"
  | "delete"
  | "configuration";
export interface TransportObservation {
  service_requests: number | null;
  wire_bytes_sent: number | null;
  wire_bytes_received: number | null;
  retries: number | null;
}
export interface StorageOperationEvent {
  schema_version: 1;
  event_id: string;
  run_id: string;
  execution_scope: ExecutionScope;
  storage_role: "workspace" | "image";
  bucket: string;
  operation: StoreOperation;
  started_at: string;
  finished_at: string;
  outcome: "confirmed" | "failed_known" | "unknown";
  error_category: string | null;
  supplied_payload_bytes: number;
  returned_payload_bytes: number | null;
  transport: TransportObservation;
}
export interface StorageMetricsView {
  schema_version: 1;
  run_id: string;
  execution_scope: ExecutionScope;
  storage_role: "workspace" | "image";
  bucket: string;
  adapter_calls: number;
  by_operation: Record<StoreOperation, number>;
  unknown_outcomes: number;
  supplied_payload_bytes: number;
  returned_payload_bytes: number;
  returned_payload_incomplete: boolean;
  service_requests: number | null;
  known_service_requests: number | null;
  wire_bytes_sent: number | null;
  known_wire_bytes_sent: number | null;
  wire_bytes_received: number | null;
  known_wire_bytes_received: number | null;
  observability: "adapter_only" | "partial_transport" | "complete_transport";
  money: {
    status: "unknown";
    amount_usd: null;
    basis: "supplier_bill_required";
  };
  through_event_id: string | null;
}
const operations: StoreOperation[] = [
  "create",
  "read",
  "stat",
  "list",
  "delete",
  "configuration",
];
const unavailableTransport = (): TransportObservation => ({
  service_requests: null,
  wire_bytes_sent: null,
  wire_bytes_received: null,
  retries: null,
});
function nonnegative(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0))
    throw new AgentError("corrupt", "Invalid storage metric counter");
}
/** Transport counters are optional explicit SDK observations; an adapter method is never falsely labeled one HTTP request. */
export class MeteredObjectStore implements ObjectStore {
  readonly bucket: string;
  private events: StorageOperationEvent[] = [];
  constructor(
    private readonly inner: ObjectStore,
    private readonly attribution: {
      run_id: string;
      execution_scope: ExecutionScope;
      storage_role: "workspace" | "image";
    },
    private readonly transport?: (eventId: string) => TransportObservation,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.bucket = inner.bucket;
  }
  private async call<T>(
    operation: StoreOperation,
    task: () => Promise<T>,
    supplied = 0,
    returned?: (value: T) => number,
  ): Promise<T> {
    const event: StorageOperationEvent = {
      schema_version: 1,
      event_id: randomUUID(),
      ...this.attribution,
      bucket: this.bucket,
      operation,
      started_at: this.now().toISOString(),
      finished_at: "",
      outcome: "unknown",
      error_category: null,
      supplied_payload_bytes: supplied,
      returned_payload_bytes: null,
      transport: unavailableTransport(),
    };
    try {
      const value = await task();
      event.outcome = "confirmed";
      event.returned_payload_bytes = returned ? returned(value) : null;
      return value;
    } catch (error) {
      event.error_category =
        error instanceof AgentError ? error.code : "unclassified";
      event.outcome =
        error instanceof AgentError &&
        ["not_found", "conflict", "permission", "configuration"].includes(
          error.code,
        )
          ? "failed_known"
          : "unknown";
      throw error;
    } finally {
      event.finished_at = this.now().toISOString();
      if (this.transport) {
        try {
          const observed = this.transport(event.event_id);
          for (const value of Object.values(observed)) nonnegative(value);
          event.transport = observed;
        } catch {
          /* Observability cannot authorize redoing a completed remote effect. */
        }
      }
      this.events.push(event);
    }
  }
  create(key: string, bytes: Uint8Array): Promise<void> {
    return this.call(
      "create",
      () => this.inner.create(key, bytes),
      bytes.length,
    );
  }
  read(key: string): Promise<Uint8Array> {
    return this.call(
      "read",
      () => this.inner.read(key),
      0,
      (value) => value.length,
    );
  }
  stat(key: string): Promise<ObjectMetadata> {
    return this.call("stat", () => this.inner.stat(key));
  }
  list(prefix: string, cursor?: string): Promise<ObjectPage> {
    return this.call("list", () => this.inner.list(prefix, cursor));
  }
  delete(key: string): Promise<void> {
    return this.call("delete", () => this.inner.delete(key));
  }
  configuration(): Promise<BucketConfiguration> {
    return this.call("configuration", () => this.inner.configuration());
  }
  observations(): StorageOperationEvent[] {
    return structuredClone(this.events);
  }
  snapshot(): StorageMetricsView {
    return summarizeStorageOperations(
      this.events,
      this.attribution,
      this.bucket,
    );
  }
}
export function summarizeStorageOperations(
  input: readonly StorageOperationEvent[],
  attribution: {
    run_id: string;
    execution_scope: ExecutionScope;
    storage_role: "workspace" | "image";
  },
  bucket: string,
): StorageMetricsView {
  const events = new Map<string, StorageOperationEvent>();
  for (const event of input) {
    if (
      event.run_id !== attribution.run_id ||
      event.execution_scope !== attribution.execution_scope ||
      event.storage_role !== attribution.storage_role ||
      event.bucket !== bucket
    )
      throw new AgentError("scope", "Mixed storage metric attribution");
    for (const number of Object.values(event.transport)) nonnegative(number);
    nonnegative(event.supplied_payload_bytes);
    nonnegative(event.returned_payload_bytes);
    const old = events.get(event.event_id);
    if (old && canonicalJson(old) !== canonicalJson(event))
      throw new AgentError("corrupt", "Storage metric replay changed");
    events.set(event.event_id, event);
  }
  const values = [...events.values()];
  const counter = (field: keyof TransportObservation) => {
    const known = values.filter((v) => v.transport[field] !== null);
    return {
      total:
        known.length === values.length
          ? known.reduce((n, v) => n + v.transport[field]!, 0)
          : null,
      known: known.length
        ? known.reduce((n, v) => n + v.transport[field]!, 0)
        : values.length
          ? null
          : 0,
    };
  };
  const requests = counter("service_requests"),
    sent = counter("wire_bytes_sent"),
    received = counter("wire_bytes_received");
  const by_operation = Object.fromEntries(
    operations.map((op) => [
      op,
      values.filter((v) => v.operation === op).length,
    ]),
  ) as Record<StoreOperation, number>;
  return {
    schema_version: 1,
    ...attribution,
    bucket,
    adapter_calls: values.length,
    by_operation,
    unknown_outcomes: values.filter((v) => v.outcome === "unknown").length,
    supplied_payload_bytes: values.reduce(
      (n, v) => n + v.supplied_payload_bytes,
      0,
    ),
    returned_payload_bytes: values.reduce(
      (n, v) => n + (v.returned_payload_bytes ?? 0),
      0,
    ),
    returned_payload_incomplete: values.some(
      (v) => v.returned_payload_bytes === null,
    ),
    service_requests: requests.total,
    known_service_requests: requests.known,
    wire_bytes_sent: sent.total,
    known_wire_bytes_sent: sent.known,
    wire_bytes_received: received.total,
    known_wire_bytes_received: received.known,
    observability: values.every((v) =>
      Object.values(v.transport).every((value) => value !== null),
    )
      ? "complete_transport"
      : values.some((v) =>
            Object.values(v.transport).some((value) => value !== null),
          )
        ? "partial_transport"
        : "adapter_only",
    money: {
      status: "unknown",
      amount_usd: null,
      basis: "supplier_bill_required",
    },
    through_event_id: values.at(-1)?.event_id ?? null,
  };
}
export type StorageObjectCategory =
  | "commits"
  | "manifests"
  | "referenced_blobs"
  | "orphan_blobs"
  | "unclassified_blobs"
  | "images"
  | "other";
export interface MetricsBinding {
  bucket: string;
  prefix: string;
  kind: "workspace" | "image";
  execution_scope: ExecutionScope | "shared";
}
export interface CapacityBreakdown {
  schema_version: 1;
  observed_at: string;
  complete: boolean;
  total_bytes: number;
  object_versions: number;
  unique_keys: number;
  historical_versions: number | null;
  additional_versions: number;
  references_complete: boolean;
  categories: Record<
    StorageObjectCategory,
    { bytes: number; object_versions: number }
  >;
  by_scope: Record<
    ExecutionScope | "shared",
    { bytes: number; object_versions: number }
  >;
  money: {
    status: "unknown";
    amount_usd: null;
    basis: "supplier_bill_required";
  };
}
export function storageObjectIdentity(
  object: Pick<InventoryObject, "bucket" | "key" | "version">,
): string {
  return canonicalJson([
    object.bucket,
    object.key,
    object.version === "null" || object.version === undefined
      ? null
      : object.version,
  ]);
}
/** Only complete inventory can prove totals. Reference completeness affects orphan classification independently. */
export function inventoryMetrics(input: {
  objects: readonly (InventoryObject & { is_latest?: boolean })[];
  complete: boolean;
  bindings: readonly MetricsBinding[];
  referenced_objects?: ReadonlySet<string>;
  references_complete: boolean;
  historical_versions_known?: boolean;
  observed_at?: string;
}): CapacityBreakdown {
  if (!input.complete)
    throw new AgentError(
      "unknown",
      "Cannot report complete capacity from partial inventory",
    );
  const unique = new Map<string, InventoryObject & { is_latest?: boolean }>();
  for (const object of input.objects) {
    nonnegative(object.size);
    const id = storageObjectIdentity(object);
    const old = unique.get(id);
    if (old && old.size !== object.size)
      throw new AgentError("corrupt", "Inventory version size changed");
    unique.set(id, object);
  }
  const categories = Object.fromEntries(
    [
      "commits",
      "manifests",
      "referenced_blobs",
      "orphan_blobs",
      "unclassified_blobs",
      "images",
      "other",
    ].map((category) => [category, { bytes: 0, object_versions: 0 }]),
  ) as CapacityBreakdown["categories"];
  const by_scope: CapacityBreakdown["by_scope"] = {
    production: { bytes: 0, object_versions: 0 },
    preview: { bytes: 0, object_versions: 0 },
    shared: { bytes: 0, object_versions: 0 },
  };
  const keys = new Set<string>();
  let total = 0;
  for (const [id, object] of unique) {
    const candidates = input.bindings
      .filter(
        (b) => b.bucket === object.bucket && object.key.startsWith(b.prefix),
      )
      .sort((a, b) => b.prefix.length - a.prefix.length);
    const binding = candidates[0];
    if (!binding)
      throw new AgentError(
        "configuration",
        "Inventory object outside declared managed bindings",
      );
    if (
      candidates[1]?.prefix === binding.prefix &&
      (candidates[1].kind !== binding.kind ||
        candidates[1].execution_scope !== binding.execution_scope)
    )
      throw new AgentError("scope", "Ambiguous metric scope binding");
    let category: StorageObjectCategory = "other";
    if (binding.kind === "image") category = "images";
    else if (object.key.includes("/commits/")) category = "commits";
    else if (object.key.includes("/manifests/")) category = "manifests";
    else if (object.key.includes("/blobs/"))
      category = input.references_complete
        ? input.referenced_objects?.has(id)
          ? "referenced_blobs"
          : "orphan_blobs"
        : "unclassified_blobs";
    categories[category].bytes += object.size;
    categories[category].object_versions++;
    by_scope[binding.execution_scope].bytes += object.size;
    by_scope[binding.execution_scope].object_versions++;
    keys.add(canonicalJson([object.bucket, object.key]));
    total += object.size;
  }
  if (!Number.isSafeInteger(total))
    throw new AgentError("corrupt", "Capacity breakdown overflow");
  return {
    schema_version: 1,
    observed_at: input.observed_at ?? new Date().toISOString(),
    complete: true,
    total_bytes: total,
    object_versions: unique.size,
    unique_keys: keys.size,
    historical_versions:
      input.historical_versions_known &&
      [...unique.values()].every(
        (object) => typeof object.is_latest === "boolean",
      )
        ? [...unique.values()].filter((object) => object.is_latest === false)
            .length
        : null,
    additional_versions: unique.size - keys.size,
    references_complete: input.references_complete,
    categories,
    by_scope,
    money: {
      status: "unknown",
      amount_usd: null,
      basis: "supplier_bill_required",
    },
  };
}
