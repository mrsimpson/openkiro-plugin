# Development Plan: openkiro-plugin (feat/minimal-kiro-plugin branch)

*Generated on 2026-06-05 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal
Build a minimal opencode plugin for Kiro that connects to Claude models with:
- Single account, IDC (IAM Identity Center) auth only
- Configured via kiro.json (`default_region`, `idc_start_url`, `idc_region`, `idc_profile_arn`)
- No desktop token support
- No multi-account support or account switching
- No Kiro CLI sync
- Minimal features to purely connect the models

---

## Key Decisions

### RED Phase Completion (Agent 1)

**Completed 2026-06-05:**
- ✅ Created 22 source files (stubs with `throw new Error('not implemented')`)
- ✅ Created `package.json` with correct hooks, dependencies, and scripts
- ✅ Created `tsconfig.json` and `tsconfig.build.json` with NodeNext module resolution
- ✅ Created `.gitignore` and `.prettierrc`
- ✅ TypeScript compiles without errors (`npx tsc --noEmit`)
- ✅ Tests RED: 8 failing tests describing behaviour at seams
  - `src/auth.test.ts`: encode/decode round-trip, expiry checks (4 tests)
  - `src/token.test.ts`: HTTP call shape, error handling, KiroTokenRefreshError (4 tests)
  - `src/index.test.ts`: 6 documentation tests (passing, document expected behaviour)
- ✅ All files use `.js` extensions in imports for NodeNext module resolution

**Notes:**
- `src/index.test.ts` tests currently pass because they document expected behaviour without actual implementation
- 8 tests fail with "not implemented" or error type mismatches, as expected in RED phase
- Ready for Agent 2 to implement and make tests GREEN

### What the original plugin (`opencode-kiro-auth`) does

The original plugin (~15 source files, ~3500 lines) is a full-featured multi-account plugin. Its complexity comes entirely from features we don't need. We only need the IDC OAuth path.

