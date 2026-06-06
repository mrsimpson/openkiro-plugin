# Implementation Review: openkiro-plugin

Gap analysis comparing the minimal IDC-only plugin against the full
`opencode-kiro-auth` implementation (hereafter "original").

## Scope

The minimal plugin targets three goals:

1. Authenticate via a single IDC (AWS IAM Identity Center)
2. ~~Get credentials from the kiro-aws database~~ (skipped)
3. Refresh tokens implicitly

---

## Critical Bugs

### BUG-1: SDK client authenticates with `refreshToken` instead of `accessToken`

| File | Line | Issue |
|------|------|-------|
| `src/sdk-client.ts` | 18 | `const token = auth.refreshToken` |
| Original `src/plugin/sdk-client.ts` | 18 | `const token = auth.access` |

The CodeWhisperer SDK sends this value as a Bearer token. Using the refresh
token will cause **every API call to fail** with a 401.

### BUG-2: Refreshed `accessToken` is never passed to `customFetch`

In `src/index.ts`, the `auth.loader` refreshes the token (line 167) into a
local `accessToken` variable, but `customFetch` (line 205) still constructs the
SDK client with `decoded.refreshToken` from the outer closure. The fresh access
token is discarded.

### BUG-3: Stale closure — no mid-session token refresh

`customFetch` captures `decoded`, `expiresAt`, and `accessToken` at
loader-invocation time. After the access token expires (~1 hour), all subsequent
requests fail with no recovery path.

**Original's approach:** `RequestHandler.handleKiroRequest()` calls
`tokenRefresher.refreshIfNeeded(acc, auth, showToast)` before **every** request
(see `src/core/request/request-handler.ts:104`). On failure it falls back to
`triggerReauth()` (line 289).

### BUG-4: Token encoding format mismatch

| Implementation | Format |
|----------------|--------|
| Minimal (`src/auth.ts:9`) | `refreshToken\|clientId\|clientSecret\|idcRegion\|idc` (5 parts) |
| Original (`src/kiro/auth.ts:21`) | `refreshToken\|clientId\|clientSecret\|idc` (4 parts) |

Tokens are **not interchangeable** between the two implementations. The original
does not store the region inside the token — it stores it on the
`ManagedAccount` record.

### BUG-5: Token refresh sends URL-encoded body

| File | Content-Type | Body encoding |
|------|--------------|---------------|
| `src/token.ts:25-29` | `application/x-www-form-urlencoded` | `URLSearchParams` |
| Original `src/plugin/token.ts:33-43` | `application/json` | `JSON.stringify` |

The original also sends additional headers (`Accept`, `amz-sdk-request`,
`x-amzn-kiro-agent-mode`, `Connection: close`) that the minimal version omits.

### BUG-6: `clientSecret` auth field abused as expiry timestamp

`src/index.ts:161`:
```ts
const expiresAt = authData.auth.clientSecret
  ? parseInt(authData.auth.clientSecret)
  : Date.now() + 3600000
```

The `clientSecret` field is repurposed to store `expiresAt`. This conflates two
different concepts and will break if OpenCode ever validates the auth entry
structure.

---

## Structural Gaps

### GAP-1: Plugin interface does not match OpenCode's contract

The original (`src/plugin.ts`) exposes:

```ts
// config hook: mutates the input object
config: async (input) => { ... }

// auth.loader: receives a getAuth callback
auth: { loader: async (getAuth) => { await getAuth(); ... } }

// auth.methods: returns AuthHook['methods'] shape
auth: { methods: authHandler.getMethods() }
// Each method: { label, type: 'oauth', prompts: [...], authorize: (inputs) => AuthOauthResult }

// provider.models: normalizes model definitions
provider: { models: async (provider) => { ... } }
```

The minimal plugin (`src/index.ts`) exposes:

```ts
// config.schema: a Zod schema (not a hook function)
config: { schema: KiroConfigSchema }

// auth.loader: takes raw authData (not a getAuth callback)
auth: { loader: async (authData) => { ... } }

// auth.methods: array of { id, name, description, handler }
// Missing: label, type, prompts, authorize, AuthOauthResult return type
auth: { methods: [{ id, name, description, handler }] }

// provider: returns { name, id } — no models hook
provider: async (options) => { name: 'kiro', id: 'kiro' }
```

