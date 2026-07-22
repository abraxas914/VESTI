import { getConversationOriginAt } from "../conversations/timestamps";
import type {
  Conversation,
  Message,
  Topic,
  WeeklyContributionDay,
  WeeklyEmotionKeyword,
  WeeklyGrowthReportV2,
  WeeklyGrowthSeriesPoint,
  WeeklyGrowthTag,
  WeeklyMostInsight,
  WeeklyOpenQuestion,
} from "../types";
import type { SupportedLocale } from "../i18n/locales";
import {
  computeFocusDepth,
  computeRhythmDistribution,
  computeTopicBreadth,
} from "./weeklyStats";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function conversationsInRange(
  conversations: Conversation[],
  rangeStart: number,
  rangeEnd: number
): Conversation[] {
  return conversations.filter((conversation) => {
    if (conversation.is_trash) return false;
    const originAt = getConversationOriginAt(conversation);
    return originAt >= rangeStart && originAt <= rangeEnd;
  });
}

function messagesForConversations(
  conversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>
): Map<number, readonly Message[]> {
  const ids = new Set(conversations.map((conversation) => conversation.id));
  const output = new Map<number, readonly Message[]>();
  for (const [conversationId, messages] of messagesByConversation.entries()) {
    if (ids.has(conversationId)) {
      output.set(conversationId, messages);
    }
  }
  return output;
}

