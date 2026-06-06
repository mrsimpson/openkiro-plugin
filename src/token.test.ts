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
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should send JSON body with camelCase field names', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });

      await refreshAccessToken('rt', 'cid', 'csec', 'us-east-1');

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body);

      expect(body.refreshToken).toBe('rt');
      expect(body.clientId).toBe('cid');
      expect(body.clientSecret).toBe('csec');
      expect(body.grantType).toBe('refresh_token');
    });

    it('should include required headers: Accept, amz-sdk-request, x-amzn-kiro-agent-mode', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      });

      await refreshAccessToken('rt', 'cid', 'csec', 'us-east-1');

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers['Accept']).toBe('application/json');
      expect(init.headers['amz-sdk-request']).toBe('attempt=1; max=1');
      expect(init.headers['x-amzn-kiro-agent-mode']).toBe('vibe');
      expect(init.headers['Connection']).toBe('close');
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
