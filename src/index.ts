import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Plugin } from "@opencode/plugin";
import { refreshAccessToken } from "./token.js";
import { readKiroCliAuth, type KiroCliAuth } from "./kiro-cli-db.js";
import { listKiroModels } from "./kiro-cli-models.js";
import { createKiroFetch, resolveApiRegion as resolveRegion } from "./kiro-fetch.js";
import { buildModelConfig } from "./model-config.js";
import { setupV2 } from "./v2.js";

const PLUGIN_ID = "kiro";

function bootstrapAuthIfNeeded(): void {
  try {
    const dataRoot =
      process.platform === "win32"
        ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
        : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    const authPath = path.join(dataRoot, "opencode", "auth.json");

    let auth: Record<string, any> = {};
    if (fs.existsSync(authPath)) {
      const parsed = JSON.parse(fs.readFileSync(authPath, "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      auth = parsed;
    }
    if (auth[PLUGIN_ID]) return;

    auth[PLUGIN_ID] = { type: "api", key: "kiro-cli-bootstrap" };
    const dir = path.dirname(authPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });
  } catch {}
}

function getApiRegionOverride(): string | undefined {
  try {
    const configPath = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".config",
      "opencode",
      "kiro.json",
    );
    if (fs.existsSync(configPath)) {
      const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return content.default_region || undefined;
    }
  } catch {}
  return undefined;
}

const KiroPlugin = async (_input: any) => {
  const regionOverride = getApiRegionOverride();

  const resolveApiRegion = (cliAuth: KiroCliAuth) => resolveRegion(cliAuth, regionOverride);

  return {
    config: async (input: any) => {
      bootstrapAuthIfNeeded();

      const cliAuth = readKiroCliAuth();
      const apiRegion = cliAuth ? resolveApiRegion(cliAuth) : "us-east-1";
      const baseURL = `https://q.${apiRegion}.amazonaws.com`;

      if (!input.provider) input.provider = {};
      if (!input.provider[PLUGIN_ID]) input.provider[PLUGIN_ID] = {};
      input.provider[PLUGIN_ID].npm = "@ai-sdk/openai-compatible";
      input.provider[PLUGIN_ID].api = baseURL;
      if (!input.provider[PLUGIN_ID].models) {
        input.provider[PLUGIN_ID].models = buildModelConfig(listKiroModels());
      }
    },

    auth: {
      provider: PLUGIN_ID,
      loader: async (_getAuth: any) => {
        const cliAuth = readKiroCliAuth();
        if (!cliAuth) return {};

        const apiRegion = resolveApiRegion(cliAuth);
        const baseURL = `https://q.${apiRegion}.amazonaws.com`;

        let accessToken = cliAuth.accessToken;
        let expiresAt = cliAuth.expiresAt;

        if (Date.now() >= expiresAt - 120_000) {
          try {
            const refreshed = await refreshAccessToken(
              cliAuth.refreshToken,
              cliAuth.clientId,
              cliAuth.clientSecret,
              cliAuth.region,
            );
            accessToken = refreshed.accessToken;
            expiresAt = refreshed.expiresAt;
          } catch {
            return {};
          }
        }

        const customFetch = createKiroFetch({
          regionOverride,
          initialToken: { accessToken, expiresAt },
        });

        return { apiKey: "", baseURL, fetch: customFetch };
      },

      methods: [
        {
          label: "Kiro CLI (already authenticated)",
          type: "oauth" as const,
          authorize: async () => {
            const cliAuth = readKiroCliAuth();
            if (!cliAuth) {
              throw new Error('Kiro CLI is not authenticated. Run "kiro login" first.');
            }
            return {
              url: "",
              instructions: "Using existing Kiro CLI session",
              method: "auto" as const,
              callback: async () => {
                // Verify credentials are still valid by refreshing
                try {
                  const refreshed = await refreshAccessToken(
                    cliAuth.refreshToken,
                    cliAuth.clientId,
                    cliAuth.clientSecret,
                    cliAuth.region,
                  );
                  return {
                    type: "success" as const,
                    refresh: "kiro-cli",
                    access: refreshed.accessToken,
                    expires: refreshed.expiresAt,
                  };
                } catch {
                  throw new Error(
                    'Kiro CLI session is expired or revoked. Run "kiro login" to re-authenticate.',
                  );
                }
              },
            };
          },
        },
      ],
    },

    provider: {
      id: PLUGIN_ID,
      models: async (provider: any) => {
        const cliAuth = readKiroCliAuth();
        const apiRegion = cliAuth ? resolveApiRegion(cliAuth) : "us-east-1";
        const baseURL = `https://q.${apiRegion}.amazonaws.com`;
        const models = provider?.models || {};
        const normalized: Record<string, any> = {};

        for (const [modelID, model] of Object.entries(models)) {
          const modelInfo = model as any;
          normalized[modelID] = {
            ...modelInfo,
            api: {
              ...modelInfo.api,
              npm: "@ai-sdk/openai-compatible",
              url: modelInfo.api?.url || baseURL,
            },
          };
        }

        return normalized;
      },
    },
  };
};

function resolveBaseURL(regionOverride: string | undefined): string {
  const cliAuth = readKiroCliAuth();
  const region = cliAuth ? resolveRegion(cliAuth, regionOverride) : regionOverride || "us-east-1";
  return `https://q.${region}.amazonaws.com`;
}

/** OpenCode 2.x entry (V2 plugin API). */
const v2: Plugin.Plugin = {
  id: PLUGIN_ID,
  async setup(ctx) {
    const regionOverride = getApiRegionOverride();
    await setupV2(ctx, {
      providerID: PLUGIN_ID,
      regionOverride,
      resolveBaseURL: () => resolveBaseURL(regionOverride),
    });
  },
};

// Dual export: OpenCode 2.x calls `setup`, OpenCode 1.x calls `server`.
export default {
  ...v2,
  server: KiroPlugin,
};
