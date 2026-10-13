import { Type } from "@sinclair/typebox";
import { AgentError } from "./index.js";
// Gregorian calendar rules belong in the portable schema as well as the JS guard.
// Non-century leap years divide by four; century leap years divide by 400.
const commonDate =
  "[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))";
const leapDate =
  "(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29";
export const UTC_INSTANT_PATTERN = `^(?:${commonDate}|${leapDate})T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,3})?Z(?![\\s\\S])`;
export const UtcInstantSchema = Type.String({ pattern: UTC_INSTANT_PATTERN });
const pattern = new RegExp(UTC_INSTANT_PATTERN);
export function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string" || !pattern.test(value)) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const normalized = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_match, fraction: string | undefined) =>
      "." + (fraction ?? "").padEnd(3, "0") + "Z",
  );
  return date.toISOString() === normalized;
}
/** Validate without converting or replacing the original persisted instant. */
export function assertUtcInstant(
  value: unknown,
  label = "UTC instant",
): asserts value is string {
  if (!isUtcInstant(value))
    throw new AgentError(
      "corrupt",
      `${label} must be a valid UTC instant ending in Z`,
    );
}
