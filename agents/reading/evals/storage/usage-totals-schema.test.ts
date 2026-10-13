import { it, expect } from "vitest";
import { Ajv } from "ajv";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  UsageTotalsSchema,
  type UsageTotalsSchemaValue,
} from "../../src/contracts/schema.js";
import {
  parseUsageTotals,
  sumUsage,
  type UsageTotals,
} from "../../src/workspace/usage.js";
import type { Usage } from "../../src/contracts/index.js";
// Independent prior field layout, now coupled to the established known/unknown price invariant.
interface PreviousUsageTotalsLayout extends Usage {
  known_cost_usd: number | null;
  token_status: "known" | "partial" | "unknown";
  invocation_count: number;
  unknown_invocations: number;
  unresolved_invocations: number;
  attribution_complete: boolean;
  unattributed_invocations: number;
}
type ExpectedUsageTotals = Omit<
  PreviousUsageTotalsLayout,
  "cost_usd" | "cost_status"
> &
  (
    | { cost_status: "known"; cost_usd: number }
    | { cost_status: "unknown"; cost_usd: null }
  );
const schemaToExpected = (value: UsageTotalsSchemaValue): ExpectedUsageTotals =>
  value;
const expectedToSchema = (value: ExpectedUsageTotals): UsageTotalsSchemaValue =>
  value;
const publicToSchema = (value: UsageTotals): UsageTotalsSchemaValue => value;
const schemaToPublic = (value: UsageTotalsSchemaValue): UsageTotals => value;
it("schema static type and prior complete field layout assign both directions without dropping uncertainty metadata", () => {
  const value: ExpectedUsageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: null,
    cost_status: "unknown",
    known_cost_usd: null,
    token_status: "unknown",
    invocation_count: 1,
    unknown_invocations: 1,
    unresolved_invocations: 1,
    attribution_complete: false,
    unattributed_invocations: 1,
  };
  expect(schemaToExpected(expectedToSchema(value))).toEqual(value);
  expect(schemaToPublic(publicToSchema(parseUsageTotals(value)))).toEqual(
    value,
  );
  const box = TypeCompiler.Compile(UsageTotalsSchema),
    ajv = new Ajv({ strict: true }).compile(
      JSON.parse(JSON.stringify(UsageTotalsSchema)),
    );
  expect(box.Check(value)).toBe(true);
  expect(ajv(value)).toBe(true);
  for (const bad of [
    { ...value, cost_usd: 0 },
    { ...value, cost_status: "known" },
    { ...value, token_status: "complete" },
    { ...value, unknown_invocations: -1 },
    { ...value, extra: "command" },
  ]) {
    expect(box.Check(bad)).toBe(false);
    expect(ajv(bad)).toBe(false);
    expect(() => parseUsageTotals(bad)).toThrow();
  }
  const { token_status: _, ...stripped } = value;
  expect(() => parseUsageTotals(stripped)).toThrow();
});
it("unobserved zero token counters stay unknown, while a known priced floor survives exact totals parsing", () => {
  const totals = sumUsage([
    {
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: null,
        cost_status: "unknown",
        known_cost_usd: 0.5,
        token_status: "unknown",
        message_count: 1,
      },
      unresolved: true,
    },
  ]);
  expect(parseUsageTotals(totals)).toMatchObject({
    input_tokens: 0,
    output_tokens: 0,
    token_status: "unknown",
    cost_usd: null,
    known_cost_usd: 0.5,
    unknown_invocations: 1,
    unresolved_invocations: 1,
  });
  expect(parseUsageTotals(sumUsage([]))).toMatchObject({
    invocation_count: 0,
    cost_usd: 0,
    token_status: "known",
  });
});
