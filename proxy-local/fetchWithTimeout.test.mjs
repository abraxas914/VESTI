import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fetchWithTimeout } from './fetchWithTimeout.mjs'

test('local upstream deadline covers the body after immediate response headers', async () => {
  const server = createServer((_req, res) => { res.writeHead(200); res.write('{') })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await expect(fetchWithTimeout(`http://127.0.0.1:${server.address().port}`, {}, 40)).rejects.toMatchObject({ name: 'TimeoutError' })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('returns complete response bytes, headers and status on success', async () => {
  const response = await fetchWithTimeout('https://fixture.example', {}, 100, async () => new Response('{"ok":true}', { status: 201, headers: { 'x-fixture': 'preserved' } }))
  expect(response.status).toBe(201)
  expect(response.headers.get('x-fixture')).toBe('preserved')
  expect(await response.json()).toEqual({ ok: true })
})
