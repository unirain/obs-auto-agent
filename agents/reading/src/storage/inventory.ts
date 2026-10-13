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
  const unique = new Map<string, InventoryObject>();
  for (const o of entries) {
    if (!Number.isSafeInteger(o.size) || o.size < 0)
      throw new AgentError("corrupt", "Inventory size invalid");
    const key = JSON.stringify([o.bucket, o.key, o.version ?? null]);
    const previous = unique.get(key);
    if (previous && previous.size !== o.size)
      throw new AgentError("corrupt", "Inventory object size changed");
    unique.set(key, o);
  }
  return [...unique.values()];
}
