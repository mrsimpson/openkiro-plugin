import * as fs from 'fs'
import * as path from 'path'
import { decodeRefreshToken, accessTokenExpired } from './auth.js'
import { refreshAccessToken, KiroTokenRefreshError } from './token.js'
import { transformToSdkRequest } from './request.js'
import { createSdkClient } from './sdk-client.js'
import { transformSdkStream } from './streaming/sdk-stream-transformer.js'
import type { KiroConfig, KiroAuthDetails } from './types.js'
import { KiroConfigSchema } from './types.js'

let cachedConfig: KiroConfig | null = null

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
      if (accessTokenExpired(expiresAt)) {
        // Refresh the token
        try {
          const refreshed = await refreshAccessToken(
            decoded.refreshToken,
            decoded.clientId,
            decoded.clientSecret,
            decoded.idcRegion || config.idc_region
          )
          // Update auth data with new token (in real usage, opencode would persist this)
        } catch (e) {
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
