import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { fetchDemoProxy } from './proxyRequest'
import { requestEmbeddings } from './embeddingService'
import { buildDefaultLlmSettings } from './llmConfig'

let server: Server
let baseUrl: string
beforeEach(async () => {
  server = createServer((_req, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{') // Headers arrive immediately; the body never finishes.
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  baseUrl = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
const localFetch: typeof fetch = (input, init) => {
  if (new URL(String(input)).origin !== new URL(baseUrl).origin) throw new DOMException('Fixture forbids external requests', 'TimeoutError')
  return fetch(input, init)
}
const bounded = async (promise: Promise<unknown>) => Promise.race([
  promise.then(() => 'completed', (error: Error) => error.name),
  new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 300))
])

it('times out a proxy response body after headers have arrived', async () => {
  expect(await bounded(fetchDemoProxy({ primaryBaseUrl: baseUrl, route: 'chat', body: '{}', totalTimeoutMs: 50, primaryAttemptTimeoutMs: 50 }, localFetch))).toBe('TimeoutError')
})
it('times out a BYOK embedding response body', async () => {
  const config = { ...buildDefaultLlmSettings(), mode: 'custom_byok' as const, baseUrl, apiKey: '<TEST_API_KEY>' }
  expect(await bounded(requestEmbeddings(config, 'fixture', { timeoutMs: 50 }))).toBe('TimeoutError')
})
it('preserves external cancellation during response body reading', async () => {
  const controller = new AbortController()
  setTimeout(() => controller.abort(new DOMException('Cancelled', 'AbortError')), 30)
  expect(await bounded(fetchDemoProxy({ primaryBaseUrl: baseUrl, route: 'chat', body: '{}', signal: controller.signal, totalTimeoutMs: 100 }, localFetch))).toBe('AbortError')
})
