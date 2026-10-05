import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ConversationRecord } from '../db/schema'
import { ensureVectorForConversation, vectorizeAllConversations } from './searchService'

const fixture = vi.hoisted(() => ({ cacheKey: 'config-a', embed: vi.fn() }))
vi.mock('./embeddingService', () => ({
  buildEmbeddingCacheKey: async () => fixture.cacheKey,
  embedTextWithMetadata: fixture.embed
}))
vi.mock('./llmSettingsService', () => ({ getLlmSettings: async () => ({ mode: 'demo_proxy' }) }))
const conversation: ConversationRecord = {
  uuid: 'recapture-test', platform: 'ChatGPT', title: 'Recapture', snippet: 'question',
  url: 'https://chatgpt.com/c/recapture-test', created_at: 1, updated_at: 1,
  source_created_at: null, first_captured_at: 1, last_captured_at: 1,
  message_count: 2, turn_count: 1, is_archived: false, is_trash: false,
  tags: [], topic_id: null, is_starred: false, isMock: false
}

const metadata = { provider: 'fixture', model: 'fixture', dimensions: 2, version: 'fixture-v1' }

beforeEach(async () => {
  fixture.cacheKey = 'config-a'
  fixture.embed.mockReset().mockResolvedValue({ vector: new Float32Array([1, 0]), metadata })
  await db.open()
  await db.vectors.clear()
  await db.conversations.clear()
  await db.messages.clear()
  await db.annotations.clear()
})
afterEach(() => db.close())

describe('embedding cache before remote requests', () => {
  it('does not request embeddings again for unchanged text/config', async () => {
    await ensureVectorForConversation(1, 'fixture text')
    await expect(ensureVectorForConversation(1, 'fixture text')).resolves.toEqual(metadata)
    expect(fixture.embed).toHaveBeenCalledTimes(1)
  })
  it('does not repeat remote calls on a subsequent full-library pass', async () => {
    await db.conversations.put({ ...conversation, id: 1 })
    await db.messages.put({ id: 1, conversation_id: 1, role: 'ai', content_text: 'fixture text', created_at: 1 })
    await vectorizeAllConversations()
    await vectorizeAllConversations()
    expect(fixture.embed).toHaveBeenCalledTimes(1)
  })
  it('refreshes changed text', async () => {
    await ensureVectorForConversation(1, 'fixture text')
    await ensureVectorForConversation(1, 'edited text')
    expect(fixture.embed).toHaveBeenCalledTimes(2)
    expect(await db.vectors.count()).toBe(1)
  })
  it('refreshes when the configured embedding endpoint/model changes', async () => {
    await ensureVectorForConversation(1, 'fixture text')
    fixture.cacheKey = 'config-b'
    await ensureVectorForConversation(1, 'fixture text')
    expect(fixture.embed).toHaveBeenCalledTimes(2)
  })
  it('refreshes legacy cache rows once, then reuses them', async () => {
    await ensureVectorForConversation(1, 'fixture text')
    const record = await db.vectors.toCollection().first()
    await db.vectors.update(record!.id!, { embedding_cache_key: undefined })
    await ensureVectorForConversation(1, 'fixture text')
    await ensureVectorForConversation(1, 'fixture text')
    expect(fixture.embed).toHaveBeenCalledTimes(2)
  })
})
