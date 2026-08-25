import { describe, expect, it } from "vitest"

import type { Conversation } from "../types"
import { upsertConversations } from "./upsertConversations"

function makeConversation(
  overrides: Partial<Conversation> & { id: number }
): Conversation {
  return {
    uuid: `uuid-${overrides.id}`,
    platform: "ChatGPT",
    title: `Conversation ${overrides.id}`,
    snippet: "",
    url: "",
    source_created_at: null,
    first_captured_at: 0,
    last_captured_at: 0,
    created_at: 0,
    updated_at: 0,
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

// Descending "newest first" order, mirroring the list's sort comparator.
const timeOf = (conversation: Conversation) => conversation.updated_at

describe("upsertConversations", () => {
  it("returns the input untouched when there are no patches", () => {
    const prev = [makeConversation({ id: 1, updated_at: 10 })]
    expect(upsertConversations(prev, [], timeOf)).toBe(prev)
  })

  it("merges fields into an existing row and keeps list order by time", () => {
    const prev = [
      makeConversation({ id: 1, updated_at: 20, title: "newest" }),
      makeConversation({ id: 2, updated_at: 10, title: "oldest" })
    ]
    const next = upsertConversations(
      prev,
      [makeConversation({ id: 2, updated_at: 10, title: "renamed" })],
      timeOf
    )
    expect(next).toHaveLength(2)
    expect(next[0].id).toBe(1)
    expect(next[1]).toMatchObject({ id: 2, title: "renamed" })
  })

  it("re-sorts when a patch makes a row newer than its neighbours", () => {
    const prev = [
      makeConversation({ id: 1, updated_at: 20 }),
      makeConversation({ id: 2, updated_at: 10 })
    ]
    const next = upsertConversations(
      prev,
      [makeConversation({ id: 2, updated_at: 30 })],
      timeOf
    )
    expect(next.map((item) => item.id)).toEqual([2, 1])
  })

  it("inserts rows that are not in the list yet (new captures)", () => {
    const prev = [makeConversation({ id: 1, updated_at: 20 })]
    const next = upsertConversations(
      prev,
      [makeConversation({ id: 2, updated_at: 30 })],
      timeOf
    )
    expect(next.map((item) => item.id)).toEqual([2, 1])
  })

  it("handles a batch mixing updates and inserts", () => {
    const prev = [
      makeConversation({ id: 1, updated_at: 20, title: "a" }),
      makeConversation({ id: 2, updated_at: 10, title: "b" })
    ]
    const next = upsertConversations(
      prev,
      [
        makeConversation({ id: 2, updated_at: 40, title: "b2" }),
        makeConversation({ id: 3, updated_at: 30, title: "c" })
      ],
      timeOf
    )
    expect(next.map((item) => item.id)).toEqual([2, 3, 1])
    expect(next[0].title).toBe("b2")
  })

  it("keeps object identity for unpatched rows (memo-friendly)", () => {
    const untouched = makeConversation({ id: 1, updated_at: 20 })
    const patched = makeConversation({ id: 2, updated_at: 10 })
    const next = upsertConversations(
      [untouched, patched],
      [makeConversation({ id: 2, updated_at: 10, title: "changed" })],
      timeOf
    )
    expect(next.find((item) => item.id === 1)).toBe(untouched)
    expect(next.find((item) => item.id === 2)).not.toBe(patched)
  })
})
