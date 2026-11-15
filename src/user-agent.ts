import { execSync } from "child_process";

/**
 * Used when the installed Kiro CLI version cannot be read.
 * Keep reasonably current: the API rejects clients it considers outdated.
 */
export const FALLBACK_KIRO_VERSION = "2.35.2";

let cachedVersion: string | undefined;

/** Extracts "x.y.z" from `kiro-cli --version` output such as "kiro-cli 2.35.2". */
export function parseKiroCliVersion(output: string): string | undefined {
  return output.match(/(\d+\.\d+\.\d+)/)?.[1];
}

/**
 * Returns the installed kiro-cli version, resolved lazily on first use and cached.
 * Falls back to FALLBACK_KIRO_VERSION if the CLI is unavailable.
 */
function getKiroCliVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const output = execSync("kiro-cli --version", { encoding: "utf-8", timeout: 5_000 });
    cachedVersion = parseKiroCliVersion(output) ?? FALLBACK_KIRO_VERSION;
  } catch {
    cachedVersion = FALLBACK_KIRO_VERSION;
  }
  return cachedVersion;
}

/**
 * User-agent tokens in the format the Kiro CLI uses. The API's client-version
 * check looks for the `md/appVersion-<ver>` token and answers 403
 * "This version of Kiro is no longer supported" without it.
 */
export function kiroUserAgentParts(version = getKiroCliVersion()): string[] {
  return [`KiroCLI/${version}`, `KAS/${version}`, `os/${process.platform}`, `md/appVersion-${version}`];
}

export function kiroUserAgent(version = getKiroCliVersion()): string {
  return kiroUserAgentParts(version).join(" ");
}