**Impact:** The plugin likely won't load in OpenCode. Key differences:

1. `auth.methods` must return `{ label, type: 'oauth', prompts, authorize }`
   (see original `src/core/auth/auth-handler.ts:63-168`)
2. `auth.loader` must accept a `getAuth` callback to trigger initial auth load
   (see original `src/plugin.ts:131`)
3. `config` must be a function that mutates `input.provider[id]`, setting `npm`,
   `api`, and `models` (see original `src/plugin.ts:39-127`)
4. `provider.models` must normalize model definitions with `api.url` fields
   (see original `src/plugin.ts:148-166`)

### GAP-2: No `profileArn` in API requests

The original passes `profileArn` to the `GenerateAssistantResponseCommand`:

- `src/plugin/request.ts:193` — `if (auth.profileArn) request.profileArn = auth.profileArn`
- `src/core/request/request-handler.ts:122` — `profileArn: sdkPrep.profileArn`
- Region derivation: `extractRegionFromArn(auth.profileArn) ?? auth.region` (line 336)

The minimal plugin never sets `profileArn` on the request. Instead it passes
`request.idcRegion` (line 192 of `src/request.ts`). For IAM Identity Center
accounts, the API requires `profileArn` to identify the entitlement.

### GAP-3: No retry or error recovery

The original has a full retry loop in `src/core/request/request-handler.ts`:

- `RetryStrategy` (`src/core/request/retry-strategy.ts`) — budget-based retry
- `ErrorHandler` (`src/core/request/error-handler.ts`) — classifies errors
- Account switching on rate-limit (429)
- `triggerReauth()` when all accounts are unhealthy (line 289-343)
- Exponential backoff for null-account scenarios (line 96-98)

The minimal plugin's `customFetch` has **zero** retry logic. A single failure
results in an unrecoverable error.

### GAP-4: No auth bootstrap

The original (`src/plugin/auth-bootstrap.ts`) writes a placeholder entry into
`auth.json` so OpenCode calls the auth loader on startup — enabling seamless
import of credentials without prior user interaction.

The minimal plugin only writes auth entries **after** explicit OAuth flow
completion.

### GAP-5: Thinking mode never activates

The minimal plugin's `customFetch` calls:
```ts
transformToSdkRequest(body, model, auth)  // think=false, budget=20000 (defaults)
```

It never inspects `body.providerOptions?.thinkingConfig` or model name suffixes
like `-thinking`. Compare with original
`src/core/request/request-handler.ts:64-65`:

```ts
const think = model.endsWith('-thinking') || !!body.providerOptions?.thinkingConfig
const budget = body.providerOptions?.thinkingConfig?.thinkingBudget || 20000
```

### GAP-6: `MODEL_MAPPING` defined but unused

`src/constants.ts` defines `MODEL_MAPPING` but `resolveKiroModel()` in
`src/request.ts:36` is a stub that returns the model unchanged. The original
(`src/plugin/models.ts`) uses it for validation and throws on unsupported models.

### GAP-7: No `GenerateAssistantResponseCommand` usage

The minimal plugin calls `sdkClient.generateAssistantResponse()` directly
(line 239 in `src/index.ts`):

```ts
const sdkResponse = await (sdkClient as any).generateAssistantResponse(sdkRequest.conversationState)
```

The original wraps the call in a proper command:

```ts
const command = new GenerateAssistantResponseCommand({
  conversationState: sdkPrep.conversationState,
  profileArn: sdkPrep.profileArn
})
const sdkResponse = await client.send(command)
```

Using `client.send(command)` ensures middleware (including the auth token
injection) runs correctly. The direct call may bypass middleware.

---

## Implicit Token Refresh (Goal #3): Gap Assessment

The minimal plugin refreshes the token **once** in `auth.loader` when it detects
expiry. This covers the case where OpenCode restarts or re-initializes auth.

**What's missing for true implicit refresh:**

