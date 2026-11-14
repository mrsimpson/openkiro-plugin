/**
 * OpenCode 2.x (V2 plugin API) integration.
 *
 * Only type imports from "@opencode/plugin" so OpenCode 1.x hosts, which don't
 * ship the package, can still load this module.
 */
import type { Model, Plugin, Provider } from "@opencode/plugin";
import { readKiroCliAuth } from "./kiro-cli-db.js";
import { listKiroModels, type KiroModel } from "./kiro-cli-models.js";
import { createKiroFetch } from "./kiro-fetch.js";
import { buildModelConfig, type KiroModelConfig } from "./model-config.js";

/** AI SDK package the core resolves for the Kiro provider (aisdk: prefix = npm AI SDK provider). */
export const KIRO_V2_PACKAGE = "aisdk:@ai-sdk/openai-compatible";

type PluginContext = Parameters<Plugin.Plugin["setup"]>[0];

export function buildV2Models(providerID: string, models: KiroModel[]): Model.Info[] {
  return Object.entries(buildModelConfig(models)).map(([id, config]) => toModelInfo(providerID, id, config));
}

function toModelInfo(providerID: string, id: string, config: KiroModelConfig): Model.Info {
  return {
    id,
    modelID: id,
    providerID,
    name: config.name,
    capabilities: {
      tools: true,
      input: config.modalities?.input ?? ["text"],
      output: config.modalities?.output ?? ["text"],
    },
    variants: Object.entries(config.variants ?? {}).map(([variantID, body]) => ({ id: variantID, body })),
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: config.limit.context, output: config.limit.output },
  } as unknown as Model.Info;
}

export function buildV2Provider(providerID: string, baseURL: string, authenticated: boolean): Provider.Info {
  return {
    id: providerID,
    name: "Kiro",
    // Kiro CLI owns the credentials, so there's no OpenCode integration to activate us.
    activation: authenticated ? "enabled" : "disabled",
    package: KIRO_V2_PACKAGE,
    // Settings must stay JSON (they're cloned by core); the fetch is injected in the sdk hook.
    settings: { baseURL, apiKey: "kiro-cli" },
  } as unknown as Provider.Info;
}

export interface V2SetupDeps {
  providerID: string;
  regionOverride?: string;
  resolveBaseURL: () => string;
  /** Lazy import keeps @ai-sdk/openai-compatible off the V1 code path. */
  loadSdkFactory?: () => Promise<(options: Record<string, any>) => unknown>;
}

const defaultSdkFactory = async () => (await import("@ai-sdk/openai-compatible")).createOpenAICompatible;

export async function setupV2(ctx: PluginContext, deps: V2SetupDeps): Promise<void> {
  const { providerID } = deps;
  const loadSdkFactory = deps.loadSdkFactory ?? defaultSdkFactory;

  let models: Model.Info[] = [];
  try {
    models = buildV2Models(providerID, listKiroModels());
  } catch (e) {
    console.error(`[kiro] Failed to list Kiro models: ${e instanceof Error ? e.message : e}`);
  }

  const info = buildV2Provider(providerID, deps.resolveBaseURL(), !!readKiroCliAuth());
  await ctx.provider.transform((editor) => {
    editor.add({ info, models });
  });

  await ctx.aisdk.hook(
    "sdk",
    async (evt) => {
      if (evt.sdk) return;
      const createOpenAICompatible = await loadSdkFactory();
      evt.sdk = createOpenAICompatible({
        ...evt.options,
        name: evt.options.name ?? providerID,
        baseURL: evt.options.baseURL ?? deps.resolveBaseURL(),
        apiKey: "kiro-cli",
        // Core's options.fetch adds timeouts and middleware; Kiro requests never reach it.
        fetch: createKiroFetch({ regionOverride: deps.regionOverride, fallbackFetch: evt.options.fetch }),
      });
    },
    { providerID },
  );

}
