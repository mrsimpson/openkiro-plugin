import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { refreshAccessToken, KiroTokenRefreshError } from './token.js'
import { transformToSdkRequest } from './request.js'
import { createSdkClient } from './sdk-client.js'
import { GenerateAssistantResponseCommand } from '@aws/codewhisperer-streaming-client'
import { transformSdkStream } from './streaming/sdk-stream-transformer.js'
import { extractRegionFromArn } from './constants.js'
import type { KiroAuthDetails } from './types.js'
import { readKiroCliAuth, type KiroCliAuth } from './kiro-cli-db.js'

const PLUGIN_ID = 'kiro'

function bootstrapAuthIfNeeded(): void {
  try {
    const dataRoot = process.platform === 'win32'
      ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
      : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'))
    const authPath = path.join(dataRoot, 'opencode', 'auth.json')

    let auth: Record<string, any> = {}
    if (fs.existsSync(authPath)) {
      const parsed = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      auth = parsed
    }
    if (auth[PLUGIN_ID]) return

    auth[PLUGIN_ID] = { type: 'api', key: 'kiro-cli-bootstrap' }
    const dir = path.dirname(authPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 })
  } catch {}
}

function getApiRegionOverride(): string | undefined {
  try {
    const configPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.config', 'opencode', 'kiro.json'
    )
    if (fs.existsSync(configPath)) {
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return content.default_region || undefined
    }
  } catch {}
  return undefined
}

