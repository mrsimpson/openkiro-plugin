import { describe, it, expect, beforeEach } from 'vitest'

describe('plugin entry (index.ts)', () => {
  let plugin: any

  beforeEach(async () => {
    const mod = await import('./index.js')
    plugin = mod.default
  })

  describe('plugin interface (OpenCode contract)', () => {
    it('config should be a hook function', () => {
      expect(typeof plugin.config).toBe('function')
    })

    it('config hook should mutate input.provider with npm, api, and models', async () => {
      const input = { provider: {} }
      await plugin.config(input)

      expect((input.provider as any).kiro).toBeDefined()
      expect((input.provider as any).kiro.npm).toBe('@ai-sdk/openai-compatible')
      expect((input.provider as any).kiro.api).toBeDefined()
      expect((input.provider as any).kiro.models).toBeDefined()
    })

    it('auth.loader should accept a getAuth callback and call it', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      const loaderDef = source.match(/loader:\s*async\s*\(([^)]+)\)/)
      expect(loaderDef).not.toBeNull()

      const paramName = loaderDef![1].trim().split(/[:{]/)[0].trim()
      expect(paramName).not.toMatch(/authData|auth/)
      expect(source).toMatch(/await\s+getAuth\s*\(\s*\)/)
    })

    it('auth.methods should have correct shape: { label, type, prompts, authorize }', () => {
      const methods = plugin.auth.methods

      expect(Array.isArray(methods)).toBe(true)
      expect(methods.length).toBeGreaterThan(0)

      const method = methods[0]
      expect(method).toHaveProperty('label')
      expect(method).toHaveProperty('type')
      expect(method.type).toBe('oauth')
      expect(method).toHaveProperty('prompts')
      expect(Array.isArray(method.prompts)).toBe(true)
      expect(method).toHaveProperty('authorize')
      expect(typeof method.authorize).toBe('function')
      expect(method).not.toHaveProperty('handler')
      expect(method).not.toHaveProperty('id')
    })

    it('auth.methods prompts should include start_url and idc_region', () => {
      const prompts = plugin.auth.methods[0].prompts
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

    it('auth.methods authorize should be a callable function', () => {
      expect(typeof plugin.auth.methods[0].authorize).toBe('function')
    })

    it('provider should be an object with a models function', () => {
      const provider = plugin.provider

      if (typeof provider === 'function') {
        expect.fail('provider should be an object with a models function, not an async function')
      }

      expect(provider).toHaveProperty('models')
      expect(typeof provider.models).toBe('function')
    })
  })

  describe('token refresh in customFetch', () => {
    it('customFetch should pass access token to createSdkClient', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      const customFetchSection = source.slice(source.indexOf('customFetch'))
      expect(customFetchSection).toMatch(/createSdkClient\s*\([^)]*access/)
      expect(customFetchSection).not.toMatch(/createSdkClient\s*\(\s*\{[^}]*refreshToken:\s*decoded\.refreshToken/)
    })

    it('customFetch should refresh token before each request if expired', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      const customFetchBody = source.slice(
        source.indexOf('const customFetch'),
        source.indexOf('return { apiKey')
      )

      expect(customFetchBody).toMatch(/accessTokenExpired|expiresAt.*Date\.now|refreshAccessToken/)
    })

    it('refreshed accessToken should be used in SDK client creation', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      const customFetchSection = source.slice(source.indexOf('const customFetch'))
      expect(customFetchSection).toContain('accessToken')
      expect(customFetchSection).toMatch(/createSdkClient\s*\([^)]*access:\s*accessToken/)
    })
  })

  describe('clientSecret field integrity', () => {
    it('should NOT parse clientSecret as a number for expiresAt', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      expect(source).not.toMatch(/parseInt\(authData\.auth\.clientSecret\)/)
      expect(source).not.toMatch(/clientSecret.*expiresAt|expiresAt.*clientSecret.*parseInt/)
    })

    it('should NOT write expiresAt into clientSecret', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      expect(source).not.toMatch(/clientSecret\s*=\s*String\(.*expiresAt/)
    })
  })

  describe('retry logic', () => {
    it('customFetch should contain retry logic for transient errors', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      const customFetchBody = source.slice(
        source.indexOf('const customFetch'),
        source.indexOf('return { apiKey')
      )

      expect(customFetchBody).toMatch(/retry|maxAttempts|while\s*\(|for\s*\(/)
    })

    it('should handle 429 rate limit responses', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      expect(source).toMatch(/429|rate.?limit|throttl/i)
    })
  })

  describe('auth bootstrap', () => {
    it('config hook should bootstrap auth entry for seamless startup', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      expect(source).toMatch(/bootstrap|writeAuthFile.*placeholder|ensureAuth/)
    })
  })

  describe('thinking mode detection in customFetch', () => {
    it('should detect thinking mode from model name and providerOptions', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      const customFetchBody = source.slice(
        source.indexOf('const customFetch'),
        source.indexOf('return { apiKey')
      )

      expect(customFetchBody).toContain('providerOptions')
      expect(customFetchBody).toMatch(/endsWith.*thinking|thinking.*model/)
    })
  })

  describe('SDK command pattern', () => {
    it('should use GenerateAssistantResponseCommand via client.send()', () => {
      const fs = require('fs')
      const source = fs.readFileSync(
        require('path').resolve(__dirname, './index.ts'),
        'utf-8'
      )

      expect(source).toContain('GenerateAssistantResponseCommand')
      expect(source).toMatch(/\.send\s*\(/)
      expect(source).not.toMatch(/as any\)\.generateAssistantResponse/)
    })
  })
})
