import { describe, it, expect } from "vitest";
import { FALLBACK_KIRO_VERSION, kiroUserAgent, kiroUserAgentParts, parseKiroCliVersion } from "./user-agent.js";

describe("user-agent", () => {
  it("parses the kiro-cli --version output", () => {
    expect(parseKiroCliVersion("kiro-cli 2.35.2\n")).toBe("2.35.2");
    expect(parseKiroCliVersion("garbage")).toBeUndefined();
  });

  it("contains the md/appVersion token the API version check needs", () => {
    expect(kiroUserAgentParts("1.2.3")).toContain("md/appVersion-1.2.3");
    expect(kiroUserAgent("1.2.3")).toMatch(/^KiroCLI\/1\.2\.3 KAS\/1\.2\.3 os\/\S+ md\/appVersion-1\.2\.3$/);
  });

  it("has a concrete, non-zero fallback version", () => {
    expect(FALLBACK_KIRO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(FALLBACK_KIRO_VERSION).not.toBe("0.0.0");
  });
});
