import { beforeEach, describe, expect, it, vi } from "vitest"

import type { HistoryProvider } from "./types"
import { runHistoryImport } from "./importRunner"

const mocks = vi.hoisted(() => ({ sendRequest: vi.fn() }))

vi.mock("../../messaging/runtime", () => ({
  sendRequest: mocks.sendRequest,
  CAPTURE_TIMEOUT_MS: 60_000
}))

function built(id: string, sourceCreatedAt: number) {
  return {
    conversation: {
      uuid: id,
      platform: "DeepSeek" as const,
      title: id,
      snippet: "demo",
      url: `https://chat.deepseek.com/a/chat/s/${id}`,
      source_created_at: sourceCreatedAt,
      first_captured_at: sourceCreatedAt,
      last_captured_at: sourceCreatedAt,
      created_at: sourceCreatedAt,
      updated_at: sourceCreatedAt,
      message_count: 1,
      turn_count: 0,
      is_archived: false,
      is_trash: false,
      tags: [],
      topic_id: null,
      is_starred: false
    },
    messages: [
      {
        role: "user" as const,
        textContent: "hello",
        timestamp: sourceCreatedAt
      }
    ]
  }
}

describe("runHistoryImport date range", () => {
  beforeEach(() => {
    mocks.sendRequest.mockReset().mockResolvedValue({
      saved: true,
      newMessages: 1
    })
  })

  it("fetches only recent references and rejects an old unknown-date detail", async () => {
    const fetchConversation = vi.fn(async (ref: { id: string }) =>
      ref.id === "recent" ? built(ref.id, 1_500) : built(ref.id, 500)
    )
    const provider: HistoryProvider = {
      platform: "DeepSeek",
      isAvailable: async () => true,
      listConversations: async () => [
        { id: "old-known", updatedAt: 500 },
        { id: "recent", updatedAt: 1_500 },
        { id: "old-unknown" }
      ],
      fetchConversation
    }

    const result = await runHistoryImport(provider, {
      since: 1_000,
      until: 2_000,
      throttleMs: 0
    })

    expect(fetchConversation).toHaveBeenCalledTimes(2)
    expect(fetchConversation.mock.calls.map(([ref]) => ref.id)).toEqual([
      "recent",
      "old-unknown"
    ])
    expect(mocks.sendRequest).toHaveBeenCalledTimes(1)
    expect(mocks.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CAPTURE_CONVERSATION" }),
      60_000
    )
    expect(result).toMatchObject({
      phase: "done",
      discovered: 2,
      processed: 2,
      saved: 1,
      skipped: 1,
      failed: 0
    })
  })
})