export function buildContributionGrid(
  conversations: Conversation[],
  rangeStart: number,
  rangeEnd: number
): WeeklyContributionDay[] {
  const byDate = new Map<
    string,
    { count: number; depthTotal: number; conversationIds: number[] }
  >();

  for (const conversation of conversations) {
    if (conversation.is_trash) continue;
    const originAt = getConversationOriginAt(conversation);
    if (originAt < rangeStart || originAt > rangeEnd) continue;
    const key = localDateKey(originAt);
    const current = byDate.get(key) ?? {
      count: 0,
      depthTotal: 0,
      conversationIds: [],
    };
    current.count += 1;
    current.depthTotal += Math.min(100, Math.max(0, conversation.turn_count) * 8);
    current.conversationIds.push(conversation.id);
    byDate.set(key, current);
  }

  const days: WeeklyContributionDay[] = [];
  const cursor = new Date(rangeStart);
  cursor.setHours(12, 0, 0, 0);
  const last = new Date(rangeEnd);
  last.setHours(12, 0, 0, 0);

  while (cursor.getTime() <= last.getTime()) {
    const key = localDateKey(cursor.getTime());
    const value = byDate.get(key);
    days.push({
      date: key,
      count: value?.count ?? 0,
      intensity: 0,
      depthScore:
        value && value.count > 0
          ? Math.round(value.depthTotal / value.count)
          : 0,
      conversationIds: value?.conversationIds ?? [],
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const maxWeight = Math.max(
    0,
    ...days.map(
      (day) => (day.count ?? 0) * 10 + Math.round((day.depthScore ?? 0) / 10)
    )
  );
  return days.map((day) => {
    const weight =
      (day.count ?? 0) * 10 + Math.round((day.depthScore ?? 0) / 10);
    return {
      ...day,
      intensity:
        weight === 0 || maxWeight === 0
          ? 0
          : Math.max(1, Math.min(4, Math.ceil((weight / maxWeight) * 4))),
    };
  });
}

export function detectBlankWeek(
  conversations: Conversation[],
  previousWeekCounts: number[],
  options: { captureReliable?: boolean } = {}
): NonNullable<WeeklyGrowthReportV2["blankWeek"]> {
  const conversationCount = conversations.filter(
    (conversation) => !conversation.is_trash
  ).length;
  const baselineMedian = median(previousWeekCounts.slice(0, 8));

  if (options.captureReliable === false) {
    return {
      isBlank: true,
      reason: "capture_uncertain",
      gentleMessage:
        "There is not enough reliable capture data yet. Check capture status and try again.",
      conversationCount,
      baselineMedian,
    };
  }
  if (conversationCount === 0) {
    return {
      isBlank: true,
      reason: "no_data",
      gentleMessage:
        "A quiet week still counts. Start with one conversation you would like to remember.",
      conversationCount,
      baselineMedian,
    };
  }

  const lowActivityThreshold =
    previousWeekCounts.length >= 3 && baselineMedian !== null
      ? Math.max(2, Math.ceil(baselineMedian * 0.3))
      : 2;
  const isBlank = conversationCount < lowActivityThreshold;
  return {
    isBlank,
    reason: isBlank ? "low_activity" : "none",
    gentleMessage: isBlank
      ? "This week has only a little data, so here is a light recap without over-interpreting it."
      : "",
    conversationCount,
    baselineMedian,
  };
}

const EMOTION_SIGNALS: Array<{
  label: Record<SupportedLocale, string>;
  pattern: RegExp;
}> = [
  {
    label: {
      en: "Curious",
      zh: "好奇",
      ja: "好奇心",
      ko: "호기심",
    },
    pattern:
      /\b(?:curious|wonder|explore|why|how)\b|好奇|为什么|为何|探索|知りたい|なぜ|探求|궁금|왜|탐구/i,
  },
  {
    label: {
      en: "Focused",
      zh: "专注",
      ja: "集中",
      ko: "집중",
    },
    pattern:
      /\b(?:focus|deep work|concentrat|priority)\b|专注|聚焦|深入|优先|集中|掘り下げ|집중|몰입|우선/i,
  },
  {
    label: {
      en: "Determined",
      zh: "坚定",
      ja: "意欲",
      ko: "의지",
    },
    pattern:
      /\b(?:decide|commit|finish|ship|resolve)\b|决定|完成|推进|落地|やり切る|決める|進める|완료|결정|추진/i,
  },
  {
    label: {
      en: "Concerned",
      zh: "审慎",
      ja: "慎重",
      ko: "신중",
    },
    pattern:
      /\b(?:concern|risk|worry|uncertain|careful)\b|担心|风险|不确定|谨慎|懸念|リスク|慎重|걱정|위험|신중/i,
  },
  {
    label: {
      en: "Energized",
      zh: "振奋",
      ja: "前向き",
      ko: "활기",
    },
    pattern:
      /\b(?:excited|great|love|energized|promising)\b|兴奋|太棒|喜欢|有希望|楽しみ|素晴らしい|前向き|기대|좋아|신나/i,
  },
];

export function buildEmotionMap(
  conversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>,
  locale: SupportedLocale
): WeeklyEmotionKeyword[] {
  const activeIds = new Set(
    conversations
      .filter((conversation) => !conversation.is_trash)
      .map((conversation) => conversation.id)
  );
  const matches = EMOTION_SIGNALS.map((signal) => ({
    label: signal.label[locale],
    count: 0,
    conversationIds: new Set<number>(),
  }));

  for (const [conversationId, messages] of messagesByConversation.entries()) {
    if (!activeIds.has(conversationId)) continue;
    for (const message of messages) {
      const text = message.content_text.trim();
      if (!text) continue;
      EMOTION_SIGNALS.forEach((signal, index) => {
        if (!signal.pattern.test(text)) return;
        matches[index].count += 1;
        matches[index].conversationIds.add(conversationId);
      });
    }
  }

  const matched = matches
    .filter((item) => item.count > 0)
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label)
    );
  if (matched.length === 0) {
    if (activeIds.size === 0) return [];
    const neutralLabel: Record<SupportedLocale, string> = {
      en: "Steady",
      zh: "平稳",
      ja: "穏やか",
      ko: "차분",
    };
    return [
      {
        label: neutralLabel[locale],
        score: 1,
        conversationIds: [...activeIds],
      },
    ];
  }

  const maxCount = matched[0].count;
  return matched.slice(0, 5).map((item) => ({
    label: item.label,
    score: Number((item.count / maxCount).toFixed(3)),
    conversationIds: [...item.conversationIds],
  }));
}

function questionReason(locale: SupportedLocale): string {
  if (locale === "zh") return "这个问题在本周被提出，但还没有出现明确闭环。";
  if (locale === "ja") return "今週提示されましたが、まだ明確な結論には至っていません。";
  if (locale === "ko") return "이번 주에 제기되었지만 아직 명확히 마무리되지 않았습니다.";
  return "This was raised during the week without a clearly captured resolution.";
}

function extractQuestion(
  text: string
): { question: string; explicitlyOpen: boolean } | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const openPattern =
    /\b(?:unclear|not sure|need to understand|open question|unresolved)\b|不清楚|没搞懂|还需确认|未解决|分からない|未確認|모르겠|확인 필요/i;
  const sentences = normalized
    .split(/(?<=[?？。.!！])\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const explicit = sentences.find(
    (sentence) =>
      /[?？]$/.test(sentence) || openPattern.test(sentence)
  );
  if (!explicit) return null;
  return {
    question: explicit.slice(0, 220),
    explicitlyOpen: openPattern.test(explicit),
  };
}

export function detectOpenQuestions(
  conversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>,
  locale: SupportedLocale,
  limit = 3
): WeeklyOpenQuestion[] {
  const activeIds = new Set(
    conversations
      .filter((conversation) => !conversation.is_trash)
      .map((conversation) => conversation.id)
  );
  const output: WeeklyOpenQuestion[] = [];
  const seen = new Set<string>();

  for (const [conversationId, messages] of messagesByConversation.entries()) {
    if (!activeIds.has(conversationId)) continue;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "user") continue;
      const extracted = extractQuestion(message.content_text);
      if (!extracted) continue;
      const hasSubstantiveAnswer = messages
        .slice(index + 1)
        .some(
          (candidate) =>
            candidate.role === "ai" &&
            candidate.content_text.trim().length >= 80
        );
      if (hasSubstantiveAnswer && !extracted.explicitlyOpen) continue;
      const key = extracted.question.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        question: extracted.question,
        whyItMatters: questionReason(locale),
        conversationIds: [conversationId],
        messageIds: [message.id],
      });
      if (output.length >= limit) return output;
    }
  }
  return output;
}

