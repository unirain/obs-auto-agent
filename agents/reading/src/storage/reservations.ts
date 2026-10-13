import {
  AgentError,
  canonicalJson,
  type WorkspaceManager,
  type WorkspaceHandle,
  type JsonValue,
  type ObjectStore,
} from "../contracts/index.js";
import { encode } from "../workspace/manifest.js";
import { assertCapacity, type StorageReservation } from "./capacity.js";
import type { StorageCapacityView } from "../contracts/index.js";
export async function reserve(
  manager: WorkspaceManager,
  handle: WorkspaceHandle,
  reservation: StorageReservation,
  view: StorageCapacityView,
  runId: string,
) {
  if (
    reservation.execution_scope !== handle.execution_scope ||
    reservation.state !== "pending"
  )
    throw new AgentError("scope", "Invalid reservation scope");
  const key = `storage/reservations/${reservation.reservation_id}`;
  const existing = handle.records[key];
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(reservation))
      throw new AgentError("conflict", "Reservation identity reused");
    return { status: "committed" as const, handle, snapshot: handle.snapshot };
  }
  /* Includes a conservative envelope bound; maximum path count ties this to admitted bytes. */ const overhead =
    encode(reservation).length +
    65536 +
    handle.snapshot.manifest.files.length * 2048;
  assertCapacity(view, reservation.expected_bytes + overhead, "generation");
  return manager.checkpoint(handle, {
    expected_revision: handle.revision,
    reason: "storage_reserved",
    run_id: runId,
    records: { [key]: reservation as unknown as JsonValue },
  });
}
export async function reconcileReservation(
  store: ObjectStore,
  reservation: StorageReservation,
): Promise<StorageReservation> {
  try {
    const found = await store.stat(reservation.key);
    if (found.size !== reservation.expected_bytes)
      throw new AgentError("corrupt", "Reserved object size mismatch");
    return {
      ...reservation,
      version: found.version ?? null,
      state: "confirmed",
    };
  } catch (e) {
    if (e instanceof AgentError && e.code === "not_found") return reservation;
    throw e;
  }
}
export async function releaseUnwrittenReservation(
  store: ObjectStore,
  reservation: StorageReservation,
): Promise<StorageReservation> {
  try {
    await store.stat(reservation.key);
    throw new AgentError("conflict", "Written reservation cannot be released");
  } catch (e) {
    if (e instanceof AgentError && e.code === "not_found")
      return { ...reservation, state: "released" };
    throw e;
  }
}
