import { AgentError } from "../contracts/index.js";
export interface ProjectCounters {
  batch_id: string;
  tools: number;
  materials: number;
  classifications: number;
  revisions: number;
  no_progress: number;
  total_tools: number;
  total_materials: number;
  yield_revision: string | null;
}
export function advanceCounters(
  previous: ProjectCounters,
  delta: Partial<
    Pick<
      ProjectCounters,
      "tools" | "materials" | "classifications" | "revisions" | "no_progress"
    >
  >,
): ProjectCounters {
  validateCounters(previous);
  for (const v of Object.values(delta))
    if (!Number.isSafeInteger(v) || v < 0)
      throw new AgentError("corrupt", "Counters cannot decrease");
  const next = {
    ...previous,
    tools: previous.tools + (delta.tools ?? 0),
    materials: previous.materials + (delta.materials ?? 0),
    classifications: previous.classifications + (delta.classifications ?? 0),
    revisions: previous.revisions + (delta.revisions ?? 0),
    no_progress: previous.no_progress + (delta.no_progress ?? 0),
    total_tools: previous.total_tools + (delta.tools ?? 0),
    total_materials: previous.total_materials + (delta.materials ?? 0),
  };
  validateCounters(next);
  return next;
}
function validateCounters(value: ProjectCounters): void {
  if (
    !value.batch_id ||
    Object.entries(value).some(
      ([key, n]) =>
        !["batch_id", "yield_revision"].includes(key) &&
        (!Number.isSafeInteger(n) || Number(n) < 0),
    )
  )
    throw new AgentError("corrupt", "Counters invalid or overflowed");
}
export function nextBatch(
  previous: ProjectCounters,
  batchId: string,
  committedYieldRevision: string,
): ProjectCounters {
  validateCounters(previous);
  if (
    !batchId ||
    !committedYieldRevision ||
    previous.yield_revision !== committedYieldRevision ||
    batchId === previous.batch_id
  )
    throw new AgentError("conflict", "New batch requires committed yield");
  return {
    ...previous,
    batch_id: batchId,
    tools: 0,
    materials: 0,
    yield_revision: null,
  };
}
