import { describe, expect, it, vi } from "vitest"

import { optimizeDeepSeekPromptInBackground } from "./deepseekPromptBackgroundService"

const mocks = vi.hoisted(() => ({
  completePromptDraft: vi.fn(),
  resolveUsableLlmConfig: vi.fn()
}))

vi.mock("../services/promptLlmService", () => ({
  completePromptDraft: mocks.completePromptDraft,
  resolveUsableLlmConfig: mocks.resolveUsableLlmConfig
}))

describe("optimizeDeepSeekPromptInBackground", () => {
  it("uses the required hard-coded expert explanation topic", async () => {
    mocks.resolveUsableLlmConfig.mockResolvedValue({ provider: "demo" })
    mocks.completePromptDraft.mockResolvedValue({
      completion: "优化后的专家提示词",
      usedLlm: true
    })

    const result = await optimizeDeepSeekPromptInBackground(
      "这段内容不应成为测试主题",
      "expert_explain"
    )

    expect(result.optimized).toBe("优化后的专家提示词")
    expect(mocks.completePromptDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        draft: expect.stringContaining("为什么小猫晚上睡不着"),
        platform: "DeepSeek",
        mode: "optimize"
      })
    )
  })
})
