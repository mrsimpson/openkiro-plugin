import { modelIdToKey, type KiroModel } from "./kiro-cli-models.js";

export interface KiroModelConfig {
  name: string;
  limit: { context: number; output: number };
  modalities?: { input: string[]; output: string[] };
  variants?: Record<string, Record<string, unknown>>;
}

/**
 * Derives a human-readable display name from a model id and credit multiplier.
 * e.g. "claude-sonnet-4.6", 1.3 → "Claude Sonnet 4.6 (1.3x)"
 */
function formatModelName(id: string, credits: number): string {
  // Capitalise hyphen-separated words, keep version numbers intact
  const words = id
    .split("-")
    .map((w) => (w.match(/^\d/) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
  return `${words.join(" ")} (${credits}x)`;
}

/**
 * Returns true for model ids that are likely to support vision (images/PDFs).
 * GPT and Claude models do; small open-weight models generally don't.
 */
function supportsVision(id: string): boolean {
  return id.startsWith("claude-") || id.startsWith("gpt-");
}

/**
 * Builds the opencode model config object from the live kiro-cli model list.
 * Shared by the V1 config hook and the V2 provider registration.
 */
export function buildModelConfig(models: KiroModel[]): Record<string, KiroModelConfig> {
  const config: Record<string, KiroModelConfig> = {};

  for (const model of models) {
    const key = modelIdToKey(model.id);
    const isClaude = model.id.startsWith("claude-");
    const isAuto = model.id === "auto";
    const contextLimit = isAuto ? 200_000 : 1_000_000;
    const modalities = {
      input: supportsVision(model.id) ? ["text", "image", "pdf"] : ["text"],
      output: ["text"],
    };

    config[key] = {
      name: formatModelName(model.id, model.credits),
      limit: { context: contextLimit, output: 64_000 },
      ...(isAuto || supportsVision(model.id) ? { modalities } : {}),
      ...(isClaude
        ? {
            variants: {
              low: { thinkingConfig: { thinkingBudget: 8_192 } },
              medium: { thinkingConfig: { thinkingBudget: 16_384 } },
              high: { thinkingConfig: { thinkingBudget: 32_768 } },
            },
          }
        : {}),
    };
  }

  return config;
}
