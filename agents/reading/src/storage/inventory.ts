import {
  AgentError,
  type ObjectStore,
  type ObjectMetadata,
} from "../contracts/index.js";
import { listAll } from "./preflight.js";
export interface InventoryObject extends ObjectMetadata {
  bucket: string;
}
export interface InventoryProvider {
  inventory(): Promise<{ complete: boolean; objects: InventoryObject[] }>;
}
/** One physical object/version counts once, including OSS's legacy literal null version. */
export function normalizeInventory(
  entries: InventoryObject[],
): InventoryObject[] {
  const unique = new Map<string, InventoryObject>();
  for (const o of entries) {
    if (
      !o ||
      typeof o.bucket !== "string" ||
      !o.bucket ||
      typeof o.key !== "string" ||
      !o.key ||
      !Number.isSafeInteger(o.size) ||
      o.size < 0 ||
      typeof o.created_at !== "string" ||
      !Number.isFinite(Date.parse(o.created_at)) ||
      (o.version !== undefined &&
        o.version !== null &&
        (typeof o.version !== "string" || !o.version))
    )
      throw new AgentError("corrupt", "Inventory metadata invalid");
    const { version, ...metadata } = o;
    const normalized: InventoryObject =
      version === undefined || version === null || version === "null"
        ? metadata
        : { ...metadata, version };
    const key = JSON.stringify([o.bucket, o.key, normalized.version ?? null]);
    const previous = unique.get(key);
    if (previous && previous.size !== o.size)
      throw new AgentError("corrupt", "Inventory object size changed");
    unique.set(key, normalized);
  }
  return [...unique.values()];
}
export async function managedInventory(
  stores: { store: ObjectStore; prefix: string }[],
  providers: InventoryProvider[] = [],
): Promise<InventoryObject[]> {
  const entries: InventoryObject[] = [];
  for (const { store, prefix } of stores) {
    for (const o of await listAll(store, prefix))
      entries.push({ ...o, bucket: store.bucket });
  }
  for (const p of providers) {
    const result = await p.inventory();
    if (!result.complete)
      throw new AgentError("unknown", "Managed inventory incomplete");
    entries.push(...result.objects);
  }
  return normalizeInventory(entries);
}
