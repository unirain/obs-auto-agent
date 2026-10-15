import { it, expect } from "vitest";
import { runOssProbe } from "./oss-probe.js";
import { runOssTransportProbe } from "./oss-transport-probe.js";
it.skipIf(process.env.OSS_LIVE_TEST_ALLOWED !== "isolated-existing-bucket")(
  "verifies native OSS against explicit isolated test resource",
  async () => {
    const report = await runOssProbe();
    expect(report.results.immutable_race).toBe("passed");
    expect(report.results.immutable_chain).toBe("passed");
    expect(report.results.pagination).toBe("passed");
  },
  120000,
);
it.skipIf(process.env.OSS_LIVE_TEST_ALLOWED !== "isolated-existing-bucket")(
  "reconciles native OSS PUT after TLS socket loss before the SDK sees success and cold-restores its exact immutable chain",
  async()=>{const report=await runOssTransportProbe();expect(report.native_failure).toBe('unknown');expect(report.trace.response_events).toBe(0);expect(report.put_attempts).toBe(1);expect(report.cold_recovery).toBe('passed');},120000,
);
