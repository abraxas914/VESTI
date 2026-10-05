import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'

let child
let baseUrl

beforeEach(async () => {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  baseUrl = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), MODELSCOPE_API_KEY: '<TEST_API_KEY>', VESTI_SERVICE_TOKEN: '<TEST_SERVICE_TOKEN>' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server readiness timed out')), 3000)
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve() }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before readiness')) })
  })
})

afterEach(async () => {
  if (child && child.exitCode === null) {
    const exit = once(child, 'exit')
    child.kill()
    await exit
  }
})

describe('JSON body contract', () => {
  for (const route of ['chat', 'embeddings']) {
    for (const body of ['null', '[]', '42', '"text"', '{']) {
      test(`${route} rejects ${body} and keeps serving requests`, async () => {
        const send = (body) => fetch(`${baseUrl}/api/${route}`, {
          method: 'POST', body, signal: AbortSignal.timeout(1500),
          headers: { 'content-type': 'application/json', 'x-vesti-service-token': '<TEST_SERVICE_TOKEN>' }
        })
        const response = await send(body)
        expect(response.status).toBe(400)
        expect((await response.json()).error.code).toBe('INVALID_JSON')
        expect((await send('{}')).status).toBe(400)
      })
    }
  }
})
