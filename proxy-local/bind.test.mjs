import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'

test('the running local proxy binds only to IPv4 loopback', () => {
  const result = spawnSync(process.execPath, ['--eval', `
    import { once } from 'node:events'
    import { server } from './server.mjs'
    if (!server.listening) await once(server, 'listening')
    console.log('BOUND_ADDRESS=' + server.address().address)
    server.close()
  `], {
    cwd: new URL('.', import.meta.url).pathname,
    env: { PATH: process.env.PATH, PORT: '0' },
    encoding: 'utf8', timeout: 3000
  })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('BOUND_ADDRESS=127.0.0.1')
})