export function buildGrowthSeries(
  historyConversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>,
  topics: Topic[],
  rangeStart: number,
  rangeEnd: number,
  weeks = 5
): WeeklyGrowthSeriesPoint[] {
  const span = Math.max(WEEK_MS, rangeEnd - rangeStart + 1);
  const points: WeeklyGrowthSeriesPoint[] = [];

  for (let index = weeks - 1; index >= 0; index -= 1) {
    const pointStart = rangeStart - index * span;
    const pointEnd = pointStart + span - 1;
    const conversations = conversationsInRange(
      historyConversations,
      pointStart,
      pointEnd
    );
    const messages = messagesForConversations(
      conversations,
      messagesByConversation
    );
    const focus = computeFocusDepth(conversations, messages);
    const rhythm = computeRhythmDistribution(conversations, messages);
    const breadth = computeTopicBreadth(conversations, topics);

    points.push({
      rangeStart: pointStart,
      rangeEnd: pointEnd,
      label: localDateKey(pointStart),
      conversationCount: conversations.length,
      activeDays: rhythm.activeDays ?? 0,
      focusDepthScore: focus.score ?? 0,
      rhythmScore: rhythm.score ?? 0,
      topicBreadthScore: breadth.score ?? 0,
    });
  }
  return points;
}

function collectTags(
  conversations: Conversation[],
  topics: Topic[]
): WeeklyGrowthTag[] {
  const topicNames = new Map<number, string>();
  const visit = (nodes: Topic[]) => {
    for (const topic of nodes) {
      topicNames.set(topic.id, topic.name);
      visit(topic.children ?? []);
    }
  };
  visit(topics);

  const counts = new Map<string, { count: number; ids: Set<number> }>();
  for (const conversation of conversations) {
    if (conversation.is_trash) continue;
    const names = new Set(
      (conversation.tags ?? [])
        .map((tag) => tag.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    );
    if (conversation.topic_id !== null) {
      const topicName = topicNames.get(conversation.topic_id);
      if (topicName) names.add(topicName);
    }
    for (const name of names) {
      const current = counts.get(name) ?? { count: 0, ids: new Set<number>() };
      current.count += 1;
      current.ids.add(conversation.id);
      counts.set(name, current);
    }
  }

  const maxCount = Math.max(1, ...[...counts.values()].map((item) => item.count));
  return [...counts.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      weight: Number((Math.log1p(value.count) / Math.log1p(maxCount)).toFixed(3)),
      conversationIds: [...value.ids],
    }))
    .sort(
      (left, right) =>
        (right.count ?? 0) - (left.count ?? 0) ||
        (left.name ?? "").localeCompare(right.name ?? "")
    );
}

export function buildWeeklyTags(
  currentConversations: Conversation[],
  previousConversations: Conversation[],
  topics: Topic[]
): NonNullable<WeeklyGrowthReportV2["tags"]> {
  const current = collectTags(currentConversations, topics);
  const previous = collectTags(previousConversations, topics);
  const previousCounts = new Map(
    previous.map((tag) => [tag.name ?? "", tag.count ?? 0])
  );

  return {
    current,
    new: current.filter((tag) => !previousCounts.has(tag.name ?? "")),
    hot: current
      .filter(
        (tag) =>
          (tag.count ?? 0) > (previousCounts.get(tag.name ?? "") ?? 0)
      )
      .slice(0, 8),
  };
}

function toMostInsight(
  conversation: Conversation | undefined,
  detail: string
): WeeklyMostInsight | null {
  if (!conversation) return null;
  return {
    label: conversation.title || "Untitled",
    detail,
    conversationId: conversation.id,
    messageIds: [],
  };
}

export function buildWeeklyMosts(
  conversations: Conversation[],
  tags: NonNullable<WeeklyGrowthReportV2["tags"]>
): NonNullable<WeeklyGrowthReportV2["mosts"]> {
  const active = conversations.filter((conversation) => !conversation.is_trash);
  const latest = [...active].sort(
    (left, right) =>
      getConversationOriginAt(right) - getConversationOriginAt(left)
  )[0];
  const longest = [...active].sort(
    (left, right) =>
      (right.turn_count ?? 0) - (left.turn_count ?? 0) ||
      (right.message_count ?? 0) - (left.message_count ?? 0)
  )[0];
  const topTag = tags.current?.[0];

  return {
    latestConversation: toMostInsight(
      latest,
      latest ? new Date(getConversationOriginAt(latest)).toISOString() : ""
    ),
    topTopic: topTag
      ? {
          label: topTag.name,
          detail: `${topTag.count ?? 0} conversations`,
          conversationId: topTag.conversationIds?.[0] ?? null,
          messageIds: [],
        }
      : null,
    longestConversation: toMostInsight(
      longest,
      longest ? `${longest.turn_count ?? 0} turns` : ""
    ),
    unexpectedConversation: null,
    mentionedEntity: null,
  };
}
