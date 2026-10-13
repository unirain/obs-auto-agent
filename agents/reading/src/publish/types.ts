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
export type PermissionCheck = (
  capability: WriteCapability,
  projectId?: string,
) => Promise<void>;
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
}
export interface GitHubFact {
  prs: PullRequestFact[];
  branch_sha: string | null;
  expected_commit_exists: boolean;
  complete_diff_matches: boolean;
  default_branch_duplicate: boolean;
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
  delivery_id: string;
  project_id: string;
  generation_version: number;
  branch: string;
  status: DeliveryStatus;
  prepared: PreparedCommit | null;
  pr: PullRequestFact | null;
  uncertain_action: string | null;
  reason: string | null;
  updated_at: string;
  superseded_by?: string;
  merged_notes?: { path: string; content: string; sha: string }[];
}
export const branchFor = (
  d: Pick<SealedDelivery, "project_id" | "generation_version">,
): string => `notes/${d.project_id}/g${d.generation_version}`;
