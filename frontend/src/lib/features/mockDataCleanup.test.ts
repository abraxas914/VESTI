import { beforeEach, describe, expect, it, vi } from "vitest"

const storageMocks = vi.hoisted(() => ({
  getConversations: vi.fn(),
  deleteConversations: vi.fn()
}))

vi.mock("../services/storageService", () => storageMocks)

import { clearSeededMockData } from "./mockDataCleanup"

describe("mock data cleanup", () => {
  beforeEach(() => {
    storageMocks.getConversations.mockReset()
    storageMocks.deleteConversations.mockReset()
    storageMocks.deleteConversations.mockResolvedValue(undefined)
  })

  it("deletes only conversations explicitly marked as mock", async () => {
    storageMocks.getConversations.mockResolvedValue([
      { id: 1, isMock: true },
      { id: 2, isMock: false },
      { id: 3 },
      { id: 4, isMock: true }
    ])

    await expect(clearSeededMockData()).resolves.toEqual({ deleted: 2 })
    expect(storageMocks.deleteConversations).toHaveBeenCalledWith([1, 4])
  })

  it("does not delete unmarked conversations", async () => {
    storageMocks.getConversations.mockResolvedValue([
      { id: 1 },
      { id: 2, isMock: false }
    ])

    await expect(clearSeededMockData()).resolves.toEqual({ deleted: 0 })
    expect(storageMocks.deleteConversations).toHaveBeenCalledWith([])
  })
})
