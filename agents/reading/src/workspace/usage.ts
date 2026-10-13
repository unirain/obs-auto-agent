import {
  AgentError,
  type Usage,
  type InvocationMessage,
  type InvocationRecord,
} from "../contracts/index.js";
export function aggregateUsage(messages: InvocationMessage[]): Usage {
  const summaries = messages.filter((m) => m.summary);
  const values = summaries.length
    ? [summaries.at(-1)!.usage]
    : messages.map((m) => m.usage);
  const known =
    values.length > 0 &&
    values.every((v) => v.cost_status === "known" && v.cost_usd !== null);
  return {
    input_tokens: values.reduce((n, v) => n + v.input_tokens, 0),
    output_tokens: values.reduce((n, v) => n + v.output_tokens, 0),
    cost_usd: known ? values.reduce((n, v) => n + (v.cost_usd ?? 0), 0) : null,
    cost_status: known ? "known" : "unknown",
  };
}
export function aggregateInvocations(records: InvocationRecord[]): Usage {
  const unique = new Map<string, InvocationRecord>();
  for (const record of records) {
    if (unique.has(record.invocation_id))
      throw new AgentError("corrupt", "Duplicate invocation in aggregate");
    unique.set(record.invocation_id, record);
  }
  return aggregateUsage(
    [...unique.values()].map((r) => ({
      message_id: r.invocation_id,
      usage: r.usage,
      summary: false,
    })),
  );
}
export function beijingDay(utcTimestamp: string): string {
  const time = Date.parse(utcTimestamp);
  if (!Number.isFinite(time))
    throw new AgentError("corrupt", "Invalid usage date");
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}
