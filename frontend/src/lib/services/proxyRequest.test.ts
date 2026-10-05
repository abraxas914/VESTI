import { describe, expect, it, vi } from 'vitest'
import { fetchDemoProxy } from './proxyRequest'
import { PRIMARY_PROXY_BASE_URL, FALLBACK_PROXY_BASE_URL, buildProxyRouteUrl } from './llmConfig'

const request = {
  primaryBaseUrl: 'https://private.example/api',
  route: 'chat' as const,
  serviceToken: '<PRIVATE_SERVICE_TOKEN>',
  body: JSON.stringify({ messages: [{ role: 'user', content: 'private fixture' }] })
}

describe('proxy trust boundary', () => {
  it.each([429, 500, 503])('does not send private requests to a public fallback on HTTP %i', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }))
    const response = await fetchDemoProxy(request, fetchImpl)
    expect(response.status).toBe(status)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://private.example/api/chat')
  })

  it('propagates a private gateway network error without a second request', async () => {
    const failure = new TypeError('offline')
    const fetchImpl = vi.fn().mockRejectedValue(failure)
    await expect(fetchDemoProxy(request, fetchImpl)).rejects.toBe(failure)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each(['https://api.ccvg1218.online.attacker.example/api', `${PRIMARY_PROXY_BASE_URL}/custom`])('does not trust lookalike or custom gateway URLs: %s', async (primaryBaseUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    await fetchDemoProxy({ ...request, primaryBaseUrl }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retains the documented fallback between the built-in gateways', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}'))
    await fetchDemoProxy({ ...request, primaryBaseUrl: PRIMARY_PROXY_BASE_URL }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toBe(buildProxyRouteUrl(FALLBACK_PROXY_BASE_URL, 'chat'))
  })
})
