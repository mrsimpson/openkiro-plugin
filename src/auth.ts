/**
 * Encode refresh token for storage (IDC format: token|clientId|clientSecret|idc)
 * The region is NOT embedded in the token — it comes from config.
 */
export function encodeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  _idcRegion?: string
): string {
  return `${refreshToken}|${clientId}|${clientSecret}|idc`;
}

/**
 * Decode refresh token from storage (4-part format: token|clientId|clientSecret|idc)
 */
export function decodeRefreshToken(
  encoded: string
): {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
} {
  const parts = encoded.split('|');
  if (parts.length < 4) {
    throw new Error('Invalid encoded token format');
  }
  return {
    refreshToken: parts[0]!,
    clientId: parts[1]!,
    clientSecret: parts[2]!,
  };
}

/**
 * Check if access token is expired (with 120s buffer)
 */
export function accessTokenExpired(expiresAt: number, bufferMs = 120000): boolean {
  return Date.now() >= expiresAt - bufferMs;
}
