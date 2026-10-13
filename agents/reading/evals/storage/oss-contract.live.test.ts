import { it, expect } from "vitest";
import { runOssProbe } from "./oss-probe.js";
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
