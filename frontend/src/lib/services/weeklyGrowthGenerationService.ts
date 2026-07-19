import { getConversationOriginAt } from "../conversations/timestamps";
import {
  getWeeklyReport,
  listConversationsByRange,
  listMessagesByRange,
  listTopicDefinitions,
  saveWeeklyReport,
} from "../db/repository";
import { getLocaleDateTag, type SupportedLocale } from "../i18n/locales";
import { getPrompt } from "../prompts";
import type { WeeklyRecapPromptPayload } from "../prompts/types";
import type {
  Conversation,
  LlmConfig,
  Message,
  WeeklyGrowthHighlight,
  WeeklyGrowthReportV2,
  WeeklyGrowthSeriesPoint,
  WeeklyMetricComparison,
  WeeklyMetricSnapshot,
  WeeklyMostInsight,
  WeeklyReportRecord,
} from "../types";
import { getEffectiveModelId } from "./llmConfig";
import { callInference, sanitizeSummaryText, truncateForContext } from "./llmService";
import { getLanguageSettings } from "./languageSettingsService";
import { parseJsonObjectFromText } from "./insightSchemas";
import {
  buildContributionGrid,
  buildGrowthSeries,
  buildWeeklyMosts,
  buildWeeklyTags,
  detectBlankWeek,
} from "./weeklyGrowthAnalytics";
import {
  computeFocusDepth,
  computeRhythmDistribution,
  computeTopicBreadth,
  computeWeeklyStats,
  rankHighlightCandidates,
} from "./weeklyStats";
import { logger } from "../utils/logger";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_WEEKS = 5;
const HIGHLIGHT_CANDIDATE_LIMIT = 8;
const HIGHLIGHT_OUTPUT_LIMIT = 5;
const HIGHLIGHT_EXCERPT_LIMIT = 280;
const WEEKLY_GROWTH_PROMPT_LIMIT = 12000;

export interface WeeklyGrowthGenerationControl {
  signal?: AbortSignal;
}

interface InternalHighlightCandidate {
  conversationId: number;
  messageId: number;
  title: string;
  topic: string | null;
  role: "user" | "ai";
  excerpt: string;
  fullText: string;
  turnCount: number;
  weightScore: number;
  originAt: number;
}

interface WeeklyGrowthAiResponse {
  greeting?: unknown;
  narrative?: unknown;
  identity?: unknown;
  highlights?: unknown;
  mosts?: unknown;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new DOMException("Weekly growth generation aborted", "AbortError");
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
  );
}

function toBoundedText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function localizedBlankMessage(
  locale: SupportedLocale,
  reason: NonNullable<WeeklyGrowthReportV2["blankWeek"]>["reason"]
): string {
  if (reason === "capture_uncertain") {
    if (locale === "zh") return "这一周的采集数据还不够完整，先检查一下采集状态，再回来看看吧。";
    if (locale === "ja") return "今週の記録はまだ十分ではありません。まず取得状態を確認してみましょう。";
    if (locale === "ko") return "이번 주 수집 데이터가 아직 충분하지 않아요. 먼저 수집 상태를 확인해 주세요.";
    return "This week's capture is not complete yet. Check capture status and come back when it is ready.";
  }
  if (reason === "no_data") {
    if (locale === "zh") return "安静的一周也值得被记录。先从一段你想记住的对话开始吧。";
    if (locale === "ja") return "静かな一週間も大切な記録です。残したい会話を一つ選んでみましょう。";
    if (locale === "ko") return "조용한 한 주도 기록할 가치가 있어요. 기억하고 싶은 대화 하나부터 시작해 보세요.";
    return "A quiet week still counts. Start with one conversation you would like to remember.";
  }
  if (locale === "zh") return "这周的记录不多，我们只做一份轻量回顾，不急着下结论。";
  if (locale === "ja") return "今週の記録は少なめなので、決めつけずに軽く振り返ります。";
  if (locale === "ko") return "이번 주 기록이 많지 않아, 단정하지 않고 가볍게 돌아볼게요.";
  return "There is only a little data this week, so this is a light recap without over-interpreting it.";
}

function buildHistoryStart(rangeStart: number, rangeEnd: number): number {
  const span = Math.max(WEEK_MS, rangeEnd - rangeStart + 1);
  return rangeStart - (HISTORY_WEEKS - 1) * span;
}

