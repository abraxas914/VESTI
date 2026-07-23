import type {
  Conversation,
  Message,
  Topic,
  WeeklyFocusDepthMetric,
  WeeklyRhythmMetric,
  WeeklyTopicBreadthMetric,
} from "../types";
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
const DEEP_CONVERSATION_TURN_THRESHOLD = 8;

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

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
 * Compute a deterministic depth score from turn counts and persisted messages.
 * The function is intentionally pure: callers provide every input and no
 * storage, network, or model access occurs here.
 */
export function computeFocusDepth(
  conversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>
): WeeklyFocusDepthMetric {
  const active = conversations.filter((conversation) => !conversation.is_trash);
  if (active.length === 0) {
    return {
      score: 0,
      averageTurns: 0,
      longestTurns: 0,
      averageMessageLength: 0,
      deepConversationCount: 0,
      deepConversationRate: 0,
      confidence: "estimated",
    };
  }

  let totalTurns = 0;
  let longestTurns = 0;
  let deepConversationCount = 0;
  let messageLengthTotal = 0;
  let persistedMessageCount = 0;
  let conversationsWithMessages = 0;

  for (const conversation of active) {
    const turns = Math.max(0, conversation.turn_count ?? 0);
    totalTurns += turns;
    longestTurns = Math.max(longestTurns, turns);

    const messages = messagesByConversation.get(conversation.id) ?? [];
    if (messages.length > 0) {
      conversationsWithMessages += 1;
    }
    for (const message of messages) {
      messageLengthTotal += message.content_text.trim().length;
      persistedMessageCount += 1;
    }

    if (
      turns >= DEEP_CONVERSATION_TURN_THRESHOLD ||
      messages.length >= DEEP_CONVERSATION_TURN_THRESHOLD * 2
    ) {
      deepConversationCount += 1;
    }
  }

  const averageTurns = totalTurns / active.length;
  const averageMessageLength =
    persistedMessageCount > 0 ? messageLengthTotal / persistedMessageCount : 0;
  const deepConversationRate = deepConversationCount / active.length;
  const score = clampScore(
    Math.min(1, averageTurns / 12) * 45 +
      deepConversationRate * 35 +
      Math.min(1, averageMessageLength / 800) * 20
  );

  return {
    score,
    averageTurns: Number(averageTurns.toFixed(1)),
    longestTurns,
    averageMessageLength: Math.round(averageMessageLength),
    deepConversationCount,
    deepConversationRate: Number(deepConversationRate.toFixed(3)),
    confidence:
      active.length >= 3 &&
      conversationsWithMessages / active.length >= 0.6
        ? "reliable"
        : "estimated",
  };
}

/**
 * Build a 24-hour activity distribution. Persisted message timestamps are
 * preferred; conversation origin timestamps provide a deterministic fallback.
 */
export function computeRhythmDistribution(
  conversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>
): WeeklyRhythmMetric {
  const active = conversations.filter((conversation) => !conversation.is_trash);
  const timestamps: number[] = [];
  let usedPersistedMessages = 0;

  for (const conversation of active) {
    const messages = messagesByConversation.get(conversation.id) ?? [];
    const validMessageTimes = messages
      .map((message) => message.created_at)
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
    if (validMessageTimes.length > 0) {
      timestamps.push(...validMessageTimes);
      usedPersistedMessages += validMessageTimes.length;
    } else {
      const originAt = getConversationOriginAt(conversation);
      if (Number.isFinite(originAt) && originAt > 0) {
        timestamps.push(originAt);
      }
    }
  }

  const activeHours = Array.from({ length: 24 }, () => 0);
  const activeDayKeys = new Set<string>();
  let lateNightCount = 0;

  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    const hour = date.getHours();
    activeHours[hour] += 1;
    activeDayKeys.add(localDateKey(timestamp));
    if (hour < 6) {
      lateNightCount += 1;
    }
  }

  const total = timestamps.length;
  const peakCount = total > 0 ? Math.max(...activeHours) : 0;
  const peakHour = peakCount > 0 ? activeHours.indexOf(peakCount) : null;
  const lateNightRatio = total > 0 ? lateNightCount / total : 0;
  const activityConcentration = total > 0 ? peakCount / total : 0;
  const score =
    total > 0
      ? clampScore(
          Math.min(1, activeDayKeys.size / 5) * 50 +
            (1 - Math.min(1, lateNightRatio)) * 25 +
            (1 - Math.min(1, activityConcentration)) * 25
        )
      : 0;

  return {
    score,
    activeHours,
    activeDays: activeDayKeys.size,
    peakHour,
    lateNightRatio: Number(lateNightRatio.toFixed(3)),
    activityConcentration: Number(activityConcentration.toFixed(3)),
    confidence:
      usedPersistedMessages >= Math.max(6, active.length)
        ? "reliable"
        : "estimated",
  };
}

/**
 * Compute breadth from explicit conversation tags and topic assignments.
 * Normalized Shannon entropy rewards a balanced mix rather than raw tag count.
 */
export function computeTopicBreadth(
  conversations: Conversation[],
  topics: Topic[] = []
): WeeklyTopicBreadthMetric {
  const active = conversations.filter((conversation) => !conversation.is_trash);
  const topicLookup = flattenTopics(topics);
  const counts = new Map<string, number>();

  for (const conversation of active) {
    const names = new Set<string>();
    for (const tag of conversation.tags ?? []) {
      const normalized = tag.replace(/\s+/g, " ").trim();
      if (normalized) names.add(normalized);
    }
    if (conversation.topic_id !== null && conversation.topic_id !== undefined) {
      const topic = topicLookup.get(conversation.topic_id);
      if (topic) names.add(topic);
    }
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const entries = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  );
  const totalMentions = entries.reduce((sum, [, count]) => sum + count, 0);
  const rawEntropy =
    totalMentions > 0
      ? entries.reduce((sum, [, count]) => {
          const share = count / totalMentions;
          return sum - share * Math.log(share);
        }, 0)
      : 0;
  const maxEntropy = entries.length > 1 ? Math.log(entries.length) : 0;
  const entropy = maxEntropy > 0 ? rawEntropy / maxEntropy : entries.length === 1 ? 1 : 0;
  const score = clampScore(
    Math.min(1, entries.length / 8) * 60 + entropy * 40
  );

  return {
    score,
    uniqueTopicCount: entries.length,
    entropy: Number(entropy.toFixed(3)),
    topTopics: entries.slice(0, 8).map(([name, count]) => ({
      name,
      count,
      share:
        totalMentions > 0
          ? Number((count / totalMentions).toFixed(3))
          : 0,
    })),
    confidence: active.length >= 3 ? "reliable" : "estimated",
  };
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
