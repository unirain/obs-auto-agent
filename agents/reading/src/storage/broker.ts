import {
  AgentError,
  sha256,
  type CommitRecord,
  type WorkspaceManifest,
} from "../contracts/index.js";
import { OssObjectStore, type OssStoreOptions } from "./oss.js";
import { listAll, preflight } from "./preflight.js";
import type { InventoryObject } from "./inventory.js";
import type { StorageReservation } from "./capacity.js";
import {
  decode,
  assertBytes,
  validateCommit,
  validateManifest,
} from "../workspace/manifest.js";
import type { Deployment } from "../config/deployment.js";
export interface ManagedBinding {
  kind: "workspace" | "image";
  scope: "production" | "preview" | "integration" | "images";
  bucket: string;
  region: string;
  endpoint: string;
  prefix: string;
}
export interface BrokerInventory {
  complete: boolean;
  objects: InventoryObject[];
  reservations: StorageReservation[];
}
/** This broker reads control chains and reservation state only. The preview receives summaries, never this adapter. */
export function capacityBrokerFromEnvironment(
  env: NodeJS.ProcessEnv,
  deployment: Deployment,
): () => Promise<BrokerInventory> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(env.READING_CAPACITY_VIEW_CREDENTIALS ?? "");
  } catch {
    throw new Error("capacity_broker_credentials_unconfigured");
  }
  if (
    typeof raw.accessKeyId !== "string" ||
    typeof raw.accessKeySecret !== "string"
  )
    throw new Error("capacity_broker_credentials_invalid");
  let bindings: ManagedBinding[];
  try {
    bindings = (
      env.READING_MANAGED_STORAGE_PREFIXES
        ? JSON.parse(env.READING_MANAGED_STORAGE_PREFIXES)
        : raw.bindings
    ) as ManagedBinding[];
  } catch {
    throw new Error("capacity_managed_bindings_invalid");
  }
  if (!Array.isArray(bindings) || !bindings.length)
    throw new Error("capacity_managed_bindings_required");
  for (const b of bindings) {
    if (
      !["workspace", "image"].includes(b.kind) ||
      !["production", "preview", "integration", "images"].includes(b.scope) ||
      !b.prefix?.endsWith("/") ||
      b.prefix.startsWith("/") ||
      b.prefix.includes("..") ||
      b.prefix.includes("\\") ||
      !/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(b.endpoint) ||
      b.endpoint.includes("-internal.") ||
      b.endpoint !== `${b.region}.aliyuncs.com`
    )
      throw new Error("capacity_managed_binding_invalid");
  }
  if (
    !bindings.some((b) => b.kind === "workspace" && b.scope === "production") ||
    !bindings.some((b) => b.kind === "workspace" && b.scope === "preview")
  )
    throw new Error("capacity_all_workspace_scopes_required");
  if (
    !bindings.some((b) => b.kind === "image") &&
    raw.image_inventory !== "none_managed_verified"
  )
    throw new Error("capacity_image_inventory_required");
  if (
    !bindings.some(
      (b) =>
        b.kind === "workspace" &&
        b.bucket === deployment.workspace.bucket &&
        deployment.workspace.prefix.startsWith(b.prefix),
    )
  )
    throw new Error("capacity_current_workspace_not_managed");
  if (
    deployment.image &&
    !bindings.some(
      (b) =>
        b.kind === "image" &&
        b.bucket === deployment.image!.bucket &&
        deployment.image!.prefix.startsWith(b.prefix),
    )
  )
    throw new Error("capacity_current_image_not_managed");
  const credentials = {
    accessKeyId: raw.accessKeyId,
    accessKeySecret: raw.accessKeySecret,
    ...(typeof raw.stsToken === "string" ? { stsToken: raw.stsToken } : {}),
  };
  const stores = bindings.map((b) => ({
    binding: b,
    store: new OssObjectStore({
      ...b,
      ...credentials,
      allowed_prefix: b.prefix,
    }),
  }));
  return async () => {
    const objects: InventoryObject[] = [];
    const reservations: StorageReservation[] = [];
    for (const { binding: b, store } of stores) {
      if (b.kind === "image") {
        objects.push(...(await store.inventoryVersions(b.prefix)));
        continue;
      }
      await preflight(store);
      const entries = await listAll(store, b.prefix);
      objects.push(...entries.map((o) => ({ ...o, bucket: b.bucket })));
      const groups = new Map<string, string[]>();
      for (const o of entries) {
        const index = o.key.indexOf("/commits/");
        if (index < 0) continue;
        const prefix = o.key.slice(0, index + 1);
        const keys = groups.get(prefix) ?? [];
        keys.push(o.key);
        groups.set(prefix, keys);
      }
      for (const [prefix, keys] of groups) {
        keys.sort();
        let priorKey: string | null = null;
        let priorHash: string | null = null;
        let head: CommitRecord | null = null;
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i]!;
          if (
            key !==
            `${prefix}commits/${BigInt(i).toString().padStart(20, "0")}.json`
          )
            throw new AgentError("corrupt", "Capacity commit chain gap");
          const bytes = await store.read(key);
          const c = decode<CommitRecord>(bytes, "checkpoint");
          validateCommit(c);
          if (
            c.parent_commit_key !== priorKey ||
            c.parent_commit_sha256 !== priorHash ||
            c.manifest_key !== `${prefix}manifests/${c.revision}.json` ||
            (head &&
              (head.workspace_id !== c.workspace_id ||
                head.execution_scope !== c.execution_scope))
          )
            throw new AgentError("corrupt", "Capacity chain identity mismatch");
          priorKey = key;
          priorHash = sha256(bytes);
          head = c;
        }
        if (!head) throw new AgentError("corrupt", "Capacity HEAD unavailable");
        const manifestBytes = await store.read(head.manifest_key);
        assertBytes(manifestBytes, head.manifest_sha256);
        const manifest = decode<WorkspaceManifest>(manifestBytes, "workspace");
        validateManifest(manifest);
        if (
          manifest.workspace_id !== head.workspace_id ||
          manifest.execution_scope !== head.execution_scope ||
          manifest.revision !== head.revision
        )
          throw new AgentError(
            "corrupt",
            "Capacity manifest identity mismatch",
          );
        for (const f of manifest.files.filter(
          (f) =>
            f.role === "control" &&
            f.path.startsWith("state/storage/reservations/") &&
            f.path.endsWith(".json"),
        )) {
          const bytes = await store.read(`${prefix}blobs/${f.sha256}`);
          assertBytes(bytes, f.sha256, f.size);
          let reservation: StorageReservation;
          try {
            reservation = JSON.parse(
              Buffer.from(bytes).toString("utf8"),
            ) as StorageReservation;
          } catch {
            throw new AgentError("corrupt", "Capacity reservation invalid");
          }
          if (
            reservation.execution_scope !== head.execution_scope ||
            !Number.isSafeInteger(reservation.expected_bytes) ||
            reservation.expected_bytes < 0 ||
            !["pending", "confirmed", "released"].includes(reservation.state) ||
            typeof reservation.reservation_id !== "string" ||
            typeof reservation.key !== "string" ||
            typeof reservation.bucket !== "string"
          )
            throw new AgentError("corrupt", "Capacity reservation invalid");
          reservations.push(reservation);
        }
      }
    }
    const unique = new Map(
      objects.map((o) => [
        JSON.stringify([o.bucket, o.key, o.version ?? null]),
        o,
      ]),
    );
    return { complete: true, objects: [...unique.values()], reservations };
  };
}
