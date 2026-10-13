import { canonicalJson, sha256 } from "../contracts/index.js";
import { FEEDBACK_REASONS, type HumanReviewFeedback } from "./metrics.js";
import type {
  DeliveryRecord,
  SealedDelivery,
  PullRequestFact,
} from "./types.js";
import type { GitHubReadAuthority } from "./regeneration.js";
export interface FeedbackReadPort {
  authority(): Promise<GitHubReadAuthority>;
  inspectPullRequest(number: number): Promise<PullRequestFact>;
}
export interface PrepareFeedbackInput {
  feedback: HumanReviewFeedback;
  trusted_actor: string;
  repository: string;
  workspace_id: string;
  request_id: string;
  seal: SealedDelivery;
  record: DeliveryRecord;
  github: FeedbackReadPort;
  now?: () => Date;
}
export interface FeedbackAudit {
  schema_version: 1;
  kind: "human_review_feedback";
  request_id: string;
  actor: string;
  workspace_id: string;
  project_id: string;
  delivery_id: string;
  checked_at: string;
  authority: GitHubReadAuthority;
  pr: PullRequestFact;
  feedback_hash: string;
  audit_hash: string;
}
export interface PreparedFeedbackBundle {
  schema_version: 1;
  records: Record<string, unknown>;
  audit: FeedbackAudit;
  feedback: HumanReviewFeedback;
  delivery: DeliveryRecord;
}
export function validateFeedback(
  feedback: HumanReviewFeedback,
  trustedActor: string,
): void {
  const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  if (
    !login.test(trustedActor) ||
    !login.test(feedback.actor) ||
    feedback.actor.toLowerCase() !== trustedActor.toLowerCase() ||
    feedback.schema_version !== 1 ||
    feedback.origin !== "trusted_management" ||
    !/^[A-Za-z0-9_-]+$/.test(feedback.delivery_id) ||
    !Number.isFinite(Date.parse(feedback.recorded_at)) ||
    (feedback.reason !== null && !FEEDBACK_REASONS.includes(feedback.reason)) ||
    (feedback.review_minutes !== null &&
      (!Number.isFinite(feedback.review_minutes) ||
        feedback.review_minutes < 0))
  )
    throw new Error("Invalid trusted actor or human review feedback");
}
/** Read-only preparation. Root must checkpoint this entire bundle together with the management request audit. */
export async function prepareHumanReviewFeedback(
  input: PrepareFeedbackInput,
): Promise<PreparedFeedbackBundle> {
  validateFeedback(input.feedback, input.trusted_actor);
  const d = input.seal,
    r = input.record;
  if (
    d.schema_version !== 1 ||
    d.execution_scope !== "production" ||
    d.workspace_id !== input.workspace_id ||
    r.schema_version !== 1 ||
    r.delivery_id !== d.delivery_id ||
    input.feedback.delivery_id !== d.delivery_id ||
    r.project_id !== d.project_id ||
    r.generation_version !== d.generation_version ||
    !r.pr ||
    !Number.isSafeInteger(r.pr.number) ||
    r.pr.number < 1 ||
    !/^[A-Za-z0-9_-]+$/.test(input.request_id)
  )
    throw new Error("Feedback actual delivery/PR binding invalid");
  let authority: GitHubReadAuthority, pr: PullRequestFact;
  try {
    authority = await input.github.authority();
    pr = await input.github.inspectPullRequest(r.pr.number);
  } catch {
    throw new Error("Feedback remote PR verification unavailable");
  }
  if (
    authority.schema_version !== 1 ||
    !authority.complete ||
    authority.repository.toLowerCase() !== input.repository.toLowerCase() ||
    !authority.default_branch ||
    !/^[a-f0-9]{40}$/.test(authority.default_commit_sha) ||
    !Number.isFinite(Date.parse(authority.checked_at)) ||
    pr.number !== r.pr.number ||
    pr.url !== r.pr.url ||
    !["open", "merged", "closed_unmerged"].includes(pr.state) ||
    !/^[a-f0-9]{40}$/.test(pr.head_sha) ||
    (pr.delivery_id !== null && pr.delivery_id !== d.delivery_id)
  )
    throw new Error("Feedback remote PR binding conflict");
  const url = new URL(pr.url);
  const path = `/${input.repository}/pull/${pr.number}`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.pathname.toLowerCase() !== path.toLowerCase() ||
    url.search ||
    url.hash
  )
    throw new Error("Feedback PR URL/repository mismatch");
  const checked_at = (input.now ?? (() => new Date()))().toISOString();
  const feedback: HumanReviewFeedback = {
    ...input.feedback,
    actor: input.trusted_actor,
    pr_binding: {
      repository: authority.repository,
      number: pr.number,
      url: pr.url,
      head_sha: pr.head_sha,
      state: pr.state,
      checked_at,
    },
  };
  const audit: FeedbackAudit = {
    schema_version: 1,
    kind: "human_review_feedback",
    request_id: input.request_id,
    actor: input.trusted_actor,
    workspace_id: input.workspace_id,
    project_id: d.project_id,
    delivery_id: d.delivery_id,
    checked_at,
    authority,
    pr,
    feedback_hash: sha256(canonicalJson(feedback)),
    audit_hash: "",
  };
  const { audit_hash, ...body } = audit;
  audit.audit_hash = sha256(canonicalJson(body));
  const delivery: DeliveryRecord = {
    ...r,
    pr,
    status: r.status === 'delivery_conflict' ? 'delivery_conflict' : pr.state === "open" ? "awaiting_review" : pr.state,
    updated_at: checked_at,
  };
  if (r.pr.head_sha !== pr.head_sha) delete delivery.review_outcome;
  return {
    schema_version: 1,
    feedback,
    delivery,
    audit,
    records: {
      [`review-feedback/${d.delivery_id}`]: feedback,
      [`delivery-${d.delivery_id}`]: delivery,
      [`feedback-audit/${input.request_id}`]: audit,
    },
  };
}
