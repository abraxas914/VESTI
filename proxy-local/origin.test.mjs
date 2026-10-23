import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'

test('HTTP origin allowlist does not trust hostname suffix attacks', async () => {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(port), VESTI_ALLOWED_ORIGINS: 'https://trusted.example*,chrome-extension://*' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Readiness timeout')), 3000)
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve() }
      })
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    for (const origin of ['https://trusted.example.attacker.test', 'https://trusted.example@attacker.test', 'https://trusted.example/path', 'chrome-extension://not-an-extension']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'OPTIONS', headers: { origin }, signal: AbortSignal.timeout(1000)
      })
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'OPTIONS', headers: { origin: 'https://trusted.example' }, signal: AbortSignal.timeout(1000)
    })
    expect(response.status).toBe(204)
  } finally {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
  }
}, 5000)
