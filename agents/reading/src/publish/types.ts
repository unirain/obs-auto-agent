/** Operations state is persisted by the host using committed WorkspaceManager checkpoints. */
export interface OperationsJournal {
  load<T>(key: string): Promise<T | undefined>;
  commit<T>(key: string, value: T): Promise<void>;
  commitMany?(records: Record<string, unknown>, reason: string): Promise<void>;
}
export type WriteCapability =
  | "upload_resource"
  | "github_write"
  | "issue_write";
export interface PolicyEvidence {
  check_id: string;
  policy_commit: string | null;
  policy_hash: string | null;
  checked_at: string;
  execution_permission?: "allowed" | "denied" | "unavailable";
}
export interface WritePolicyReceipt {
  action: string;
  evidence: PolicyEvidence | null;
  status: "verified" | "legacy_unverified";
  checked_at: string;
}
export type PermissionCheck = (
  capability: WriteCapability,
  projectId?: string,
) => Promise<void | PolicyEvidence>;
export interface ResourceReceipt {
  object_key: string;
  sha256: string;
  bytes: number;
  mime: string;
  url: string;
  project_id: string;
  version_id: string | null;
  confirmed_at: string;
}
export interface DeliveryFile {
  path: string;
  role: "note" | "diagram_source";
  mime: string;
  bytes: number;
  sha256: string;
  content: Uint8Array;
  symlink?: boolean;
}
export interface SealedDelivery {
  schema_version: 1;
  delivery_id: string;
  execution_scope: "production";
  workspace_id: string;
  project_id: string;
  generation_version: number;
  workspace_revision: string;
  context_id: string;
  base_commit: string;
  sources_verified_at: string;
  files: DeliveryFile[];
  resources: ResourceReceipt[];
  /** Main article URL must be first; supplemental references never define duplicate article identity. */ sources: string[];
  /** Trusted aliases of the main article only, never supplemental materials. */ primary_source_aliases?: string[];
  quality_report: Record<string, unknown>;
  rationale: string;
  knowledge_increment: string;
  gaps: string[];
  image_degradations: string[];
  usage: {
    status: "known" | "unknown" | "partial";
    estimated_usd: number | null;
  };
  warnings: string[];
  validated_hash: string;
}
export interface GitIdentity {
  name: string;
  email: string;
  date: string;
}
export interface PreparedCommit {
  base_commit: string;
  base_tree: string;
  tree_sha: string;
  commit_sha: string;
  message: string;
  identity: GitIdentity;
  blobs: { path: string; sha: string; content_base64: string }[];
  files: { path: string; sha256: string }[];
}
export interface PullRequestFact {
  number: number;
  url: string;
  state: "open" | "closed_unmerged" | "merged";
  branch: string;
  head_sha: string;
  delivery_id: string | null;
  created_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
}
export interface GitHubFact {
  observation?: {
    schema_version: 1;
    complete: boolean;
    repository: string;
    default_branch: string;
    default_commit_sha: string;
    project_id: string;
    checked_at: string;
  };
  prs: PullRequestFact[];
  branch_sha: string | null;
  expected_commit_exists: boolean;
  complete_diff_matches: boolean;
  default_branch_duplicate: boolean;
  pending_duplicate?: boolean;
  review_outcome?:
    | "accepted_without_changes"
    | "accepted_with_changes"
    | "rejected"
    | "pending";
  merged_notes?: { path: string; content: string; sha: string }[];
}
export interface GitHubPort {
  prepare(
    delivery: SealedDelivery,
    identity: GitIdentity,
  ): Promise<PreparedCommit>;
  inspect(
    delivery: SealedDelivery,
    prepared?: PreparedCommit,
  ): Promise<GitHubFact>;
  materialize(
    prepared: PreparedCommit,
    beforeWrite: () => Promise<void>,
  ): Promise<void>;
  createBranch(branch: string, sha: string): Promise<void>;
  createPR(
    branch: string,
    title: string,
    body: string,
  ): Promise<PullRequestFact>;
}
export type DeliveryStatus =
  | "publishing"
  | "awaiting_review"
  | "closed_unmerged"
  | "merged"
  | "delivery_conflict"
  | "needs_resume"
  | "policy_blocked"
  | "superseded";
export interface DeliveryRecord {
  schema_version: 1;
  delivery_id: string;
  project_id: string;
  generation_version: number;
  branch: string;
  status: DeliveryStatus;
  prepared: PreparedCommit | null;
  pr: PullRequestFact | null;
  uncertain_action: string | null;
  reason: string | null;
  policy_checks?: WritePolicyReceipt[];
  updated_at: string;
  superseded_by?: string;
  review_outcome?:
    | "accepted_without_changes"
    | "accepted_with_changes"
    | "rejected"
    | "pending";
  merged_notes?: { path: string; content: string; sha: string }[];
}
export const branchFor = (
  d: Pick<SealedDelivery, "project_id" | "generation_version">,
): string => `notes/${d.project_id}/g${d.generation_version}`;

export function writePolicyReceipt(
  action: string,
  check: void | PolicyEvidence,
  now: string,
): WritePolicyReceipt {
  if (!check)
    return {
      action,
      evidence: null,
      status: "legacy_unverified",
      checked_at: now,
    };
  if (
    !/^[a-f0-9]{64}$/.test(check.check_id) ||
    !check.policy_commit ||
    !/^[a-f0-9]{40}$/.test(check.policy_commit) ||
    !check.policy_hash ||
    !/^[a-f0-9]{64}$/.test(check.policy_hash) ||
    !Number.isFinite(Date.parse(check.checked_at)) ||
    (check.execution_permission !== undefined &&
      check.execution_permission !== "allowed")
  )
    throw new Error("Invalid current policy evidence");
  return {
    action,
    evidence: {
      check_id: check.check_id,
      policy_commit: check.policy_commit,
      policy_hash: check.policy_hash,
      checked_at: check.checked_at,
      ...(check.execution_permission
        ? { execution_permission: check.execution_permission }
        : {}),
    },
    status: "verified",
    checked_at: check.checked_at,
  };
}
