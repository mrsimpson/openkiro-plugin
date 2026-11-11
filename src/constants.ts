import { buildModelMapping, listKiroModels, getKiroCliVersion } from "./kiro-cli-models.js";

const KIRO_CLI_VERSION = getKiroCliVersion();

export const KIRO_CONSTANTS = {
  REFRESH_IDC_URL: "https://oidc.{{region}}.amazonaws.com/token",
  BASE_URL: "https://q.{{region}}.amazonaws.com/generateAssistantResponse",
  DEFAULT_REGION: "us-east-1",
  AXIOS_TIMEOUT: 120000,
  USER_AGENT: `KiroIDE/${KIRO_CLI_VERSION}`,
  KIRO_CLI_VERSION,
  CHAT_TRIGGER_TYPE_MANUAL: "MANUAL",
  ORIGIN_AI_EDITOR: "AI_EDITOR",
};

export const MODEL_MAPPING: Record<string, string> = buildModelMapping(listKiroModels());

export function extractRegionFromArn(arn: string | undefined): string | undefined {
  if (!arn) return undefined;
  const parts = arn.split(":");
  if (parts.length < 6) return undefined;
  if (parts[0] !== "arn") return undefined;
  const region = parts[3];
  if (typeof region !== "string" || !region) return undefined;
  return region;
}
