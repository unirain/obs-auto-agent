import {
  STORAGE_LIMIT,
  STORAGE_WARNING,
  STORAGE_GENERATION_STOP,
} from "../storage/capacity.js";

export interface RuntimeLimits {
  watchdog_gap_hours: number;
  sources_freshness_hours: number;
  storage_limit_bytes: typeof STORAGE_LIMIT;
  storage_warning_bytes: typeof STORAGE_WARNING;
  storage_stop_generation_bytes: typeof STORAGE_GENERATION_STOP;
}

/** Trusted YAML values stay numbers; strings, NaN and unrepresentable durations fail closed. */
export function runtimeHours(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isSafeInteger(value * 3_600_000) ||
    value * 3_600_000 > 8_640_000_000_000_000
  )
    throw new Error(`Invalid runtime ${field}: expected positive finite hours`);
  return value;
}

/** These storage thresholds are currently fixed in the capacity algorithm. Reject misleading overrides. */
export function parseRuntimeLimits(value: unknown): RuntimeLimits {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid trusted runtime configuration");
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== 1)
    throw new Error("Unsupported trusted runtime configuration schema");
  if (raw.cost_policy !== "observe_only")
    throw new Error("Runtime cost policy must remain observe_only");
  if (raw.storage_limit_bytes !== STORAGE_LIMIT)
    throw new Error("Runtime storage limit must equal the shared 50 GB bound");
  if (
    raw.storage_warning_bytes !== STORAGE_WARNING ||
    raw.storage_stop_generation_bytes !== STORAGE_GENERATION_STOP
  )
    throw new Error("Unsupported runtime storage thresholds: current capacity algorithm uses 45/49 GB");
  return {
    watchdog_gap_hours: runtimeHours(raw.watchdog_gap_hours, "watchdog_gap_hours"),
    sources_freshness_hours: runtimeHours(raw.sources_freshness_hours, "sources_freshness_hours"),
    storage_limit_bytes: STORAGE_LIMIT,
    storage_warning_bytes: STORAGE_WARNING,
    storage_stop_generation_bytes: STORAGE_GENERATION_STOP,
  };
}
