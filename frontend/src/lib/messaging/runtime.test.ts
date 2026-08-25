import { afterEach, describe, expect, it, vi } from "vitest"

import type { RequestMessage } from "./protocol"
import {
  CAPTURE_TIMEOUT_MS,
  RequestTimeoutError,
  sendRequest
} from "./runtime"

describe("sendRequest timeout handling", () => {
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as { chrome?: unknown }).chrome
  })

  it("rejects with RequestTimeoutError when the background never responds", async () => {
    vi.useFakeTimers()
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        lastError: undefined
      }
    } as unknown as typeof chrome

    const promise = sendRequest(
      { type: "CAPTURE_CONVERSATION" } as unknown as RequestMessage,
      50
    )
    const assertion = expect(promise).rejects.toBeInstanceOf(
      RequestTimeoutError
    )
    await vi.advanceTimersByTimeAsync(60)
    await assertion
  })

  it("exposes a capture timeout well above the generic 4s default", () => {
    // Large-library recaptures legitimately take tens of seconds; the capture
    // budget must not regress to the generic request default (4s).
    expect(CAPTURE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })
})