function buildPreviousWeekCounts(
  historyConversations: Conversation[],
  rangeStart: number,
  rangeEnd: number
): number[] {
  const span = Math.max(WEEK_MS, rangeEnd - rangeStart + 1);
  const counts: number[] = [];
  for (let index = 1; index < HISTORY_WEEKS; index += 1) {
    const start = rangeStart - index * span;
    const end = start + span - 1;
    counts.push(
      historyConversations.filter((conversation) => {
        if (conversation.is_trash) return false;
        const originAt = getConversationOriginAt(conversation);
        return originAt >= start && originAt <= end;
      }).length
    );
  }
  return counts;
}

function snapshotFromPoint(
  point: WeeklyGrowthSeriesPoint | undefined
): WeeklyMetricSnapshot {
  return {
    conversationCount: point?.conversationCount ?? 0,
    activeDays: point?.activeDays ?? 0,
    focusDepthScore: point?.focusDepthScore ?? 0,
    rhythmScore: point?.rhythmScore ?? 0,
    topicBreadthScore: point?.topicBreadthScore ?? 0,
  };
}

function subtractSnapshots(
  current: WeeklyMetricSnapshot,
  baseline: WeeklyMetricSnapshot
): WeeklyMetricSnapshot {
  return {
    conversationCount:
      (current.conversationCount ?? 0) - (baseline.conversationCount ?? 0),
    activeDays: (current.activeDays ?? 0) - (baseline.activeDays ?? 0),
    focusDepthScore:
      (current.focusDepthScore ?? 0) - (baseline.focusDepthScore ?? 0),
    rhythmScore: (current.rhythmScore ?? 0) - (baseline.rhythmScore ?? 0),
    topicBreadthScore:
      (current.topicBreadthScore ?? 0) - (baseline.topicBreadthScore ?? 0),
  };
}

function averageSnapshots(
  points: WeeklyGrowthSeriesPoint[]
): WeeklyMetricSnapshot {
  if (points.length === 0) return snapshotFromPoint(undefined);
  const total = points.reduce(
    (sum, point) => ({
      conversationCount:
        (sum.conversationCount ?? 0) + (point.conversationCount ?? 0),
      activeDays: (sum.activeDays ?? 0) + (point.activeDays ?? 0),
      focusDepthScore:
        (sum.focusDepthScore ?? 0) + (point.focusDepthScore ?? 0),
      rhythmScore: (sum.rhythmScore ?? 0) + (point.rhythmScore ?? 0),
      topicBreadthScore:
        (sum.topicBreadthScore ?? 0) + (point.topicBreadthScore ?? 0),
    }),
    snapshotFromPoint(undefined)
  );
  const divide = (value: number | undefined) =>
    Number(((value ?? 0) / points.length).toFixed(1));
  return {
    conversationCount: divide(total.conversationCount),
    activeDays: divide(total.activeDays),
    focusDepthScore: divide(total.focusDepthScore),
    rhythmScore: divide(total.rhythmScore),
    topicBreadthScore: divide(total.topicBreadthScore),
  };
}

function buildComparison(
  label: string,
  current: WeeklyMetricSnapshot,
  baseline: WeeklyMetricSnapshot
): WeeklyMetricComparison {
  return {
    baselineLabel: label,
    current,
    baseline,
    deltas: subtractSnapshots(current, baseline),
  };
}

function selectCandidateMessage(messages: readonly Message[]): Message | null {
  const eligible = messages.filter(
    (message) => message.content_text.trim().length >= 24
  );
  if (eligible.length === 0) return null;
  return [...eligible].sort((left, right) => {
    const leftLength = Math.min(1200, left.content_text.trim().length);
    const rightLength = Math.min(1200, right.content_text.trim().length);
    const leftScore = leftLength + (left.role === "user" ? 120 : 0);
    const rightScore = rightLength + (right.role === "user" ? 120 : 0);
    return rightScore - leftScore || left.created_at - right.created_at;
  })[0];
}

function buildHighlightCandidates(
  conversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>,
  topics: Awaited<ReturnType<typeof listTopicDefinitions>>
): InternalHighlightCandidate[] {
  const ranked = rankHighlightCandidates(conversations, { topics });
  const candidates: InternalHighlightCandidate[] = [];

  for (const conversation of ranked) {
    const message = selectCandidateMessage(
      messagesByConversation.get(conversation.conversationId) ?? []
    );
    if (!message) continue;
    const fullText = message.content_text;
    const excerpt = fullText.trim().slice(0, HIGHLIGHT_EXCERPT_LIMIT);
    if (!excerpt || !fullText.includes(excerpt)) continue;
    candidates.push({
      conversationId: conversation.conversationId,
      messageId: message.id,
      title: conversation.title,
      topic: conversation.topic,
      role: message.role,
      excerpt,
      fullText,
      turnCount: conversation.turnCount,
      weightScore: conversation.weightScore,
      originAt: conversation.originAt,
    });
    if (candidates.length >= HIGHLIGHT_CANDIDATE_LIMIT) break;
  }
  return candidates;
}

