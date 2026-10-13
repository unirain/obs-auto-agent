import {
  AgentError,
  type ExecutionScope,
  type StorageCapacityView,
} from "../contracts/index.js";
import { normalizeInventory, type InventoryObject } from "./inventory.js";
import { validateSchema } from "../contracts/schema.js";
export const STORAGE_LIMIT = 50_000_000_000;
export const STORAGE_WARNING = 45_000_000_000;
export const STORAGE_GENERATION_STOP = 49_000_000_000;
export interface StorageReservation {
  schema_version: 1;
  reservation_id: string;
  execution_scope: ExecutionScope;
  bucket: string;
  key: string;
  version: string | null;
  expected_bytes: number;
  state: "pending" | "confirmed" | "released";
}
/** Versioned control envelope; no implicit migration or defaulting. */
export function parseStorageReservation(value: unknown): StorageReservation {
  return validateSchema<StorageReservation>("storage_reservation", value);
}
export function capacityView(
  objects: InventoryObject[],
  reservations: StorageReservation[],
  observedAt = new Date().toISOString(),
): StorageCapacityView {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new AgentError("corrupt", "Capacity observation timestamp invalid");
  objects = normalizeInventory(objects);
  const occupied = objects.reduce((n, o) => n + o.size, 0);
  const normalizeVersion = (v: string | null | undefined) =>
    v === undefined || v === null || v === "null" ? null : v;
  const keys = new Map(
    objects.map((o) => [
      JSON.stringify([o.bucket, o.key, normalizeVersion(o.version)]),
      o,
    ]),
  );
  const ids = new Set<string>();
  let pending = 0;
  for (const r of reservations) {
    parseStorageReservation(r);
    const id = JSON.stringify([
      r.bucket,
      r.key,
      normalizeVersion(r.version),
      r.execution_scope,
      r.reservation_id,
    ]);
    if (ids.has(id))
      throw new AgentError("corrupt", "Duplicate reservation identity");
    ids.add(id);
    if (!Number.isSafeInteger(r.expected_bytes) || r.expected_bytes < 0)
      throw new AgentError("corrupt", "Reservation size invalid");
    const found =
      keys.get(
        JSON.stringify([r.bucket, r.key, normalizeVersion(r.version)]),
      ) ??
      (r.state === "pending" && normalizeVersion(r.version) === null
        ? objects.find(
            (o) =>
              o.bucket === r.bucket &&
              o.key === r.key &&
              o.size === r.expected_bytes,
          )
        : undefined);
    if (found && found.size !== r.expected_bytes)
      throw new AgentError("corrupt", "Reserved object size mismatch");
    if (r.state === "pending" && !found) pending += r.expected_bytes;
    if (r.state === "confirmed" && !found)
      throw new AgentError(
        "unknown",
        "Confirmed resource absent from inventory",
      );
  }
  if (!Number.isSafeInteger(occupied + pending))
    throw new AgentError("corrupt", "Capacity numeric overflow");
  return {
    verified: true,
    observed_at: observedAt,
    occupied_bytes: occupied,
    reserved_bytes: pending,
    limit_bytes: STORAGE_LIMIT,
    warning: occupied + pending >= STORAGE_WARNING,
    accepts_generation: occupied + pending < STORAGE_GENERATION_STOP,
  };
}
export function assertCapacity(
  view: StorageCapacityView,
  additionalBytes: number,
  kind: "control" | "generation",
): void {
  validateSchema("storage", view);
  if (
    !view.verified ||
    view.limit_bytes !== STORAGE_LIMIT ||
    !Number.isSafeInteger(view.occupied_bytes) ||
    !Number.isSafeInteger(view.reserved_bytes) ||
    !Number.isFinite(Date.parse(view.observed_at)) ||
    !Number.isSafeInteger(additionalBytes) ||
    additionalBytes < 0
  )
    throw new AgentError("unknown", "Capacity cannot be verified");
  const total = view.occupied_bytes + view.reserved_bytes + additionalBytes;
  if (!Number.isSafeInteger(total))
    throw new AgentError("corrupt", "Capacity numeric overflow");
  if (
    total > view.limit_bytes ||
    (kind === "generation" && total >= STORAGE_GENERATION_STOP)
  )
    throw new AgentError("capacity", "Shared managed capacity insufficient");
}