| Requirement | Original Implementation | Minimal Plugin |
|-------------|------------------------|----------------|
| Pre-request expiry check | `TokenRefresher.refreshIfNeeded()` before every API call | None in `customFetch` |
| Token rotation on refresh | Updates `auth.refresh` (the encoded compound token) if server issues a new refresh token (`src/plugin/token.ts:66`) | Does not update refresh token if server rotates it |
| Reauth trigger | `RequestHandler.triggerReauth()` — re-runs OAuth flow transparently | None |
| Cache invalidation after refresh | `createSdkClient` re-creates client when `auth.access` changes (cache key includes token) | Cache key uses `auth.refreshToken` which never changes |

---

## Code Correctly Reused

These files are near-verbatim copies and function correctly:

| Minimal Plugin | Original Source |
|---------------|----------------|
| `src/request.ts` | `src/plugin/request.ts` |
| `src/streaming/sdk-stream-transformer.ts` | `src/plugin/streaming/sdk-stream-transformer.ts` |
| `src/streaming/openai-converter.ts` | `src/plugin/streaming/openai-converter.ts` |
| `src/streaming/stream-parser.ts` | `src/plugin/streaming/stream-parser.ts` |
| `src/streaming/stream-state.ts` | `src/plugin/streaming/stream-state.ts` |
| `src/streaming/types.ts` | `src/plugin/streaming/types.ts` |
| `src/transformers/history-builder.ts` | `src/infrastructure/transformers/history-builder.ts` |
| `src/transformers/message-transformer.ts` | `src/infrastructure/transformers/message-transformer.ts` |
| `src/transformers/tool-transformer.ts` | `src/infrastructure/transformers/tool-transformer.ts` |
| `src/transformers/tool-call-parser.ts` | `src/infrastructure/transformers/tool-call-parser.ts` |
| `src/transformers/event-stream-parser.ts` | `src/infrastructure/transformers/event-stream-parser.ts` |
| `src/image-handler.ts` | `src/plugin/image-handler.ts` |
| `src/oauth-idc.ts` | `src/kiro/oauth-idc.ts` |
| `src/constants.ts` | `src/constants.ts` |

---

## Recommended Fix Priority

| Priority | Issue | Effort |
|----------|-------|--------|
| P0 | BUG-1: Use access token, not refresh token, in SDK client | Trivial |
| P0 | BUG-2+3: Thread fresh access token into customFetch; add pre-request refresh | Medium |
| P0 | GAP-1: Match OpenCode plugin interface contract | Large |
| P1 | BUG-4: Align token format to 4-part (drop embedded region) | Small |
| P1 | BUG-5: Use JSON body for token refresh | Small |
| P1 | GAP-2: Pass `profileArn` in requests | Small |
| P2 | GAP-5: Detect thinking mode from model name / providerOptions | Small |
| P2 | GAP-3: Add basic retry (at minimum for 429 / 5xx) | Medium |
| P3 | GAP-7: Use `GenerateAssistantResponseCommand` + `client.send()` | Small |
| P3 | GAP-4: Auth bootstrap for seamless startup | Small |
| P3 | GAP-6: Wire up MODEL_MAPPING for validation | Trivial |

---

## Files in Original Not Ported (Intentionally Excluded)

These are out of scope given the "single IDC, no database" constraint:

- `src/plugin/storage/sqlite.ts` — SQLite database
- `src/plugin/storage/migrations.ts` — DB migrations
- `src/plugin/storage/locked-operations.ts` — File locking
- `src/infrastructure/database/account-repository.ts` — Account persistence
- `src/infrastructure/database/account-cache.ts` — In-memory TTL cache
- `src/plugin/accounts.ts` — Multi-account manager
- `src/plugin/sync/kiro-cli.ts` — Kiro CLI credential import
- `src/plugin/sync/kiro-cli-parser.ts` — CLI DB parser
- `src/plugin/sync/kiro-cli-profile.ts` — Active profile reader
- `src/plugin/usage.ts` — Usage tracking / quotas
- `src/plugin/health.ts` — Account health tracking
- `src/core/account/account-selector.ts` — Account selection strategies
- `src/core/account/usage-tracker.ts` — Per-request usage sync
- `src/plugin/logger.ts` — Structured logging
- `src/plugin/auth-page.ts` — Auth page rendering
