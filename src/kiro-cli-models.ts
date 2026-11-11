import { execSync } from "child_process";

/**
 * Fallback version used when the installed Kiro CLI version cannot be read.
 * Kept reasonably current so the server's client-version check still passes.
 */
export const FALLBACK_KIRO_VERSION = "2.21.4";

/**
 * Returns the installed kiro-cli version string (e.g. "2.21.4").
 * Falls back to FALLBACK_KIRO_VERSION if the CLI is unavailable.
 */
export function getKiroCliVersion(): string {
  try {
    const output = execSync("kiro-cli --version", {
      encoding: "utf-8",
      timeout: 5_000,
    });
    // Output is "kiro-cli 2.21.4\n" — extract the version number
    const m = output.trim().match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : FALLBACK_KIRO_VERSION;
  } catch {
    return FALLBACK_KIRO_VERSION;
  }
}

export interface KiroModel {
  id: string;         // as returned by CLI, e.g. "claude-sonnet-4.6"
  credits: number;    // multiplier, e.g. 1.3
  description: string;
  isDefault: boolean;
}

/**
 * Runs `kiro-cli chat --list-models` and parses the output.
 * Throws if the CLI is unavailable or the output cannot be parsed.
 */
export function listKiroModels(): KiroModel[] {
  const output = execSync("kiro-cli chat --list-models", {
    encoding: "utf-8",
    timeout: 10_000,
  });

  return parseKiroModelOutput(output);
}

/**
 * Parses the text output of `kiro-cli chat --list-models`.
 *
 * Expected line format (one of):
 *   "* auto                 1.00x credits      Description"
 *   "  claude-sonnet-4.6   1.30x credits      Description"
 */
export function parseKiroModelOutput(output: string): KiroModel[] {
  const models: KiroModel[] = [];
  // Match: optional "* " or "  ", then model id, then Xx credits, then description
  const lineRe = /^(\*?)\s+([\w.\-]+)\s+([\d.]+)x\s+credits\s+(.*)/;

  for (const line of output.split("\n")) {
    const m = line.match(lineRe);
    if (!m) continue;
    const [, star, id, creditsStr, description] = m;
    models.push({
      id,
      credits: parseFloat(creditsStr),
      description: description.trim(),
      isDefault: star === "*",
    });
  }

  if (models.length === 0) {
    throw new Error("kiro-cli returned no models — unexpected output format");
  }

  return models;
}

/**
 * Converts a dot-separated model id to the hyphen-separated key used in opencode
 * model config, e.g. "claude-sonnet-4.6" → "claude-sonnet-4-6".
 * IDs that contain no dots are returned as-is.
 */
export function modelIdToKey(id: string): string {
  // Replace dots that appear between digits (version separators) with hyphens
  return id.replace(/(\d)\.(\d)/g, "$1-$2");
}

/**
 * Builds a MODEL_MAPPING record (opencode key → kiro API id) from the live
 * model list.  Thinking variants are synthesised automatically for every
 * Claude model.
 */
export function buildModelMapping(models: KiroModel[]): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const model of models) {
    const key = modelIdToKey(model.id);
    mapping[key] = model.id;
  }

  return mapping;
}
