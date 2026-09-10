import { SUPPORTED_PLATFORMS } from "../platform"
import type { Conversation, DashboardStats, Platform } from "../types"
import { getConversationFirstCapturedAt } from "./timestamps"

function dayKey(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function initPlatformDistribution(): Record<Platform, number> {
  return Object.fromEntries(
    SUPPORTED_PLATFORMS.map((platform) => [platform, 0])
  ) as Record<Platform, number>
}

/**
 * Pure dashboard-stats derivation over an already-loaded conversation list.
 * The sidepanel derives stats locally from the list it just fetched (instead
 * of issuing a second full-table read through IPC); the repository-level
 * getDashboardStats shares this implementation to keep the semantics identical.
 */
export function computeDashboardStats(
  conversations: Conversation[]
): DashboardStats {
  const distribution = initPlatformDistribution()

  for (const c of conversations) {
    distribution[c.platform] += 1
  }

  const today = dayKey(Date.now())
  // Single pass: one dayKey computation per conversation. The previous
  // implementation filtered the whole list once per distinct day
  // (O(conversations x days), with a Date allocation per pair).
  const countsByDay = new Map<string, number>()
  for (const c of conversations) {
    const key = dayKey(getConversationFirstCapturedAt(c))
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1)
  }

  const firstCapturedTodayCount = countsByDay.get(today) ?? 0
  const daysWithConversations = new Set(countsByDay.keys())

  let firstCaptureStreak = 0
  const cursor = new Date()
  while (daysWithConversations.has(dayKey(cursor.getTime()))) {
    firstCaptureStreak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  const firstCaptureHeatmapData = Array.from(countsByDay, ([date, count]) => ({
    date,
    count
  }))

  return {
    totalConversations: conversations.length,
    totalTokens: 0,
    firstCaptureStreak,
    firstCapturedTodayCount,
    platformDistribution: distribution,
    firstCaptureHeatmapData
  }
}
