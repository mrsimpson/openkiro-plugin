import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshAccessToken, KiroTokenRefreshError } from './token.js';

describe('token', () => {
  describe('refreshAccessToken', () => {
    let fetchSpy: any;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call OIDC endpoint with correct parameters', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: 3600,
        }),
      };

      fetchSpy.mockResolvedValueOnce(mockResponse);

      const refreshToken = 'test-refresh-token';
      const clientId = 'test-client-id';
      const clientSecret = 'test-client-secret';
      const idcRegion = 'eu-central-1';

      const result = await refreshAccessToken(
        refreshToken,
        clientId,
        clientSecret,
        idcRegion
      );

      expect(result.accessToken).toBe('new-access-token');
      expect(typeof result.expiresAt).toBe('number');
      expect(result.expiresAt).toBeGreaterThan(Date.now());

      // Verify fetch was called with correct URL and body
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`oidc.${idcRegion}.amazonaws.com`),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );
    });

    it('should throw KiroTokenRefreshError on HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'invalid_grant' }),
      };

      fetchSpy.mockResolvedValueOnce(mockResponse);

      const refreshToken = 'test-refresh-token';
      const clientId = 'test-client-id';
      const clientSecret = 'test-client-secret';
      const idcRegion = 'eu-central-1';

      await expect(
        refreshAccessToken(refreshToken, clientId, clientSecret, idcRegion)
      ).rejects.toThrow(KiroTokenRefreshError);
    });

    it('should throw KiroTokenRefreshError on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const refreshToken = 'test-refresh-token';
      const clientId = 'test-client-id';
      const clientSecret = 'test-client-secret';
      const idcRegion = 'eu-central-1';

      await expect(
        refreshAccessToken(refreshToken, clientId, clientSecret, idcRegion)
      ).rejects.toThrow(KiroTokenRefreshError);
    });

    it('should return token with correct expiration timestamp', async () => {
      const expiresIn = 7200; // 2 hours
      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          expires_in: expiresIn,
        }),
      };

      fetchSpy.mockResolvedValueOnce(mockResponse);

      const result = await refreshAccessToken(
        'test-refresh-token',
        'test-client-id',
        'test-client-secret',
        'eu-central-1'
      );

      const timeDiff = result.expiresAt - Date.now();
      // Should be approximately expiresIn milliseconds (with small tolerance for execution time)
      expect(timeDiff).toBeGreaterThan(expiresIn * 1000 - 1000);
      expect(timeDiff).toBeLessThan(expiresIn * 1000 + 1000);
    });
  });
});
