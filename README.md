# openkiro-plugin

An [OpenCode](https://github.com/sst/opencode) plugin that connects to AWS CodeWhisperer (Kiro) using credentials from the Kiro CLI. Zero configuration required — just `kiro login` and go.

## Prerequisites

- [Kiro CLI](https://kiro.dev) installed and authenticated (`kiro login`)
- [OpenCode](https://github.com/sst/opencode) installed

## Setup

The plugin supports OpenCode 1.x and 2.x from the same package.

**OpenCode 2.x** — the config key is `plugins`:

```json
{
  "plugins": ["/path/to/openkiro-plugin"]
}
```

The Kiro provider is enabled automatically when the Kiro CLI is logged in; no `/connect` step is needed. Models are read from `kiro-cli chat --list-models`, and Claude models offer `low`/`medium`/`high` thinking variants.

**OpenCode 1.x** — the config key is `plugin`:

```json
{
  "plugin": ["/path/to/openkiro-plugin"]
}
```

Then `/connect` in OpenCode and select the Kiro option.

## Available models

By default, the plugin exposes these models: `auto`, `claude-opus-4-6`, `claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `claude-sonnet-4-6-thinking`, `claude-haiku-4-5`, `minimax-m2.5`, `minimax-m2.1`, `qwen3-coder-next`.

To expose additional models, define them in your `opencode.json` under `provider.kiro.models`. This **replaces** the defaults entirely — include any default models you still want:

```json
{
  "plugin": ["/path/to/openkiro-plugin"],
  "provider": {
    "kiro": {
      "models": {
        "auto": { "name": "Auto (1.0x)", "limit": { "context": 200000, "output": 64000 }, "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] } },
        "claude-sonnet-4-6": { "name": "Claude Sonnet 4.6", "limit": { "context": 1000000, "output": 64000 }, "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] } },
        "claude-opus-4-7": { "name": "Claude Opus 4.7", "limit": { "context": 1000000, "output": 64000 }, "modalities": { "input": ["text", "image", "pdf"], "output": ["text"] } },
        "deepseek-3.2": { "name": "DeepSeek 3.2", "limit": { "context": 200000, "output": 64000 }, "modalities": { "input": ["text"], "output": ["text"] } }
      }
    }
  }
}
```

Append `-thinking` to any Claude model for extended thinking mode (e.g. `claude-sonnet-4-6-thinking`).

### How model IDs relate to the API

The model IDs you use in `opencode.json` (and that appear in `/models`) are **user-facing keys**. Before sending a request to the CodeWhisperer API, the plugin translates them via `MODEL_MAPPING` in `src/constants.ts` — typically converting hyphens to dots for Claude models (e.g. `claude-sonnet-4-6` → `claude-sonnet-4.6`). Any model ID not found in the mapping is passed through unchanged.

The CodeWhisperer SDK has no model-discovery endpoint, so both layers are maintained manually. To add a new model:

1. Add the user-facing entry to your `opencode.json` (so it shows up in `/models`)
2. If the API name differs from the user-facing ID, add a translation in `src/constants.ts` `MODEL_MAPPING`

## How it works

### Authentication

The plugin reads credentials directly from the Kiro CLI's SQLite database (`~/Library/Application Support/kiro-cli/data.sqlite3` on macOS) using `bun:sqlite` (OpenCode runs on Bun). No separate OAuth flow or configuration is needed.

On every request, the plugin:

1. Reads the current access token from the Kiro CLI DB
2. If expired (within 2-minute buffer), refreshes it via the OIDC token endpoint
3. Passes the token to the CodeWhisperer streaming SDK

This means if the Kiro CLI refreshes tokens in the background, the plugin picks up the fresh token automatically.

### Request flow

```
OpenCode ─── AI SDK (openai-compatible) ─── customFetch ─┐
                                                          │
    ┌─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 1. Read auth from Kiro CLI DB               │
│ 2. Refresh token if expired                 │
│ 3. Transform OpenAI format → CW format      │
│    (messages, tools, images, system prompt)  │
│ 4. Send GenerateAssistantResponseCommand     │
│ 5. Stream CW response → OpenAI SSE format   │
└─────────────────────────────────────────────┘
```

The plugin intercepts the `fetch` call that OpenCode's AI SDK would normally make to an OpenAI-compatible endpoint, and instead translates it into a CodeWhisperer streaming SDK call. Responses are streamed back as Server-Sent Events in OpenAI format.

How the fetch gets injected depends on the OpenCode version:

- 1.x: the `auth.loader` hook returns `{ fetch }`.
- 2.x: provider settings must be plain JSON, so the plugin registers an `aisdk` `sdk` hook scoped to the `kiro` provider and builds the `@ai-sdk/openai-compatible` provider with the custom fetch itself. No local proxy or open port is involved.

### Client version / User-Agent

The API rejects clients whose user-agent lacks a recognised version token (403 "This version of Kiro is no longer supported"). The plugin sends `KiroCLI/<ver> KAS/<ver> os/<platform> md/appVersion-<ver>` on API and token-refresh calls. The version is read lazily from `kiro-cli --version`, with a fallback in `src/user-agent.ts`.

### Region resolution

1. Optional override: `~/.config/opencode/kiro.json` → `{ "default_region": "eu-central-1" }`
2. Derived from profile ARN (e.g. `arn:aws:codewhisperer:eu-central-1:...`)
3. From the Kiro CLI DB's stored region
4. Fallback: `us-east-1`

### Retry logic

Retries up to 3 times on 429 (rate limit) and 5xx errors with exponential backoff (1s, 2s, 4s).

## Project structure

```
src/
├── index.ts              Plugin entry — V1 hooks (`server`) and V2 entry (`setup`)
├── v2.ts                 OpenCode 2.x provider registration + aisdk hook
├── kiro-fetch.ts         Custom fetch: OpenAI request → CodeWhisperer → OpenAI SSE
├── model-config.ts       Model list → OpenCode model config
├── user-agent.ts         Versioned Kiro CLI user-agent
├── kiro-cli-db.ts        Reads auth from Kiro CLI's SQLite DB
├── kiro-cli-models.ts    Reads the model list from the Kiro CLI
├── token.ts              OIDC token refresh
├── sdk-client.ts         CodeWhisperer streaming client (cached per region+token)
├── request.ts            Transforms OpenAI messages → CodeWhisperer conversationState
├── constants.ts          Model mapping, API constants
├── types.ts              Shared type definitions
├── image-handler.ts      Converts images to Kiro's format
├── streaming/            SDK response → OpenAI SSE stream
└── transformers/         Message history, tool calls, merging
```
