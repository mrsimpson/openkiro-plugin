import { describe, it, expect, afterEach } from "vitest";
import { clearSdkClientCache } from "./sdk-client.js";

describe("sdk-client", () => {
  afterEach(() => {
    clearSdkClientCache();
  });

  it("should use auth.access as the bearer token, not auth.refreshToken", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require("path").resolve(__dirname, "./sdk-client.ts"), "utf-8");

    expect(source).toContain("auth.access");
    expect(source).not.toMatch(/const token = auth\.refreshToken/);
  });

  it("KiroAuthDetails type must include an access field", () => {
    const fs = require("fs");
    const typesSource = fs.readFileSync(require("path").resolve(__dirname, "./types.ts"), "utf-8");

    expect(typesSource).toMatch(/access\s*[?:]?\s*:?\s*string/);
  });

  it("cache key should not leak refresh token secret", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require("path").resolve(__dirname, "./sdk-client.ts"), "utf-8");

    expect(source).not.toMatch(/cacheKey.*auth\.refreshToken/);
  });
});
