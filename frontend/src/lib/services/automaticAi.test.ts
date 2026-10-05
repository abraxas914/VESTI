import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeCaptureSettings, isAutomaticAiEnabled, setCaptureSettings, DEFAULT_CAPTURE_SETTINGS } from './captureSettingsService'
import { interceptAndPersistCapture } from '../capture/storage-interceptor'
import type { ConversationDraft } from '../messaging/protocol'

const calls = vi.hoisted(() => ({ persist: vi.fn(), gardener: vi.fn(), vectorize: vi.fn() }))
vi.mock('../core/middleware/deduplicate', () => ({ deduplicateAndSave: calls.persist }))
vi.mock('./gardenerService', () => ({ runGardener: calls.gardener }))
vi.mock('./vectorizationService', () => ({ requestVectorization: calls.vectorize }))
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }))

let stored: Record<string, unknown>
beforeEach(() => {
  stored = {}
  vi.stubGlobal('chrome', {
    runtime: {},
    storage: { local: {
      get: (_keys: unknown, callback: (result: Record<string, unknown>) => void) => callback(stored),
      set: (value: Record<string, unknown>, callback: () => void) => { stored = { ...stored, ...value }; callback() }
    } }
  })
  calls.persist.mockReset().mockResolvedValue({ saved: true, newMessages: 1, conversationId: 1 })
  calls.gardener.mockReset().mockResolvedValue({ updated: false })
  calls.vectorize.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

const conversation: ConversationDraft = {
  uuid: 'privacy-fixture', platform: 'ChatGPT', title: 'Fixture', snippet: 'fixture',
  url: 'https://chatgpt.com/c/fixture', created_at: 1, updated_at: 1,
  source_created_at: null, first_captured_at: 1, last_captured_at: 1,
  message_count: 1, turn_count: 0, is_archived: false, is_trash: false,
  tags: [], topic_id: null, is_starred: false
}
const capture = () => interceptAndPersistCapture({ conversation, messages: [{ role: 'user', textContent: 'private fixture' }] })

describe('automatic AI consent boundary', () => {
  it.each([undefined, {}, { automaticAi: { enabled: true } }, { automaticAi: { enabled: true, consentVersion: 0 } }])('does not migrate absent/unversioned consent into permission: %j', (settings) => {
    expect(normalizeCaptureSettings(settings).automaticAi?.enabled).toBe(false)
  })
  it('fails closed when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {})
    expect(await isAutomaticAiEnabled()).toBe(false)
  })
  it('captures locally without starting remote work by default', async () => {
    expect((await capture()).saved).toBe(true)
    expect(calls.persist).toHaveBeenCalledTimes(1)
    expect(calls.gardener).not.toHaveBeenCalled()
    expect(calls.vectorize).not.toHaveBeenCalled()
  })
  it('starts remote work only after saved consent, and stops after disabling', async () => {
    await setCaptureSettings({ ...DEFAULT_CAPTURE_SETTINGS, automaticAi: { enabled: true, consentVersion: 1 } })
    await capture()
    expect(calls.gardener).toHaveBeenCalledTimes(1)
    expect(calls.vectorize).toHaveBeenCalledTimes(1)
    await setCaptureSettings({ ...DEFAULT_CAPTURE_SETTINGS, automaticAi: { enabled: false, consentVersion: 1 } })
    await capture()
    expect(calls.persist).toHaveBeenCalledTimes(2)
    expect(calls.gardener).toHaveBeenCalledTimes(1)
    expect(calls.vectorize).toHaveBeenCalledTimes(1)
  })
})
