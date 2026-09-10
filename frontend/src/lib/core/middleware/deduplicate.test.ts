import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationDraft, ParsedMessage } from "../../messaging/protocol"

// In-memory fake of the Dexie `db` surface used by deduplicateAndSave. The
// recapture path is what dangles annotations.message_id in production, so
// these tests exercise id stability and reference reconciliation directly.
const mocks = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id?: number }

  function createTable() {
    let seq = 1
    const rows: Row[] = []
    return { rows, nextId: () => seq++ }
  }

  const conversations = createTable()
  const messages = createTable()
  const annotations = createTable()
  const prompts = createTable()

  const db = {
    transaction: (...args: unknown[]) => {
      const callback = args[args.length - 1] as () => unknown
      return callback()
    },
    conversations: {
      where: (index: string) => ({
        equals: (value: [string, string]) => ({
          first: async () =>
            index === "[platform+uuid]"
              ? conversations.rows.find(
                  (row) => row.platform === value[0] && row.uuid === value[1]
                )
              : undefined
        })
      }),
      add: async (record: Row) => {
        const id = conversations.nextId()
        conversations.rows.push({ ...record, id })
        return id
      },
      update: async (id: number, changes: Row) => {
        const row = conversations.rows.find((item) => item.id === id)
        if (row) Object.assign(row, changes)
      }
    },
    messages: {
      where: () => ({
        equals: (conversationId: number) => ({
          toArray: async () =>
            messages.rows.filter((row) => row.conversation_id === conversationId),
          delete: async () => {
            for (let index = messages.rows.length - 1; index >= 0; index -= 1) {
              if (messages.rows[index].conversation_id === conversationId) {
                messages.rows.splice(index, 1)
              }
            }
          }
        })
      }),
      bulkAdd: async (inserts: Row[], options?: { allKeys?: boolean }) => {
        const ids = inserts.map((insert) => {
          const id =
            typeof insert.id === "number" ? insert.id : messages.nextId()
          messages.rows.push({ ...insert, id })
          return id
        })
        return options?.allKeys ? ids : ids[ids.length - 1]
      }
    },
    annotations: {
      where: () => ({
        equals: (conversationId: number) => ({
          toArray: async () =>
            annotations.rows.filter(
              (row) => row.conversation_id === conversationId
            )
        })
      }),
      add: async (record: Row) => {
        const id = annotations.nextId()
        annotations.rows.push({ ...record, id })
        return id
      },
      update: async (id: number, changes: Row) => {
        const row = annotations.rows.find((item) => item.id === id)
        if (row) Object.assign(row, changes)
      },
      delete: async (id: number) => {
        const index = annotations.rows.findIndex((item) => item.id === id)
        if (index >= 0) annotations.rows.splice(index, 1)
      }
    },
    prompts: {
      where: () => ({
        equals: (conversationId: number) => ({
          toArray: async () =>
            prompts.rows.filter(
              (row) => row.source_conversation_id === conversationId
            )
        })
      }),
      add: async (record: Row) => {
        const id = prompts.nextId()
        prompts.rows.push({ ...record, id })
        return id
      },
      update: async (id: number, changes: Row) => {
        const row = prompts.rows.find((item) => item.id === id)
        if (row) Object.assign(row, changes)
      }
    }
  }

  function reset() {
    for (const table of [conversations, messages, annotations, prompts]) {
      table.rows.length = 0
    }
  }

  return { db, conversations, messages, annotations, prompts, reset }
})

vi.mock("../../db/schema", () => ({
  db: mocks.db,
  resolveConversationRecordOriginAt: (record: {
    source_created_at?: number | null
    first_captured_at?: number
    created_at?: number
  }) =>
    record.source_created_at ??
    record.first_captured_at ??
    record.created_at ??
    0
}))

vi.mock("../../db/storageLimits", () => ({
  enforceStorageWriteGuard: async () => undefined
}))

const { deduplicateAndSave } = await import("./deduplicate")

function draft(overrides: Partial<ConversationDraft> = {}): ConversationDraft {
  return {
    uuid: "conv-1",
    platform: "Kimi",
    title: "demo",
    snippet: "demo",
    url: "https://www.kimi.com/chat/conv-1",
    source_created_at: 1_000,
    first_captured_at: 1_000,
    last_captured_at: 1_000,
    created_at: 1_000,
    updated_at: 1_000,
    message_count: 0,
    turn_count: 0,
    is_archived: false,
    is_trash: false,
    tags: [],
    topic_id: null,
    is_starred: false,
    ...overrides
  }
}

function userMessage(text: string, timestamp?: number): ParsedMessage {
  return { role: "user", textContent: text, timestamp }
}

function aiMessage(text: string, timestamp?: number): ParsedMessage {
  return { role: "ai", textContent: text, timestamp }
}

