import { describe, expect, it } from "vitest"

import { SUPPORTED_PLATFORMS } from "../platform"
import type { Conversation, Platform } from "../types"
import { computeDashboardStats } from "./dashboardStats"

function makeConversation(
  overrides: Partial<Conversation> & { id: number }
): Conversation {
  return {
    uuid: `uuid-${overrides.id}`,
    platform: "ChatGPT",
    title: `Conversation ${overrides.id}`,
    snippet: "",
    url: "",
    source_created_at: null,
    first_captured_at: 0,
    last_captured_at: 0,
    created_at: 0,
    updated_at: 0,
    message_count: 0,
    turn_count: 0,
    is_archived: false,
    is_trash: false,
    tags: [],
    topic_id: null,
    is_starred: false,
    ...overrides
  }
}

function localDayAtNoon(daysAgo: number): number {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

describe("computeDashboardStats", () => {
  it("returns zeroed stats for an empty list", () => {
    const stats = computeDashboardStats([])
    expect(stats.totalConversations).toBe(0)
    expect(stats.firstCapturedTodayCount).toBe(0)
    expect(stats.firstCaptureStreak).toBe(0)
    expect(stats.firstCaptureHeatmapData).toEqual([])
    for (const platform of SUPPORTED_PLATFORMS) {
      expect(stats.platformDistribution[platform]).toBe(0)
    }
  })

  it("counts totals and per-platform distribution", () => {
    const conversations = [
      makeConversation({ id: 1, platform: "ChatGPT" }),
      makeConversation({ id: 2, platform: "ChatGPT" }),
      makeConversation({ id: 3, platform: "Kimi" })
    ]
    const stats = computeDashboardStats(conversations)
    expect(stats.totalConversations).toBe(3)
    const expectedDistribution = Object.fromEntries(
      SUPPORTED_PLATFORMS.map((platform: Platform) => [platform, 0])
    )
    expectedDistribution.ChatGPT = 2
    expectedDistribution.Kimi = 1
    expect(stats.platformDistribution).toEqual(expectedDistribution)
  })

  it("counts only today's first captures in firstCapturedTodayCount", () => {
    const conversations = [
      makeConversation({ id: 1, first_captured_at: localDayAtNoon(0) }),
      makeConversation({ id: 2, first_captured_at: localDayAtNoon(0) }),
      makeConversation({ id: 3, first_captured_at: localDayAtNoon(1) })
    ]
    const stats = computeDashboardStats(conversations)
    expect(stats.firstCapturedTodayCount).toBe(2)
  })

  it("counts the consecutive-day streak starting from today", () => {
    const conversations = [
      makeConversation({ id: 1, first_captured_at: localDayAtNoon(0) }),
      makeConversation({ id: 2, first_captured_at: localDayAtNoon(1) }),
      makeConversation({ id: 3, first_captured_at: localDayAtNoon(2) }),
      // gap on day 3, then an older capture that must not extend the streak
      makeConversation({ id: 4, first_captured_at: localDayAtNoon(4) })
    ]
    expect(computeDashboardStats(conversations).firstCaptureStreak).toBe(3)
  })

  it("reports a zero streak when nothing was captured today", () => {
    const conversations = [
      makeConversation({ id: 1, first_captured_at: localDayAtNoon(1) }),
      makeConversation({ id: 2, first_captured_at: localDayAtNoon(2) })
    ]
    expect(computeDashboardStats(conversations).firstCaptureStreak).toBe(0)
  })

  it("falls back to created_at when first_captured_at is missing", () => {
    const conversations = [
      makeConversation({
        id: 1,
        first_captured_at: 0,
        created_at: localDayAtNoon(0)
      })
    ]
    expect(computeDashboardStats(conversations).firstCapturedTodayCount).toBe(1)
  })

  it("aggregates heatmap entries per day", () => {
    const conversations = [
      makeConversation({ id: 1, first_captured_at: localDayAtNoon(1) }),
      makeConversation({ id: 2, first_captured_at: localDayAtNoon(1) }),
      makeConversation({ id: 3, first_captured_at: localDayAtNoon(0) })
    ]
    const stats = computeDashboardStats(conversations)
    const countsByDate = new Map(
      stats.firstCaptureHeatmapData.map((entry) => [entry.date, entry.count])
    )
    const keyOf = (ts: number) => {
      const d = new Date(ts)
      const mm = String(d.getMonth() + 1).padStart(2, "0")
      const dd = String(d.getDate()).padStart(2, "0")
      return `${d.getFullYear()}-${mm}-${dd}`
    }
    expect(countsByDate.get(keyOf(localDayAtNoon(0)))).toBe(1)
    expect(countsByDate.get(keyOf(localDayAtNoon(1)))).toBe(2)
    expect(stats.firstCaptureHeatmapData).toHaveLength(2)
  })
})
