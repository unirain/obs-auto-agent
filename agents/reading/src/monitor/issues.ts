import { createHash } from "node:crypto";
import { Octokit } from "@octokit/rest";
import type { MonitorMetadata } from "./source-health.js";
export interface IssueFact {
  number: number;
  body: string;
  state: "open" | "closed";
}
export interface IssuePort {
  list(): Promise<IssueFact[]>;
  create(title: string, body: string): Promise<IssueFact>;
  update(number: number, body: string, state: "open" | "closed"): Promise<void>;
  comments(number: number): Promise<string[]>;
  comment(number: number, body: string): Promise<void>;
}
export const marker = (key: string): string =>
  `<!-- reading-monitor:${createHash("sha256").update(key).digest("hex")} -->`;
const metadataRE = /<!-- reading-monitor-metadata:([A-Za-z0-9+/=]+) -->/;
export function decodeMetadata(body: string): MonitorMetadata | undefined {
  const match = metadataRE.exec(body);
  if (!match) return undefined;
  let m: MonitorMetadata;
  try {
    m = JSON.parse(
      Buffer.from(match[1]!, "base64").toString("utf8"),
    ) as MonitorMetadata;
  } catch {
    throw new Error("Invalid Issue monitoring metadata");
  }
  if (
    m.schema_version !== 1 ||
    typeof m.key !== "string" ||
    !Number.isSafeInteger(m.last_position) ||
    !["active", "recovered", "accepted_gap"].includes(m.status) ||
    typeof m.suppressed !== "boolean" ||
    !Array.isArray(m.events) ||
    !Array.isArray(m.unresolved_gaps)
  )
    throw new Error("Invalid Issue monitoring metadata");
  if (!body.includes(marker(m.key))) throw new Error("Issue marker mismatch");
  return m;
}
function machineBody(metadata: MonitorMetadata): string {
  return `${marker(metadata.key)}\n<!-- reading-monitor-metadata:${Buffer.from(JSON.stringify(metadata)).toString("base64")} -->\n\n来源：${metadata.source_id}\n原因：${metadata.reason_code}\n状态：${metadata.status}${metadata.suppressed ? "（策略抑制）" : ""}\n未解决覆盖缺口：${metadata.unresolved_gaps.join(", ") || "无"}\n事件范围：${metadata.event_summary ? `${metadata.event_summary.first_at} — ${metadata.event_summary.last_at} (${metadata.event_summary.total})` : "无"}\n\n<!-- reading-monitor-end -->`;
}
export function issueBody(
  metadata: MonitorMetadata,
  existing?: string,
): string {
  const human =
    existing?.split("<!-- reading-monitor-end -->")[1] ??
    "\n\n本 Issue 记录运行事实；普通评论不会执行控制命令。";
  return machineBody(metadata) + human;
}
export class IssueProjector {
  constructor(
    private port: IssuePort,
    private beforeWrite: () => Promise<void>,
  ) {}
  async current(
    key: string,
  ): Promise<{ issue: IssueFact; metadata: MonitorMetadata } | undefined> {
    const found = (await this.port.list()).filter((i) =>
      i.body.includes(marker(key)),
    );
    if (found.length > 1)
      throw new Error(
        "Duplicate monitoring Issues require human reconciliation",
      );
    if (!found[0]) return undefined;
    const metadata = decodeMetadata(found[0].body);
    if (!metadata || metadata.key !== key) throw new Error("Issue marker without matching metadata");
    return { issue: found[0], metadata };
  }
  async apply(metadata: MonitorMetadata, notify: boolean): Promise<void> {
    // Issue is the durable cursor. Read back every time, including after a lost write response.
    let existing = await this.current(metadata.key);
    if (existing && existing.metadata.last_position > metadata.last_position)
      throw new Error("Stale monitor projection");
    if (!existing) {
      await this.beforeWrite();
      await this.port.create(
        `Reading Agent: ${metadata.source_id} / ${metadata.reason_code}`,
        issueBody(metadata),
      );
      existing = await this.current(metadata.key);
      if (!existing) throw new Error("Issue creation result unknown");
      if (metadata.status !== "active") {
        await this.beforeWrite();
        await this.port.update(
          existing.issue.number,
          issueBody(metadata, existing.issue.body),
          "closed",
        );
      }
      return;
    }
    if (notify) {
      const notificationMarker = `<!-- reading-monitor-notice:${createHash("sha256").update(`${metadata.key}:${metadata.last_position}`).digest("hex")} -->`;
      const comments = await this.port.comments(existing.issue.number);
      if (!comments.some((c) => c.includes(notificationMarker))) {
        const events = metadata.events.filter(
          (e) => e.position > existing!.metadata.last_position,
        );
        await this.beforeWrite();
        await this.port.comment(
          existing.issue.number,
          `${notificationMarker}\n${events.map((e) => `${e.occurred_at}: ${e.kind}`).join("\n")}\n当前状态：${metadata.status}`,
        );
      }
    }
    await this.beforeWrite();
    await this.port.update(
      existing.issue.number,
      issueBody(metadata, existing.issue.body),
      metadata.status === "active" ? "open" : "closed",
    );
    const readback = await this.current(metadata.key);
    if (!readback || readback.metadata.last_position !== metadata.last_position)
      throw new Error("Issue update result unknown; cursor not confirmed");
  }
}
export class OctokitIssuePort implements IssuePort {
  private owner: string;
  private repo: string;
  constructor(
    private client: Octokit,
    repository: string,
  ) {
    const p = repository.split("/");
    if (p.length !== 2 || !p.every((x) => /^[\w.-]+$/.test(x)))
      throw new Error("Invalid implementation repository");
    this.owner = p[0]!;
    this.repo = p[1]!;
  }
  private args(): { owner: string; repo: string } {
    return { owner: this.owner, repo: this.repo };
  }
  async list(): Promise<IssueFact[]> {
    return (
      await this.client.paginate(this.client.issues.listForRepo, {
        ...this.args(),
        state: "all",
        per_page: 100,
      })
    )
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        body: i.body ?? "",
        state: i.state === "closed" ? "closed" : "open",
      }));
  }
  async create(title: string, body: string): Promise<IssueFact> {
    const i = (await this.client.issues.create({ ...this.args(), title, body }))
      .data;
    return { number: i.number, body: i.body ?? "", state: "open" };
  }
  async update(
    number: number,
    body: string,
    state: "open" | "closed",
  ): Promise<void> {
    await this.client.issues.update({
      ...this.args(),
      issue_number: number,
      body,
      state,
    });
  }
  async comments(number: number): Promise<string[]> {
    return (
      await this.client.paginate(this.client.issues.listComments, {
        ...this.args(),
        issue_number: number,
        per_page: 100,
      })
    ).map((c) => c.body ?? "");
  }
  async comment(number: number, body: string): Promise<void> {
    await this.client.issues.createComment({
      ...this.args(),
      issue_number: number,
      body,
    });
  }
}