function fallbackHighlight(
  candidate: InternalHighlightCandidate
): WeeklyGrowthHighlight {
  return {
    id: `${candidate.conversationId}:${candidate.messageId}`,
    conversationId: candidate.conversationId,
    messageId: candidate.messageId,
    title: candidate.title,
    excerpt: candidate.excerpt,
    insight: candidate.topic
      ? `A focused contribution around ${candidate.topic}.`
      : "A substantial moment worth revisiting.",
    score: candidate.weightScore,
    originAt: candidate.originAt,
  };
}

function validateMostInsight(
  value: unknown,
  candidatesByMessageId: ReadonlyMap<number, InternalHighlightCandidate>
): WeeklyMostInsight | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const conversationId = Number(row.conversationId);
  const messageIds = Array.isArray(row.messageIds)
    ? row.messageIds
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item))
    : [];
  const evidence = messageIds
    .map((messageId) => candidatesByMessageId.get(messageId))
    .filter(
      (candidate): candidate is InternalHighlightCandidate =>
        Boolean(candidate && candidate.conversationId === conversationId)
    );
  if (evidence.length === 0) return null;
  return {
    label: toBoundedText(row.label, 80),
    detail: toBoundedText(row.detail, 240),
    conversationId,
    messageIds: evidence.map((candidate) => candidate.messageId),
  };
}

function applyAiLayer(
  base: WeeklyGrowthReportV2,
  raw: WeeklyGrowthAiResponse,
  candidates: InternalHighlightCandidate[]
): WeeklyGrowthReportV2 {
  const candidatesByMessageId = new Map(
    candidates.map((candidate) => [candidate.messageId, candidate])
  );
  const acceptedHighlights: WeeklyGrowthHighlight[] = [];
  const usedMessageIds = new Set<number>();
  const rawHighlights = Array.isArray(raw.highlights) ? raw.highlights : [];

  for (const value of rawHighlights) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const messageId = Number(row.messageId);
    const conversationId = Number(row.conversationId);
    const excerpt = typeof row.excerpt === "string" ? row.excerpt.trim() : "";
    const candidate = candidatesByMessageId.get(messageId);
    if (
      !candidate ||
      usedMessageIds.has(messageId) ||
      candidate.conversationId !== conversationId ||
      excerpt !== candidate.excerpt ||
      !candidate.fullText.includes(excerpt)
    ) {
      continue;
    }
    usedMessageIds.add(messageId);
    acceptedHighlights.push({
      id: `${conversationId}:${messageId}`,
      conversationId,
      messageId,
      title: toBoundedText(row.title, 120) || candidate.title,
      excerpt: candidate.excerpt,
      insight:
        toBoundedText(row.insight, 320) ||
        fallbackHighlight(candidate).insight,
      score: candidate.weightScore,
      originAt: candidate.originAt,
    });
    if (acceptedHighlights.length >= HIGHLIGHT_OUTPUT_LIMIT) break;
  }

  const desiredMinimum = Math.min(3, candidates.length);
  for (const candidate of candidates) {
    if (acceptedHighlights.length >= desiredMinimum) break;
    if (usedMessageIds.has(candidate.messageId)) continue;
    usedMessageIds.add(candidate.messageId);
    acceptedHighlights.push(fallbackHighlight(candidate));
  }

  const identityRow =
    raw.identity && typeof raw.identity === "object"
      ? (raw.identity as Record<string, unknown>)
      : {};
  const rawEmotions = Array.isArray(identityRow.emotionKeywords)
    ? identityRow.emotionKeywords
    : [];
  const allowedConversationIds = new Set(
    candidates.map((candidate) => candidate.conversationId)
  );
  const emotionKeywords = rawEmotions
    .filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object")
    )
    .map((value) => ({
      label: toBoundedText(value.label, 32),
      score: Math.max(0, Math.min(1, Number(value.score) || 0)),
      conversationIds: Array.isArray(value.conversationIds)
        ? value.conversationIds
            .map((item) => Number(item))
            .filter((id) => allowedConversationIds.has(id))
        : [],
    }))
    .filter((item) => item.label)
    .slice(0, 5);

  const mostsRow =
    raw.mosts && typeof raw.mosts === "object"
      ? (raw.mosts as Record<string, unknown>)
      : {};

  return {
    ...base,
    greeting: toBoundedText(raw.greeting, 160) || base.greeting,
    narrative: Array.isArray(raw.narrative)
      ? raw.narrative
          .map((item) => toBoundedText(item, 420))
          .filter(Boolean)
          .slice(0, 3)
      : base.narrative,
    identity: {
      label:
        toBoundedText(identityRow.label, 32) ||
        base.identity?.label ||
        "Steady Explorer",
      rationale:
        toBoundedText(identityRow.rationale, 240) ||
        base.identity?.rationale ||
        "",
      moodEmoji:
        toBoundedText(identityRow.moodEmoji, 8) ||
        base.identity?.moodEmoji ||
        "✨",
      emotionKeywords,
    },
    highlights: acceptedHighlights.slice(0, HIGHLIGHT_OUTPUT_LIMIT),
    mosts: {
      ...base.mosts,
      unexpectedConversation: validateMostInsight(
        mostsRow.unexpectedConversation,
        candidatesByMessageId
      ),
      mentionedEntity: validateMostInsight(
        mostsRow.mentionedEntity,
        candidatesByMessageId
      ),
    },
  };
}

