import type {
  DeliveryRecord,
  GitHubPort,
  OperationsJournal,
  PermissionCheck,
  SealedDelivery,
} from "./types.js";
import { branchFor, writePolicyReceipt } from "./types.js";
import { validateDelivery, validatePreparedFiles } from "./validate.js";
import { reconcileRecord } from "./reconcile.js";
import { recoveryRoute, assertRefreshAllowed } from "./recovery.js";
import { runtimeHours } from "../config/runtime-limits.js";
import { isUtcInstant } from "../contracts/utc.js";
import { parseDeliveryRecord, parseStoredDelivery } from "./contracts.js";
export interface PublisherOptions {
  content_validator?: (bytes:Uint8Array)=>void;
  workspace_id: string;
  committedRevision: () => Promise<string>;
  /** Must compare the sealed manifest against the restored committed snapshot. */
  verifyCommittedDelivery: (delivery: SealedDelivery) => Promise<void>;
  classificationCurrent: (delivery: SealedDelivery) => Promise<boolean>;
  identity: { name: string; email: string };
  now?: () => Date;
  sources_freshness_hours?: number;
}
export class Publisher {
  private now: () => Date;
  constructor(
    private github: GitHubPort,
    private journal: OperationsJournal,
    private permission: PermissionCheck,
    private options: PublisherOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    runtimeHours(
      options.sources_freshness_hours ?? 24,
      "sources_freshness_hours",
    );
  }
  private key(id: string): string {
    return `delivery-${id}`;
  }
  async history(projectId: string): Promise<DeliveryRecord[]> {
    const ids =
      (await this.journal.load<string[]>(`delivery-project-${projectId}`)) ??
      [];
    const records: DeliveryRecord[] = [];
    for (const id of ids) {
      const record = await this.journal.load<DeliveryRecord>(this.key(id));
      if (!record) throw new Error("Missing persisted historical delivery");
      if (record.schema_version !== 1)
        throw new Error("Unsupported delivery record schema");
      parseDeliveryRecord(record);
      if (record.project_id !== projectId || record.delivery_id !== id)
        throw new Error("Historical delivery identity mismatch");
      records.push(record);
    }
    return records;
  }
  private async save(r: DeliveryRecord): Promise<void> {
    parseDeliveryRecord(r);
    await this.journal.commit(this.key(r.delivery_id), r);
  }
  async reconcile(delivery: SealedDelivery): Promise<DeliveryRecord[]> {
    const records = await this.history(delivery.project_id);
    for (const record of records) {
      const encoded = await this.journal.load<StoredDelivery>(
        `sealed-${record.delivery_id}`,
      );
      const historical = encoded ? decodeDelivery(encoded) : undefined;
      if (!historical) throw new Error("Missing sealed historical manifest");
      try {
        const fact = await this.github.inspect(
          historical,
          record.prepared ?? undefined,
        );
        await this.save(
          reconcileRecord(record, fact, this.now().toISOString()),
        );
      } catch (error) {
        await this.save({
          ...record,
          status: "publishing",
          uncertain_action: record.uncertain_action ?? "reconcile",
          reason: "GitHub read unavailable",
          updated_at: this.now().toISOString(),
        });
        throw error;
      }
    }
    return this.history(delivery.project_id);
  }
  /** Called only after trusted source verification confirms unchanged content. No model or remote mutation. */
  async refreshVerified(
    previous: SealedDelivery,
    refresh: {
      delivery_id: string;
      workspace_revision: string;
      sources_verified_at: string;
    },
  ): Promise<SealedDelivery> {
    if (
      refresh.delivery_id === previous.delivery_id ||
      !/^[a-zA-Z0-9_-]+$/.test(refresh.delivery_id) ||
      !isUtcInstant(refresh.sources_verified_at)
    )
      throw new Error("Invalid immutable delivery refresh");
    const records = await this.reconcile(previous);
    assertRefreshAllowed(records);
    const old = records.find((r) => r.delivery_id === previous.delivery_id);
    if (!old) throw new Error("Cannot refresh an untracked delivery");
    const next: SealedDelivery = {
      ...previous,
      delivery_id: refresh.delivery_id,
      workspace_revision: refresh.workspace_revision,
      sources_verified_at: refresh.sources_verified_at,
    };
    validateDelivery(next, {
      id: this.options.workspace_id,
      revision: await this.options.committedRevision(),
    },this.options.content_validator);
    await this.options.verifyCommittedDelivery(next);
    const record: DeliveryRecord = {
      ...old,
      delivery_id: next.delivery_id,
      status: "publishing",
      pr: null,
      uncertain_action: null,
      reason: null,
      updated_at: this.now().toISOString(),
    };
    delete record.superseded_by;
    if (!this.journal.commitMany)
      throw new Error("Atomic refresh checkpoint capability missing");
    await this.journal.commitMany(
      {
        [`sealed-${next.delivery_id}`]: encodeDelivery(next),
        [this.key(next.delivery_id)]: record,
        [`delivery-project-${next.project_id}`]: [
          ...records.map((r) => r.delivery_id),
          next.delivery_id,
        ],
        [this.key(old.delivery_id)]: {
          ...old,
          status: "superseded",
          superseded_by: next.delivery_id,
          updated_at: this.now().toISOString(),
        },
      },
      "delivery_refreshed_unchanged_sources",
    );
    return next;
  }
  async publish(
    d: SealedDelivery,
    mode: "scheduled" | "resume" | "publish-only" = "scheduled",
  ): Promise<DeliveryRecord> {
    validateDelivery(d, {
      id: this.options.workspace_id,
      revision: await this.options.committedRevision(),
    },this.options.content_validator);
    await this.options.verifyCommittedDelivery(d);
    let records = await this.reconcile(d);
    let record = records.find((r) => r.delivery_id === d.delivery_id);
    if (record?.superseded_by) {
      const stored = await this.journal.load<StoredDelivery>(
        `sealed-${record.superseded_by}`,
      );
      if (!stored) throw new Error("Superseded delivery successor missing");
      return this.publish(decodeDelivery(stored), mode);
    }
    const existingPR = records.find(
      (r) =>
        r.pr ||
        ["awaiting_review", "closed_unmerged", "merged"].includes(r.status),
    );
    if (existingPR) return existingPR; // Read-only facts remain available even if current policy cannot be read.
    if (!record) {
      const ids = records.map((r) => r.delivery_id);
      // Local writes are checkpoints too. Both indexes commit before any external mutation.
      await this.journal.commit(`sealed-${d.delivery_id}`, encodeDelivery(d));
      record = {
        schema_version: 1,
        delivery_id: d.delivery_id,
        project_id: d.project_id,
        generation_version: d.generation_version,
        branch: branchFor(d),
        status: "publishing",
        prepared: null,
        pr: null,
        uncertain_action: null,
        reason: null,
        updated_at: this.now().toISOString(),
      };
      await this.save(record);
      await this.journal.commit(`delivery-project-${d.project_id}`, [
        ...ids,
        d.delivery_id,
      ]);
      records = await this.reconcile(d);
      record = records.find((r) => r.delivery_id === d.delivery_id)!;
    }
    const confirmedPR = records.find(
      (r) =>
        r.pr ||
        ["awaiting_review", "closed_unmerged", "merged"].includes(r.status),
    );
    if (confirmedPR) return confirmedPR;
    const current = await this.options.classificationCurrent(d);
    const route = recoveryRoute(
      d,
      records,
      current,
      this.now(),
      mode,
      this.options.sources_freshness_hours ?? 24,
    );
    if (route.route !== "publish") {
      if (
        ["resume_source_verification", "resume_classification"].includes(
          route.route,
        )
      ) {
        record = { ...record, status: "needs_resume", reason: route.reason };
        await this.save(record);
      }
      return record;
    }
    try {
      await this.permission("github_write", d.project_id);
    } catch {
      record = {
        ...record,
        status: "policy_blocked",
        reason: "current_policy_denied",
      };
      await this.save(record);
      return record;
    }
    if (!record.prepared) {
      const prepared = await this.github.prepare(d, {
        ...this.options.identity,
        date: this.now().toISOString(),
      });
      record = { ...record, prepared, updated_at: this.now().toISOString() };
      await this.save(record); // Expected commit SHA is authoritative before the first remote write.
    }
    const before = async (action: string): Promise<void> => {
      const policy = writePolicyReceipt(
        action,
        await this.permission("github_write", d.project_id),
        this.now().toISOString(),
      );
      record = {
        ...record!,
        policy_checks: [...(record!.policy_checks ?? []), policy],
        status: "publishing",
        uncertain_action: action,
        updated_at: this.now().toISOString(),
      };
      await this.save(record);
    };
    const prepared = record.prepared;
    if (!prepared) throw new Error("Missing committed commit preparation");
    validatePreparedFiles(d, prepared);
    try {
      let facts = await this.github.inspect(d, prepared);
      const reconciled = reconcileRecord(
        record,
        facts,
        this.now().toISOString(),
      );
      if (reconciled.status !== "publishing") {
        await this.save(reconciled);
        return reconciled;
      }
      if (!facts.expected_commit_exists)
        await this.github.materialize(prepared, () => before("git_object"));
      facts = await this.github.inspect(d, prepared);
      if (!facts.expected_commit_exists || !facts.complete_diff_matches)
        throw new Error("Expected commit/full diff not confirmed");
      if (facts.branch_sha === null) {
        await before("create_branch");
        await this.github.createBranch(record.branch, prepared.commit_sha);
      }
      // Recheck every historical generation after object/branch creation. Human PRs block new delivery.
      records = await this.reconcile(d);
      const remoteRecord = records.find(
        (r) => r.delivery_id === d.delivery_id,
      )!;
      if (
        remoteRecord.status !== "publishing" ||
        records.some(
          (r) =>
            r.delivery_id !== d.delivery_id &&
            (r.pr || r.status === "delivery_conflict"),
        )
      )
        return remoteRecord;
      await before("create_pr");
      const pr = await this.github.createPR(
        record.branch,
        `阅读笔记：${d.project_id}`,
        prBody(d),
      );
      record = {
        ...record,
        pr,
        status: pr.state === "open" ? "awaiting_review" : pr.state,
        uncertain_action: null,
        reason: null,
        updated_at: this.now().toISOString(),
      };
      await this.save(record);
      return record;
    } catch (error) {
      // A failed journal commit must never lead to another remote action. Next run reads GitHub.
      throw error;
    }
  }
}
export function prBody(d: SealedDelivery): string {
  return [
    `<!-- reading-delivery:${d.delivery_id} project:${d.project_id} -->`,
    `来源：${d.sources.join("、")}`,
    `收录理由：${d.rationale}`,
    `知识增量：${d.knowledge_increment}`,
    `文件：\n${d.files.map((f) => `- ${f.path} (${f.sha256})`).join("\n")}`,
    `证据缺口：${d.gaps.join("；") || "无"}`,
    `配图降级：${d.image_degradations.join("；") || "无"}`,
    `校验：${JSON.stringify(d.quality_report)}`,
    `模型费用：${d.usage.estimated_usd === null ? "未知" : `$${d.usage.estimated_usd}`} (${d.usage.status})`,
    `警告：${d.warnings.join("；") || "无"}`,
    "请由知识库所有者审阅后合并。",
  ].join("\n\n");
}

type StoredDelivery = Omit<SealedDelivery, "files"> & {
  files: (Omit<SealedDelivery["files"][number], "content"> & {
    content_base64: string;
  })[];
};
function encodeDelivery(d: SealedDelivery): StoredDelivery {
  const encoded = {
    ...d,
    files: d.files.map(({ content, ...f }) => ({
      ...f,
      content_base64: Buffer.from(content).toString("base64"),
    })),
  };
  parseStoredDelivery(encoded);
  return encoded;
}
function decodeDelivery(d: StoredDelivery): SealedDelivery {
  parseStoredDelivery(d);
  return {
    ...d,
    files: d.files.map(({ content_base64, ...f }) => ({
      ...f,
      content: Buffer.from(content_base64, "base64"),
    })),
  };
}
