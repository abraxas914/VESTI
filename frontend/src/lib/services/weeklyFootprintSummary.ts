import { getLocaleDateTag, type SupportedLocale } from "../i18n/locales"
import type {
  Conversation,
  Message,
  Topic,
  WeeklyFootprintSummary
} from "../types"
import type { WeeklyStats } from "./weeklyStats"

const QUESTION_LIMIT = 88

function flattenTopics(topics: readonly Topic[]): Map<number, string> {
  const lookup = new Map<number, string>()
  const visit = (nodes: readonly Topic[]) => {
    for (const topic of nodes) {
      const name = topic.name?.replace(/\s+/g, " ").trim()
      if (typeof topic.id === "number" && name) {
        lookup.set(topic.id, name)
      }
      if (topic.children?.length) visit(topic.children)
    }
  }
  visit(topics)
  return lookup
}

function normalizeLabel(
  value: string | null | undefined,
  limit: number
): string {
  return (value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#\[\]]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
}

function summarizeQuestion(value: string): string {
  const normalized = normalizeLabel(value, QUESTION_LIMIT + 1)
  if (normalized.length <= QUESTION_LIMIT) return normalized
  return `${normalized.slice(0, QUESTION_LIMIT).trimEnd()}…`
}

function rankCounts(counts: ReadonlyMap<string, number>): string | null {
  return (
    [...counts.entries()].sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName)
    )[0]?.[0] ?? null
  )
}

