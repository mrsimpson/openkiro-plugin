/**
 * Authorize via Kiro IDC (device code flow)
 */
export function authorizeKiroIDC(
  idcStartUrl: string,
  idcRegion: string
): Promise<{
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  expiresAt: number;
}> {
  throw new Error('not implemented');
}

/**
 * Poll for token from Kiro IDC device code flow
 */
export function pollKiroIDCToken(
  deviceCode: string,
  clientId: string,
  clientSecret: string,
  idcRegion: string
): Promise<{
  refreshToken: string;
  expiresAt: number;
}> {
  throw new Error('not implemented');
}
