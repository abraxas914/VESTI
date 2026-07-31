import { describe, expect, it } from "vitest"

import {
  createSeedConversations,
  SEED_RANGE_END,
  SEED_RANGE_START
} from "./seedData"

describe("createSeedConversations", () => {
  it("creates deterministic, idempotent demo conversations", () => {
    const first = createSeedConversations()
    const second = createSeedConversations()

    expect(first).toEqual(second)
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length)
    expect(first).toHaveLength(7)
  })

  it("covers the requested date range and all three AI platforms", () => {
    const conversations = createSeedConversations()
    const localDates = conversations.map((item) =>
      new Date(item.createdAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    )

    expect(localDates).toContain(SEED_RANGE_START)
    expect(localDates).toContain(SEED_RANGE_END)
    expect(new Set(conversations.map((item) => item.platform))).toEqual(
      new Set(["ChatGPT", "DeepSeek", "Kimi"])
    )
  })

  it("provides the complete capture schema for every conversation", () => {
    for (const conversation of createSeedConversations()) {
      expect(conversation.id).toMatch(/^vesti-demo-/)
      expect(conversation.title.trim()).not.toBe("")
      expect(conversation.summary.trim()).not.toBe("")
      expect(Number.isFinite(conversation.createdAt)).toBe(true)
      expect(conversation.messages.length).toBeGreaterThanOrEqual(2)
      expect(
        conversation.messages.every(
          (message) =>
            (message.role === "user" || message.role === "ai") &&
            message.content.trim().length > 0 &&
            Number.isFinite(message.createdAt)
        )
      ).toBe(true)
    }
  })
})
