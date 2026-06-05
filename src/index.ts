import * as fs from 'fs'
import * as path from 'path'
import { decodeRefreshToken, accessTokenExpired, encodeRefreshToken } from './auth.js'
import { refreshAccessToken, KiroTokenRefreshError } from './token.js'
import { authorizeKiroIDC, pollKiroIDCToken } from './oauth-idc.js'
import { transformToSdkRequest } from './request.js'
import { createSdkClient } from './sdk-client.js'
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

  // Merge: project wins over user
  const merged = { ...userConfig, ...projectConfig }

  // Validate
  const validated = KiroConfigSchema.parse(merged)
  cachedConfig = validated
  return validated
}

const plugin = {
  name: 'kiro',
  version: '0.1.0',

  config: {
    schema: KiroConfigSchema,
  },

  auth: {
    methods: [
      {
        id: 'idc',
        name: 'AWS IAM Identity Center (IDC)',
        description: 'Authenticate via IDC device code flow',
        handler: async (): Promise<{ refreshToken: string; clientId: string; clientSecret: string; idcRegion: string }> => {
          const config = loadConfig()
          
          // Step 1: Start device code flow
          const authResp = await authorizeKiroIDC(config.idc_region as any, config.idc_start_url)
          
          // Step 2: Poll for tokens
          const tokens = await pollKiroIDCToken(
            authResp.clientId,
            authResp.clientSecret,
            authResp.deviceCode,
            authResp.interval,
            authResp.expiresIn,
            authResp.region
          )
          
          // Step 3: Store in auth.json
          const auth = readAuthFile()
          auth.kiro = {
            refreshToken: encodeRefreshToken(
              tokens.refreshToken,
              tokens.clientId,
              tokens.clientSecret,
              tokens.region
            ),
            clientId: tokens.clientId,
            clientSecret: tokens.clientSecret,
            idcRegion: tokens.region,
          }
          writeAuthFile(auth)
          
          return {
            refreshToken: tokens.refreshToken,
            clientId: tokens.clientId,
            clientSecret: tokens.clientSecret,
            idcRegion: tokens.region,
          }
        },
      },
    ],

    loader: async (authData: { auth: { refreshToken?: string; clientId?: string; clientSecret?: string; idcRegion?: string } }): Promise<{ apiKey: string; baseURL: string; fetch: typeof fetch }> => {
      const config = loadConfig()
      const storedToken = authData.auth.refreshToken

      if (!storedToken) {
        throw new Error('No stored refresh token found')
      }

      // Decode the stored token
      let decoded: any
      try {
        decoded = decodeRefreshToken(storedToken)
      } catch (e) {
        throw new Error(`Failed to decode refresh token: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }

      // Check if access token is expired
      const expiresAt = authData.auth.clientSecret ? parseInt(authData.auth.clientSecret) : Date.now() + 3600000
      let accessToken = ''
      
      if (accessTokenExpired(expiresAt)) {
        // Refresh the token
        try {
          const refreshed = await refreshAccessToken(
            decoded.refreshToken,
            decoded.clientId,
            decoded.clientSecret,
            decoded.idcRegion || config.idc_region
          )
          accessToken = refreshed.accessToken
          
          // Update stored token in auth.json with new tokens
          const auth = readAuthFile()
          if (auth.kiro) {
            auth.kiro.refreshToken = encodeRefreshToken(
              decoded.refreshToken,
              decoded.clientId,
              decoded.clientSecret,
              decoded.idcRegion || config.idc_region
            )
            auth.kiro.clientSecret = String(refreshed.expiresAt)
            writeAuthFile(auth)
          }
        } catch (e) {
          // On refresh failure, clear the auth entry so user must re-authenticate
          const auth = readAuthFile()
          delete auth.kiro
          writeAuthFile(auth)
          
          throw new KiroTokenRefreshError(
            `Token refresh failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
            'REFRESH_FAILED'
          )
        }
      }

      // Return auth payload with custom fetch interceptor
      const baseURL = `https://q.${config.default_region}.amazonaws.com`
      const apiKey = ''

      // Create custom fetch that intercepts CodeWhisperer URLs
      const customFetch: typeof fetch = async (resource, init) => {
        const url = typeof resource === 'string' ? resource : (resource as any).url
        const isCodeWhispererUrl = /q\..*\.amazonaws\.com/.test(url)

        if (!isCodeWhispererUrl) {
          // Pass through to native fetch
          return globalThis.fetch(resource, init)
        }

        // Transform OpenAI request to CodeWhisperer format
        const body = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : {}
        const model = body.model || 'claude-opus-4.5'

        const sdkRequest = transformToSdkRequest(body, model, {
          refreshToken: decoded.refreshToken,
          clientId: decoded.clientId,
          clientSecret: decoded.clientSecret,
          idcRegion: decoded.idcRegion || config.idc_region,
          expiresAt,
        })

        // Create SDK client
        const sdkClient = createSdkClient(
          {
            refreshToken: decoded.refreshToken,
            clientId: decoded.clientId,
            clientSecret: decoded.clientSecret,
            idcRegion: decoded.idcRegion || config.idc_region,
            expiresAt,
          },
          config.default_region
        )

        // Call SDK
        const sdkResponse = await (sdkClient as any).generateAssistantResponse(sdkRequest.conversationState)

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
      }

      return { apiKey, baseURL, fetch: customFetch }
    },
  },

  provider: async (options: any) => {
    // Provider hook is called to customize the provider behavior
    // For now, we just return a pass-through implementation
    return {
      name: 'kiro',
      id: 'kiro',
    }
  },
}

export default plugin
