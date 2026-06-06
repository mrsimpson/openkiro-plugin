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
  const url = `https://oidc.${idcRegion}.amazonaws.com/token`;

  const requestBody = {
    refreshToken: refreshToken,
    clientId: clientId,
    clientSecret: clientSecret,
    grantType: 'refresh_token',
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'amz-sdk-request': 'attempt=1; max=1',
        'x-amzn-kiro-agent-mode': 'vibe',
        'user-agent':
          'aws-sdk-js/3.738.0 ua/2.1 os/other lang/js md/browser#unknown_unknown api/sso-oidc#3.738.0 m/E KiroIDE',
        'Connection': 'close',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const txt = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(txt);
      } catch {
        data = { message: txt };
      }
      throw new KiroTokenRefreshError(
        `Refresh failed: ${data.message || data.error_description || txt}`,
        data.error || `HTTP_${res.status}`
      );
    }

    const d = (await res.json()) as any;
    const acc = d.access_token || d.accessToken;

    if (!acc) {
      throw new KiroTokenRefreshError('No access token in response', 'INVALID_RESPONSE');
    }

    const expiresInSeconds = d.expires_in || d.expiresIn || 3600;

    return {
      accessToken: acc,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
  } catch (error) {
    if (error instanceof KiroTokenRefreshError) throw error;
    throw new KiroTokenRefreshError(
      `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'NETWORK_ERROR'
    );
  }
}
