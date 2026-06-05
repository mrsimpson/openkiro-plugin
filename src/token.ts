/**
 * Custom error for token refresh failures
 */
export class KiroTokenRefreshError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'KiroTokenRefreshError';
  }
}

/**
 * Refresh access token via OIDC endpoint
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  idcRegion: string
): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
  throw new Error('not implemented');
}