function buildLocalIdentity(
  locale: SupportedLocale,
  conversationCount: number
): NonNullable<WeeklyGrowthReportV2["identity"]> {
  if (locale === "zh") {
    return {
      label: conversationCount > 0 ? "稳步探索者" : "轻盈蓄力者",
      rationale: conversationCount > 0 ? "你在这一周持续留下了思考足迹。" : "安静也可以是下一次探索前的蓄力。",
      moodEmoji: conversationCount > 0 ? "✨" : "🌱",
      emotionKeywords: [],
    };
  }
  if (locale === "ja") {
    return {
      label: conversationCount > 0 ? "着実な探究者" : "静かな準備家",
      rationale: conversationCount > 0 ? "今週も思考の足跡を着実に残しました。" : "静かな時間も次の探究への準備です。",
      moodEmoji: conversationCount > 0 ? "✨" : "🌱",
      emotionKeywords: [],
    };
  }
  if (locale === "ko") {
    return {
      label: conversationCount > 0 ? "꾸준한 탐험가" : "고요한 준비가",
      rationale: conversationCount > 0 ? "이번 주에도 생각의 흔적을 꾸준히 남겼어요." : "조용한 시간도 다음 탐색을 위한 준비예요.",
      moodEmoji: conversationCount > 0 ? "✨" : "🌱",
      emotionKeywords: [],
    };
  }
  return {
    label: conversationCount > 0 ? "Steady Explorer" : "Quiet Builder",
    rationale:
      conversationCount > 0
        ? "You kept leaving thoughtful traces this week."
        : "A quiet week can prepare the ground for what comes next.",
    moodEmoji: conversationCount > 0 ? "✨" : "🌱",
    emotionKeywords: [],
  };
}

function renderWeeklyGrowthText(
  report: WeeklyGrowthReportV2,
  locale: SupportedLocale
): string {
  const lines: string[] = [];
  const identity = report.identity;
  if (report.greeting) {
    lines.push(
      `${identity?.moodEmoji ?? "✨"} ${report.greeting}${
        identity?.label ? ` (${identity.label})` : ""
      }`
    );
  }
  for (const paragraph of report.narrative ?? []) {
    if (paragraph) lines.push(paragraph);
  }
  if (report.blankWeek?.isBlank && report.blankWeek.gentleMessage) {
    lines.push(report.blankWeek.gentleMessage);
  }
  for (const highlight of report.highlights ?? []) {
    if (!highlight.title) continue;
    lines.push(
      locale === "zh"
        ? `高光：${highlight.title}`
        : locale === "ja"
          ? `ハイライト：${highlight.title}`
          : locale === "ko"
            ? `하이라이트: ${highlight.title}`
            : `Highlight: ${highlight.title}`
    );
  }
  return sanitizeSummaryText(lines.join("\n"));
}

