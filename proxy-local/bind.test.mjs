import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

test('the running local proxy binds only to IPv4 loopback', async () => {
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    const output = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Readiness timeout')), 3000)
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(String(chunk)) }
      })
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    // The startup log reads the actual runtime socket address, not the label.
    expect(output).toMatch(/listening on http:\/\/127\.0\.0\.1:[1-9]\d*/)
  } finally {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
  }
}, 5000)
