import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Database } from "bun:sqlite";

export interface KiroCliAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  clientSecret: string;
  region: string;
  startUrl: string;
  profileArn?: string;
}

function getCliDbPath(): string {
  if (process.env.KIROCLI_DB_PATH) return process.env.KIROCLI_DB_PATH;
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "kiro-cli",
      "data.sqlite3",
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "kiro-cli", "data.sqlite3");
  }
  return path.join(os.homedir(), ".local", "share", "kiro-cli", "data.sqlite3");
}

function queryState(db: Database, key: string): string | undefined {
  try {
    const row = db.query("SELECT value FROM state WHERE key = ?").get(key) as any;
    return row?.value ?? undefined;
  } catch {
    return undefined;
  }
}

function queryAuthKv(db: Database, key: string): string | undefined {
  try {
    const row = db.query("SELECT value FROM auth_kv WHERE key = ?").get(key) as any;
    return row?.value ?? undefined;
  } catch {
    return undefined;
  }
}

export function readKiroCliAuth(): KiroCliAuth | null {
  const dbPath = getCliDbPath();
  if (!fs.existsSync(dbPath)) return null;

  const db = new Database(dbPath, { readonly: true });

  try {
    const tokenRaw =
      queryAuthKv(db, "kirocli:odic:token") || queryAuthKv(db, "codewhisperer:odic:token");
    if (!tokenRaw) return null;

    const token = JSON.parse(tokenRaw);
    const accessToken = token.access_token || token.accessToken;
    const refreshToken = token.refresh_token || token.refreshToken;
    if (!accessToken || !refreshToken) return null;

    const regRaw =
      queryAuthKv(db, "kirocli:odic:device-registration") ||
      queryAuthKv(db, "codewhisperer:odic:device-registration");
    if (!regRaw) return null;

    const reg = JSON.parse(regRaw);
    const clientId = reg.client_id || reg.clientId;
    const clientSecret = reg.client_secret || reg.clientSecret;
    if (!clientId || !clientSecret) return null;

    let expiresAt: number;
    if (token.expires_at) {
      expiresAt = new Date(token.expires_at).getTime();
    } else if (token.expires_in) {
      expiresAt = Date.now() + token.expires_in * 1000;
    } else {
      expiresAt = 0;
    }

    const region = token.region || reg.region || "us-east-1";
    const startUrl = token.start_url || reg.start_url || "";

    let profileArn: string | undefined;
    const profileRaw = queryState(db, "api.codewhisperer.profile");
    if (profileRaw) {
      try {
        const parsed = JSON.parse(profileRaw);
        profileArn = parsed?.arn || parsed?.profileArn || parsed?.profile_arn;
      } catch {}
    }

    return {
      accessToken,
      refreshToken,
      expiresAt,
      clientId,
      clientSecret,
      region,
      startUrl,
      profileArn,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}
