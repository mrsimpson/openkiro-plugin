/**
 * Tests validating each issue identified in REVIEW.md.
 * These tests document the EXPECTED correct behavior — they will FAIL against
 * the current implementation, proving the bugs exist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeRefreshToken, decodeRefreshToken } from './auth.js'
import { refreshAccessToken } from './token.js'
import { createSdkClient, clearSdkClientCache } from './sdk-client.js'
import { transformToSdkRequest } from './request.js'

// ─────────────────────────────────────────────────────────────────────────────
// BUG-1: SDK client must use access token, not refresh token
// Original: src/plugin/sdk-client.ts:18 — `const token = auth.access`
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-1: SDK client must authenticate with access token', () => {
  afterEach(() => {
    clearSdkClientCache()
  })

  it('should use an access token field for the bearer token, not refreshToken', () => {
    // The original at src/plugin/sdk-client.ts:18 uses `const token = auth.access`
    // The minimal uses `const token = auth.refreshToken` — sending refresh token as bearer.
    //
    // We test by reading the source file to verify the token assignment.
    // This is a source-level assertion: createSdkClient must read from an `access` field.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './sdk-client.ts'),
      'utf-8'
    )

    // The source should contain `auth.access` (like the original),
    // NOT `auth.refreshToken` for the bearer token.
    expect(source).toContain('auth.access')
    expect(source).not.toMatch(/const token = auth\.refreshToken/)
  })

  it('KiroAuthDetails type must include an access field', () => {
    // The original KiroAuthDetails has: { refresh, access, expires, ... }
    // The minimal KiroAuthDetails has: { refreshToken, clientId, clientSecret, idcRegion, expiresAt }
    // Missing: `access` field for the bearer token.
    const fs = require('fs')
    const typesSource = fs.readFileSync(
      require('path').resolve(__dirname, './types.ts'),
      'utf-8'
    )

    // KiroAuthDetails should have an `access` field for the current access token
    expect(typesSource).toMatch(/access\s*[?:]?\s*:?\s*string/)
  })

  it('cache key should use identity (email), not refresh token secret', () => {
    // Original uses `${region}:${auth.email || 'default'}` as cache key.
    // Minimal uses `${region}:${auth.refreshToken}` — leaking the secret into a Map key.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './sdk-client.ts'),
      'utf-8'
    )

    // Cache key should NOT contain refreshToken
    expect(source).not.toMatch(/cacheKey.*auth\.refreshToken/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-2 & BUG-3: customFetch must use fresh access token and refresh mid-session
// Original: src/core/request/request-handler.ts:104 — refreshIfNeeded() before every call
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-2 & BUG-3: auth.loader must provide a fetch that refreshes tokens', () => {
  it('customFetch should pass an access token (not refreshToken) to createSdkClient', () => {
    // The auth.loader's customFetch creates the SDK client with:
    //   createSdkClient({ refreshToken: decoded.refreshToken, ... }, region)
    // and sdk-client.ts reads auth.refreshToken as the bearer.
    //
    // Correct: customFetch should pass the fresh access token obtained from refreshAccessToken.
    // We verify by reading the source.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // The customFetch section should NOT pass decoded.refreshToken to createSdkClient.
    // It should pass the refreshed accessToken.
    // Look for the SDK client creation inside customFetch:
    const customFetchSection = source.slice(source.indexOf('customFetch'))

    // Should reference accessToken (the fresh one), not decoded.refreshToken
    expect(customFetchSection).not.toMatch(/createSdkClient\s*\(\s*\{[^}]*refreshToken:\s*decoded\.refreshToken/)
  })

  it('customFetch should refresh token on every request if expired', () => {
    // Original: TokenRefresher.refreshIfNeeded() is called before EVERY request.
    // Current: token is refreshed once in auth.loader, then the closure is stale.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // The customFetch function body should contain a token expiry check.
    // Look for accessTokenExpired or expiry check inside the customFetch closure.
    const customFetchBody = source.slice(
      source.indexOf('const customFetch'),
      source.indexOf('return { apiKey')
    )

    // Expected: customFetch should check expiry and refresh before each request
    expect(customFetchBody).toMatch(/accessTokenExpired|expiresAt.*Date\.now|refreshAccessToken/)
  })

  it('refreshed accessToken variable should be used in SDK client creation', () => {
    // BUG-2: index.ts refreshes token into `accessToken` (line 167) but never uses it.
    // The customFetch still reads from the stale `decoded` closure.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // After `accessToken = refreshed.accessToken` (line ~173), the customFetch
    // should use `accessToken` when creating the SDK client.
    // Currently it uses `decoded.refreshToken` instead.
    const customFetchSection = source.slice(source.indexOf('const customFetch'))

    // The SDK client auth object inside customFetch should reference `accessToken`
    expect(customFetchSection).toContain('accessToken')
    // And it should NOT be using decoded.refreshToken as the bearer
    expect(customFetchSection).not.toContain('decoded.refreshToken')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-4: Token encoding format must match original (4-part, not 5-part)
// Original: src/kiro/auth.ts:21 — `${refreshToken}|${clientId}|${clientSecret}|idc`
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-4: Token encoding format mismatch', () => {
  it('should encode IDC tokens in 4-part format: refreshToken|clientId|clientSecret|idc', () => {
    const encoded = encodeRefreshToken('rt', 'cid', 'csec', 'us-east-1')

    // Original format: "rt|cid|csec|idc" (4 parts)
    // Current format:  "rt|cid|csec|us-east-1|idc" (5 parts)
    const parts = encoded.split('|')

    // Expected: 4 parts — region should NOT be embedded in the token
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('rt')
    expect(parts[1]).toBe('cid')
    expect(parts[2]).toBe('csec')
    expect(parts[3]).toBe('idc')
  })

  it('should be decodable by the original implementation format', () => {
    // Original decode expects: parts[0]=refresh, parts[1]=clientId, parts[2]=clientSecret
    // and parts[last]='idc' as the auth method marker
    const originalFormat = 'my-refresh|my-client|my-secret|idc'

    // Current decode expects 5+ parts and reads parts[3] as idcRegion
    // This will either throw or return wrong values for 4-part tokens
    const decoded = decodeRefreshToken(originalFormat)

    // Expected: should successfully decode a 4-part original-format token
    expect(decoded.refreshToken).toBe('my-refresh')
    expect(decoded.clientId).toBe('my-client')
    expect(decoded.clientSecret).toBe('my-secret')
  })

  it('encoded tokens should NOT contain the region', () => {
    const encoded = encodeRefreshToken('rt', 'cid', 'csec', 'eu-central-1')

    // The region 'eu-central-1' should NOT appear in the encoded string
    // because the original stores region separately on the account record.
    expect(encoded).not.toContain('eu-central-1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-5: Token refresh must send JSON body (not URL-encoded)
// Original: src/plugin/token.ts:33-44 — Content-Type: application/json
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-5: Token refresh must use JSON body', () => {
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should send Content-Type: application/json', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    })

    await refreshAccessToken('rt', 'cid', 'csec', 'us-east-1')

    const [, init] = fetchSpy.mock.calls[0]
    // Original uses 'application/json', current uses 'application/x-www-form-urlencoded'
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('should send JSON body with camelCase field names', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    })

    await refreshAccessToken('rt', 'cid', 'csec', 'us-east-1')

    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse(init.body)

    // Original sends camelCase JSON:
    // { refreshToken, clientId, clientSecret, grantType: 'refresh_token' }
    expect(body.refreshToken).toBe('rt')
    expect(body.clientId).toBe('cid')
    expect(body.clientSecret).toBe('csec')
    expect(body.grantType).toBe('refresh_token')
  })

  it('should include required headers: Accept, amz-sdk-request, x-amzn-kiro-agent-mode', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    })

    await refreshAccessToken('rt', 'cid', 'csec', 'us-east-1')

    const [, init] = fetchSpy.mock.calls[0]
    // Original includes these headers (src/plugin/token.ts:36-40)
    expect(init.headers['Accept']).toBe('application/json')
    expect(init.headers['amz-sdk-request']).toBe('attempt=1; max=1')
    expect(init.headers['x-amzn-kiro-agent-mode']).toBe('vibe')
    expect(init.headers['Connection']).toBe('close')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-6: clientSecret field must not be abused as expiry timestamp
// Original: stores expiresAt on the ManagedAccount record, not in auth.json
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-6: clientSecret must not store expiry timestamp', () => {
  it('auth.loader should NOT parse clientSecret as a number for expiresAt', () => {
    // The current implementation at index.ts:161 does:
    //   const expiresAt = authData.auth.clientSecret ? parseInt(authData.auth.clientSecret) : ...
    // This conflates the OIDC client secret with an expiry timestamp.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // The source should NOT contain parseInt(authData.auth.clientSecret)
    // or use clientSecret as a timestamp.
    expect(source).not.toMatch(/parseInt\(authData\.auth\.clientSecret\)/)
    expect(source).not.toMatch(/clientSecret.*expiresAt|expiresAt.*clientSecret.*parseInt/)
  })

  it('auth entry written to auth.json should have a dedicated expiresAt field', () => {
    // Original: ManagedAccount stores expiresAt as its own numeric field.
    // Current: repurposes clientSecret field (auth.kiro.clientSecret = String(refreshed.expiresAt))
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // Should NOT write expiresAt into clientSecret
    expect(source).not.toMatch(/clientSecret\s*=\s*String\(.*expiresAt/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GAP-1: Plugin interface must match OpenCode's contract
// Original: src/plugin.ts — config hook, auth.loader(getAuth), auth.methods shape
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP-1: Plugin interface must match OpenCode contract', () => {
  let plugin: any

  beforeEach(async () => {
    const mod = await import('./index.js')
    plugin = mod.default
  })

  it('config should be a function (hook), not an object with schema', () => {
    // Original: config is `async (input) => { input.provider[id] = {...} }`
    // Current: config is `{ schema: ZodSchema }`
    expect(typeof plugin.config).toBe('function')
  })

  it('config hook should mutate input.provider with npm, api, and models', async () => {
    // Original: src/plugin.ts:39-127
    const input = { provider: {} }

    if (typeof plugin.config === 'function') {
      await plugin.config(input)

      expect((input.provider as any).kiro).toBeDefined()
      expect((input.provider as any).kiro.npm).toBe('@ai-sdk/openai-compatible')
      expect((input.provider as any).kiro.api).toBeDefined()
      expect((input.provider as any).kiro.models).toBeDefined()
    } else {
      // Current implementation fails here — config is not a function
      expect.fail('config must be a hook function, not { schema }')
    }
  })

  it('auth.loader should accept a getAuth callback and call it', () => {
    // Original: src/plugin.ts:131 — `loader: async (getAuth) => { await getAuth(); ... }`
    // The loader calls getAuth() to trigger OpenCode's auth resolution.
    // Current: takes raw authData object directly.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // The loader definition should accept `getAuth` (a function), not `authData` (an object)
    // and should call `await getAuth()` before proceeding.
    const loaderDef = source.match(/loader:\s*async\s*\(([^)]+)\)/)
    expect(loaderDef).not.toBeNull()

    const paramName = loaderDef![1].trim().split(/[:{]/)[0].trim()
    // Parameter should be named something like getAuth, not authData
    expect(paramName).not.toMatch(/authData|auth/)
    expect(source).toMatch(/await\s+getAuth\s*\(\s*\)/)
  })

  it('auth.methods should return objects with { label, type, prompts, authorize }', () => {
    // Original: src/core/auth/auth-handler.ts:73-168
    // Each method: { label: string, type: 'oauth', prompts: [...], authorize: fn }
    const methods = plugin.auth.methods

    expect(Array.isArray(methods)).toBe(true)
    expect(methods.length).toBeGreaterThan(0)

    const method = methods[0]

    // Required fields per OpenCode's AuthHook['methods'] type:
    expect(method).toHaveProperty('label')
    expect(method).toHaveProperty('type')
    expect(method.type).toBe('oauth')
    expect(method).toHaveProperty('prompts')
    expect(Array.isArray(method.prompts)).toBe(true)
    expect(method).toHaveProperty('authorize')
    expect(typeof method.authorize).toBe('function')

    // Current implementation has: { id, name, description, handler } — wrong shape
    expect(method).not.toHaveProperty('handler') // should use authorize, not handler
    expect(method).not.toHaveProperty('id') // OpenCode doesn't use this
  })

  it('auth.methods prompts should have text inputs for start_url and idc_region', () => {
    // Original: src/core/auth/auth-handler.ts:78-110
    const methods = plugin.auth.methods

    if (!methods[0]?.prompts) {
      expect.fail('methods[0].prompts is required')
      return
    }

    const prompts = methods[0].prompts
    const keys = prompts.map((p: any) => p.key)

    expect(keys).toContain('start_url')
    expect(keys).toContain('idc_region')

    for (const prompt of prompts) {
      expect(prompt).toHaveProperty('type')
      expect(prompt.type).toBe('text')
      expect(prompt).toHaveProperty('key')
      expect(prompt).toHaveProperty('message')
    }
  })

  it('auth.methods authorize should return AuthOauthResult shape', async () => {
    // Original: src/core/auth/idc-auth-method.ts:60-89
    // Returns: { url, instructions, method: 'auto', callback: async () => {...} }
    const methods = plugin.auth.methods

    if (!methods[0]?.authorize) {
      expect.fail('methods[0].authorize is required')
      return
    }

    // We can't actually call authorize (it starts a real OAuth flow),
    // but we verify the function exists and accepts inputs.
    expect(typeof methods[0].authorize).toBe('function')
  })

  it('provider.models should be a function that normalizes model definitions', () => {
    // Original: src/plugin.ts:148-166
    const provider = plugin.provider

    if (typeof provider === 'function') {
      // Current implementation returns a plain object, not a models hook
      expect.fail('provider should be an object with a models function, not an async function')
    }

    expect(provider).toHaveProperty('models')
    expect(typeof provider.models).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GAP-2: profileArn must be passed in API requests
// Original: src/plugin/request.ts:193 — if (auth.profileArn) request.profileArn = auth.profileArn
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP-2: profileArn must be included in requests', () => {
  it('transformToSdkRequest should include profileArn when auth has one', () => {
    const auth = {
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'csec',
      idcRegion: 'us-east-1',
      expiresAt: Date.now() + 3600000,
      profileArn: 'arn:aws:codewhisperer:us-east-1:123456789012:profile/ABCDEF',
    }

    const result = transformToSdkRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        model: 'claude-sonnet-4-5',
      }),
      'claude-sonnet-4-5',
      auth as any
    )

    // Original: request.profileArn is set and passed to GenerateAssistantResponseCommand
    expect(result.profileArn).toBe(
      'arn:aws:codewhisperer:us-east-1:123456789012:profile/ABCDEF'
    )
  })

  it('should derive region from profileArn when available', () => {
    const auth = {
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'csec',
      idcRegion: 'us-east-1',
      expiresAt: Date.now() + 3600000,
      profileArn: 'arn:aws:codewhisperer:eu-central-1:123456789012:profile/ABCDEF',
    }

    const result = transformToSdkRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        model: 'claude-sonnet-4-5',
      }),
      'claude-sonnet-4-5',
      auth as any
    )

    // Original: region = extractRegionFromArn(auth.profileArn) ?? auth.region
    // The ARN contains eu-central-1, so region should be derived from it.
    expect(result.region).toBe('eu-central-1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GAP-3: No retry or error recovery
// Original: src/core/request/request-handler.ts — full retry loop
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP-3: Fetch interceptor should retry on transient errors', () => {
  it('customFetch should contain retry logic for transient errors', () => {
    // Original: ErrorHandler classifies 429 as retryable, RequestHandler retries.
    // Current: no retry at all — a single 429 causes permanent failure.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    const customFetchBody = source.slice(
      source.indexOf('const customFetch'),
      source.indexOf('return { apiKey')
    )

    // Should have retry logic: a loop, retry counter, or retry utility
    expect(customFetchBody).toMatch(/retry|maxAttempts|while\s*\(|for\s*\(/)
  })

  it('should handle 429 rate limit responses gracefully', () => {
    // Original: src/core/request/error-handler.ts classifies 429 and triggers retry
    // with optional account switching.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // Should check for rate limit status codes
    expect(source).toMatch(/429|rate.?limit|throttl/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GAP-5: Thinking mode must be detected from model name and providerOptions
// Original: src/core/request/request-handler.ts:64-65
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP-5: Thinking mode detection', () => {
  it('should enable thinking for models ending in -thinking', () => {
    const auth = {
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'csec',
      idcRegion: 'us-east-1',
      expiresAt: Date.now() + 3600000,
    }

    const result = transformToSdkRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'think about this' }],
        model: 'claude-sonnet-4-5-thinking',
      }),
      'claude-sonnet-4-5-thinking',
      auth
    )

    // When model ends with '-thinking', the system prompt should include
    // <thinking_mode>enabled</thinking_mode>
    const history = result.conversationState.history || []
    const firstMsg = history[0]
    const systemContent = firstMsg?.userInputMessage?.content || ''

    expect(systemContent).toContain('<thinking_mode>enabled</thinking_mode>')
  })

  it('should enable thinking when providerOptions.thinkingConfig is present', () => {
    const auth = {
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'csec',
      idcRegion: 'us-east-1',
      expiresAt: Date.now() + 3600000,
    }

    // The customFetch in index.ts should read providerOptions from the body
    // and pass think=true to transformToSdkRequest.
    // Currently it always passes think=false (default).
    const bodyWithThinking = {
      messages: [{ role: 'user', content: 'think about this' }],
      model: 'claude-sonnet-4-5',
      providerOptions: { thinkingConfig: { thinkingBudget: 50000 } },
    }

    // When called with think=true, budget=50000, it should inject thinking mode
    const result = transformToSdkRequest(
      JSON.stringify(bodyWithThinking),
      'claude-sonnet-4-5',
      auth,
      true, // think — this is what customFetch should pass
      50000 // budget from providerOptions
    )

    const history = result.conversationState.history || []
    const firstMsg = history[0]
    const systemContent = firstMsg?.userInputMessage?.content || ''

    expect(systemContent).toContain('<thinking_mode>enabled</thinking_mode>')
    expect(systemContent).toContain('<max_thinking_length>50000</max_thinking_length>')
  })

  it('customFetch should detect thinking mode from model name and providerOptions', () => {
    // Original: src/core/request/request-handler.ts:64-65
    //   const think = model.endsWith('-thinking') || !!body.providerOptions?.thinkingConfig
    //   const budget = body.providerOptions?.thinkingConfig?.thinkingBudget || 20000
    // Current: always calls transformToSdkRequest(body, model, auth) without think/budget.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    const customFetchBody = source.slice(
      source.indexOf('const customFetch'),
      source.indexOf('return { apiKey')
    )

    // customFetch should inspect providerOptions.thinkingConfig
    expect(customFetchBody).toContain('providerOptions')
    // customFetch should check model name for -thinking suffix
    expect(customFetchBody).toMatch(/endsWith.*thinking|thinking.*model/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GAP-6: MODEL_MAPPING should be used for validation
// Original: src/plugin/models.ts — validates and maps model IDs
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP-6: Model resolution should use MODEL_MAPPING', () => {
  it('should resolve model aliases via MODEL_MAPPING', () => {
    const auth = {
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'csec',
      idcRegion: 'us-east-1',
      expiresAt: Date.now() + 3600000,
    }

    // MODEL_MAPPING maps user-facing names to internal model IDs.
    // resolveKiroModel should use it, but currently it's a passthrough stub.
    const result = transformToSdkRequest(
      JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'auto',
      }),
      'auto',
      auth
    )

    // 'auto' should be resolved to a concrete model ID via MODEL_MAPPING.
    // Currently the stub just returns 'auto' unchanged.
    expect(result.effectiveModel).not.toBe('auto')
  })

  it('should reject unsupported model names', () => {
    const auth = {
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'csec',
      idcRegion: 'us-east-1',
      expiresAt: Date.now() + 3600000,
    }

    // An unsupported model should throw, not pass through silently.
    expect(() =>
      transformToSdkRequest(
        JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          model: 'gpt-4-nonexistent',
        }),
        'gpt-4-nonexistent',
        auth
      )
    ).toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GAP-7: Should use GenerateAssistantResponseCommand via client.send()
// Original: src/core/request/request-handler.ts:120-125
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP-7: SDK usage should use Command pattern', () => {
  it('should use client.send(command) pattern, not direct method call', () => {
    // Original:
    //   const command = new GenerateAssistantResponseCommand({...})
    //   const sdkResponse = await client.send(command)
    //
    // Current (index.ts:239):
    //   const sdkResponse = await (sdkClient as any).generateAssistantResponse(...)
    //
    // Using client.send(command) ensures all middleware runs.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // Should import and use GenerateAssistantResponseCommand
    expect(source).toContain('GenerateAssistantResponseCommand')
    // Should use client.send() pattern
    expect(source).toMatch(/\.send\s*\(/)
    // Should NOT use direct method call cast with (as any)
    expect(source).not.toMatch(/as any\)\.generateAssistantResponse/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GAP-4: Auth bootstrap for seamless startup
// Original: src/plugin/auth-bootstrap.ts
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP-4: Auth bootstrap', () => {
  it('config hook should bootstrap auth entry for seamless startup', () => {
    // Original: bootstrapAuthIfNeeded(id) is called inside the config hook
    // (src/plugin.ts:42) to write a placeholder entry into auth.json.
    // This ensures OpenCode calls the auth.loader even without prior OAuth.
    //
    // Current: no bootstrap — auth entry only appears after explicit OAuth.
    const fs = require('fs')
    const source = fs.readFileSync(
      require('path').resolve(__dirname, './index.ts'),
      'utf-8'
    )

    // The config hook (or plugin initialization) should call a bootstrap function
    expect(source).toMatch(/bootstrap|writeAuthFile.*placeholder|ensureAuth/)
  })
})
