import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/schema'
import { getAnnotationExportContext, saveAnnotation } from '../../db/repository'
import type { ConversationDraft, ParsedMessage } from '../../messaging/protocol'
import { deduplicateAndSave } from './deduplicate'

vi.mock('../../db/storageLimits', () => ({ enforceStorageWriteGuard: vi.fn() }))

const conversation: ConversationDraft = {
  uuid: 'recapture-test', platform: 'ChatGPT', title: 'Recapture', snippet: 'question',
  url: 'https://chatgpt.com/c/recapture-test', created_at: 1, updated_at: 1,
  source_created_at: null, first_captured_at: 1, last_captured_at: 1,
  message_count: 2, turn_count: 1, is_archived: false, is_trash: false,
  tags: [], topic_id: null, is_starred: false, isMock: false
}
const initial: ParsedMessage[] = [
  { role: 'user', textContent: 'question' },
  { role: 'ai', textContent: 'answer' }
]

beforeEach(async () => {
  await db.open()
  await db.transaction('rw', db.conversations, db.messages, db.annotations, async () => {
    await db.annotations.clear()
    await db.messages.clear()
    await db.conversations.clear()
  })
})
afterEach(() => db.close())

async function captureWithAnnotation() {
  const result = await deduplicateAndSave(conversation, initial)
  const messages = await db.messages.where('conversation_id').equals(result.conversationId!).sortBy('created_at')
  const annotation = await saveAnnotation({ conversationId: result.conversationId!, messageId: messages[1].id!, contentText: 'Keep this answer' })
  return { messages, annotation }
}

describe('recapture message identity', () => {
  it('keeps annotated IDs and export context when a conversation grows', async () => {
    const { messages, annotation } = await captureWithAnnotation()
    await deduplicateAndSave(conversation, [...initial, { role: 'user', textContent: 'follow-up' }])
    expect(await db.messages.get(messages[1].id!)).toMatchObject({ content_text: 'answer' })
    expect((await getAnnotationExportContext(annotation.id)).message.id).toBe(messages[1].id)
    expect(await db.messages.count()).toBe(3)
  })

  it('preserves the annotated answer when earlier messages are inserted', async () => {
    const { messages, annotation } = await captureWithAnnotation()
    await deduplicateAndSave(conversation, [{ role: 'user', textContent: 'earlier question' }, { role: 'ai', textContent: 'earlier answer' }, ...initial])
    expect((await getAnnotationExportContext(annotation.id)).message).toMatchObject({ id: messages[1].id, content_text: 'answer' })
    expect((await db.messages.orderBy('created_at').toArray()).map((message) => message.content_text)).toEqual(['earlier question', 'earlier answer', 'question', 'answer'])
  })

  it('keeps the previous capture when an annotated answer is regenerated', async () => {
    const { messages, annotation } = await captureWithAnnotation()
    await expect(deduplicateAndSave(conversation, [initial[0], { role: 'ai', textContent: 'revised answer' }])).rejects.toThrow('ANNOTATED_MESSAGE_IDENTITY_AMBIGUOUS')
    expect((await getAnnotationExportContext(annotation.id)).message).toMatchObject({ id: messages[1].id, content_text: 'answer' })
  })

  it('rejects changed duplicate counts rather than moving an annotation to a new copy', async () => {
    const { messages, annotation } = await captureWithAnnotation()
    await expect(deduplicateAndSave(conversation, [...initial, { role: 'ai', textContent: 'answer' }])).rejects.toThrow('ANNOTATED_MESSAGE_IDENTITY_AMBIGUOUS')
    expect((await getAnnotationExportContext(annotation.id)).message.id).toBe(messages[1].id)
    expect(await db.messages.count()).toBe(2)
  })

  it('updates rich content without changing the annotated message ID', async () => {
    const { messages, annotation } = await captureWithAnnotation()
    await deduplicateAndSave(conversation, [initial[0], { ...initial[1], citations: [{ label: 'Source', href: 'https://example.com', host: 'example.com', sourceType: 'reference_list' }] }])
    expect((await getAnnotationExportContext(annotation.id)).message.id).toBe(messages[1].id)
    expect((await db.messages.get(messages[1].id!))?.citations).toHaveLength(1)
  })

  it('leaves the capture intact when an annotated message cannot be matched', async () => {
    const { messages, annotation } = await captureWithAnnotation()
    await expect(deduplicateAndSave(conversation, [{ role: 'ai', textContent: 'different' }, { role: 'user', textContent: 'replacement' }])).rejects.toThrow('ANNOTATED_MESSAGE_IDENTITY_AMBIGUOUS')
    expect((await getAnnotationExportContext(annotation.id)).message.id).toBe(messages[1].id)
    expect(await db.messages.count()).toBe(2)
  })
})
