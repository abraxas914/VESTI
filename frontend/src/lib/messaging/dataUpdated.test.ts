import { afterEach, describe, expect, it, vi } from "vitest"

import { notifyDataUpdated, parseDataUpdatedPayload } from "./dataUpdated"

describe("parseDataUpdatedPayload", () => {
  it("parses a conversation-upsert payload", () => {
    expect(
      parseDataUpdatedPayload({
        type: "VESTI_DATA_UPDATED",
        payload: { kind: "conversation-upsert", conversationId: 42 }
      })
    ).toEqual({ kind: "conversation-upsert", conversationId: 42 })
  })

  it("parses a structural payload", () => {
    expect(
      parseDataUpdatedPayload({
        type: "VESTI_DATA_UPDATED",
        payload: { kind: "structural" }
      })
    ).toEqual({ kind: "structural" })
  })

  it("returns null for legacy payload-less messages (full-reload fallback)", () => {
    expect(parseDataUpdatedPayload({ type: "VESTI_DATA_UPDATED" })).toBeNull()
  })

  it("returns null for malformed messages", () => {
    expect(parseDataUpdatedPayload(null)).toBeNull()
    expect(parseDataUpdatedPayload("VESTI_DATA_UPDATED")).toBeNull()
    expect(parseDataUpdatedPayload({ payload: "structural" })).toBeNull()
    expect(parseDataUpdatedPayload({ payload: { kind: "unknown" } })).toBeNull()
    expect(
      parseDataUpdatedPayload({
        payload: { kind: "conversation-upsert" }
      })
    ).toBeNull()
    expect(
      parseDataUpdatedPayload({
        payload: { kind: "conversation-upsert", conversationId: "42" }
      })
    ).toBeNull()
  })
})

describe("notifyDataUpdated", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("broadcasts VESTI_DATA_UPDATED with the payload", () => {
    const sendMessage = vi.fn((_message: unknown, callback: () => void) =>
      callback()
    )
    vi.stubGlobal("chrome", {
      runtime: { sendMessage, lastError: undefined }
    })

    notifyDataUpdated({ kind: "conversation-upsert", conversationId: 7 })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: "VESTI_DATA_UPDATED",
      payload: { kind: "conversation-upsert", conversationId: 7 }
    })
  })

  it("does not throw when the chrome runtime is unavailable", () => {
    vi.stubGlobal("chrome", undefined)
    expect(() => notifyDataUpdated({ kind: "structural" })).not.toThrow()
  })
})