function messageIds(): number[] {
  return mocks.messages.rows.map((row) => row.id as number)
}

function danglingAnnotations(): unknown[] {
  const validIds = new Set(messageIds())
  return mocks.annotations.rows.filter(
    (row) => !validIds.has(row.message_id as number)
  )
}

describe("deduplicateAndSave recapture reference stability", () => {
  beforeEach(() => {
    mocks.reset()
  })

  it("keeps stored message ids stable across an append-only recapture, so annotations stay valid", async () => {
    const first = await deduplicateAndSave(draft(), [
      userMessage("hello", 1),
      aiMessage("hi there", 2)
    ])
    expect(first.saved).toBe(true)
    const [firstUserId, firstAiId] = messageIds()

    const annotationId = await mocks.db.annotations.add({
      conversation_id: first.conversationId,
      message_id: firstAiId,
      content_text: "remember this",
      created_at: 10,
      days_after: 0
    })

    const second = await deduplicateAndSave(draft(), [
      userMessage("hello", 1),
      aiMessage("hi there", 2),
      userMessage("follow up", 3)
    ])
    expect(second).toMatchObject({ saved: true, newMessages: 1 })

    // Unchanged messages kept their ids; only the appended message got a new one.
    expect(messageIds().slice(0, 2)).toEqual([firstUserId, firstAiId])

    const annotation = mocks.annotations.rows.find(
      (row) => row.id === annotationId
    )
    expect(annotation?.message_id).toBe(firstAiId)
    expect(danglingAnnotations()).toEqual([])
  })

  it("does not churn message ids when a recapture is a no-op", async () => {
    await deduplicateAndSave(draft(), [userMessage("hello", 1)])
    const idsBefore = messageIds()

    const result = await deduplicateAndSave(draft(), [userMessage("hello", 1)])

    expect(result.saved).toBe(false)
    expect(messageIds()).toEqual(idsBefore)
  })

  it("drops annotations whose message disappeared in the recapture instead of leaving them dangling", async () => {
    const first = await deduplicateAndSave(draft(), [
      userMessage("hello", 1),
      aiMessage("answer A", 2),
      userMessage("thanks", 3)
    ])
    const removedMessageId = messageIds()[1]

    const annotationId = await mocks.db.annotations.add({
      conversation_id: first.conversationId,
      message_id: removedMessageId,
      content_text: "stale note",
      created_at: 10,
      days_after: 0
    })

    // Same-length recapture where the middle message changed: not blocked by
    // the destructive-recapture guard, and the old middle id is discarded.
    const second = await deduplicateAndSave(draft(), [
      userMessage("hello", 1),
      aiMessage("answer B", 2),
      userMessage("thanks", 3)
    ])
    expect(second.saved).toBe(true)

    expect(
      mocks.annotations.rows.find((row) => row.id === annotationId)
    ).toBeUndefined()
    expect(danglingAnnotations()).toEqual([])
  })

  it("remaps references from a discarded duplicate to the surviving identical message", async () => {
    const first = await deduplicateAndSave(draft(), [
      userMessage("same", 1),
      userMessage("same", 2)
    ])
    const secondDuplicateId = messageIds()[1]

    const annotationId = await mocks.db.annotations.add({
      conversation_id: first.conversationId,
      message_id: secondDuplicateId,
      content_text: "on the duplicate",
      created_at: 10,
      days_after: 0
    })
    const promptId = await mocks.db.prompts.add({
      source_conversation_id: first.conversationId,
      source_message_id: secondDuplicateId,
      body: "same"
    })

    const second = await deduplicateAndSave(draft(), [
      userMessage("same", 1),
      aiMessage("reply", 3)
    ])
    expect(second.saved).toBe(true)

    const survivingId = messageIds()[0]
    const annotation = mocks.annotations.rows.find(
      (row) => row.id === annotationId
    )
    expect(annotation?.message_id).toBe(survivingId)
    const prompt = mocks.prompts.rows.find((row) => row.id === promptId)
    expect(prompt?.source_message_id).toBe(survivingId)
    expect(danglingAnnotations()).toEqual([])
  })

  it("nulls prompt provenance when its source message is gone for good", async () => {
    const first = await deduplicateAndSave(draft(), [
      userMessage("hello", 1),
      aiMessage("answer A", 2)
    ])
    const removedMessageId = messageIds()[1]

    const promptId = await mocks.db.prompts.add({
      source_conversation_id: first.conversationId,
      source_message_id: removedMessageId,
      body: "answer A"
    })

    const second = await deduplicateAndSave(draft(), [
      userMessage("hello", 1),
      aiMessage("answer B", 2)
    ])
    expect(second.saved).toBe(true)

    const prompt = mocks.prompts.rows.find((row) => row.id === promptId)
    expect(prompt?.source_message_id).toBeNull()
  })
})