const KiroPlugin = async (_input: any) => {
  const regionOverride = getApiRegionOverride()

  function resolveApiRegion(cliAuth: KiroCliAuth): string {
    if (regionOverride) return regionOverride
    return extractRegionFromArn(cliAuth.profileArn) || cliAuth.region || 'us-east-1'
  }

  return {
    config: async (input: any) => {
      bootstrapAuthIfNeeded()

      const cliAuth = readKiroCliAuth()
      const apiRegion = cliAuth ? resolveApiRegion(cliAuth) : 'us-east-1'
      const baseURL = `https://q.${apiRegion}.amazonaws.com`

      if (!input.provider) input.provider = {}
      if (!input.provider[PLUGIN_ID]) input.provider[PLUGIN_ID] = {}
      input.provider[PLUGIN_ID].npm = '@ai-sdk/openai-compatible'
      input.provider[PLUGIN_ID].api = baseURL
      if (!input.provider[PLUGIN_ID].models) {
        input.provider[PLUGIN_ID].models = {
          'auto': { name: 'Auto (1.0x)', limit: { context: 200000, output: 64000 }, modalities: { input: ['text', 'image', 'pdf'], output: ['text'] } },
          'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5', limit: { context: 200000, output: 64000 }, modalities: { input: ['text', 'image', 'pdf'], output: ['text'] } },
          'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', limit: { context: 1000000, output: 64000 }, modalities: { input: ['text', 'image', 'pdf'], output: ['text'] } },
          'claude-opus-4-7': { name: 'Claude Opus 4.7', limit: { context: 1000000, output: 64000 }, modalities: { input: ['text', 'image', 'pdf'], output: ['text'] } },
        }
      }
    },

    auth: {
      provider: PLUGIN_ID,
      loader: async (_getAuth: any) => {
        const cliAuth = readKiroCliAuth()
        if (!cliAuth) return {}

        const apiRegion = resolveApiRegion(cliAuth)
        const baseURL = `https://q.${apiRegion}.amazonaws.com`

        let accessToken = cliAuth.accessToken
        let expiresAt = cliAuth.expiresAt

        if (Date.now() >= expiresAt - 120_000) {
          try {
            const refreshed = await refreshAccessToken(
              cliAuth.refreshToken,
              cliAuth.clientId,
              cliAuth.clientSecret,
              cliAuth.region
            )
            accessToken = refreshed.accessToken
            expiresAt = refreshed.expiresAt
          } catch {
            return {}
          }
        }

        const customFetch: typeof fetch = async (resource, init) => {
          const url = typeof resource === 'string' ? resource : (resource as any).url
          if (!/q\..*\.amazonaws\.com/.test(url)) {
            return globalThis.fetch(resource, init)
          }

          // Re-read from DB on each request to pick up token rotations from Kiro CLI
          const freshAuth = readKiroCliAuth()
          if (freshAuth) {
            accessToken = freshAuth.accessToken
            expiresAt = freshAuth.expiresAt
          }

          if (Date.now() >= expiresAt - 120_000) {
            const src = freshAuth || cliAuth
            try {
              const refreshed = await refreshAccessToken(
                src.refreshToken,
                src.clientId,
                src.clientSecret,
                src.region
              )
              accessToken = refreshed.accessToken
              expiresAt = refreshed.expiresAt
            } catch (e) {
              throw new KiroTokenRefreshError(
                `Token refresh failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
                'REFRESH_FAILED'
              )
            }
          }

          const body = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : {}
          const model = body.model || 'claude-sonnet-4-6'

          const think = !!body.providerOptions?.thinkingConfig
          const budget = body.providerOptions?.thinkingConfig?.thinkingBudget || 20000

          const sdkRequest = transformToSdkRequest(body, model, {
            idcRegion: cliAuth.region,
            profileArn: cliAuth.profileArn,
          } as KiroAuthDetails, think, budget)

          const effectiveRegion = sdkRequest.region || apiRegion
          const sdkClient = createSdkClient(
            { access: accessToken } as KiroAuthDetails,
            effectiveRegion
          )

          const maxAttempts = 3
          let lastError: any = null

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              const command = new GenerateAssistantResponseCommand({
                conversationState: sdkRequest.conversationState,
                profileArn: sdkRequest.profileArn
              })
              const sdkResponse = await sdkClient.send(command)
              const stream = transformSdkStream(sdkResponse, model, sdkRequest.conversationId)

              const encoder = new TextEncoder()
              const readable = new ReadableStream({
                async start(controller) {
                  try {
                    for await (const chunk of stream) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                    controller.close()
                  } catch (e) {
                    controller.error(e)
                  }
                },
              })

              return new Response(readable, {
                status: 200,
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive',
                },
              })
            } catch (e: any) {
              lastError = e
              const status = e?.statusCode || e?.$metadata?.httpStatusCode || 0
              const isRetryable = status === 429 || (status >= 500 && status < 600)

              if (!isRetryable || attempt >= maxAttempts) throw e

              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
              await new Promise(resolve => setTimeout(resolve, delay))
            }
          }

          throw lastError
        }

        return { apiKey: '', baseURL, fetch: customFetch }
      },

      methods: [
        {
          label: 'Kiro CLI (already authenticated)',
          type: 'oauth' as const,
          authorize: async () => {
            const cliAuth = readKiroCliAuth()
            if (!cliAuth) {
              throw new Error(
                'Kiro CLI is not authenticated. Run "kiro login" first.'
              )
            }
            return {
              url: '',
              instructions: 'Using existing Kiro CLI session',
              method: 'auto' as const,
              callback: async () => {
                // Verify credentials are still valid by refreshing
                try {
                  const refreshed = await refreshAccessToken(
                    cliAuth.refreshToken,
                    cliAuth.clientId,
                    cliAuth.clientSecret,
                    cliAuth.region
                  )
                  return {
                    type: 'success' as const,
                    refresh: 'kiro-cli',
                    access: refreshed.accessToken,
                    expires: refreshed.expiresAt,
                  }
                } catch {
                  throw new Error(
                    'Kiro CLI session is expired or revoked. Run "kiro login" to re-authenticate.'
                  )
                }
              },
            }
          },
        },
      ],
    },

    provider: {
      id: PLUGIN_ID,
      models: async (provider: any) => {
        const cliAuth = readKiroCliAuth()
        const apiRegion = cliAuth ? resolveApiRegion(cliAuth) : 'us-east-1'
        const baseURL = `https://q.${apiRegion}.amazonaws.com`
        const models = provider?.models || {}
        const normalized: Record<string, any> = {}

        for (const [modelID, model] of Object.entries(models)) {
          const modelInfo = model as any
          normalized[modelID] = {
            ...modelInfo,
            api: {
              ...(modelInfo.api || {}),
              npm: '@ai-sdk/openai-compatible',
              url: modelInfo.api?.url || baseURL,
            },
          }
        }

        return normalized
      },
    },
  }
}

export default {
  id: PLUGIN_ID,
  server: KiroPlugin,
}
