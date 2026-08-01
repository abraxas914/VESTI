import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  consumeSidepanelNavigation,
  isSidepanelRoute,
  navigateSidepanel,
  SIDEPANEL_NAVIGATION_KEY
} from "./sidepanelNavigation"

const storage = new Map<string, unknown>()
const sentMessages: unknown[] = []

function installChromeMock() {
  vi.stubGlobal("chrome", {
    runtime: {
      lastError: undefined,
      sendMessage(message: unknown, callback: () => void) {
        sentMessages.push(message)
        callback()
      }
    },
    storage: {
      local: {
        get(keys: string[], callback: (result: object) => void) {
          callback(
            Object.fromEntries(
              keys
                .filter((key) => storage.has(key))
                .map((key) => [key, storage.get(key)])
            )
          )
        },
        set(payload: Record<string, unknown>, callback: () => void) {
          Object.entries(payload).forEach(([key, value]) =>
            storage.set(key, value)
          )
          callback()
        },
        remove(keys: string[], callback: () => void) {
          keys.forEach((key) => storage.delete(key))
          callback()
        }
      }
    }
  })
}

describe("sidepanel navigation handoff", () => {
  beforeEach(() => {
    storage.clear()
    sentMessages.length = 0
    installChromeMock()
  })

  it("persists the route and emits the exact runtime navigation message", async () => {
    await navigateSidepanel("/dashboard")

    expect(storage.get(SIDEPANEL_NAVIGATION_KEY)).toMatchObject({
      type: "NAVIGATE_SIDEPANEL",
      route: "/dashboard"
    })
    expect(sentMessages).toEqual([
      { type: "NAVIGATE_SIDEPANEL", route: "/dashboard" }
    ])
  })

  it("consumes a pending route exactly once", async () => {
    await navigateSidepanel("/insights")

    await expect(consumeSidepanelNavigation()).resolves.toBe("/insights")
    await expect(consumeSidepanelNavigation()).resolves.toBeNull()
  })

  it("rejects unsupported routes", () => {
    expect(isSidepanelRoute("/dashboard")).toBe(true)
    expect(isSidepanelRoute("/unknown")).toBe(false)
  })
})