function buildSourceFingerprint(
  conversations: Conversation[],
  messagesByConversation: ReadonlyMap<number, readonly Message[]>,
  historyStart: number,
  rangeEnd: number
): string {
  return JSON.stringify({
    version: "weekly-growth-source.v2",
    historyStart,
    rangeEnd,
    conversations: [...conversations]
      .sort((left, right) => left.id - right.id)
      .map((conversation) => ({
        id: conversation.id,
        originAt: getConversationOriginAt(conversation),
        updatedAt: conversation.updated_at,
        title: conversation.title,
        tags: conversation.tags,
        topicId: conversation.topic_id,
        starred: conversation.is_starred,
        trash: conversation.is_trash,
        messageCount: conversation.message_count,
        turnCount: conversation.turn_count,
      })),
    messages: [...messagesByConversation.values()]
      .flat()
      .sort((left, right) => left.id - right.id)
      .map((message) => ({
        id: message.id,
        conversationId: message.conversation_id,
        createdAt: message.created_at,
        role: message.role,
        content: message.content_text,
      })),
  });
}

async function buildCacheKey(input: {
  sourceFingerprint: string;
  modelId: string;
  promptVersion: string;
  locale: SupportedLocale;
}): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      version: "weekly-growth-cache.v2",
      sourceHash: input.sourceFingerprint,
      model: input.modelId,
      promptVersion: input.promptVersion,
      locale: input.locale,
      schemaVersion: "weekly_growth_report.v2",
      periodType: "week",
    })
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `weekly-growth-cache.v2:${hex}`;
}

function isReusableReport(
  report: WeeklyReportRecord | null,
  cacheKey: string,
  modelId: string
): report is WeeklyReportRecord {
  return Boolean(
    report &&
      report.schemaVersion === "weekly_growth_report.v2" &&
      report.status === "ok" &&
      report.structured &&
      report.modelId === modelId &&
      report.sourceHash === cacheKey
  );
}

