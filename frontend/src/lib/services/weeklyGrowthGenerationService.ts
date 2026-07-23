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
  WeeklyOpenQuestion,
  WeeklyPushCenter,
  WeeklyResourceRecommendation,
  WeeklyReportRecord,
} from "../types";
import { getEffectiveModelId } from "./llmConfig";
import { callInference, sanitizeSummaryText, truncateForContext } from "./llmService";
import { getLanguageSettings } from "./languageSettingsService";
import { parseJsonObjectFromText } from "./insightSchemas";
import {
  buildContributionGrid,
  buildEmotionMap,
  buildGrowthSeries,
  buildWeeklyMosts,
  buildWeeklyTags,
  detectBlankWeek,
  detectOpenQuestions,
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
  pushCenter?: unknown;
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

function validateEvidence(
  value: Record<string, unknown>,
  candidatesByMessageId: ReadonlyMap<number, InternalHighlightCandidate>
): { conversationIds: number[]; messageIds: number[] } | null {
  const requestedMessageIds = Array.isArray(value.messageIds)
    ? value.messageIds
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item))
    : [];
  const evidence = requestedMessageIds
    .map((messageId) => candidatesByMessageId.get(messageId))
    .filter(
      (candidate): candidate is InternalHighlightCandidate =>
        candidate !== undefined
    );
  if (evidence.length === 0) return null;
  return {
    conversationIds: [
      ...new Set(evidence.map((candidate) => candidate.conversationId)),
    ],
    messageIds: [...new Set(evidence.map((candidate) => candidate.messageId))],
  };
}

function validateOpenQuestions(
  value: unknown,
  candidatesByMessageId: ReadonlyMap<number, InternalHighlightCandidate>
): WeeklyOpenQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const evidence = validateEvidence(row, candidatesByMessageId);
      const question = toBoundedText(row.question, 220);
      if (!evidence || !question) return [];
      return [
        {
          question,
          whyItMatters: toBoundedText(row.whyItMatters, 260),
          ...evidence,
        } satisfies WeeklyOpenQuestion,
      ];
    })
    .slice(0, 3);
}

function validateResourceRecommendations(
  value: unknown,
  candidatesByMessageId: ReadonlyMap<number, InternalHighlightCandidate>
): WeeklyResourceRecommendation[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const evidence = validateEvidence(row, candidatesByMessageId);
      const title = toBoundedText(row.title, 120);
      const searchQuery = toBoundedText(row.searchQuery, 160);
      if (!evidence || !title || !searchQuery) return [];
      return [
        {
          title,
          reason: toBoundedText(row.reason, 260),
          searchQuery,
          ...evidence,
        } satisfies WeeklyResourceRecommendation,
      ];
    })
    .slice(0, 3);
}

function validateStyleVariant(value: unknown): {
  greeting?: string;
  narrative?: string[];
  callToAction?: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const greeting = toBoundedText(row.greeting, 160);
  const narrative = Array.isArray(row.narrative)
    ? row.narrative
        .map((item) => toBoundedText(item, 420))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const callToAction = toBoundedText(row.callToAction, 180);
  if (!greeting && narrative.length === 0 && !callToAction) return null;
  return { greeting, narrative, callToAction };
}

function validatePushCenter(
  value: unknown,
  base: WeeklyPushCenter | undefined,
  candidatesByMessageId: ReadonlyMap<number, InternalHighlightCandidate>
): WeeklyPushCenter | undefined {
  if (!value || typeof value !== "object") return base;
  const row = value as Record<string, unknown>;
  const spiritualFoodRow =
    row.spiritualFood && typeof row.spiritualFood === "object"
      ? (row.spiritualFood as Record<string, unknown>)
      : null;
  const stylesRow =
    row.styleVariants && typeof row.styleVariants === "object"
      ? (row.styleVariants as Record<string, unknown>)
      : {};
  const humorous = validateStyleVariant(stylesRow.humorous);
  const professional = validateStyleVariant(stylesRow.professional);
  const motivational = validateStyleVariant(stylesRow.motivational);
  const unclearQuestions = validateOpenQuestions(
    row.unclearQuestions,
    candidatesByMessageId
  );
  const resourceRecommendations = validateResourceRecommendations(
    row.resourceRecommendations,
    candidatesByMessageId
  );

  return {
    spiritualFood: spiritualFoodRow
      ? {
          title:
            toBoundedText(spiritualFoodRow.title, 120) ||
            base?.spiritualFood?.title,
          summary:
            toBoundedText(spiritualFoodRow.summary, 320) ||
            base?.spiritualFood?.summary,
          takeaway:
            toBoundedText(spiritualFoodRow.takeaway, 220) ||
            base?.spiritualFood?.takeaway,
        }
      : base?.spiritualFood,
    styleVariants: {
      humorous: humorous ?? base?.styleVariants?.humorous,
      professional: professional ?? base?.styleVariants?.professional,
      motivational: motivational ?? base?.styleVariants?.motivational,
    },
    unclearQuestions:
      unclearQuestions.length > 0
        ? unclearQuestions
        : base?.unclearQuestions ?? [],
    resourceRecommendations:
      resourceRecommendations.length > 0
        ? resourceRecommendations
        : base?.resourceRecommendations ?? [],
  };
}

