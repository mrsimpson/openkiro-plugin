# Development Plan: openkiro-plugin (feat/opencode-2-compat branch)

*Generated on 2026-11-11 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal
Make the plugin load and work in OpenCode 2.x (V2 plugin API, `@opencode/plugin` 2.2.7) while keeping OpenCode 1.x working.

## Key Decisions
- Dual export: one default object with V1 `server()` and V2 `id` + `setup()` (documented "Support V1" pattern). Installed opencode is still 1.19.0.
- V2 provider registration via `ctx.provider.transform` → `editor.add({ info, models })`, package `aisdk:@ai-sdk/openai-compatible`, `activation: "enabled"` when Kiro CLI auth exists.
- Custom fetch injected via `ctx.aisdk.hook("sdk", …, { providerID: "kiro" })` creating `createOpenAICompatible({ ...options, fetch })`. Settings are structuredCloned by core, so functions can't live there.
- `@ai-sdk/openai-compatible` pinned to 2.0.41 (same as @opencode/core 2.2.7), loaded via dynamic import only in V2 path.
- `@opencode/plugin` used as type-only import (devDependency) so V1 hosts don't need it at runtime.
- Thinking variants: V2 variants use `body` overlays `{ thinkingConfig: { thinkingBudget } }`; fetch reads `body.thinkingConfig` or `body.providerOptions.thinkingConfig`.
- No V2 integration/auth method: credentials come straight from the Kiro CLI DB. `activation` is "enabled" only if Kiro CLI auth exists at setup, else "disabled".
- PR #2 (jschirrmacher) reviewed: adopted the versioned user-agent; rejected the loopback HTTP proxy (unauthenticated local port exposing user credentials; unnecessary given the aisdk sdk hook).
- User-agent version resolved lazily (no execSync at import of token.ts/constants.ts).
- Model.Info / Provider.Info built as plain objects (no runtime schema import) so V1 hosts never load @opencode/plugin.

## Notes
- V2 config key is `plugins` (not `plugin`); local paths must be directories.
- Model.Info requires id, modelID, providerID, name, capabilities, variants, time, cost, status, enabled, limit.

## Explore
### Completed
- [x] Created development plan file
- [x] Studied V2 docs (plugins, server, migrate-v1, effect) and @opencode/plugin + @opencode/core 2.2.7 sources

## Plan
### Completed
- [x] Planned tasks (see Code)

## Code
### Tasks
- [ ] Pre-existing failing test `request.test.ts > -thinking` (unrelated: model list now comes from kiro-cli, `claude-sonnet-4-5-thinking` not in it) — left as is, flag to user

### Completed
- [x] `src/kiro-fetch.ts`: shared `createKiroFetch` (token kept in closure, DB token only adopted when rotated, abort signal passed to SDK, clear error when not logged in)
- [x] `src/model-config.ts`: `buildModelConfig` extracted
- [x] `src/v2.ts` + `setup` on default export (dual V1/V2)
- [x] `src/user-agent.ts`: versioned UA from PR #2, lazily resolved + cached; used by sdk-client and token refresh
- [x] Deps pinned: `@opencode/plugin@2.2.7` (dev, type-only), `@ai-sdk/openai-compatible@2.0.41`; vite externals for `@ai-sdk/*`, `@opencode/*`, `child_process`
- [x] Tests: `v2.test.ts`, `user-agent.test.ts`, index tests adapted; tsc + build OK
- [x] Smoke test of built `dist/index.js` V2 `setup` against real Kiro API (Node + sqlite shim): reply "pong"
- [x] README: V2 `plugins` setup, injection mechanism, user-agent

## Commit
### Tasks
- [ ] Post review on PR #2 (awaiting user confirmation)

### Completed
- [x] Cleanup: no debug output / TODOs in new code; knip: `getKiroCliVersion` un-exported, `kiro-cli` added to `ignoreBinaries` (remaining unused export `parseKiroModelOutput` is pre-existing)
- [x] Final validation: tsc OK, build OK, 42/43 tests (pre-existing failure only)
- [x] Commit + push `feat/opencode-2-compat`, PR created

---
*This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on.*
