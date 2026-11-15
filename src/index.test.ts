import { describe, it, expect, beforeEach } from "vitest";

describe("plugin entry (index.ts)", () => {
  let plugin: any;
  let pluginModule: any;

  beforeEach(async () => {
    const mod = await import("./index.js");
    pluginModule = mod.default;
    plugin = await pluginModule.server({});
  });

  describe("plugin module shape", () => {
    it("should export { id, server } as PluginModule", () => {
      expect(pluginModule).toHaveProperty("id");
      expect(pluginModule).toHaveProperty("server");
      expect(typeof pluginModule.server).toBe("function");
      expect(pluginModule.id).toBe("kiro");
    });
  });

  describe("config hook", () => {
    it("should be a function", () => {
      expect(typeof plugin.config).toBe("function");
    });

    it("should register provider with npm and models", async () => {
      const input = { provider: {} };
      await plugin.config(input);

      expect((input.provider as any).kiro).toBeDefined();
      expect((input.provider as any).kiro.npm).toBe("@ai-sdk/openai-compatible");
      expect((input.provider as any).kiro.api).toBeDefined();
      expect((input.provider as any).kiro.models).toBeDefined();
    });

    it("should not overwrite user-defined models", async () => {
      const input = { provider: { kiro: { models: { custom: { name: "Custom" } } } } };
      await plugin.config(input);

      expect((input.provider as any).kiro.models.custom).toEqual({ name: "Custom" });
      expect((input.provider as any).kiro.models["claude-sonnet-4-6"]).toBeUndefined();
    });
  });

  describe("auth hook", () => {
    it("should have provider set to kiro", () => {
      expect(plugin.auth.provider).toBe("kiro");
    });

    it("should have a loader function", () => {
      expect(typeof plugin.auth.loader).toBe("function");
    });

    it("should have a methods array with oauth type (Kiro CLI based)", () => {
      expect(Array.isArray(plugin.auth.methods)).toBe(true);
      expect(plugin.auth.methods[0].type).toBe("oauth");
      expect(plugin.auth.methods[0].label).toContain("Kiro CLI");
      expect(typeof plugin.auth.methods[0].authorize).toBe("function");
    });
  });

  describe("provider hook", () => {
    it("should have id and models function", () => {
      expect(plugin.provider.id).toBe("kiro");
      expect(typeof plugin.provider.models).toBe("function");
    });

    it("should normalize model entries with npm and url", async () => {
      const provider = {
        models: {
          "claude-sonnet-4-6": { name: "Claude Sonnet 4.6", limit: { context: 1000000 } },
        },
      };
      const result = await plugin.provider.models(provider);

      expect(result["claude-sonnet-4-6"].api.npm).toBe("@ai-sdk/openai-compatible");
      expect(result["claude-sonnet-4-6"].api.url).toMatch(/q\..*\.amazonaws\.com/);
    });
  });

  describe("auth.loader behavior", () => {
    it("should read from Kiro CLI DB (source code check)", () => {
      const fs = require("fs");
      const source = fs.readFileSync(require("path").resolve(__dirname, "./index.ts"), "utf-8");

      expect(source).toContain("readKiroCliAuth");
      expect(source).not.toContain("decodeRefreshToken");
      expect(source).not.toContain("encodeRefreshToken");
    });
  });

  describe("createKiroFetch (kiro-fetch.ts)", () => {
    const fs = require("fs");
    const source = fs.readFileSync(require("path").resolve(__dirname, "./kiro-fetch.ts"), "utf-8");

    it("should contain retry logic", () => {
      expect(source).toMatch(/maxAttempts/);
      expect(source).toMatch(/429/);
    });

    it("should re-read auth from DB on each request", () => {
      expect(source).toContain("readKiroCliAuth");
    });

    it("should use GenerateAssistantResponseCommand", () => {
      expect(source).toContain("GenerateAssistantResponseCommand");
      expect(source).toMatch(/\.send\s*\(/);
    });

    it("should read thinking config from providerOptions (V1) and body (V2)", () => {
      expect(source).toContain("providerOptions?.thinkingConfig");
      expect(source).toContain("body.thinkingConfig");
      expect(source).toContain("transformToSdkRequest");
    });

    it("V1 loader should use createKiroFetch", () => {
      const index = fs.readFileSync(require("path").resolve(__dirname, "./index.ts"), "utf-8");
      expect(index).toContain("createKiroFetch(");
    });
  });

  describe("V2 entry", () => {
    it("should expose setup next to server", () => {
      expect(typeof pluginModule.setup).toBe("function");
    });

    it("should not import @opencode/plugin at runtime", () => {
      const fs = require("fs");
      for (const file of ["./index.ts", "./v2.ts"]) {
        const src = fs.readFileSync(require("path").resolve(__dirname, file), "utf-8");
        expect(src).not.toMatch(/^import \{[^}]*\} from "@opencode\/plugin"/m);
      }
    });
  });
});