function buildLocalPushCenter(
  locale: SupportedLocale,
  candidates: InternalHighlightCandidate[],
  tags: NonNullable<WeeklyGrowthReportV2["tags"]>,
  unclearQuestions: WeeklyOpenQuestion[]
): WeeklyPushCenter {
  const topic =
    tags.current?.[0]?.name ??
    candidates[0]?.topic ??
    candidates[0]?.title ??
    (locale === "zh"
      ? "本周思考"
      : locale === "ja"
        ? "今週の思考"
        : locale === "ko"
          ? "이번 주의 생각"
          : "this week's thinking");
  const resourceReason =
    locale === "zh"
      ? "围绕本周反复出现的主题补充一份基础材料。"
      : locale === "ja"
        ? "今週繰り返し現れたテーマの基礎資料を補います。"
        : locale === "ko"
          ? "이번 주 반복된 주제의 기초 자료를 보완합니다."
          : "Add a grounded primer around a theme that recurred this week.";
  const resources = (tags.current ?? []).slice(0, 3).flatMap((tag) => {
    const name = tag.name?.trim();
    const conversationId = tag.conversationIds?.[0];
    const candidate = candidates.find(
      (item) => item.conversationId === conversationId
    );
    if (!name || !candidate) return [];
    return [
      {
        title:
          locale === "zh"
            ? `${name} 入门与实践`
            : locale === "ja"
              ? `${name}の入門と実践`
              : locale === "ko"
                ? `${name} 입문과 실천`
            : `${name}: primer and practice`,
        reason: resourceReason,
        searchQuery: `${name} guide best practices`,
        conversationIds: [candidate.conversationId],
        messageIds: [candidate.messageId],
      } satisfies WeeklyResourceRecommendation,
    ];
  });

  const copy =
    locale === "zh"
      ? {
          spiritualTitle: `本周精神食粮：${topic}`,
          spiritualSummary: `你本周围绕“${topic}”留下了持续的思考痕迹。`,
          takeaway: "挑一个仍有余味的问题，下周继续追一层。",
          humorousGreeting: "这周的大脑也没闲着",
          professionalGreeting: "本周思考脉络已整理",
          motivationalGreeting: "你正在把好奇心变成进展",
          humorousNarrative: "有些问题被你追着问，有些答案还在路上。",
          professionalNarrative: "本周的重点主题、情绪信号与待澄清问题已完成归纳。",
          motivationalNarrative: "每一次认真追问，都在为下一步积累清晰度。",
          humorousAction: "下周再抓住一个问题不放。",
          professionalAction: "选择一个未闭环问题继续验证。",
          motivationalAction: "把今天的一点清晰，变成下周的一步行动。",
        }
      : locale === "ja"
        ? {
            spiritualTitle: `今週の心の栄養：${topic}`,
            spiritualSummary: `今週は「${topic}」について繰り返し考えました。`,
            takeaway: "まだ気になる問いを一つ選び、来週もう一段掘り下げましょう。",
            humorousGreeting: "今週も頭はほどよく大忙しでした",
            professionalGreeting: "今週の思考マップを整理しました",
            motivationalGreeting: "好奇心が着実な前進に変わっています",
            humorousNarrative:
              "追いかけた問いもあれば、うまく逃げ切った答えも少しありました。",
            professionalNarrative:
              "主要テーマ、感情の兆し、未解決の問いを簡潔に整理しました。",
            motivationalNarrative:
              "丁寧な問いかけの一つひとつが、次の一歩を明確にしています。",
            humorousAction: "来週は一つの疑問を逃さず追いかけましょう。",
            professionalAction: "未解決の問いを一つ選び、重点的に検証しましょう。",
            motivationalAction: "一つの気づきを、小さな行動に変えましょう。",
          }
        : locale === "ko"
          ? {
              spiritualTitle: `이번 주 마음의 양식: ${topic}`,
              spiritualSummary: `이번 주에는 “${topic}”에 대한 생각이 반복해서 이어졌습니다.`,
              takeaway: "여운이 남은 질문 하나를 골라 다음 주에 한 단계 더 파고들어 보세요.",
              humorousGreeting: "이번 주에도 머릿속은 기분 좋게 바빴어요",
              professionalGreeting: "이번 주 생각 지도를 정리했습니다",
              motivationalGreeting: "호기심을 꾸준한 진전으로 바꾸고 있어요",
              humorousNarrative:
                "끝까지 쫓아간 질문도 있고, 슬쩍 달아난 답도 조금 있었습니다.",
              professionalNarrative:
                "핵심 주제, 감정 신호, 아직 풀리지 않은 질문을 간결하게 정리했습니다.",
              motivationalNarrative:
                "신중하게 던진 질문 하나하나가 다음 걸음을 더 선명하게 만듭니다.",
              humorousAction: "다음 주에는 질문 하나를 끝까지 붙잡아 보세요.",
              professionalAction: "열린 질문 하나를 골라 집중적으로 검증하세요.",
              motivationalAction: "유용한 통찰 하나를 작은 행동으로 바꿔 보세요.",
            }
          : {
          spiritualTitle: `Food for thought: ${topic}`,
          spiritualSummary: `Your week kept returning to ${topic}.`,
          takeaway: "Choose one open question and follow it one layer deeper.",
          humorousGreeting: "Your brain stayed pleasantly busy",
          professionalGreeting: "Your weekly thinking map is ready",
          motivationalGreeting: "You are turning curiosity into momentum",
          humorousNarrative:
            "Some questions got chased down; a few clever loose ends escaped.",
          professionalNarrative:
            "Key themes, emotional signals, and unresolved questions are summarized.",
          motivationalNarrative:
            "Every careful question is building clarity for the next move.",
          humorousAction: "Pick one loose end and politely refuse to let it escape.",
          professionalAction: "Select one open question for focused validation.",
          motivationalAction: "Turn one useful insight into one small action.",
            };

  return {
    spiritualFood: {
      title: copy.spiritualTitle,
      summary: copy.spiritualSummary,
      takeaway: copy.takeaway,
    },
    styleVariants: {
      humorous: {
        greeting: copy.humorousGreeting,
        narrative: [copy.humorousNarrative],
        callToAction: copy.humorousAction,
      },
      professional: {
        greeting: copy.professionalGreeting,
        narrative: [copy.professionalNarrative],
        callToAction: copy.professionalAction,
      },
      motivational: {
        greeting: copy.motivationalGreeting,
        narrative: [copy.motivationalNarrative],
        callToAction: copy.motivationalAction,
      },
    },
    unclearQuestions,
    resourceRecommendations: resources,
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
      emotionKeywords:
        emotionKeywords.length > 0
          ? emotionKeywords
          : base.identity?.emotionKeywords,
    },
    pushCenter: validatePushCenter(
      raw.pushCenter,
      base.pushCenter,
      candidatesByMessageId
    ),
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
  const emotionMap = buildEmotionMap(
    currentConversations,
    messagesByConversation,
    languageSettings.locale
  );
  const unclearQuestions = detectOpenQuestions(
    currentConversations,
    messagesByConversation,
    languageSettings.locale
  );
  const localPushCenter = buildLocalPushCenter(
    languageSettings.locale,
    candidates,
    tags,
    unclearQuestions
  );
  const localIdentity = buildLocalIdentity(
    languageSettings.locale,
    currentConversations.length
  );
  localIdentity.emotionKeywords = emotionMap;

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
    identity: localIdentity,
    pushCenter: localPushCenter,
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
      openQuestions: unclearQuestions,
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
