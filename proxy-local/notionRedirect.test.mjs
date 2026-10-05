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
    env: { PATH: process.env.PATH, PORT: String(port), NOTION_CLIENT_ID: '<TEST_CLIENT_ID>', NOTION_CLIENT_SECRET: '<TEST_CLIENT_SECRET>' },
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

describe('Notion extension callback contract', () => {
  const extensionId = 'a'.repeat(32)
  for (const url of [`https://${extensionId}.chromiumapp.org/notion`, `chrome-extension://${extensionId}/notion`]) {
    test(`accepts ${url}`, async () => {
      const response = await fetch(`${baseUrl}/api/notion/oauth/start?extension_redirect_uri=${encodeURIComponent(url)}`, {
        redirect: 'manual', signal: AbortSignal.timeout(1000)
      })
      expect(response.status).toBe(302)
      const target = new URL(response.headers.get('location'))
      expect(target.origin).toBe('https://api.notion.com')
      expect(target.searchParams.get('state')).toBeTruthy()
    })
  }
  for (const url of [
    `https://${extensionId}.chromiumapp.org.attacker.test/notion`,
    `http://${extensionId}.chromiumapp.org/notion`,
    `https://user@${extensionId}.chromiumapp.org/notion`,
    `https://${extensionId}.chromiumapp.org:444/notion`,
    'https://attacker.test/notion', 'chrome-extension://invalid/notion'
  ]) {
    test(`rejects ${url}`, async () => {
      const response = await fetch(`${baseUrl}/api/notion/oauth/start?extension_redirect_uri=${encodeURIComponent(url)}`, {
        redirect: 'manual', signal: AbortSignal.timeout(1000)
      })
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('INVALID_EXTENSION_REDIRECT')
    })
  }
})
