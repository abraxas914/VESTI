import { describe, expect, it } from "vitest"

import {
  isSupportedCaptureTabUrl,
  rankSupportedCaptureTabs,
  resolvePlatformFromUrl
} from "./targeting"

describe("onboarding capture target selection", () => {
  it("recognizes every supported host without accepting lookalikes", () => {
    expect(isSupportedCaptureTabUrl("https://chatgpt.com/c/123")).toBe(true)
    expect(isSupportedCaptureTabUrl("https://claude.ai/chat/123")).toBe(true)
    expect(isSupportedCaptureTabUrl("https://chatgpt.com.evil.test/")).toBe(
      false
    )
    expect(
      isSupportedCaptureTabUrl("chrome-extension://example/onboarding.html")
    ).toBe(false)
  })

  it("resolves platform names used by the capture protocol", () => {
    expect(resolvePlatformFromUrl("https://chat.qwen.ai/c/1")).toBe("Qwen")
    expect(resolvePlatformFromUrl("https://kimi.moonshot.cn/chat/1")).toBe(
      "Kimi"
    )
    expect(resolvePlatformFromUrl("https://example.com/")).toBeUndefined()
  })

  it("ranks by last access and excludes the onboarding tab", () => {
    const ranked = rankSupportedCaptureTabs(
      [
        {
          id: 7,
          url: "https://chatgpt.com/c/older",
          lastAccessed: 100,
          active: true
        },
        {
          id: 9,
          url: "https://claude.ai/chat/newer",
          lastAccessed: 300,
          active: false
        },
        {
          id: 11,
          url: "https://example.com/",
          lastAccessed: 500,
          active: true
        }
      ] as unknown as chrome.tabs.Tab[],
      7
    )

    expect(ranked.map((tab) => tab.id)).toEqual([9])
  })
})
