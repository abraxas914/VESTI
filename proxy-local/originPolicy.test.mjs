import { expect, test } from 'bun:test'
import { originMatchesRule } from './originPolicy.mjs'

test('matches parsed origin boundaries and supported wildcard contracts', () => {
  for (const [origin, rule, expected] of [
    ['https://example.com', 'https://example.com*', true],
    ['https://example.com.evil.test', 'https://example.com*', false],
    ['https://sub.example.com', 'https://*.example.com', true],
    ['https://deep.sub.example.com', 'https://*.example.com', true],
    ['https://example.com', 'https://*.example.com', false],
    ['https://evilexample.com', 'https://*.example.com', false],
    ['http://sub.example.com', 'https://*.example.com', false],
    ['https://sub.example.com:444', 'https://*.example.com', false],
    ['https://example.com/path', '*', false],
    ['https://user@example.com', '*', false],
    ['null', '*', false],
    ['file:///tmp', '*', false],
    ['chrome-extension://' + 'a'.repeat(32), 'chrome-extension://*', true],
    ['chrome-extension://anything', 'chrome-extension://*', false]
  ]) expect(originMatchesRule(origin, rule)).toBe(expected)
})
