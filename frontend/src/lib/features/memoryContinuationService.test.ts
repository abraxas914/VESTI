import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  CONTINUATION_DRAFT_KEY,
  createSummaryContinuation,
  generateSummaryService
} from "./memoryContinuationService"

const mocks = vi.hoisted(() => ({
  createExploreSession: vi.fn(),
  getConversations: vi.fn(),
  getMessages: vi.fn()
}))

vi.mock("../services/storageService", () => ({
  createExploreSession: mocks.createExploreSession,
  getConversations: mocks.getConversations,
  getMessages: mocks.getMessages
}))

const storage = new Map<string, unknown>()

describe("createSummaryContinuation", () => {
  beforeEach(() => {
    storage.clear()
    mocks.createExploreSession.mockReset().mockResolvedValue("sess_demo")
    mocks.getConversations.mockReset()
    mocks.getMessages.mockReset()
    vi.stubGlobal("chrome", {
      runtime: { lastError: undefined },
      storage: {
        local: {
          set(payload: Record<string, unknown>, callback: () => void) {
            Object.entries(payload).forEach(([key, value]) =>
              storage.set(key, value)
            )
            callback()
          }
        }
      }
    })
  })

  it("persists the merged summary as the new session system prompt", async () => {
    const draft = await createSummaryContinuation("第一条结论\n第二条结论")

    expect(draft.sessionId).toBe("sess_demo")
    expect(draft.systemPrompt).toContain("第一条结论")
    expect(mocks.createExploreSession).toHaveBeenCalledWith(
      "基于合并记忆的新对话",
      draft.systemPrompt
    )
    expect(storage.get(CONTINUATION_DRAFT_KEY)).toEqual(draft)
  })

  it("uses the already loaded conversations and their local messages", async () => {
    const conversations = [
      {
        id: 1,
        title: "作息讨论",
        platform: "deepseek",
        snippet: "小猫晚上睡不着"
      },
      {
        id: 2,
        title: "睡眠建议",
        platform: "chatgpt",
        snippet: "调整光照和活动时间"
      }
    ] as never[]
    mocks.getMessages
      .mockResolvedValueOnce([
        { role: "user", content_text: "为什么小猫晚上睡不着" },
        { role: "ai", content_text: "可能与昼夜节律有关" }
      ])
      .mockResolvedValueOnce([])

    const summary = await generateSummaryService(
      [1, 2],
      conversations
    )

    expect(mocks.getConversations).not.toHaveBeenCalled()
    expect(summary).toContain("为什么小猫晚上睡不着")
    expect(summary).toContain("调整光照和活动时间")
  })
})
