import type { Conversation, Topic } from "../types";
import { getConversationOriginAt } from "../conversations/timestamps";

// ──────────────────────────────────────────────────────────────────────────
// Pure, dependency-light weekly statistics for the "weekly recap" (Plan B).
// NO LLM here: everything below is computed in code from the in-range
// conversations the caller already loaded. The single LLM call (warm copy)
// lives in insightGenerationService.generateWeeklyRecap.
// ──────────────────────────────────────────────────────────────────────────

export interface WeeklyStats {
  conversationCount: number;
  activeDays: number;
  streakWeeks: number;
  topPlatforms: Array<{ platform: string; count: number }>;
  busiestDay: { label?: string; count: number };
  topTopics: string[];
  starredCount: number;
  weekOverWeekDelta: number | null;
}

export interface WeeklyHighlightCandidate {
  conversationId: number;
  title: string;
  platform: string;
  topic: string | null;
  messageCount: number;
  turnCount: number;
  isStarred: boolean;
  weightScore: number;
  originAt: number;
  snippet: string;
}

export interface ComputeWeeklyStatsOptions {
  /** Topic lookup so topic_id can be resolved to a human label. */
  topics?: Topic[];
  /** Previous weeks' conversation counts, most-recent-first (index 0 = last week). */
  previousWeekCounts?: number[];
  /** BCP-47 tag used to format the busiest-weekday label (e.g. "en-US"). */
  dateTag?: string;
  /** Max platforms / topics surfaced. */
  topPlatformLimit?: number;
  topTopicLimit?: number;
}

const DEFAULT_TOP_PLATFORM_LIMIT = 3;
const DEFAULT_TOP_TOPIC_LIMIT = 3;

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function flattenTopics(topics: Topic[]): Map<number, string> {
  const lookup = new Map<number, string>();
  const visit = (nodes: Topic[]) => {
    for (const node of nodes) {
      if (typeof node.id === "number" && node.name) {
        lookup.set(node.id, node.name);
      }
      if (node.children && node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(topics);
  return lookup;
}

function formatWeekday(timestamp: number, dateTag: string): string {
  try {
    return new Date(timestamp).toLocaleDateString(dateTag, { weekday: "long" });
  } catch {
    return new Date(timestamp).toLocaleDateString("en-US", { weekday: "long" });
  }
}

/**
 * Compute weekly statistics from the in-range conversations. Trash threads are
 * filtered out. Topic names are resolved through the passed-in topics list.
 */
export function computeWeeklyStats(
  conversations: Conversation[],
  opts: ComputeWeeklyStatsOptions = {}
): WeeklyStats {
  const dateTag = opts.dateTag ?? "en-US";
  const topPlatformLimit = opts.topPlatformLimit ?? DEFAULT_TOP_PLATFORM_LIMIT;
  const topTopicLimit = opts.topTopicLimit ?? DEFAULT_TOP_TOPIC_LIMIT;

  const inRange = conversations.filter((conversation) => !conversation.is_trash);
  const topicLookup = flattenTopics(opts.topics ?? []);

  const conversationCount = inRange.length;

  const activeDayKeys = new Set<string>();
  const platformCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const dayCounts = new Map<string, { count: number; sampleTs: number }>();
  let starredCount = 0;

  for (const conversation of inRange) {
    const originAt = getConversationOriginAt(conversation);
    const dayKey = localDateKey(originAt);
    activeDayKeys.add(dayKey);

    platformCounts.set(
      conversation.platform,
      (platformCounts.get(conversation.platform) ?? 0) + 1
    );

    if (conversation.topic_id !== null && conversation.topic_id !== undefined) {
      const topicName = topicLookup.get(conversation.topic_id);
      if (topicName) {
        topicCounts.set(topicName, (topicCounts.get(topicName) ?? 0) + 1);
      }
    }

    const existingDay = dayCounts.get(dayKey);
    dayCounts.set(dayKey, {
      count: (existingDay?.count ?? 0) + 1,
      sampleTs: existingDay?.sampleTs ?? originAt,
    });

    if (conversation.is_starred) {
      starredCount += 1;
    }
  }

  const topPlatforms = [...platformCounts.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform))
    .slice(0, topPlatformLimit);

  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topTopicLimit)
    .map(([topic]) => topic);

  let busiestDay: { label?: string; count: number } = { count: 0 };
  for (const [, value] of dayCounts.entries()) {
    if (value.count > busiestDay.count) {
      busiestDay = {
        label: formatWeekday(value.sampleTs, dateTag),
        count: value.count,
      };
    }
  }

  const { streakWeeks, weekOverWeekDelta } = computeStreakAndDelta(
    conversationCount,
    opts.previousWeekCounts ?? []
  );

  return {
    conversationCount,
    activeDays: activeDayKeys.size,
    streakWeeks,
    topPlatforms,
    busiestDay,
    topTopics,
    starredCount,
    weekOverWeekDelta,
  };
}

/**
 * Derive the consecutive-week streak (including this week) and the
 * week-over-week delta from this week's count plus prior weeks' counts.
 * `previousWeekCounts` is most-recent-first (index 0 = last week).
 */
export function computeStreakAndDelta(
  thisWeekCount: number,
  previousWeekCounts: number[]
): { streakWeeks: number; weekOverWeekDelta: number | null } {
  let streakWeeks = thisWeekCount >= 1 ? 1 : 0;
  if (streakWeeks > 0) {
    for (const count of previousWeekCounts) {
      if (count >= 1) {
        streakWeeks += 1;
      } else {
        break;
      }
    }
  }

  const weekOverWeekDelta =
    previousWeekCounts.length > 0 ? thisWeekCount - previousWeekCounts[0] : null;

  return { streakWeeks, weekOverWeekDelta };
}

/**
 * Rank conversations into highlight candidates. The TOP candidate is the
 * "聊了很多" (chatted a lot) conversation. Trash threads are excluded.
 * weightScore = messageCount*1 + turnCount*2 + (isStarred ? 15 : 0).
 */
export function rankHighlightCandidates(
  conversations: Conversation[],
  opts: { topics?: Topic[] } = {}
): WeeklyHighlightCandidate[] {
  const topicLookup = flattenTopics(opts.topics ?? []);

  return conversations
    .filter((conversation) => !conversation.is_trash)
    .map((conversation) => {
      const messageCount = conversation.message_count ?? 0;
      const turnCount = conversation.turn_count ?? 0;
      const isStarred = Boolean(conversation.is_starred);
      const weightScore = messageCount * 1 + turnCount * 2 + (isStarred ? 15 : 0);
      const topic =
        conversation.topic_id !== null && conversation.topic_id !== undefined
          ? topicLookup.get(conversation.topic_id) ?? null
          : null;

      return {
        conversationId: conversation.id,
        title: conversation.title || "(untitled)",
        platform: conversation.platform,
        topic,
        messageCount,
        turnCount,
        isStarred,
        weightScore,
        originAt: getConversationOriginAt(conversation),
        snippet: conversation.snippet || "",
      };
    })
    .sort(
      (a, b) => b.weightScore - a.weightScore || b.originAt - a.originAt
    );
}
