/**
 * Encode refresh token for storage
 */
export function encodeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  idcRegion: string
): string {
  throw new Error('not implemented');
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
  throw new Error('not implemented');
}

/**
 * Check if access token is expired
 */
export function accessTokenExpired(expiresAt: number): boolean {
  throw new Error('not implemented');
}
