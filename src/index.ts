import * as fs from 'fs'
import * as path from 'path'
import { decodeRefreshToken, accessTokenExpired, encodeRefreshToken } from './auth.js'
import { refreshAccessToken, KiroTokenRefreshError } from './token.js'
import { authorizeKiroIDC, pollKiroIDCToken } from './oauth-idc.js'
import { transformToSdkRequest } from './request.js'
import { createSdkClient } from './sdk-client.js'
import { GenerateAssistantResponseCommand } from '@aws/codewhisperer-streaming-client'
import { transformSdkStream } from './streaming/sdk-stream-transformer.js'
import type { KiroConfig, KiroAuthDetails } from './types.js'
import { KiroConfigSchema } from './types.js'

let cachedConfig: KiroConfig | null = null

function getOpenCodeAuthPath(): string {
  const dataRoot = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'))
    : (process.env.XDG_DATA_HOME || path.join(process.env.HOME || '', '.local', 'share'))
  return path.join(dataRoot, 'opencode', 'auth.json')
}

function readAuthFile(): Record<string, any> {
  const authPath = getOpenCodeAuthPath()
  try {
    if (fs.existsSync(authPath)) {
      const content = fs.readFileSync(authPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch (e) {
    // Ignore errors
  }
  return {}
}

function writeAuthFile(auth: Record<string, any>): void {
  const authPath = getOpenCodeAuthPath()
  try {
    const dir = path.dirname(authPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    // Preserve file permissions if it exists
    const mode = fs.existsSync(authPath) ? fs.statSync(authPath).mode & 0o777 : 0o600
    const tempPath = `${authPath}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(auth, null, 2), { encoding: 'utf-8', mode })
    fs.chmodSync(tempPath, mode)
    fs.renameSync(tempPath, authPath)
  } catch (e) {
    // Log but don't throw — auth may be read-only
    console.error(`Failed to write auth.json: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function bootstrapAuthIfNeeded(id: string): void {
  const auth = readAuthFile()
  if (!auth[id]) {
    // Write a placeholder entry so OpenCode knows to call the auth loader on startup
    auth[id] = { placeholder: true }
    writeAuthFile(auth)
  }
}

function loadConfig(): KiroConfig {
  if (cachedConfig) return cachedConfig

  // Load user-global config
  const userConfigPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'opencode', 'kiro.json')
  let userConfig: Partial<KiroConfig> = {}
  try {
    if (fs.existsSync(userConfigPath)) {
      const content = fs.readFileSync(userConfigPath, 'utf-8')
      userConfig = JSON.parse(content)
    }
  } catch (e) {
    // Ignore errors reading user config
  }

  // Load project config (overrides user config)
  let projectConfig: Partial<KiroConfig> = {}
  const projectConfigPath = path.join(process.cwd(), '.opencode', 'kiro.json')
  try {
    if (fs.existsSync(projectConfigPath)) {
      const content = fs.readFileSync(projectConfigPath, 'utf-8')
      projectConfig = JSON.parse(content)
    }
  } catch (e) {
    // Ignore errors reading project config
  }

  // Merge: defaults < user < project
  const merged = {
    default_region: 'us-east-1',
    idc_start_url: 'https://view.awsapps.com/start',
    idc_region: 'us-east-1',
    ...userConfig,
    ...projectConfig,
  }

  // Validate
  const validated = KiroConfigSchema.parse(merged)
  cachedConfig = validated
  return validated
}

function createPlugin(id: string) {
  const config = loadConfig()
  const baseURL = `https://q.${config.default_region}.amazonaws.com`

  return {
    config: async (input: any) => {
      // Bootstrap auth entry for seamless startup
      bootstrapAuthIfNeeded(id)

      if (!input.provider) input.provider = {}
      if (!input.provider[id]) input.provider[id] = {}
      input.provider[id].npm = '@ai-sdk/openai-compatible'
      input.provider[id].api = baseURL
      input.provider[id].models = {
        'auto': { name: 'Auto', limit: { context: 200000, output: 64000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
        'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5', limit: { context: 200000, output: 64000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
        'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', limit: { context: 1000000, output: 64000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
        'claude-opus-4-7': { name: 'Claude Opus 4.7', limit: { context: 1000000, output: 64000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
      }
    },

    auth: {
      provider: id,
      loader: async (getAuth: any) => {
        await getAuth()

        const authFile = readAuthFile()
        const storedData = authFile[id]

        if (!storedData || !storedData.refreshToken) {
          throw new Error('No stored refresh token found')
        }

        // Decode the stored token
        let decoded: any
        try {
          decoded = decodeRefreshToken(storedData.refreshToken)
        } catch (e) {
          throw new Error(`Failed to decode refresh token: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }

        // Get initial access token
        let accessToken = ''
        let expiresAt = storedData.expiresAt || 0

        if (accessTokenExpired(expiresAt)) {
          try {
            const refreshed = await refreshAccessToken(
              decoded.refreshToken,
              decoded.clientId,
              decoded.clientSecret,
              config.idc_region
            )
            accessToken = refreshed.accessToken
            expiresAt = refreshed.expiresAt

            // Update stored auth with new expiresAt
            const auth = readAuthFile()
            if (auth[id]) {
              auth[id].expiresAt = refreshed.expiresAt
              writeAuthFile(auth)
            }
          } catch (e) {
            // On refresh failure, clear the auth entry so user must re-authenticate
            const auth = readAuthFile()
            delete auth[id]
            writeAuthFile(auth)

            throw new KiroTokenRefreshError(
              `Token refresh failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
              'REFRESH_FAILED'
            )
          }
        }

        // Create custom fetch that intercepts CodeWhisperer URLs
        const customFetch: typeof fetch = async (resource, init) => {
          const url = typeof resource === 'string' ? resource : (resource as any).url
          const isCodeWhispererUrl = /q\..*\.amazonaws\.com/.test(url)

          if (!isCodeWhispererUrl) {
            // Pass through to native fetch
            return globalThis.fetch(resource, init)
          }

          // Check token expiry and refresh if needed before each request
          if (accessTokenExpired(expiresAt)) {
            try {
              const refreshed = await refreshAccessToken(
                decoded.refreshToken,
                decoded.clientId,
                decoded.clientSecret,
                config.idc_region
              )
              accessToken = refreshed.accessToken
              expiresAt = refreshed.expiresAt

              // Persist the new expiresAt
              const auth = readAuthFile()
              if (auth[id]) {
                auth[id].expiresAt = refreshed.expiresAt
                writeAuthFile(auth)
              }
            } catch (e) {
              throw new KiroTokenRefreshError(
                `Token refresh failed mid-session: ${e instanceof Error ? e.message : 'Unknown error'}`,
                'REFRESH_FAILED'
              )
            }
          }

          // Transform OpenAI request to CodeWhisperer format
          const body = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : {}
          const model = body.model || 'claude-sonnet-4-5'

          // Detect thinking mode from model name or providerOptions
          const think = model.endsWith('-thinking') || !!body.providerOptions?.thinkingConfig
          const budget = body.providerOptions?.thinkingConfig?.thinkingBudget || 20000

          const sdkRequest = transformToSdkRequest(body, model, {
            refreshToken: decoded.refreshToken,
            clientId: decoded.clientId,
            clientSecret: decoded.clientSecret,
            idcRegion: config.idc_region,
            expiresAt,
          }, think, budget)

          // Create SDK client using fresh accessToken
          const sdkClient = createSdkClient(
            { access: accessToken } as KiroAuthDetails,
            config.default_region
          )

          // Retry logic for transient errors (429, 5xx)
          const maxAttempts = 3
          let lastError: any = null

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              // Use Command pattern via client.send()
              const command = new GenerateAssistantResponseCommand({
                conversationState: sdkRequest.conversationState,
                profileArn: sdkRequest.profileArn
              })
              const sdkResponse = await sdkClient.send(command)

              // Stream response back as OpenAI SSE
              const stream = transformSdkStream(sdkResponse, model, sdkRequest.conversationId)

              // Convert async generator to readable stream
              const readable = new ReadableStream({
                async start(controller) {
                  try {
                    for await (const chunk of stream) {
                      const line = `data: ${JSON.stringify(chunk)}\n\n`
                      controller.enqueue(new TextEncoder().encode(line))
                    }
                    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
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

              if (!isRetryable || attempt >= maxAttempts) {
                throw e
              }

              // Exponential backoff for rate limit / throttling errors
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
          label: 'AWS IAM Identity Center',
          type: 'oauth' as const,
          prompts: [
            {
              type: 'text' as const,
              key: 'start_url',
              message: 'Enter your IAM Identity Center start URL',
              placeholder: 'https://d-xxxxxxxxxx.awsapps.com/start',
              validate: (value: string) => {
                if (!value) return 'Start URL is required'
                try { new URL(value) } catch { return 'Must be a valid URL' }
                return undefined
              }
            },
            {
              type: 'text' as const,
              key: 'idc_region',
              message: 'Enter your IDC region',
              placeholder: 'us-east-1',
              validate: (value: string) => {
                if (!value) return 'Region is required'
                return undefined
              }
            },
          ],
          authorize: async (inputs: Record<string, string>) => {
            const startUrl = inputs.start_url || config.idc_start_url
            const idcRegion = inputs.idc_region || config.idc_region

            // Start device code flow
            const authResp = await authorizeKiroIDC(idcRegion as any, startUrl)

            return {
              url: authResp.verificationUriComplete || authResp.verificationUrl,
              instructions: `Enter code: ${authResp.userCode}`,
              method: 'auto' as const,
              callback: async () => {
                // Poll for tokens
                const tokens = await pollKiroIDCToken(
                  authResp.clientId,
                  authResp.clientSecret,
                  authResp.deviceCode,
                  authResp.interval,
                  authResp.expiresIn,
                  authResp.region
                )

                // Store in auth.json
                const auth = readAuthFile()
                auth[id] = {
                  refreshToken: encodeRefreshToken(
                    tokens.refreshToken,
                    tokens.clientId,
                    tokens.clientSecret,
                    tokens.region
                  ),
                  clientId: tokens.clientId,
                  idcRegion: tokens.region,
                  expiresAt: tokens.expiresAt,
                }
                writeAuthFile(auth)

                return {
                  refreshToken: tokens.refreshToken,
                  clientId: tokens.clientId,
                  idcRegion: tokens.region,
                }
              }
            }
          },
        },
      ],
    },

    provider: {
      id,
      models: async (provider: any) => {
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

export default createPlugin('kiro')