function formatLatestChatAt(
  timestamp: number,
  locale: SupportedLocale
): string {
  try {
    return new Intl.DateTimeFormat(getLocaleDateTag(locale), {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

function buildEncouragement(
  locale: SupportedLocale,
  stats: Pick<WeeklyStats, "activeDays" | "weekOverWeekDelta">,
  latestChatAt: number | null
): string {
  const lateNight =
    latestChatAt !== null && new Date(latestChatAt).getHours() < 6

  if (locale === "zh") {
    if (lateNight) {
      return "这周你辛苦了，深夜还在认真追问，也别忘了给自己留一点休息时间。"
    }
    if ((stats.weekOverWeekDelta ?? 0) > 0) {
      return "这周你好棒，比上周又向前走了一步。"
    }
    if (stats.activeDays >= 5) {
      return "这周你辛苦了，持续投入本身就是很了不起的进步。"
    }
    return "这周你好棒，每一次认真发问都在让你向前走。"
  }
  if (locale === "ja") {
    if (lateNight)
      return "今週もお疲れさまでした。深夜まで考えた分、休む時間も大切にしてください。"
    if ((stats.weekOverWeekDelta ?? 0) > 0)
      return "今週もすてきでした。先週よりまた一歩前進しています。"
    if (stats.activeDays >= 5)
      return "今週もお疲れさまでした。続けたこと自体が立派な成長です。"
    return "今週もすてきでした。一つひとつの問いが前進につながっています。"
  }
  if (locale === "ko") {
    if (lateNight)
      return "이번 주도 수고했어요. 늦은 밤까지 고민한 만큼 충분히 쉬어 주세요."
    if ((stats.weekOverWeekDelta ?? 0) > 0)
      return "이번 주 정말 잘했어요. 지난주보다 한 걸음 더 나아갔어요."
    if (stats.activeDays >= 5)
      return "이번 주도 수고했어요. 꾸준히 이어 온 것 자체가 멋진 성장입니다."
    return "이번 주 정말 잘했어요. 진지한 질문 하나하나가 앞으로 나아가게 해요."
  }
  if (lateNight) {
    return "You worked hard this week. Your late-night curiosity deserves some real rest, too."
  }
  if ((stats.weekOverWeekDelta ?? 0) > 0) {
    return "You did wonderfully this week—you moved another step beyond last week."
  }
  if (stats.activeDays >= 5) {
    return "You worked hard this week. Showing up consistently is meaningful progress."
  }
  return "You did wonderfully this week. Every thoughtful question is moving you forward."
}

function buildSummaryText(
  locale: SupportedLocale,
  input: {
    platform: string
    topicCount: number
    topDirection: string
    latestChatAt: number
    latestQuestion: string
  }
): string {
  const latestTime = formatLatestChatAt(input.latestChatAt, locale)
  if (locale === "zh") {
    return `这周你主要在 ${input.platform} 平台上聊了 ${input.topicCount} 个话题。本周你最关心的话题为“${input.topDirection}”。本周最晚在 ${latestTime} 提问，提的问题为“${input.latestQuestion}”。`
  }
  if (locale === "ja") {
    return `今週は主に${input.platform}で${input.topicCount}件の話題を扱い、最も多かった方向は「${input.topDirection}」でした。最後の会話は${latestTime}で、そのときは「${input.latestQuestion}」について尋ねていました。`
  }
  if (locale === "ko") {
    return `이번 주에는 주로 ${input.platform}에서 ${input.topicCount}개 주제를 이야기했고, 가장 많이 다룬 방향은 ‘${input.topDirection}’이었어요. 가장 늦은 대화는 ${latestTime}에 있었고, 당시 ‘${input.latestQuestion}’에 관해 질문했어요.`
  }
  return `This week you mainly used ${input.platform} across ${input.topicCount} topics, with ${input.topDirection} as your leading direction. Your latest chat was ${latestTime}, when you asked about “${input.latestQuestion}.”`
}

/**
 * Build the weekly footprint locally from already-loaded report inputs. This
 * deliberately avoids another model call and keeps every displayed fact tied
 * to stored conversations and user messages.
 */
export function buildWeeklyFootprintSummary(
  conversations: readonly Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>,
  topics: readonly Topic[],
  stats: Pick<WeeklyStats, "activeDays" | "topPlatforms" | "weekOverWeekDelta">,
  locale: SupportedLocale,
  rangeStart: number,
  rangeEnd: number
): WeeklyFootprintSummary | undefined {
  const active = conversations.filter((conversation) => !conversation.is_trash)
  if (active.length === 0) return undefined

  const platformCounts = new Map<string, number>()
  const directionCounts = new Map<string, number>()
  const topicLookup = flattenTopics(topics)

  for (const conversation of active) {
    platformCounts.set(
      conversation.platform,
      (platformCounts.get(conversation.platform) ?? 0) + 1
    )
    const directions = new Set<string>()
    for (const tag of conversation.tags ?? []) {
      const normalized = normalizeLabel(tag, 48)
      if (normalized) directions.add(normalized)
    }
    if (conversation.topic_id !== null) {
      const topic = topicLookup.get(conversation.topic_id)
      if (topic) directions.add(topic)
    }
    if (directions.size === 0) {
      const fallback = normalizeLabel(
        conversation.title || conversation.snippet,
        48
      )
      if (fallback) directions.add(fallback)
    }
    for (const direction of directions) {
      directionCounts.set(direction, (directionCounts.get(direction) ?? 0) + 1)
    }
  }

  const latestUserMessage = active
    .flatMap((conversation) =>
      (messagesByConversation.get(conversation.id) ?? [])
        .filter(
          (message) =>
            message.role === "user" &&
            Number.isFinite(message.created_at) &&
            message.created_at >= rangeStart &&
            message.created_at <= rangeEnd &&
            message.content_text.trim().length > 0
        )
        .map((message) => ({ conversation, message }))
    )
    .sort(
      (left, right) =>
        right.message.created_at - left.message.created_at ||
        right.message.id - left.message.id
    )[0]
  // A "latest question" is shown only when it is backed by an in-range user
  // message. Conversation origin/capture time is not a valid substitute for
  // the user's real question time.
  if (!latestUserMessage) return undefined
  const latestConversation = latestUserMessage.conversation
  const latestChatAt = latestUserMessage.message.created_at
  const latestQuestion = summarizeQuestion(latestUserMessage.message.content_text)
  const platform =
    stats.topPlatforms[0]?.platform ?? rankCounts(platformCounts) ?? "AI"
  const topDirection =
    rankCounts(directionCounts) ?? normalizeLabel(latestConversation.title, 48)

  if (!latestQuestion || !topDirection || !Number.isFinite(latestChatAt)) {
    return undefined
  }

  const topicCount = Math.max(1, directionCounts.size)
  return {
    platform,
    topicCount,
    topDirection,
    latestChatAt,
    latestConversationId: latestConversation.id,
    latestMessageId: latestUserMessage?.message.id ?? null,
    latestQuestion,
    summary: buildSummaryText(locale, {
      platform,
      topicCount,
      topDirection,
      latestChatAt,
      latestQuestion
    }),
    encouragement: buildEncouragement(locale, stats, latestChatAt)
  }
}
