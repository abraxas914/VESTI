import { describe, expect, it, vi } from "vitest"

import { runCoreRoundTableService } from "./roundTableBackgroundService"

const mocks = vi.hoisted(() => ({
  callInference: vi.fn(),
  resolveUsableLlmConfig: vi.fn()
}))

vi.mock("../services/llmService", () => ({
  callInference: mocks.callInference
}))

vi.mock("../services/promptLlmService", () => ({
  resolveUsableLlmConfig: mocks.resolveUsableLlmConfig
}))

describe("runCoreRoundTableService", () => {
  it("starts all three role requests concurrently", async () => {
    mocks.resolveUsableLlmConfig.mockResolvedValue({ provider: "demo" })
    const resolvers: Array<(value: { content: string }) => void> = []
    mocks.callInference.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )

    const pending = runCoreRoundTableService("该如何设计首次体验？")
    await vi.waitFor(() => expect(mocks.callInference).toHaveBeenCalledTimes(3))

    resolvers.forEach((resolve, index) =>
      resolve({ content: `角色回答 ${index + 1}` })
    )
    const result = await pending

    expect(result.replies).toHaveLength(3)
    expect(result.replies.every((reply) => reply.ok)).toBe(true)
    expect(
      new Set(
        mocks.callInference.mock.calls.map(
          (call) => call[2]?.systemPrompt as string
        )
      ).size
    ).toBe(3)
  })
})