| Layer | Files | Purpose | Keep? |
|---|---|---|---|
| `src/plugin.ts` | 1 | Plugin entry, hooks (config/auth/provider) | YES — heavily simplified |
| `src/constants.ts` | 1 | URLs, model mapping, region helpers | YES — copy as-is |
| `src/kiro/auth.ts` | 1 | `decodeRefreshToken`, `encodeRefreshToken`, `accessTokenExpired` | YES — copy as-is |
| `src/kiro/oauth-idc.ts` | 1 | `authorizeKiroIDC`, `pollKiroIDCToken` — the device-code flow | YES — copy as-is |
| `src/plugin/token.ts` | 1 | `refreshAccessToken` — HTTP POST token refresh | YES — idc path only |
| `src/plugin/models.ts` | 1 | `resolveKiroModel`, `getContextWindowSize` | YES — copy as-is |
| `src/plugin/types.ts` | 1 | TypeScript interfaces | YES — trimmed to idc-only |
| `src/plugin/request.ts` | 1 | `transformToSdkRequest` — OpenAI → CodeWhisperer format | YES — copy as-is |
| `src/plugin/image-handler.ts` | 1 | Image extraction & conversion | YES — copy as-is |
| `src/plugin/streaming/sdk-stream-transformer.ts` | 1 | AWS SDK event stream → OpenAI SSE | YES — copy as-is |
| `src/plugin/streaming/openai-converter.ts` | 1 | Anthropic events → OpenAI format | YES — copy as-is |
| `src/plugin/streaming/types.ts` | 1 | Stream type definitions | YES — copy as-is |
| `src/plugin/streaming/stream-state.ts` | 1 | Text/thinking block state helpers | YES — copy as-is |
| `src/plugin/streaming/stream-parser.ts` | 1 | `findRealTag` helper | YES — copy as-is |
| `src/infrastructure/transformers/history-builder.ts` | 1 | Build CodeWhisperer history from messages | YES — copy as-is |
| `src/infrastructure/transformers/message-transformer.ts` | 1 | `mergeAdjacentMessages`, `getContentText`, etc. | YES — copy as-is |
| `src/infrastructure/transformers/tool-transformer.ts` | 1 | `convertToolsToCodeWhisperer`, `deduplicateToolResults` | YES — copy as-is |
| `src/infrastructure/transformers/event-stream-parser.ts` | 1 | `parseAwsEventStreamBuffer` | YES — copy as-is |
| `src/infrastructure/transformers/tool-call-parser.ts` | 1 | `parseBracketToolCalls`, etc. | YES — copy as-is |
| `src/plugin/sdk-client.ts` | 1 | `createSdkClient` (CodeWhispererStreamingClient) | YES — copy as-is |
| `src/core/auth/idc-auth-method.ts` | 1 | IDC device-code authorize + callback | YES — simplified (drop usage fetch, drop profile-arn 2nd method) |
| `src/plugin/config/schema.ts` | 1 | Full Zod schema with 15+ fields | NO — replace with 4-field schema |
| `src/plugin/config/loader.ts` | 1 | Config loading (user + project paths) | PARTIAL — keep path logic, drop env overrides |
| `src/plugin/accounts.ts` | 1 | Multi-account `AccountManager` | NO |
| `src/plugin/auth-bootstrap.ts` | 1 | Kiro CLI DB bootstrap | NO |
| `src/plugin/auth-page.ts` | 1 | OAuth web page | NO |
| `src/plugin/health.ts` | 1 | Account health tracking | NO |
| `src/plugin/usage.ts` | 1 | Usage quota tracking | NO |
| `src/plugin/logger.ts` | 1 | Logging | NO |
| `src/plugin/errors.ts` | 1 | Custom error types | PARTIAL — inline `KiroTokenRefreshError` in token.ts |
| `src/plugin/sync/` | dir | Kiro CLI sync | NO |
| `src/plugin/storage/` | dir | SQLite storage | NO |
| `src/core/account/` | dir | AccountSelector, UsageTracker | NO |
| `src/core/auth/auth-handler.ts` | 1 | Multi-method auth orchestrator | NO — inline single IDC method in plugin |
| `src/core/auth/token-refresher.ts` | 1 | Token refresh with account switching | NO |
| `src/core/request/error-handler.ts` | 1 | Rate limit / error classification | NO |
| `src/core/request/retry-strategy.ts` | 1 | Retry logic with account switching | NO |
| `src/infrastructure/database/` | dir | SQLite account repository | NO |

### Minimal plugin file structure (target: ~20 files)

```
src/
  index.ts                    — plugin entry: config + auth + provider hooks
  types.ts                    — KiroConfig, KiroAuthDetails (idc-only), CodeWhisperer types
  constants.ts                — KIRO_CONSTANTS, MODEL_MAPPING, region helpers
  token.ts                    — refreshAccessToken (idc path only)
  auth.ts                     — decodeRefreshToken, encodeRefreshToken, accessTokenExpired
  oauth-idc.ts                — authorizeKiroIDC, pollKiroIDCToken (copied verbatim)
  request.ts                  — transformToSdkRequest (copied verbatim)
  sdk-client.ts               — createSdkClient (copied verbatim)
  image-handler.ts            — image extraction + conversion (copied verbatim)
  transformers/
    history-builder.ts        — (copied verbatim)
    message-transformer.ts    — (copied verbatim)
    tool-transformer.ts       — (copied verbatim)
    event-stream-parser.ts    — (copied verbatim)
    tool-call-parser.ts       — (copied verbatim)
  streaming/
    sdk-stream-transformer.ts — (copied verbatim)
    openai-converter.ts       — (copied verbatim)
    stream-state.ts           — (copied verbatim)
    stream-parser.ts          — (copied verbatim)
    types.ts                  — (copied verbatim)
package.json
tsconfig.json
tsconfig.build.json
.gitignore
.prettierrc
```

### Simplified kiro.json schema

The original schema has 15+ fields for multi-account strategies, rate limits, usage tracking, auth server ports, etc. The minimal version needs only:

```json
{
  "default_region": "eu-central-1",
  "idc_start_url": "https://d-99671a01cd.awsapps.com/start",
  "idc_region": "eu-central-1",
  "idc_profile_arn": "optional — arn:aws:codewhisperer:eu-central-1:..."
}
```

The plugin uses **IDC (IAM Identity Center) OAuth device-code flow** for authentication. On first use, it opens a browser to complete sign-in and stores the resulting tokens in opencode's `auth.json`. On subsequent calls it refreshes the access token automatically using the stored refresh token.

No `refresh_token` field needed in `kiro.json` — credentials are obtained via the browser flow and stored by opencode.

Config is loaded from two locations (project wins over user-global):
1. `~/.config/opencode/kiro.json` (user-global)
2. `.opencode/kiro.json` (project-level, overrides)

### How the auth/request flow works (minimal version)

1. **Plugin init**: read `kiro.json`, store config in closure
2. **`auth.methods`**: single IDC OAuth method — triggers device-code flow (open browser → poll for token → store in opencode's `auth.json`)  
   - Optional `idc_profile_arn` prompt (pre-filled from config if set)
   - No second method, no desktop auth, no usage-limit fetch
3. **`auth.loader`**: opencode calls this on startup with the stored token key → decode token (IDC format: `refreshToken|clientId|clientSecret|idc`) → check expiry → refresh via `https://oidc.{region}.amazonaws.com/token` → return `{ apiKey: '', baseURL, fetch }`
4. **Custom `fetch`**: intercept `q.*.amazonaws.com` calls → `transformToSdkRequest()` → AWS SDK `GenerateAssistantResponseCommand` → stream back as OpenAI SSE
5. **All other URLs**: pass through to native `fetch`

No retry, no account switching, no health checks. Token refresh failure → throw.

### Dependencies

Keep:
- `@aws/codewhisperer-streaming-client` — AWS SDK client for the CodeWhisperer API
- `@opencode-ai/plugin` — opencode plugin types/API
- `@types/node`, `typescript` — build tooling
- `zod` — minimal config schema validation (small dep, safer than manual JSON parsing)

Drop: `proper-lockfile`, `@types/proper-lockfile` (were only used for SQLite lockfile in multi-account path).

---

## Plan

### Tasks

1. Set up project scaffold (package.json, tsconfig, .gitignore, .prettierrc)
2. Copy and adapt source files from `opencode-kiro-auth`
3. Write simplified `src/index.ts` plugin entry (config + auth + provider hooks)
4. Write simplified config loader (2-path load, minimal schema)
5. Verify TypeScript compiles without errors
6. Initial git commit

---

## Explore
<!-- beads-phase-id: openkiro-plugin-1.1 -->
### Tasks

*Tasks managed via `bd` CLI*

## Plan
<!-- beads-phase-id: openkiro-plugin-1.2 -->
### Tasks

*Tasks managed via `bd` CLI (openkiro-plugin-1.2.7 through 1.2.10)*

**TDD approach: London School (outside-in)**  
Two agents, two commits.

---

### Task 1.2.7 — RED: Scaffold + structure + failing tests (Agent 1)

Agent 1 sets up the full project skeleton and writes tests that describe the desired behaviour. Nothing needs to pass yet.

**Steps:**
1. `package.json` — name `openkiro-plugin`, `main`/`exports` pointing at `dist/index.js`, `opencode.hooks` declaring `auth` + `provider`, deps: `@aws/codewhisperer-streaming-client`, `@opencode-ai/plugin`, `zod`; devDeps: `typescript`, `@types/node`, `vitest`
2. `tsconfig.json` + `tsconfig.build.json` — `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, emit to `dist/`
3. `.gitignore`, `.prettierrc`
4. All source files as stubs (correct exports, no implementation — just `throw new Error("not implemented")`):
   - `src/types.ts` — `KiroConfig`, `KiroAuthDetails` (idc-only), CodeWhisperer types
   - `src/constants.ts` — stub
   - `src/auth.ts` — `decodeRefreshToken`, `encodeRefreshToken`, `accessTokenExpired` stubs
   - `src/oauth-idc.ts` — `authorizeKiroIDC`, `pollKiroIDCToken` stubs
   - `src/token.ts` — `refreshAccessToken` stub
   - `src/request.ts` — `transformToSdkRequest` stub
   - `src/sdk-client.ts` — `createSdkClient` stub
   - `src/image-handler.ts` — stub
   - `src/transformers/` (5 files) — stubs
   - `src/streaming/` (5 files) — stubs
   - `src/index.ts` — plugin entry stub (config + auth + provider hooks)
5. Tests (vitest) — describe behaviour at the seams we own:
   - `src/auth.test.ts` — `encodeRefreshToken`/`decodeRefreshToken` round-trip, `accessTokenExpired` logic
   - `src/token.test.ts` — `refreshAccessToken` calls OIDC endpoint with correct params, returns new tokens, throws `KiroTokenRefreshError` on failure
   - `src/index.test.ts` — config loader merges user + project kiro.json; auth.loader decodes + refreshes token + returns correct shape; custom fetch intercepts `q.*.amazonaws.com`, passes through other URLs
6. `npm test` — all tests RED (fail with "not implemented")

### Task 1.2.8 — WIP commit: red phase snapshot

```
git add -A
git commit -m "wip: red phase — scaffold, stubs, failing tests"
```

---

### Task 1.2.9 — GREEN: Make all tests pass (Agent 2)

Agent 2 fills in the real implementations, copying from `opencode-kiro-auth` where applicable.

**Steps (in dependency order):**
1. `src/constants.ts` — copy from `opencode-kiro-auth/src/constants.ts` as-is
2. `src/types.ts` — fill in IDC-only types (strip desktop/multi-account variants)
3. `src/auth.ts` — copy from `opencode-kiro-auth/src/kiro/auth.ts` as-is
4. `src/oauth-idc.ts` — copy from `opencode-kiro-auth/src/kiro/oauth-idc.ts` as-is
5. `src/token.ts` — copy IDC branch only from `opencode-kiro-auth/src/plugin/token.ts`, inline `KiroTokenRefreshError`
6. `src/transformers/` — copy verbatim from `opencode-kiro-auth/src/infrastructure/transformers/`
7. `src/streaming/` — copy verbatim from `opencode-kiro-auth/src/plugin/streaming/`
8. `src/sdk-client.ts` — copy from `opencode-kiro-auth/src/plugin/sdk-client.ts` as-is
9. `src/image-handler.ts` — copy from `opencode-kiro-auth/src/plugin/image-handler.ts` as-is
10. `src/request.ts` — copy from `opencode-kiro-auth/src/plugin/request.ts` as-is
11. `src/index.ts` — implement config loader, IDC auth method, auth.loader, provider fetch interceptor
12. `npm test` — all tests GREEN
13. `npx tsc --noEmit` — no type errors

### Task 1.2.10 — Final commit: green phase

```
git add -A
git commit -m "feat: minimal Kiro IDC-only opencode plugin"
```

---

### What tests cover (London School: test the seams, mock collaborators)

| Test file | What it tests | Mocks |
|---|---|---|
| `src/auth.test.ts` | encode/decode round-trip, expiry check | none (pure functions) |
| `src/token.test.ts` | `refreshAccessToken` HTTP call shape + error path | `globalThis.fetch` |
| `src/index.test.ts` | config merge logic, auth.loader shape, fetch interceptor routing | `fs`, `refreshAccessToken`, `createSdkClient` |

No tests for verbatim-copied transformer/streaming files — they are copied unchanged and tested implicitly via integration.

## Code
<!-- beads-phase-id: openkiro-plugin-1.3 -->
### Tasks

*Tasks managed via `bd` CLI*

## Commit
<!-- beads-phase-id: openkiro-plugin-1.4 -->
### Tasks

*Tasks managed via `bd` CLI*

---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
