# openkiro-plugin

An [OpenCode](https://github.com/sst/opencode) plugin that connects to AWS CodeWhisperer (Kiro) using credentials from the Kiro CLI. Zero configuration required — just `kiro login` and go.

## Prerequisites

- [Kiro CLI](https://kiro.dev) installed and authenticated (`kiro login`)
- [OpenCode](https://github.com/sst/opencode) installed

## Setup

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": {
    "kiro": {
      "source": "/path/to/openkiro-plugin"
    }
  }
}
```

Then `/connect` in OpenCode and select the Kiro option.

## Available models

- `auto` — server-side model selection
- `claude-sonnet-4-6`, `claude-opus-4-7`, and other Claude variants
- `deepseek-3.2`, `glm-5`, `minimax-m2.5`, `qwen3-coder-next`

Append `-thinking` to any Claude model for extended thinking mode (e.g. `claude-sonnet-4-6-thinking`).

The model list is a static mapping in `src/constants.ts` (`MODEL_MAPPING`). The CodeWhisperer SDK has no model-discovery endpoint, so available models are maintained manually. When AWS adds new models to the Kiro backend, add a new entry there — the key is what users type in OpenCode, the value is what the API expects (typically hyphens → dots for Claude models).

## How it works

### Authentication

The plugin reads credentials directly from the Kiro CLI's SQLite database (`~/Library/Application Support/kiro-cli/data.sqlite3` on macOS). No separate OAuth flow or configuration is needed.

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
├── index.ts              Plugin entry — hooks into OpenCode's config/auth/provider system
├── kiro-cli-db.ts        Reads auth from Kiro CLI's SQLite DB
├── token.ts              OIDC token refresh
├── sdk-client.ts         CodeWhisperer streaming client (cached per region+token)
├── request.ts            Transforms OpenAI messages → CodeWhisperer conversationState
├── constants.ts          Model mapping, API constants
├── types.ts              Shared type definitions
├── image-handler.ts      Converts images to Kiro's format
├── streaming/            SDK response → OpenAI SSE stream
└── transformers/         Message history, tool calls, merging
```
