import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type ConversationRecord } from './schema'
import { deleteConversation, exportAllDataAsJson, importAllData } from './repository'

const conversation: ConversationRecord = {
  uuid: 'recapture-test', platform: 'ChatGPT', title: 'Recapture', snippet: 'question',
  url: 'https://chatgpt.com/c/recapture-test', created_at: 1, updated_at: 1,
  source_created_at: null, first_captured_at: 1, last_captured_at: 1,
  message_count: 2, turn_count: 1, is_archived: false, is_trash: false,
  tags: [], topic_id: null, is_starred: false, isMock: false
}

beforeEach(async () => {
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: 'test' }) } })
  await db.open()
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
    for (const id of [1, 2]) {
      await db.conversations.put({ ...conversation, id, uuid: `fixture-${id}` })
      await db.messages.put({ id, conversation_id: id, role: 'ai', content_text: `answer-${id}`, created_at: 1 })
      await db.summaries.put({ id, conversationId: id, content: `summary-${id}`, modelId: 'fixture', createdAt: 1, sourceUpdatedAt: 1 })
      await db.vectors.put({ id, conversation_id: id, text_hash: 'fixture', embedding: new Float32Array([1]), embedding_provider: 'fixture', embedding_model: 'fixture', embedding_dimensions: 1, index_version: 'fixture' })
      await db.annotations.put({ id, conversation_id: id, message_id: id, content_text: 'annotation', created_at: 1, days_after: 0 })
    }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

describe('permanent conversation deletion', () => {
  it('removes only the deleted conversation and its derived records', async () => {
    await deleteConversation(1)
    for (const table of [db.conversations, db.messages, db.annotations, db.summaries, db.vectors]) {
      expect(await table.get(1)).toBeUndefined()
      expect(await table.get(2)).toBeDefined()
    }
  })

  it('exports a backup that can be imported after deletion', async () => {
    await deleteConversation(1)
    const backup = await exportAllDataAsJson()
    await expect(importAllData(backup)).resolves.toMatchObject({ conversations: 1, messages: 1, summaries: 1, annotations: 1 })
    expect(await db.conversations.get(2)).toBeDefined()
  })

  it('rolls back all dependent deletions on a failed transaction', async () => {
    vi.spyOn(db.conversations, 'delete').mockRejectedValueOnce(new Error('fixture failure'))
    await expect(deleteConversation(1)).rejects.toThrow('fixture failure')
    for (const table of [db.conversations, db.messages, db.annotations, db.summaries, db.vectors]) {
      expect(await table.get(1)).toBeDefined()
    }
  })
})
