import { describe, expect, it } from 'vitest'
import { buildEmbeddingCacheKey } from './embeddingService'
import { buildDefaultLlmSettings } from './llmConfig'

describe('embedding cache configuration fingerprint', () => {
  const config = { ...buildDefaultLlmSettings(), proxyBaseUrl: 'https://private.example/api', proxyServiceToken: '<TEST_TOKEN>', apiKey: '<TEST_API_KEY>' }
  it('invalidates a changed endpoint and never stores its literal address', async () => {
    const key = await buildEmbeddingCacheKey(config)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(await buildEmbeddingCacheKey({ ...config, proxyBaseUrl: 'https://other.example/api' })).not.toBe(key)
  })
  it('does not derive the persistent fingerprint from credentials', async () => {
    expect(await buildEmbeddingCacheKey({ ...config, proxyServiceToken: '<OTHER_TEST_TOKEN>', apiKey: '<OTHER_TEST_API_KEY>' })).toBe(await buildEmbeddingCacheKey(config))
  })
})
