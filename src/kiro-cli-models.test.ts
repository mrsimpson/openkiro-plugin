import { describe, it, expect } from "vitest";
import { getKiroCliVersion, FALLBACK_KIRO_VERSION } from "./kiro-cli-models.js";

describe("getKiroCliVersion", () => {
  it("returns a concrete semver string", () => {
    // In the test environment the CLI may or may not be present; either way
    // the function must return a usable version token for the user-agent.
    expect(getKiroCliVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes a concrete, non-zero fallback version", () => {
    // A "0.0.0" fallback risks being rejected by the server's version check,
    // so the fallback must be a plausible current version.
    expect(FALLBACK_KIRO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(FALLBACK_KIRO_VERSION).not.toBe("0.0.0");
  });
});
