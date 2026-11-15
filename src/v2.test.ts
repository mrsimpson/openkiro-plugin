import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./kiro-cli-models.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./kiro-cli-models.js")>()),
  listKiroModels: () => [
    { id: "claude-sonnet-4.6", credits: 1.3, description: "", isDefault: false },
    { id: "auto", credits: 1, description: "", isDefault: true },
  ],
}));

const readKiroCliAuth = vi.fn();
vi.mock("./kiro-cli-db.js", () => ({ readKiroCliAuth: () => readKiroCliAuth() }));

const { setupV2, buildV2Models, buildV2Provider, KIRO_V2_PACKAGE } = await import("./v2.js");

function fakeContext() {
  const added: any[] = [];
  const hooks: { name: string; cb: (evt: any) => Promise<void> | void; options: any }[] = [];
  const ctx = {
    provider: {
      transform: async (cb: (editor: any) => void) => {
        cb({ add: (input: any) => added.push(input) });
        return { dispose: async () => {} };
      },
    },
    aisdk: {
      hook: async (name: string, cb: any, options: any) => {
        hooks.push({ name, cb, options });
        return { dispose: async () => {} };
      },
    },
  };
  return { ctx: ctx as any, added, hooks };
}

describe("buildV2Models", () => {
  it("maps Kiro models to Model.Info with variants as body overlays", () => {
    const models = buildV2Models("kiro", [
      { id: "claude-sonnet-4.6", credits: 1.3, description: "", isDefault: false },
    ]);
    expect(models).toHaveLength(1);
    const m = models[0] as any;
    expect(m.id).toBe("claude-sonnet-4-6");
    expect(m.providerID).toBe("kiro");
    expect(m.capabilities.input).toContain("image");
    expect(m.variants.map((v: any) => v.id)).toEqual(["low", "medium", "high"]);
    expect(m.variants[0].body).toEqual({ thinkingConfig: { thinkingBudget: 8_192 } });
  });
});

describe("buildV2Provider", () => {
  it("is enabled only when Kiro CLI is authenticated", () => {
    expect((buildV2Provider("kiro", "https://q.us-east-1.amazonaws.com", true) as any).activation).toBe("enabled");
    expect((buildV2Provider("kiro", "https://q.us-east-1.amazonaws.com", false) as any).activation).toBe("disabled");
  });

  it("uses the AI SDK openai-compatible package and JSON-only settings", () => {
    const info = buildV2Provider("kiro", "https://q.eu-central-1.amazonaws.com", true) as any;
    expect(info.package).toBe(KIRO_V2_PACKAGE);
    expect(() => structuredClone(info)).not.toThrow();
    expect(info.settings.baseURL).toBe("https://q.eu-central-1.amazonaws.com");
  });
});

describe("setupV2", () => {
  beforeEach(() => readKiroCliAuth.mockReset());

  it("registers the provider with models", async () => {
    readKiroCliAuth.mockReturnValue({ accessToken: "t" });
    const { ctx, added } = fakeContext();
    await setupV2(ctx, { providerID: "kiro", resolveBaseURL: () => "https://q.us-east-1.amazonaws.com" });

    expect(added).toHaveLength(1);
    expect(added[0].info.id).toBe("kiro");
    expect(added[0].info.activation).toBe("enabled");
    expect(added[0].models.map((m: any) => m.id)).toEqual(["claude-sonnet-4-6", "auto"]);
  });

  it("injects a custom fetch through a provider-scoped sdk hook", async () => {
    readKiroCliAuth.mockReturnValue(null);
    const { ctx, hooks } = fakeContext();
    const factory = vi.fn((options: any) => ({ options }));
    await setupV2(ctx, {
      providerID: "kiro",
      resolveBaseURL: () => "https://q.us-east-1.amazonaws.com",
      loadSdkFactory: async () => factory,
    });

    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe("sdk");
    expect(hooks[0].options).toEqual({ providerID: "kiro" });

    const evt: any = { options: { baseURL: "https://q.us-east-1.amazonaws.com" } };
    await hooks[0].cb(evt);
    expect(factory).toHaveBeenCalledOnce();
    expect(typeof evt.sdk.options.fetch).toBe("function");
    expect(evt.sdk.options.baseURL).toBe("https://q.us-east-1.amazonaws.com");
  });

  it("does not override an sdk set by another hook", async () => {
    readKiroCliAuth.mockReturnValue(null);
    const { ctx, hooks } = fakeContext();
    const factory = vi.fn();
    await setupV2(ctx, { providerID: "kiro", resolveBaseURL: () => "", loadSdkFactory: async () => factory });

    const existing = {};
    const evt: any = { options: {}, sdk: existing };
    await hooks[0].cb(evt);
    expect(evt.sdk).toBe(existing);
    expect(factory).not.toHaveBeenCalled();
  });

  it("passes non-Kiro requests to the core fetch", async () => {
    readKiroCliAuth.mockReturnValue(null);
    const { ctx, hooks } = fakeContext();
    await setupV2(ctx, { providerID: "kiro", resolveBaseURL: () => "", loadSdkFactory: async () => (o: any) => o });

    const coreFetch = vi.fn(async () => new Response("ok"));
    const evt: any = { options: { fetch: coreFetch } };
    await hooks[0].cb(evt);
    await evt.sdk.fetch("https://example.com/other");
    expect(coreFetch).toHaveBeenCalledOnce();
  });

  it("fails Kiro requests clearly when the CLI is not logged in", async () => {
    readKiroCliAuth.mockReturnValue(null);
    const { ctx, hooks } = fakeContext();
    await setupV2(ctx, { providerID: "kiro", resolveBaseURL: () => "", loadSdkFactory: async () => (o: any) => o });

    const evt: any = { options: {} };
    await hooks[0].cb(evt);
    await expect(
      evt.sdk.fetch("https://q.us-east-1.amazonaws.com/chat/completions", { method: "POST", body: "{}" }),
    ).rejects.toThrow(/kiro login/);
  });
});
