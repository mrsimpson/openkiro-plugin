/**
 * Encode refresh token for storage (IDC format: token|clientId|clientSecret|region|idc)
 */
export function encodeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  idcRegion: string
): string {
  return `${refreshToken}|${clientId}|${clientSecret}|${idcRegion}|idc`;
}

/**
 * Decode refresh token from storage
 */
export function decodeRefreshToken(
  encoded: string
): {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  idcRegion: string;
} {
  const parts = encoded.split('|');
  if (parts.length < 5) {
    throw new Error('Invalid encoded token format');
  }
  return {
    refreshToken: parts[0]!,
    clientId: parts[1]!,
    clientSecret: parts[2]!,
    idcRegion: parts[3]!,
  };
}

/**
 * Check if access token is expired (with 120s buffer)
 */
export function accessTokenExpired(expiresAt: number, bufferMs = 120000): boolean {
  return Date.now() >= expiresAt - bufferMs;
}