export async function generateWeeklyGrowthReportV2(
  settings: LlmConfig,
  rangeStart: number,
  rangeEnd: number,
  control: WeeklyGrowthGenerationControl = {}
): Promise<WeeklyReportRecord> {
  const prompt = getPrompt("weeklyRecap", { variant: "current" });
  const modelId = getEffectiveModelId(settings);
  const historyStart = buildHistoryStart(rangeStart, rangeEnd);

  throwIfAborted(control.signal);
  const [languageSettings, cachedReport, historyConversations, topics] =
    await Promise.all([
      getLanguageSettings(),
      getWeeklyReport(rangeStart, rangeEnd),
      listConversationsByRange(historyStart, rangeEnd),
      listTopicDefinitions(),
    ]);
  throwIfAborted(control.signal);

  const messagesByConversation = await listMessagesByRange(
    historyStart,
    rangeEnd,
    historyConversations.map((conversation) => conversation.id)
  );
  throwIfAborted(control.signal);

  const sourceFingerprint = buildSourceFingerprint(
    historyConversations,
    messagesByConversation,
    historyStart,
    rangeEnd
  );
  const cacheKey = await buildCacheKey({
    sourceFingerprint,
    modelId,
    promptVersion: prompt.version,
    locale: languageSettings.locale,
  });
  throwIfAborted(control.signal);

  if (isReusableReport(cachedReport, cacheKey, modelId)) {
    return cachedReport;
  }

  const currentConversations = historyConversations.filter((conversation) => {
    if (conversation.is_trash) return false;
    const originAt = getConversationOriginAt(conversation);
    return originAt >= rangeStart && originAt <= rangeEnd;
  });
  const previousConversations = historyConversations.filter((conversation) => {
    const originAt = getConversationOriginAt(conversation);
    return !conversation.is_trash && originAt < rangeStart;
  });
  const previousWeekCounts = buildPreviousWeekCounts(
    historyConversations,
    rangeStart,
    rangeEnd
  );
  const stats = computeWeeklyStats(currentConversations, {
    topics,
    previousWeekCounts,
    dateTag: getLocaleDateTag(languageSettings.locale),
  });
  const focusDepth = computeFocusDepth(
    currentConversations,
    messagesByConversation
  );
  const rhythmHealth = computeRhythmDistribution(
    currentConversations,
    messagesByConversation
  );
  const topicBreadth = computeTopicBreadth(currentConversations, topics);
  const growthSeries = buildGrowthSeries(
    historyConversations,
    messagesByConversation,
    topics,
    rangeStart,
    rangeEnd,
    HISTORY_WEEKS
  );
  const tags = buildWeeklyTags(
    currentConversations,
    previousConversations,
    topics
  );
  const mosts = buildWeeklyMosts(currentConversations, tags);
  const blankWeek = detectBlankWeek(
    currentConversations,
    previousWeekCounts
  );
  blankWeek.gentleMessage = localizedBlankMessage(
    languageSettings.locale,
    blankWeek.reason
  );
  const currentSnapshot = snapshotFromPoint(
    growthSeries[growthSeries.length - 1]
  );
  const previousSnapshot = snapshotFromPoint(
    growthSeries[growthSeries.length - 2]
  );
  const monthSnapshot = averageSnapshots(growthSeries.slice(0, -1));
  const candidates = buildHighlightCandidates(
    currentConversations,
    messagesByConversation,
    topics
  );

  let structured: WeeklyGrowthReportV2 = {
    schema: "weekly_growth_report.v2",
    period: {
      type: "week",
      start: rangeStart,
      end: rangeEnd,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    greeting: blankWeek.isBlank
      ? blankWeek.gentleMessage
      : languageSettings.locale === "zh"
        ? "这一周，你留下了新的思考轨迹"
        : "You left a new trail of thought this week",
    narrative: [],
    energy: {
      focusDepth,
      rhythmHealth,
      topicBreadth,
    },
    growth: {
      previousWeek: buildComparison(
        "previous_week",
        currentSnapshot,
        previousSnapshot
      ),
      previousMonth: buildComparison(
        "previous_four_week_average",
        currentSnapshot,
        monthSnapshot
      ),
      series: growthSeries,
    },
    identity: buildLocalIdentity(
      languageSettings.locale,
      currentConversations.length
    ),
    highlights: candidates.slice(0, 3).map(fallbackHighlight),
    contributionGrid: buildContributionGrid(
      currentConversations,
      rangeStart,
      rangeEnd
    ),
    tags,
    mosts,
    blankWeek,
  };

  let status: "ok" | "fallback" = "ok";

  // Blank and zero-data weeks are intentionally local-only. This branch is
  // before every callInference invocation, so /api/chat cannot be requested.
  if (!blankWeek.isBlank) {
    const payload: WeeklyRecapPromptPayload = {
      stats,
      energy: structured.energy,
      growthSeries,
      highlightCandidates: candidates.map((candidate) => ({
        conversationId: candidate.conversationId,
        messageId: candidate.messageId,
        title: candidate.title,
        topic: candidate.topic,
        role: candidate.role,
        excerpt: candidate.excerpt,
        turnCount: candidate.turnCount,
        weightScore: candidate.weightScore,
      })),
      tags: tags.current,
      mosts: {
        latestConversation: mosts.latestConversation,
        topTopic: mosts.topTopic,
        longestConversation: mosts.longestConversation,
      },
      rangeStart,
      rangeEnd,
      locale: languageSettings.locale,
    };

    try {
      const primaryPrompt = truncateForContext(
        prompt.userTemplate(payload),
        WEEKLY_GROWTH_PROMPT_LIMIT
      );
      const first = await callInference(settings, primaryPrompt, {
        responseFormat: "json_object",
        systemPrompt: prompt.system,
        signal: control.signal,
      });
      let parsed: WeeklyGrowthAiResponse | null = null;
      try {
        parsed = parseJsonObjectFromText(first.content) as WeeklyGrowthAiResponse;
      } catch {
        const repair = await callInference(
          settings,
          truncateForContext(
            `Return valid weekly_growth_ai.v2 JSON only. Repair this output without adding facts:\n${first.content}`,
            WEEKLY_GROWTH_PROMPT_LIMIT
          ),
          {
            responseFormat: "json_object",
            systemPrompt: prompt.system,
            signal: control.signal,
          }
        );
        parsed = parseJsonObjectFromText(
          repair.content
        ) as WeeklyGrowthAiResponse;
      }
      if (parsed) {
        structured = applyAiLayer(structured, parsed, candidates);
      }
    } catch (error) {
      if (isAbortError(error, control.signal)) throw error;
      status = "fallback";
      logger.warn("service", "Weekly growth V2 narrative generation failed", {
        rangeStart,
        rangeEnd,
        reason:
          error instanceof Error
            ? error.message
            : "WEEKLY_GROWTH_NARRATIVE_FAILED",
      });
    }
  }

  throwIfAborted(control.signal);
  return saveWeeklyReport(
    {
      rangeStart,
      rangeEnd,
      content: renderWeeklyGrowthText(structured, languageSettings.locale),
      structured,
      format: "structured_v1",
      status,
      schemaVersion: "weekly_growth_report.v2",
      periodType: "week",
      modelId,
      createdAt: Date.now(),
      sourceHash: cacheKey,
    },
    { signal: control.signal }
  );
}
