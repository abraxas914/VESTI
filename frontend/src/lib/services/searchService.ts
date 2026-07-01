import type {
  Annotation,
  Conversation,
  ExploreAskOptions,
  ExploreAgentPlan,
  ExploreAgentMeta,
  ExploreContextCandidate,
  ExploreIntentType,
  ExploreMode,
  ExploreResolvedTimeScope,
  ExploreRequestedTimeScope,
  ExploreSearchScope,
  ExploreToolCall,
  ExploreToolName,
  LlmConfig,
  Message,
  RagResponse,
  RelatedConversation,
} from "../types";
import {
  getConversationCaptureFreshnessAt,
  getConversationOriginAt,
} from "../conversations/timestamps";
import { db } from "../db/schema";
import {
  addExploreMessage,
  createExploreSession,
  getExploreMessages,
  getSummary,
  getWeeklyReport,
  listConversationsByRange,
  updateExploreSession,
} from "../db/repository";
import { embedText } from "./embeddingService";
import {
  generateConversationSummary,
  generateWeeklyReport,
} from "./insightGenerationService";
import type {
  CallModelScopeOptions,
  InferenceCallResult,
} from "./llmService";
import { callInference } from "./llmService";
import { getLanguageSettings } from "./languageSettingsService";
import { getLlmLanguageName, buildLlmOutputDirective, type SupportedLocale } from "../i18n/locales";
import { getEffectiveModelId, getLlmAccessMode } from "./llmConfig";
import { getLlmSettings } from "./llmSettingsService";
import { logger } from "../utils/logger";
import {
  buildMessagePreviewText,
  buildMessageSearchIndexText,
} from "../utils/messageContentPackage";

type SearchableMessage = Pick<
  Message,
  "role" | "content_text" | "citations" | "attachments" | "artifacts"
>;

const MAX_MESSAGE_COUNT = 12;
const MAX_TEXT_LENGTH = 4000;
const MAX_RAG_SOURCES = 5;
const MAX_EMBEDDING_CHARS = 2048;
const AGENT_SUMMARY_SOURCE_LIMIT = 3;
const MAX_WEEKLY_CANDIDATES = 12;
const MAX_WEEKLY_SOURCE_CHIPS = 8;
const EXPLORE_CONTINUATION_MAX_ROUNDS = 2;
const EXPLORE_CONTINUATION_TAIL_CHARS = 1200;
const EXPLORE_CONTINUATION_MIN_EXTENSION = 24;

type SummaryToolResult = {
  snippets: Map<number, string>;
  cacheHits: number;
  generated: number;
  failed: number;
};

type WeeklySummaryToolResult = {
  summaryText: string;
  sourceOrigin: "cached_report" | "generated_report" | "custom_summary" | "local_only";
  conversations: Conversation[];
  sources: RelatedConversation[];
};

type RagRetrievalItem = {
  source: RelatedConversation;
  contextBlock: string;
  excerpt: string;
};

type RagRetrievalResult = {
  sources: RelatedConversation[];
  context: string;
  items: RagRetrievalItem[];
};

type ExploreCompletionResult = {
  content: string;
  continuationCount: number;
};

const TOOL_DESCRIPTIONS: Record<ExploreToolName, string> = {
  intent_planner:
    "Uses the language model to infer the user's intent, choose the answer route, and decide whether a time scope is needed.",
  time_scope_resolver:
    "Converts relative phrases like 'this week' into a concrete local date range before retrieval or summarization.",
  weekly_summary_tool:
    "Finds conversations inside the chosen time window, then reuses or generates a weekly digest so the answer can be grounded in that period.",
  query_planner:
    "Legacy planner step kept for backward compatibility with older Explore messages.",
  search_rag:
    "Retrieves semantically similar conversations from the knowledge base using vector search.",
  summary_tool:
    "Reuses cached conversation summaries or generates missing ones to improve multi-source synthesis.",
  context_compiler:
    "Builds the editable context draft and source list so the reasoning chain stays inspectable.",
  answer_synthesizer:
    "Writes the final answer from the collected evidence and points the user to concrete sources when evidence is partial.",
};

function getToolDescription(name: ExploreToolName): string {
  return TOOL_DESCRIPTIONS[name];
}

function hasUsableLlmSettings(settings: LlmConfig | null | undefined): settings is LlmConfig {
  if (!settings) return false;

  const mode = getLlmAccessMode(settings);
  const modelId = getEffectiveModelId(settings);

  if (mode === "demo_proxy") {
    return Boolean((settings.proxyBaseUrl || settings.proxyUrl || "").trim() && modelId);
  }

  return Boolean((settings.baseUrl || "").trim() && (settings.apiKey || "").trim() && modelId);
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStartOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

function getEndOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function buildResolvedTimeScope(
  preset: ExploreResolvedTimeScope["preset"],
  label: string,
  start: Date,
  end: Date
): ExploreResolvedTimeScope {
  return {
    preset,
    label,
    rangeStart: getStartOfDay(start),
    rangeEnd: getEndOfDay(end),
    startDate: formatLocalIsoDate(start),
    endDate: formatLocalIsoDate(end),
  };
}

function getCurrentWeekToDateRange(reference = new Date()): ExploreResolvedTimeScope {
  const now = new Date(reference);
  const weekDay = now.getDay();
  const daysSinceMonday = (weekDay + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - daysSinceMonday);
  return buildResolvedTimeScope("current_week_to_date", "Current week to date", start, now);
}

function getLastSevenDaysRange(reference = new Date()): ExploreResolvedTimeScope {
  const end = new Date(reference);
  const start = new Date(reference);
  start.setDate(end.getDate() - 6);
  return buildResolvedTimeScope("last_7_days", "Last 7 days", start, end);
}

function getLastFullWeekRange(reference = new Date()): ExploreResolvedTimeScope {
  const now = new Date(reference);
  const weekDay = now.getDay();
  const daysSinceMonday = (weekDay + 6) % 7;
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setDate(now.getDate() - daysSinceMonday);

  const end = new Date(startOfThisWeek);
  end.setDate(startOfThisWeek.getDate() - 1);

  const start = new Date(end);
  start.setDate(end.getDate() - 6);

  return buildResolvedTimeScope("last_full_week", "Last full week", start, end);
}

function parseDateInput(value?: string): Date | null {
  if (!value?.trim()) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function resolveRequestedTimeScope(
  requested?: ExploreRequestedTimeScope
): ExploreResolvedTimeScope | undefined {
  if (!requested || requested.preset === "none") {
    return undefined;
  }

  switch (requested.preset) {
    case "current_week_to_date":
      return getCurrentWeekToDateRange();
    case "last_7_days":
      return getLastSevenDaysRange();
    case "last_full_week":
      return getLastFullWeekRange();
    case "custom": {
      const start = parseDateInput(requested.startDate);
      const end = parseDateInput(requested.endDate);
      if (!start || !end || start.getTime() > end.getTime()) {
        return undefined;
      }
      return buildResolvedTimeScope(
        "custom",
        requested.label?.trim() || `${requested.startDate} to ${requested.endDate}`,
        start,
        end
      );
    }
  }
}

function buildToolPlan(preferredPath: ExploreAgentPlan["preferredPath"]): ExploreToolName[] {
  if (preferredPath === "clarify") {
    return ["intent_planner"];
  }

  if (preferredPath === "weekly_summary") {
    return [
      "intent_planner",
      "time_scope_resolver",
      "weekly_summary_tool",
      "context_compiler",
      "answer_synthesizer",
    ];
  }

  return [
    "intent_planner",
    "search_rag",
    "summary_tool",
    "context_compiler",
    "answer_synthesizer",
  ];
}

function normalizeRequestedTimeScope(
  value: unknown
): ExploreRequestedTimeScope | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const preset =
    candidate.preset === "current_week_to_date" ||
    candidate.preset === "last_7_days" ||
    candidate.preset === "last_full_week" ||
    candidate.preset === "custom"
      ? candidate.preset
      : candidate.preset === "none"
        ? "none"
        : undefined;

  if (!preset) {
    return undefined;
  }

  return {
    preset,
    label: typeof candidate.label === "string" ? candidate.label.trim() : undefined,
    startDate:
      typeof candidate.startDate === "string" ? candidate.startDate.trim() : undefined,
    endDate: typeof candidate.endDate === "string" ? candidate.endDate.trim() : undefined,
  };
}

function hasExplicitWeeklySignal(query: string): boolean {
  const lowered = query.toLowerCase();
  return (
    /this week|current week|last week|previous week|last 7 days|past 7 days|recent week/.test(
      lowered
    ) ||
    /\u672c\u5468|\u8fd9\u5468|\u8fd9\u4e00\u5468|\u4e0a\u5468|\u6700\u8fd1\u4e03\u5929|\u8fc7\u53bb\u4e03\u5929/.test(
      query
    )
  );
}

function hasSummaryStyleSignal(query: string): boolean {
  const lowered = query.toLowerCase();
  return (
    /summary|summarize|overview|recap|review|what did i do|what have i done|timeline|chronological/.test(
      lowered
    ) ||
    /\u603b\u7ed3|\u6982\u89c8|\u56de\u987e|\u6c47\u603b|\u65f6\u95f4\u7ebf|\u505a\u4e86\u4ec0\u4e48/.test(
      query
    )
  );
}

function applyPlannerGuardrails(query: string, plan: ExploreAgentPlan): ExploreAgentPlan {
  if (plan.preferredPath !== "weekly_summary") {
    return plan;
  }

  if (hasExplicitWeeklySignal(query)) {
    return plan;
  }

  const downgradedIntent: ExploreIntentType = hasSummaryStyleSignal(query)
    ? "cross_conversation_summary"
    : "fact_lookup";
  const downgradedSummaryTarget =
    downgradedIntent === "cross_conversation_summary"
      ? clamp(plan.sourceLimit, 1, AGENT_SUMMARY_SOURCE_LIMIT)
      : clamp(Math.min(plan.sourceLimit, 2), 1, AGENT_SUMMARY_SOURCE_LIMIT);

  return {
    ...plan,
    intent: downgradedIntent,
    preferredPath: "rag",
    summaryTargetCount: downgradedSummaryTarget,
    requestedTimeScope: undefined,
    resolvedTimeScope: undefined,
    toolPlan: buildToolPlan("rag"),
    reason: `${plan.reason} | guardrail: weekly_summary requires an explicit weekly time signal in the query`,
  };
}

function buildFallbackPlan(
  query: string,
  requestedLimit: number,
  fallbackReason: string
): ExploreAgentPlan {
  const lowered = query.toLowerCase();
  const currentWeekIntent =
    /this week|current week/.test(lowered) ||
    /\u672c\u5468|\u8fd9\u5468|\u8fd9\u4e00\u5468/.test(query);
  const lastWeekIntent =
    /last week|previous week/.test(lowered) || /\u4e0a\u5468/.test(query);
  const trailingWeekIntent =
    /last 7 days|past 7 days|recent week/.test(lowered) ||
    /\u8fc7\u53bb\u4e03\u5929|\u6700\u8fd1\u4e03\u5929/.test(query);
  const weeklyIntent = currentWeekIntent || lastWeekIntent || trailingWeekIntent;
  const summaryIntent =
    weeklyIntent ||
    /summary|summarize|overview|recap|review/.test(lowered) ||
    /\u603b\u7ed3|\u6982\u89c8|\u56de\u987e|\u6c47\u603b/.test(query);
  const timelineIntent =
    /timeline|chronological/.test(lowered) ||
    /\u65f6\u95f4\u7ebf|\u6309\u65f6\u95f4/.test(query);

  const requestedTimeScope = weeklyIntent
    ? {
        preset: currentWeekIntent
          ? ("current_week_to_date" as const)
          : lastWeekIntent
            ? ("last_full_week" as const)
            : ("last_7_days" as const),
        label: currentWeekIntent
          ? "Current week to date"
          : lastWeekIntent
            ? "Last full week"
            : "Last 7 days",
      }
    : undefined;

  const preferredPath = weeklyIntent ? "weekly_summary" : "rag";
  const sourceLimit = clamp(requestedLimit || MAX_RAG_SOURCES, 1, 8);
  const summaryTargetCount =
    preferredPath === "weekly_summary"
      ? 0
      : summaryIntent
        ? clamp(sourceLimit, 1, AGENT_SUMMARY_SOURCE_LIMIT)
        : clamp(Math.min(sourceLimit, 2), 1, AGENT_SUMMARY_SOURCE_LIMIT);
  const intent: ExploreIntentType = weeklyIntent
    ? "weekly_review"
    : timelineIntent
      ? "timeline"
      : summaryIntent
        ? "cross_conversation_summary"
        : "fact_lookup";

  return applyPlannerGuardrails(query, {
    intent,
    reason: fallbackReason,
    preferredPath,
    sourceLimit,
    summaryTargetCount,
    answerGoal: weeklyIntent
      ? "Summarize what the user worked on during the requested week and point to the relevant conversations."
      : "Answer the user's question with source-grounded evidence from conversation history.",
    requestedTimeScope,
    resolvedTimeScope: resolveRequestedTimeScope(requestedTimeScope),
    toolPlan: buildToolPlan(preferredPath),
  });
}

function normalizeAgentPlan(
  raw: unknown,
  requestedLimit: number,
  query: string
): ExploreAgentPlan {
  if (!raw || typeof raw !== "object") {
    return buildFallbackPlan(query, requestedLimit, "PLANNER_OUTPUT_INVALID");
  }

  const candidate = raw as Record<string, unknown>;
  const intent: ExploreIntentType =
    candidate.intent === "cross_conversation_summary" ||
    candidate.intent === "weekly_review" ||
    candidate.intent === "timeline" ||
    candidate.intent === "clarification_needed"
      ? candidate.intent
      : "fact_lookup";
  const preferredPath: ExploreAgentPlan["preferredPath"] =
    candidate.preferredPath === "weekly_summary" ||
    candidate.preferredPath === "clarify"
      ? candidate.preferredPath
      : "rag";
  const sourceLimit = clamp(
    typeof candidate.sourceLimit === "number" ? candidate.sourceLimit : requestedLimit || 5,
    1,
    8
  );
  const normalizedRequestedTimeScope = normalizeRequestedTimeScope(
    candidate.requestedTimeScope
  );
  const defaultSummaryTarget =
    preferredPath === "weekly_summary"
      ? 0
      : intent === "cross_conversation_summary" || intent === "timeline"
        ? clamp(sourceLimit, 1, AGENT_SUMMARY_SOURCE_LIMIT)
        : clamp(Math.min(sourceLimit, 2), 1, AGENT_SUMMARY_SOURCE_LIMIT);
  const summaryTargetCount =
    preferredPath === "weekly_summary"
      ? 0
      : clamp(
          typeof candidate.summaryTargetCount === "number"
            ? candidate.summaryTargetCount
            : defaultSummaryTarget,
          0,
          AGENT_SUMMARY_SOURCE_LIMIT
        );

  const plan: ExploreAgentPlan = {
    intent,
    reason:
      typeof candidate.reason === "string" && candidate.reason.trim()
        ? candidate.reason.trim()
        : "PLANNER_REASON_UNSPECIFIED",
    preferredPath,
    sourceLimit,
    summaryTargetCount,
    answerGoal:
      typeof candidate.answerGoal === "string" ? candidate.answerGoal.trim() : undefined,
    needsClarification:
      typeof candidate.needsClarification === "boolean"
        ? candidate.needsClarification
        : preferredPath === "clarify" || intent === "clarification_needed",
    clarifyingQuestion:
      typeof candidate.clarifyingQuestion === "string"
        ? candidate.clarifyingQuestion.trim()
        : undefined,
    requestedTimeScope:
      preferredPath === "weekly_summary"
        ? normalizedRequestedTimeScope ?? {
            preset: "current_week_to_date",
            label: "Current week to date",
          }
        : normalizedRequestedTimeScope,
  };

  plan.resolvedTimeScope = resolveRequestedTimeScope(plan.requestedTimeScope);
  plan.toolPlan = buildToolPlan(plan.preferredPath);

  if ((plan.needsClarification || plan.preferredPath === "clarify") && !plan.clarifyingQuestion) {
    plan.clarifyingQuestion =
      "I can answer this, but I need one more constraint first. Which conversations or time window should I use?";
  }

  return applyPlannerGuardrails(query, plan);
}

function localeOutputDirective(locale: SupportedLocale): string {
  return buildLlmOutputDirective(locale);
}

function buildPlannerPrompt(params: {
  query: string;
  historyContext: string;
  requestedLimit: number;
  searchScope?: ExploreSearchScope;
  locale: SupportedLocale;
}): string {
  const today = formatLocalIsoDate(new Date());
  const history = params.historyContext ? truncateInline(params.historyContext, 700) : "(none)";

  return [
    `Today: ${today}`,
    `User query: ${params.query}`,
    `Search scope: ${describeSearchScope(params.searchScope)}`,
    `Requested source limit: ${params.requestedLimit}`,
    `Recent conversation context: ${history}`,
    "",
    "Choose a high-level execution plan for Explore.",
    "Available tools and their jobs:",
    "- intent_planner: interpret the user's intent and choose the route.",
    "- time_scope_resolver: turn relative phrases like 'this week' into concrete dates.",
    "- weekly_summary_tool: gather conversations inside a time window and summarize what happened in that period.",
    "- search_rag: retrieve semantically similar conversations.",
    "- summary_tool: enrich top conversations with summaries if multi-source synthesis needs it.",
    "- context_compiler: build an editable context draft and source list.",
    "- answer_synthesizer: write the final answer and tell the user where to look if evidence is partial.",
    "",
    "Rules:",
    "- Queries like '我这一周做了什么' or 'what did I do this week' should normally use weekly_review + weekly_summary + current_week_to_date.",
    "- If the user asks for a summary over a recent week, prefer a weekly_summary path over semantic search.",
    "- Never choose weekly_summary for a topic-only query with no explicit time phrase. For example, '数学建模比赛' must stay on the rag path.",
    "- Use clarification_needed only when the request is too ambiguous to answer responsibly.",
    "- Use rag for factual lookup and cross-conversation synthesis that are not primarily time-window based.",
    `- Write "clarifyingQuestion", "answerGoal", and any other user-facing natural-language text in ${getLlmLanguageName(
      params.locale
    )} (JSON field names stay in English).`,
    "",
    "Return JSON only with this schema:",
    "{",
    '  "intent": "fact_lookup | cross_conversation_summary | weekly_review | timeline | clarification_needed",',
    '  "reason": "short explanation",',
    '  "preferredPath": "rag | weekly_summary | clarify",',
    '  "sourceLimit": 1-8,',
    '  "summaryTargetCount": 0-3,',
    '  "answerGoal": "what the final answer should accomplish",',
    '  "needsClarification": true | false,',
    '  "clarifyingQuestion": "optional question",',
    '  "requestedTimeScope": {',
    '    "preset": "none | current_week_to_date | last_7_days | last_full_week | custom",',
    '    "label": "optional label",',
    '    "startDate": "YYYY-MM-DD when preset=custom",',
    '    "endDate": "YYYY-MM-DD when preset=custom"',
    "  }",
    "}",
  ].join("\n");
}
async function planAgentIntent(params: {
  query: string;
  historyContext: string;
  requestedLimit: number;
  searchScope?: ExploreSearchScope;
  settings: LlmConfig | null;
  locale: SupportedLocale;
}): Promise<ExploreAgentPlan> {
  const { query, historyContext, requestedLimit, searchScope, settings, locale } = params;

  if (!hasUsableLlmSettings(settings)) {
    return buildFallbackPlan(query, requestedLimit, "LLM_PLANNER_UNAVAILABLE");
  }

  try {
    const plannerPrompt = buildPlannerPrompt({
      query,
      historyContext,
      requestedLimit,
      searchScope,
      locale,
    });
    const result = await callInference(settings, plannerPrompt, {
      responseFormat: "json_object",
      systemPrompt:
        "You are the planning layer for Vesti Explore. Output only strict JSON that matches the requested schema.",
    });
    const parsed = JSON.parse(result.content) as unknown;
    return normalizeAgentPlan(parsed, requestedLimit, query);
  } catch {
    return buildFallbackPlan(query, requestedLimit, "LLM_PLANNER_FALLBACK");
  }
}

function getScopedConversationIds(searchScope?: ExploreSearchScope): number[] | undefined {
  if (searchScope?.mode !== "selected") {
    return undefined;
  }

  const ids = Array.isArray(searchScope.conversationIds)
    ? searchScope.conversationIds.filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id)
      )
    : [];

  return ids.length > 0 ? ids : undefined;
}

function describeSearchScope(searchScope?: ExploreSearchScope): string {
  const scopedIds = getScopedConversationIds(searchScope);
  if (!scopedIds) {
    return "all conversations";
  }
  return `${scopedIds.length} selected conversation${scopedIds.length === 1 ? "" : "s"}`;
}

function normalizeEmbeddingInput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= MAX_EMBEDDING_CHARS) return trimmed;
  return trimmed.slice(0, MAX_EMBEDDING_CHARS);
}

function toFloat32Array(value: Float32Array | number[]): Float32Array {
  return value instanceof Float32Array ? value : new Float32Array(value);
}

function buildConversationText(
  conversation: Conversation,
  messageTexts: string[],
  annotations: Annotation[]
): string {
  const annotationText = annotations.map((item) => `【批注】${item.content_text}`);
  const chunks = [conversation.title, conversation.snippet, ...messageTexts, ...annotationText];
  const combined = chunks.filter(Boolean).join("\n");
  if (combined.length <= MAX_TEXT_LENGTH) return combined;
  return combined.slice(0, MAX_TEXT_LENGTH);
}

function buildConversationContext(
  conversation: Conversation,
  messages: SearchableMessage[],
  annotations: Annotation[]
): string {
  const lines = messages
    .slice(0, MAX_MESSAGE_COUNT)
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "AI";
      return `[${role}] ${buildMessageSearchIndexText(msg)}`;
    });

  const annotationLines = annotations.map((item) => `[Note] ${item.content_text}`);

  return [
    `[Title] ${conversation.title}`,
    `[Platform] ${conversation.platform}`,
    "[Content]",
    ...lines,
    ...(annotationLines.length > 0 ? ["【批注】", ...annotationLines] : []),
  ].join("\n");
}

function truncateInline(text: string, max = 200): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildHistoryContext(messages: Array<{ role: string; content: string }>): string {
  if (messages.length === 0) return "";

  return `\n\nPrevious conversation context:\n${messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 200)}`)
    .join("\n")}\n\nConsider the above context when answering the new question.`;
}

function buildContextualRagPrompt(
  retrievedContext: string,
  historyContext: string,
  locale: SupportedLocale,
  summaryHints?: string
): string {
  const basePrompt =
    "You are Vesti's knowledge base assistant. Answer based primarily on the retrieved conversations below.";
  const summarySection = summaryHints?.trim()
    ? `\nSummary Hints:\n${summaryHints.trim()}\n`
    : "";

  return `${basePrompt}${historyContext}${summarySection}

Retrieved Conversations:
${retrievedContext}

Instructions:
1. If this is a follow-up question, consider the previous conversation context.
2. Answer based primarily on the retrieved conversations.
3. If information is insufficient, say so clearly.
4. Cite specific conversations when possible.
5. Prefer a complete answer over an ultra-short answer.
6. Use short sections or bullets when they improve clarity.
7. ${localeOutputDirective(locale)}`;
}

function normalizeFinishReason(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function isLengthFinishReason(result: InferenceCallResult): boolean {
  const finishReason = normalizeFinishReason(result.finishReason);
  return finishReason.includes("length") || finishReason.includes("max");
}

function isNearTokenLimit(
  result: InferenceCallResult,
  settings: LlmConfig
): boolean {
  const completionTokens = result.usage?.completionTokens;
  const effectiveMaxTokens =
    result.proxyTokenMetrics?.effectiveMaxTokens ??
    result.proxyTokenMetrics?.requestedMaxTokens ??
    settings.maxTokens;

  if (
    typeof completionTokens !== "number" ||
    !Number.isFinite(completionTokens) ||
    typeof effectiveMaxTokens !== "number" ||
    !Number.isFinite(effectiveMaxTokens)
  ) {
    return false;
  }

  return completionTokens >= Math.max(64, effectiveMaxTokens - 32);
}

function buildContinuationPrompt(originalPrompt: string, partialAnswer: string): string {
  const answerTail =
    partialAnswer.length <= EXPLORE_CONTINUATION_TAIL_CHARS
      ? partialAnswer
      : partialAnswer.slice(-EXPLORE_CONTINUATION_TAIL_CHARS);

  return [
    "The previous answer was cut off by the output limit.",
    "Continue the same answer from exactly where it stopped.",
    "Rules:",
    "- Do not restart the answer.",
    "- Do not repeat earlier text unless a few bridge words are unavoidable.",
    "- Preserve the same language, tone, and formatting style.",
    "- Return only the continuation.",
    "",
    "Original request:",
    originalPrompt,
    "",
    "Already returned (tail):",
    answerTail,
  ].join("\n");
}

function findOverlapSize(previous: string, next: string): number {
  const maxOverlap = Math.min(previous.length, next.length, 220);
  for (let size = maxOverlap; size >= 24; size -= 1) {
    if (previous.slice(-size) === next.slice(0, size)) {
      return size;
    }
  }
  return 0;
}

function mergeContinuationText(previous: string, next: string): string {
  const trimmedNext = next.trimStart();
  if (!trimmedNext) {
    return previous;
  }

  const overlapSize = findOverlapSize(previous, trimmedNext);
  if (overlapSize > 0) {
    return `${previous}${trimmedNext.slice(overlapSize)}`;
  }

  if (!previous) {
    return trimmedNext;
  }

  if (previous.endsWith("\n") || trimmedNext.startsWith("\n")) {
    return `${previous}${trimmedNext}`;
  }

  if (
    /[A-Za-z0-9\u3400-\u9FFF]$/.test(previous) &&
    /^[A-Za-z0-9\u3400-\u9FFF]/.test(trimmedNext)
  ) {
    return `${previous}\n${trimmedNext}`;
  }

  return `${previous}${trimmedNext}`;
}

async function callExploreInference(
  settings: LlmConfig,
  prompt: string,
  options: CallModelScopeOptions
): Promise<ExploreCompletionResult> {
  let combined = "";
  let continuationCount = 0;
  let currentPrompt = prompt;
  let result = await callInference(settings, currentPrompt, options);
  let currentContent = result.content?.trim() || "";

  if (!currentContent) {
    return {
      content: "",
      continuationCount: 0,
    };
  }

  combined = currentContent;

  while (
    (isLengthFinishReason(result) || isNearTokenLimit(result, settings)) &&
    continuationCount < EXPLORE_CONTINUATION_MAX_ROUNDS
  ) {
    continuationCount += 1;
    currentPrompt = buildContinuationPrompt(prompt, combined);
    result = await callInference(settings, currentPrompt, options);
    currentContent = result.content?.trim() || "";

    if (!currentContent) {
      break;
    }

    const previousLength = combined.length;
    combined = mergeContinuationText(combined, currentContent);
    if (combined.length - previousLength < EXPLORE_CONTINUATION_MIN_EXTENSION) {
      break;
    }
  }

  if (continuationCount > 0) {
    logger.info("service", "Explore answer extended with continuation", {
      continuationCount,
      finishReason: result.finishReason ?? null,
      modelId: getEffectiveModelId(settings),
    });
  }

  return {
    content: combined,
    continuationCount,
  };
}

function extractExcerpt(messages: SearchableMessage[]): string {
  const text = messages
    .slice(0, 4)
    .map((message) => buildMessagePreviewText(message, { maxChars: 120 }))
    .filter(Boolean)
    .join("\n");

  return truncateInline(text, 260);
}

function buildLocalFallbackAnswer(
  query: string,
  sources: RelatedConversation[],
  locale: SupportedLocale
): string {
  const pick = <T,>(ko: T, ja: T, zh: T, en: T): T =>
    locale === "ko" ? ko : locale === "ja" ? ja : locale === "zh" ? zh : en;
  if (sources.length === 0) {
    return pick(
      [
        `"${truncateInline(query, 120)}"와(과) 매우 유사한 대화를 찾지 못했습니다.`,
        "표현을 바꾸거나 조금 더 넓은 주제를 선택해 보세요.",
        "팁: 설정에서 LLM을 구성하면 더 풍부한 종합 답변을 받을 수 있습니다.",
      ],
      [
        `「${truncateInline(query, 120)}」に強く類似する対話は見つかりませんでした。`,
        "言い回しを変えるか、もう少し広いトピックを選んでみてください。",
        "ヒント：設定で LLM を構成すると、より充実した統合回答が得られます。",
      ],
      [
        `未找到与"${truncateInline(query, 120)}"高度相似的对话。`,
        "可以换个说法，或者选择更宽泛的主题。",
        "提示：在设置中配置 LLM，就能获得更丰富的综合回答。",
      ],
      [
        `I could not find highly similar conversations for: "${truncateInline(query, 120)}".`,
        "Try rephrasing the query or selecting a broader topic.",
        "Tip: configure an LLM in Settings for richer synthesis.",
      ]
    ).join("\n");
  }

  const matchSuffix = pick(" 일치", " 一致", " 匹配", " match");
  const lines = sources
    .slice(0, 5)
    .map(
      (source, index) =>
        `${index + 1}. ${source.title} [${source.platform}] (${source.similarity}%${matchSuffix})`
    );

  return [
    pick(
      "모델 종합은 현재 사용할 수 없지만, 다음 로컬 대화가 가장 관련성이 높습니다:",
      "モデルによる統合は現在利用できませんが、以下のローカル対話が最も関連しています：",
      "模型综合暂时不可用，但以下本地对话最相关：",
      "Model synthesis is unavailable, but these local conversations are most relevant:"
    ),
    ...lines,
    pick(
      "관심 있는 출처를 열어 자세히 확인한 뒤, 더 좁혀진 후속 질문을 해 보세요.",
      "気になる出典を開いて詳細を確認し、より絞り込んだ追加質問をしてみてください。",
      "打开来源查看详情，再提出更聚焦的追问。",
      "Open a source to inspect details, then ask a narrower follow-up."
    ),
  ].join("\n");
}

function createToolCall(name: ExploreToolName, inputSummary: string): ExploreToolCall {
  const now = Date.now();
  return {
    id: `tool_${now}_${Math.random().toString(36).slice(2, 9)}`,
    name,
    status: "completed",
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    description: getToolDescription(name),
    inputSummary,
  };
}

function completeToolCall(call: ExploreToolCall, outputSummary: string): void {
  const endedAt = Date.now();
  call.status = "completed";
  call.endedAt = endedAt;
  call.durationMs = Math.max(0, endedAt - call.startedAt);
  call.outputSummary = outputSummary;
}

function failToolCall(call: ExploreToolCall, error: unknown): void {
  const endedAt = Date.now();
  call.status = "failed";
  call.endedAt = endedAt;
  call.durationMs = Math.max(0, endedAt - call.startedAt);
  call.error = (error as Error)?.message ?? "UNKNOWN_ERROR";
}

async function runToolStep<T>(
  toolCalls: ExploreToolCall[],
  name: ExploreToolName,
  inputSummary: string,
  executor: () => Promise<T>,
  outputSummaryBuilder: (value: T) => string
): Promise<T> {
  const call = createToolCall(name, inputSummary);
  try {
    const value = await executor();
    completeToolCall(call, outputSummaryBuilder(value));
    toolCalls.push(call);
    return value;
  } catch (error) {
    failToolCall(call, error);
    toolCalls.push(call);
    throw error;
  }
}

function buildSummaryHintsText(
  sources: RelatedConversation[],
  snippets: Map<number, string>
): string {
  const lines: string[] = [];
  for (const source of sources) {
    const snippet = snippets.get(source.id);
    if (!snippet) continue;
    lines.push(`- ${source.title}: ${truncateInline(snippet, 240)}`);
  }
  return lines.join("\n");
}

function buildContextDraft(params: {
  query: string;
  sources: RelatedConversation[];
  candidates: ExploreContextCandidate[];
  searchScope?: ExploreSearchScope;
  plan?: ExploreAgentPlan;
  weeklySummaryText?: string;
}): string {
  const { query, sources, candidates, searchScope, plan, weeklySummaryText } = params;
  const selectedIds = candidates.map((candidate) => candidate.conversationId);
  const lines: string[] = [
    "# Explore Context Draft",
    "",
    `Query: ${query}`,
    `Search Scope: ${describeSearchScope(searchScope)}`,
    `Intent: ${plan?.intent ?? "unknown"}`,
    `Route: ${plan?.preferredPath ?? "rag"}`,
    `Generated At: ${new Date().toISOString()}`,
    "",
  ];

  if (plan?.resolvedTimeScope) {
    lines.push(
      "## Time Scope",
      `${plan.resolvedTimeScope.label} (${plan.resolvedTimeScope.startDate} to ${plan.resolvedTimeScope.endDate})`,
      ""
    );
  }

  if (weeklySummaryText?.trim()) {
    lines.push("## Weekly Summary", weeklySummaryText.trim(), "");
  }

  lines.push(
    "## Planned Tools",
    plan?.toolPlan?.length ? plan.toolPlan.join(" -> ") : "(not recorded)",
    "",
    "## Selected Source IDs",
    selectedIds.length ? selectedIds.join(", ") : "(none)",
    "",
    "## Source Notes"
  );

  if (!sources.length) {
    lines.push("- No relevant conversations were retrieved.");
  } else {
    for (const source of sources) {
      const candidate = candidates.find((item) => item.conversationId === source.id);
      const matchLabel =
        candidate?.matchType === "time_scope" ? "in range" : `${source.similarity}% match`;
      lines.push(
        `- ${source.title} [${source.platform}] (${matchLabel})`,
        `  Match Type: ${candidate?.matchType ?? "semantic"}`,
        `  Selection Reason: ${candidate?.selectionReason || "(not available)"}`,
        `  Summary: ${candidate?.summarySnippet || "(not available)"}`,
        `  Excerpt: ${candidate?.excerpt || "(not available)"}`
      );
    }
  }

  lines.push(
    "",
    "## Instruction",
    "Use this draft as a transparent context package for a new conversation. Edit freely before sending."
  );

  return lines.join("\n");
}

function filterConversationsBySearchScope(
  conversations: Conversation[],
  searchScope?: ExploreSearchScope
): Conversation[] {
  const scopedIds = getScopedConversationIds(searchScope);
  if (!scopedIds) {
    return conversations;
  }

  const scopedIdSet = new Set(scopedIds);
  return conversations.filter((conversation) => scopedIdSet.has(conversation.id));
}

function buildWeeklySources(conversations: Conversation[]): RelatedConversation[] {
  return conversations.slice(0, MAX_WEEKLY_SOURCE_CHIPS).map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    platform: conversation.platform,
    similarity: 100,
  }));
}

async function buildWeeklyContextCandidates(
  conversations: Conversation[],
  timeScope: ExploreResolvedTimeScope
): Promise<ExploreContextCandidate[]> {
  const candidates: ExploreContextCandidate[] = [];

  for (const conversation of conversations.slice(0, MAX_WEEKLY_CANDIDATES)) {
    const summary = await getSummary(conversation.id);
    candidates.push({
      conversationId: conversation.id,
      title: conversation.title,
      platform: conversation.platform,
      similarity: 100,
      matchType: "time_scope",
      selectionReason: `Included because it falls within ${timeScope.label} (${timeScope.startDate} to ${timeScope.endDate}).`,
      summarySnippet: summary?.content?.trim()
        ? truncateInline(summary.content, 260)
        : undefined,
      excerpt: conversation.snippet ? truncateInline(conversation.snippet, 260) : undefined,
    });
  }

  return candidates;
}

async function buildWeeklyEvidenceText(conversations: Conversation[]): Promise<string> {
  if (!conversations.length) {
    return "(no conversations in the selected time range)";
  }

  const lines: string[] = [];
  for (const conversation of conversations.slice(0, 8)) {
    const summary = await getSummary(conversation.id);
    lines.push(
      `- ${conversation.title} [${conversation.platform}]`,
      `  Started: ${formatLocalIsoDate(
        new Date(getConversationOriginAt(conversation))
      )}`,
      `  Captured: ${formatLocalIsoDate(
        new Date(getConversationCaptureFreshnessAt(conversation))
      )}`,
      `  Snippet: ${truncateInline(conversation.snippet || "No snippet available", 220)}`,
      `  Summary: ${
        summary?.content?.trim()
          ? truncateInline(summary.content, 240)
          : "(no cached summary)"
      }`
    );
  }

  return lines.join("\n");
}

async function buildCustomWeeklySummary(params: {
  settings: LlmConfig;
  query: string;
  timeScope: ExploreResolvedTimeScope;
  conversations: Conversation[];
  locale: SupportedLocale;
}): Promise<string> {
  const evidence = await buildWeeklyEvidenceText(params.conversations);
  const systemPrompt = [
    "You are Vesti's weekly exploration summarizer.",
    "Summarize what the user worked on, discussed, decided, or explored during the requested time window.",
    "If evidence is thin, state that clearly and point to the listed conversations for manual inspection.",
    "Keep the answer concise but concrete.",
    localeOutputDirective(params.locale),
  ].join(" ");

  const userPrompt = [
    `User query: ${params.query}`,
    `Time scope: ${params.timeScope.label} (${params.timeScope.startDate} to ${params.timeScope.endDate})`,
    "",
    "Evidence:",
    evidence,
  ].join("\n");

  const result = await callExploreInference(params.settings, userPrompt, { systemPrompt });
  return result.content.trim();
}

function buildWeeklyLocalFallbackAnswer(params: {
  query: string;
  timeScope: ExploreResolvedTimeScope;
  sources: RelatedConversation[];
  summaryText?: string;
  scoped: boolean;
  locale: SupportedLocale;
}): string {
  const pick = <T,>(ko: T, ja: T, zh: T, en: T): T =>
    params.locale === "ko"
      ? ko
      : params.locale === "ja"
        ? ja
        : params.locale === "zh"
          ? zh
          : en;
  const lines: string[] = [];
  if (params.summaryText?.trim()) {
    lines.push(params.summaryText.trim(), "");
  } else {
    lines.push(
      pick(
        `모델의 도움 없이는 "${truncateInline(params.query, 120)}"에 대한 완전한 답변을 종합하지 못했습니다.`,
        `モデルの支援がない状態では、「${truncateInline(params.query, 120)}」に対する完全な答えをまとめることができませんでした。`,
        `在没有模型协助的情况下，无法为"${truncateInline(params.query, 120)}"综合出完整的答案。`,
        `I could not synthesize a full answer for "${truncateInline(params.query, 120)}" without model assistance.`
      ),
      pick(
        `해당 기간은 ${params.timeScope.label}(${params.timeScope.startDate} ~ ${params.timeScope.endDate})입니다.`,
        `対象となる期間は ${params.timeScope.label}（${params.timeScope.startDate} 〜 ${params.timeScope.endDate}）です。`,
        `相关时间窗为 ${params.timeScope.label}（${params.timeScope.startDate} 至 ${params.timeScope.endDate}）。`,
        `The relevant window is ${params.timeScope.label} (${params.timeScope.startDate} to ${params.timeScope.endDate}).`
      ),
      ""
    );
  }

  if (params.sources.length === 0) {
    lines.push(
      params.scoped
        ? pick(
            "선택한 범위에서는 해당 기간 내에 대화를 찾지 못했습니다.",
            "選択した範囲のその期間内には対話が見つかりませんでした。",
            "在所选范围的该时间窗内没有找到任何对话。",
            "No conversations were found in that time window within the selected scope."
          )
        : pick(
            "해당 기간 내에 대화를 찾지 못했습니다.",
            "その期間内には対話が見つかりませんでした。",
            "在该时间窗内没有找到任何对话。",
            "No conversations were found in that time window."
          ),
      pick(
        "범위를 넓히거나 다른 기간으로 다시 질문해 보세요.",
        "範囲を広げるか、別の期間で聞き直してみてください。",
        "可以扩大范围，或换一个时间段再问。",
        "Try broadening the scope or asking for a different period."
      )
    );
    return lines.join("\n");
  }

  lines.push(
    pick(
      "다음 대화를 확인하면 답변의 근거를 확인할 수 있습니다:",
      "以下の対話を確認すると、答えの裏付けが取れます：",
      "你可以查看以下对话来核实答案：",
      "You can inspect these conversations to verify the answer:"
    )
  );
  params.sources.forEach((source, index) => {
    lines.push(`${index + 1}. ${source.title} [${source.platform}]`);
  });
  lines.push(
    pick(
      "출처 칩을 클릭하거나 라이브러리로 전환해 직접 확인해 보세요.",
      "出典のタグをクリックするか、ライブラリに切り替えて直接確認してください。",
      "点击来源标签，或切换到资料库直接查看。",
      "Open the source chips or switch to Library to inspect them directly."
    )
  );

  return lines.join("\n");
}

async function resolveWeeklySummary(params: {
  query: string;
  timeScope: ExploreResolvedTimeScope;
  searchScope?: ExploreSearchScope;
  settings: LlmConfig | null;
  locale: SupportedLocale;
}): Promise<WeeklySummaryToolResult> {
  const allConversations = await listConversationsByRange(
    params.timeScope.rangeStart,
    params.timeScope.rangeEnd
  );
  const conversations = filterConversationsBySearchScope(allConversations, params.searchScope);
  const sources = buildWeeklySources(conversations);
  const scoped = Boolean(getScopedConversationIds(params.searchScope));

  if (!conversations.length) {
    return {
      summaryText: "",
      sourceOrigin: "local_only",
      conversations,
      sources,
    };
  }

  if (!scoped) {
    const cached = await getWeeklyReport(params.timeScope.rangeStart, params.timeScope.rangeEnd);
    if (cached?.content?.trim()) {
      return {
        summaryText: cached.content.trim(),
        sourceOrigin: "cached_report",
        conversations,
        sources,
      };
    }
  }

  if (!hasUsableLlmSettings(params.settings)) {
    return {
      summaryText: "",
      sourceOrigin: "local_only",
      conversations,
      sources,
    };
  }

  if (!scoped) {
    try {
      const generated = await generateWeeklyReport(
        params.settings,
        params.timeScope.rangeStart,
        params.timeScope.rangeEnd
      );
      if (generated.content?.trim()) {
        return {
          summaryText: generated.content.trim(),
          sourceOrigin: "generated_report",
          conversations,
          sources,
        };
      }
    } catch {
      // Fall through to custom weekly synthesis.
    }
  }

  const summaryText = await buildCustomWeeklySummary({
    settings: params.settings,
    query: params.query,
    timeScope: params.timeScope,
    conversations,
    locale: params.locale,
  });

  return {
    summaryText,
    sourceOrigin: summaryText ? "custom_summary" : "local_only",
    conversations,
    sources,
  };
}

async function retrieveRagContext(
  query: string,
  limit: number,
  searchScope?: ExploreSearchScope
): Promise<RagRetrievalResult> {
  const preparedQuery = normalizeEmbeddingInput(query);
  if (!preparedQuery) {
    throw new Error("QUERY_EMPTY");
  }

  const queryVector = toFloat32Array(await embedText(preparedQuery));
  const vectors = await db.vectors.toArray();
  const scored: Array<{ id: number; similarity: number }> = [];
  const scopedConversationIds = getScopedConversationIds(searchScope);
  const scopedConversationIdSet = scopedConversationIds
    ? new Set(scopedConversationIds)
    : undefined;

  for (const vector of vectors) {
    if (
      scopedConversationIdSet &&
      !scopedConversationIdSet.has(vector.conversation_id)
    ) {
      continue;
    }
    const embedding = toFloat32Array(vector.embedding as Float32Array | number[]);
    if (embedding.length !== queryVector.length || embedding.length === 0) continue;
    const similarity = cosineSimilarity(queryVector, embedding);
    if (similarity < 0.15) continue;
    scored.push({ id: vector.conversation_id, similarity });
  }

  const safeLimit = Math.max(1, limit);
  const top = scored.sort((a, b) => b.similarity - a.similarity).slice(0, safeLimit);
  if (scopedConversationIds?.length) {
    const topIds = new Set(top.map((item) => item.id));
    for (const conversationId of scopedConversationIds) {
      if (top.length >= safeLimit) break;
      if (topIds.has(conversationId)) continue;
      top.push({ id: conversationId, similarity: 0 });
      topIds.add(conversationId);
    }
  }
  const conversations = top.length
    ? await db.conversations.bulkGet(top.map((item) => item.id))
    : [];
  const byId = new Map<number, Conversation>();

  for (const conversation of conversations) {
    if (conversation?.id !== undefined) {
      byId.set(conversation.id, conversation as Conversation);
    }
  }

  const sources: RelatedConversation[] = [];
  const contextBlocks: string[] = [];
  const items: RagRetrievalItem[] = [];

  for (const topItem of top) {
    const conversation = byId.get(topItem.id);
    if (!conversation) continue;

    const messages = await db.messages
      .where("conversation_id")
      .equals(conversation.id)
      .sortBy("created_at");

    const source: RelatedConversation = {
      id: conversation.id,
      title: conversation.title,
      platform: conversation.platform,
      similarity: Math.round(topItem.similarity * 100),
    };
    const annotationRecords = await db.annotations
      .where("conversation_id")
      .equals(conversation.id)
      .toArray();
    const annotations = annotationRecords
      .filter((record): record is Annotation => typeof record?.content_text === "string")
      .map((record) => ({
        id: record.id as number,
        conversation_id: record.conversation_id,
        message_id: record.message_id,
        content_text: record.content_text,
        created_at: record.created_at,
        days_after: record.days_after,
      }));

    const contextBlock = buildConversationContext(conversation, messages, annotations);
    const excerpt = extractExcerpt(messages);

    sources.push(source);
    contextBlocks.push(contextBlock);
    items.push({ source, contextBlock, excerpt });
  }

  return {
    sources,
    context: contextBlocks.join("\n\n---\n\n"),
    items,
  };
}

async function resolveSummarySnippets(
  settings: Awaited<ReturnType<typeof getLlmSettings>>,
  sources: RelatedConversation[],
  targetCount: number
): Promise<SummaryToolResult> {
  const snippets = new Map<number, string>();
  let cacheHits = 0;
  let generated = 0;
  let failed = 0;

  for (const source of sources.slice(0, targetCount)) {
    try {
      const existing = await getSummary(source.id);
      if (existing?.content?.trim()) {
        snippets.set(source.id, truncateInline(existing.content, 320));
        cacheHits += 1;
        continue;
      }

      if (!hasUsableLlmSettings(settings)) {
        failed += 1;
        continue;
      }

      const synthesized = await generateConversationSummary(settings, source.id);
      if (synthesized?.content?.trim()) {
        snippets.set(source.id, truncateInline(synthesized.content, 320));
        generated += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    snippets,
    cacheHits,
    generated,
    failed,
  };
}

function buildContextCandidates(
  retrieval: RagRetrievalResult,
  summarySnippets: Map<number, string>
): ExploreContextCandidate[] {
  return retrieval.items.map((item) => ({
    conversationId: item.source.id,
    title: item.source.title,
    platform: item.source.platform,
    similarity: item.source.similarity,
    matchType: "semantic",
    selectionReason: "Retrieved by semantic similarity against the user's query.",
    summarySnippet: summarySnippets.get(item.source.id),
    excerpt: item.excerpt,
  }));
}

async function runClassicKnowledgeBase(
  query: string,
  historyContext: string,
  limit: number,
  locale: SupportedLocale,
  searchScope?: ExploreSearchScope,
  existingRetrieval?: RagRetrievalResult
): Promise<RagResponse> {
  let retrieval = existingRetrieval;
  if (!retrieval) {
    try {
      retrieval = await retrieveRagContext(query, limit, searchScope);
    } catch {
      retrieval = {
        sources: [],
        context: "",
        items: [],
      };
    }
  }
  const settings = await getLlmSettings();

  if (!hasUsableLlmSettings(settings)) {
    return {
      answer: buildLocalFallbackAnswer(query, retrieval.sources, locale),
      sources: retrieval.sources,
    };
  }

  try {
    const systemPrompt = buildContextualRagPrompt(retrieval.context, historyContext, locale);
    const result = await callExploreInference(settings, query, { systemPrompt });
    const answer = result.content.trim();
    return {
      answer: answer || buildLocalFallbackAnswer(query, retrieval.sources, locale),
      sources: retrieval.sources,
    };
  } catch {
    return {
      answer: buildLocalFallbackAnswer(query, retrieval.sources, locale),
      sources: retrieval.sources,
    };
  }
}

async function synthesizeAgentAnswer(params: {
  query: string;
  historyContext: string;
  retrieval: RagRetrievalResult;
  summaryHints: string;
  settings: Awaited<ReturnType<typeof getLlmSettings>>;
  locale: SupportedLocale;
}): Promise<string> {
  const { query, historyContext, retrieval, summaryHints, settings, locale } = params;
  if (!hasUsableLlmSettings(settings)) {
    return buildLocalFallbackAnswer(query, retrieval.sources, locale);
  }

  const systemPrompt = buildContextualRagPrompt(
    retrieval.context,
    historyContext,
    locale,
    summaryHints
  );

  try {
    const result = await callExploreInference(settings, query, { systemPrompt });
    const answer = result.content.trim();
    if (!answer) {
      return buildLocalFallbackAnswer(query, retrieval.sources, locale);
    }
    return answer;
  } catch {
    return buildLocalFallbackAnswer(query, retrieval.sources, locale);
  }
}

async function synthesizeWeeklyAnswer(params: {
  query: string;
  historyContext: string;
  timeScope: ExploreResolvedTimeScope;
  weeklySummaryText: string;
  sources: RelatedConversation[];
  settings: Awaited<ReturnType<typeof getLlmSettings>>;
  scoped: boolean;
  locale: SupportedLocale;
}): Promise<string> {
  const { query, historyContext, timeScope, weeklySummaryText, sources, settings, scoped, locale } =
    params;

  if (!hasUsableLlmSettings(settings)) {
    return buildWeeklyLocalFallbackAnswer({
      query,
      timeScope,
      sources,
      summaryText: weeklySummaryText,
      scoped,
      locale,
    });
  }

  const sourceLines =
    sources.length > 0
      ? sources.map((source) => `- ${source.title} [${source.platform}]`).join("\n")
      : "- No conversations were found in this time scope.";

  const systemPrompt = [
    "You are Vesti's transparent Explore answer synthesizer.",
    historyContext,
    `Time scope: ${timeScope.label} (${timeScope.startDate} to ${timeScope.endDate}).`,
    "Weekly digest evidence:",
    weeklySummaryText || "(no weekly digest available)",
    "",
    "Source conversations:",
    sourceLines,
    "",
    "Instructions:",
    "1. Answer the user's specific question using the weekly digest and source list.",
    "2. If evidence is partial, say that clearly.",
    "3. Tell the user which source conversations to open when deeper verification is needed.",
    "4. Keep the answer grounded in the selected time window.",
    "5. Prefer a complete answer over an ultra-short one.",
    `6. ${localeOutputDirective(locale)}`,
  ].join("\n");

  try {
    const result = await callExploreInference(settings, query, { systemPrompt });
    const answer = result.content.trim();
    if (!answer) {
      return buildWeeklyLocalFallbackAnswer({
        query,
        timeScope,
        sources,
        summaryText: weeklySummaryText,
        scoped,
        locale,
      });
    }
    return answer;
  } catch {
    return buildWeeklyLocalFallbackAnswer({
      query,
      timeScope,
      sources,
      summaryText: weeklySummaryText,
      scoped,
      locale,
    });
  }
}

async function runAgentKnowledgeBase(
  query: string,
  historyContext: string,
  limit: number,
  locale: SupportedLocale,
  options?: ExploreAskOptions
): Promise<RagResponse> {
  const toolCalls: ExploreToolCall[] = [];
  const startedAt = Date.now();
  let retrieval: RagRetrievalResult | undefined;
  let plan: ExploreAgentPlan | undefined;
  let weeklyResult: WeeklySummaryToolResult | undefined;
  let contextDraft = "";
  let contextCandidates: ExploreContextCandidate[] = [];
  let selectedContextConversationIds: number[] = [];
  const searchScope = options?.searchScope;
  const settings = await getLlmSettings();

  try {
    plan = await runToolStep(
      toolCalls,
      "intent_planner",
      `query="${truncateInline(query, 100)}", scope=${describeSearchScope(searchScope)}`,
      async () =>
        planAgentIntent({
          query,
          historyContext,
          requestedLimit: limit,
          searchScope,
          settings,
          locale,
        }),
      (value) =>
        `intent=${value.intent}, route=${value.preferredPath}, sourceLimit=${value.sourceLimit}, reason=${truncateInline(value.reason, 100)}`
    );

    if (plan.needsClarification || plan.preferredPath === "clarify") {
      contextDraft = buildContextDraft({
        query,
        sources: [],
        candidates: [],
        searchScope,
        plan,
      });

      const agentMeta: ExploreAgentMeta = {
        mode: "agent",
        query,
        searchScope,
        plan,
        toolCalls,
        contextDraft,
        contextCandidates,
        selectedContextConversationIds,
        totalDurationMs: Date.now() - startedAt,
      };

      return {
        answer:
          plan.clarifyingQuestion ||
          (locale === "ko"
            ? "정확하게 답변드리기 위해, 조건을 하나만 더 알려 주시겠어요?"
            : locale === "ja"
              ? "確実にお答えするために、もう一つだけ条件を補足していただけますか。"
              : locale === "zh"
                ? "在可靠作答前，我还需要你再补充一个限定条件。"
                : "I need one more constraint before I can answer this reliably."),
        sources: [],
        agent: agentMeta,
      };
    }

    if (plan.preferredPath === "weekly_summary") {
      const resolvedTimeScope = await runToolStep(
        toolCalls,
        "time_scope_resolver",
        `requested=${plan.requestedTimeScope?.preset ?? "none"}`,
        async () => {
          const resolved = plan?.resolvedTimeScope ?? resolveRequestedTimeScope(plan?.requestedTimeScope);
          if (!resolved) {
            throw new Error("TIME_SCOPE_UNRESOLVED");
          }
          return resolved;
        },
        (value) => `${value.label} (${value.startDate} to ${value.endDate})`
      );

      plan = {
        ...plan,
        resolvedTimeScope,
        toolPlan: buildToolPlan("weekly_summary"),
      };

      weeklyResult = await runToolStep(
        toolCalls,
        "weekly_summary_tool",
        `scope=${resolvedTimeScope.label}, searchScope=${describeSearchScope(searchScope)}`,
        async () =>
          resolveWeeklySummary({
            query,
            timeScope: resolvedTimeScope,
            searchScope,
            settings,
            locale,
          }),
        (value) =>
          `sourceOrigin=${value.sourceOrigin}, conversations=${value.conversations.length}, sources=${value.sources.length}`
      );

      const compiledContext = await runToolStep(
        toolCalls,
        "context_compiler",
        `sources=${weeklyResult.sources.length}, route=weekly_summary`,
        async () => {
          const candidates = await buildWeeklyContextCandidates(
            weeklyResult!.conversations,
            resolvedTimeScope
          );
          const draft = buildContextDraft({
            query,
            sources: weeklyResult!.sources,
            candidates,
            searchScope,
            plan,
            weeklySummaryText: weeklyResult!.summaryText,
          });
          return { candidates, draft };
        },
        (value) => `draftChars=${value.draft.length}, candidates=${value.candidates.length}`
      );

      contextCandidates = compiledContext.candidates;
      contextDraft = compiledContext.draft;
      selectedContextConversationIds = contextCandidates.map(
        (candidate) => candidate.conversationId
      );

      const answer = await runToolStep(
        toolCalls,
        "answer_synthesizer",
        `route=weekly_summary, sources=${weeklyResult.sources.length}`,
        async () =>
          synthesizeWeeklyAnswer({
            query,
            historyContext,
            timeScope: resolvedTimeScope,
            weeklySummaryText: weeklyResult!.summaryText,
            sources: weeklyResult!.sources,
            settings,
            scoped: Boolean(getScopedConversationIds(searchScope)),
            locale,
          }),
        (value) => `answerChars=${value.length}`
      );

      const agentMeta: ExploreAgentMeta = {
        mode: "agent",
        query,
        searchScope,
        plan,
        toolCalls,
        contextDraft,
        contextCandidates,
        selectedContextConversationIds,
        totalDurationMs: Date.now() - startedAt,
      };

      return {
        answer,
        sources: weeklyResult.sources,
        agent: agentMeta,
      };
    }

    retrieval = await runToolStep(
      toolCalls,
      "search_rag",
      `sourceLimit=${plan.sourceLimit}, scope=${describeSearchScope(searchScope)}`,
      async () => retrieveRagContext(query, plan.sourceLimit, searchScope),
      (value) => `retrieved=${value.sources.length}, scope=${describeSearchScope(searchScope)}`
    );

    const summaryResult = await runToolStep(
      toolCalls,
      "summary_tool",
      `target=${plan.summaryTargetCount}`,
      async () => resolveSummarySnippets(settings, retrieval!.sources, plan.summaryTargetCount),
      (value) =>
        `cacheHits=${value.cacheHits}, generated=${value.generated}, failed=${value.failed}`
    );

    const compiledContext = await runToolStep(
      toolCalls,
      "context_compiler",
      `sources=${retrieval.sources.length}`,
      async () => {
        const candidates = buildContextCandidates(retrieval!, summaryResult.snippets);
        const draft = buildContextDraft({
          query,
          sources: retrieval!.sources,
          candidates,
          searchScope,
          plan,
        });
        return { candidates, draft };
      },
      (value) => `draftChars=${value.draft.length}, candidates=${value.candidates.length}`
    );

    contextCandidates = compiledContext.candidates;
    contextDraft = compiledContext.draft;
    selectedContextConversationIds = contextCandidates.map(
      (candidate) => candidate.conversationId
    );

    const summaryHints = buildSummaryHintsText(retrieval.sources, summaryResult.snippets);
    const answer = await runToolStep(
      toolCalls,
      "answer_synthesizer",
      `sources=${retrieval.sources.length}`,
      async () =>
        synthesizeAgentAnswer({
          query,
          historyContext,
          retrieval: retrieval!,
          summaryHints,
          settings,
          locale,
        }),
      (value) => `answerChars=${value.length}`
    );

    const agentMeta: ExploreAgentMeta = {
      mode: "agent",
      query,
      searchScope,
      plan,
      toolCalls,
      contextDraft,
      contextCandidates,
      selectedContextConversationIds,
      totalDurationMs: Date.now() - startedAt,
    };

    return {
      answer,
      sources: retrieval.sources,
      agent: agentMeta,
    };
  } catch {
    if (plan?.preferredPath === "weekly_summary" && plan.resolvedTimeScope) {
      if (!contextDraft) {
        contextCandidates = weeklyResult
          ? await buildWeeklyContextCandidates(
              weeklyResult.conversations,
              plan.resolvedTimeScope
            )
          : [];
        contextDraft = buildContextDraft({
          query,
          sources: weeklyResult?.sources ?? [],
          candidates: contextCandidates,
          searchScope,
          plan,
          weeklySummaryText: weeklyResult?.summaryText,
        });
        selectedContextConversationIds = contextCandidates.map(
          (candidate) => candidate.conversationId
        );
      }

      const agentMeta: ExploreAgentMeta = {
        mode: "agent",
        query,
        searchScope,
        plan,
        toolCalls,
        contextDraft,
        contextCandidates,
        selectedContextConversationIds,
        totalDurationMs: Date.now() - startedAt,
      };

      return {
        answer: buildWeeklyLocalFallbackAnswer({
          query,
          timeScope: plan.resolvedTimeScope,
          sources: weeklyResult?.sources ?? [],
          summaryText: weeklyResult?.summaryText,
          scoped: Boolean(getScopedConversationIds(searchScope)),
          locale,
        }),
        sources: weeklyResult?.sources ?? [],
        agent: agentMeta,
      };
    }

    const fallback = await runClassicKnowledgeBase(
      query,
      historyContext,
      limit,
      locale,
      searchScope,
      retrieval
    );

    if (!contextDraft && retrieval) {
      contextCandidates = buildContextCandidates(retrieval, new Map<number, string>());
      contextDraft = buildContextDraft({
        query,
        sources: retrieval.sources,
        candidates: contextCandidates,
        searchScope,
        plan,
      });
      selectedContextConversationIds = contextCandidates.map(
        (candidate) => candidate.conversationId
      );
    }

    const agentMeta: ExploreAgentMeta = {
      mode: "agent",
      query,
      searchScope,
      plan,
      toolCalls,
      contextDraft,
      contextCandidates,
      selectedContextConversationIds,
      totalDurationMs: Date.now() - startedAt,
    };

    return {
      answer: fallback.answer,
      sources: fallback.sources,
      agent: agentMeta,
    };
  }
}

export async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getConversationText(
  conversationId: number
): Promise<{ conversation: Conversation; text: string }> {
  const conversation = await db.conversations.get(conversationId);
  if (!conversation || conversation.id === undefined) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const messages = await db.messages
    .where("conversation_id")
    .equals(conversationId)
    .sortBy("created_at");

  const messageTexts = messages
    .slice(0, MAX_MESSAGE_COUNT)
    .map((message) => buildMessageSearchIndexText(message))
    .filter(Boolean);

  const annotationRecords = await db.annotations
    .where("conversation_id")
    .equals(conversationId)
    .toArray();
  const annotations = annotationRecords
    .filter((record): record is Annotation => typeof record?.content_text === "string")
    .map((record) => ({
      id: record.id as number,
      conversation_id: record.conversation_id,
      message_id: record.message_id,
      content_text: record.content_text,
      created_at: record.created_at,
      days_after: record.days_after,
    }));

  const text = buildConversationText(
    conversation as Conversation,
    messageTexts,
    annotations
  );
  return { conversation: conversation as Conversation, text };
}

type EdgeQueryOptions = {
  threshold?: number;
  conversationIds?: number[];
};

function normalizeConversationIds(conversationIds?: number[]): number[] {
  if (!Array.isArray(conversationIds)) {
    return [];
  }

  const seen = new Set<number>();
  const normalizedIds: number[] = [];

  conversationIds.forEach((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const normalized = Math.floor(value);
    if (normalized <= 0 || seen.has(normalized)) return;
    seen.add(normalized);
    normalizedIds.push(normalized);
  });

  return normalizedIds;
}

async function ensureVectorsForConversations(conversationIds: number[]): Promise<void> {
  for (const conversationId of conversationIds) {
    try {
      const { text } = await getConversationText(conversationId);
      await ensureVectorForConversation(conversationId, text);
    } catch (error) {
      logger.warn("service", "Failed to ensure vector for network conversation", {
        conversationId,
        error: (error as Error)?.message ?? String(error),
      });
    }
  }
}

export async function ensureVectorForConversation(
  conversationId: number,
  text: string
): Promise<void> {
  const preparedText = normalizeEmbeddingInput(text);
  if (!preparedText) return;

  const textHash = await hashText(preparedText);

  const existing = await db.vectors
    .where("conversation_id")
    .equals(conversationId)
    .and((record) => record.text_hash === textHash)
    .first();
  if (existing && existing.id !== undefined) return;

  const embedding = await embedText(preparedText);

  await db.transaction("rw", db.vectors, async () => {
    await db.vectors
      .where("conversation_id")
      .equals(conversationId)
      .and((record) => record.text_hash !== textHash)
      .delete();

    await db.vectors.add({
      conversation_id: conversationId,
      text_hash: textHash,
      embedding,
    });
  });
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

export async function findRelatedConversations(
  conversationId: number,
  limit = 3
): Promise<RelatedConversation[]> {
  const { text } = await getConversationText(conversationId);
  await ensureVectorForConversation(conversationId, text);

  const targetVector = await db.vectors
    .where("conversation_id")
    .equals(conversationId)
    .first();
  if (!targetVector) return [];

  const vectors = await db.vectors.toArray();
  const targetEmbedding = toFloat32Array(targetVector.embedding);

  const scores: Array<{ id: number; similarity: number }> = [];
  for (const vector of vectors) {
    if (vector.conversation_id === conversationId) continue;
    const embedding = toFloat32Array(vector.embedding as Float32Array | number[]);
    const similarity = cosineSimilarity(targetEmbedding, embedding);
    scores.push({ id: vector.conversation_id, similarity });
  }

  const top = scores.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  const conversations = await db.conversations.bulkGet(top.map((item) => item.id));
  const byId = new Map<number, Conversation>();
  conversations.forEach((item) => {
    if (item && item.id !== undefined) {
      byId.set(item.id, item as Conversation);
    }
  });

  return top
    .map((item) => {
      const conversation = byId.get(item.id);
      if (!conversation) return null;
      return {
        id: conversation.id,
        title: conversation.title,
        platform: conversation.platform,
        similarity: Math.round(item.similarity * 100),
      } as RelatedConversation;
    })
    .filter(Boolean) as RelatedConversation[];
}

export async function findAllEdges(
  options: EdgeQueryOptions = {}
): Promise<Array<{ source: number; target: number; weight: number }>> {
  const threshold = options.threshold ?? 0.3;
  const targetConversationIds = normalizeConversationIds(options.conversationIds);

  const vectors = Array.isArray(options.conversationIds)
    ? targetConversationIds.length === 0
      ? []
      : await (async () => {
          await ensureVectorsForConversations(targetConversationIds);
          return db.vectors.where("conversation_id").anyOf(targetConversationIds).toArray();
        })()
    : await db.vectors.toArray();

  const edges: Array<{ source: number; target: number; weight: number }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const left = vectors[i];
      const right = vectors[j];
      if (
        typeof left.conversation_id !== "number" ||
        typeof right.conversation_id !== "number"
      ) {
        continue;
      }

      const a = toFloat32Array(left.embedding as Float32Array | number[]);
      const b = toFloat32Array(right.embedding as Float32Array | number[]);
      if (a.length !== b.length || a.length === 0) continue;

      const similarity = cosineSimilarity(a, b);
      if (similarity < threshold) continue;

      const key = `${left.conversation_id}-${right.conversation_id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        source: left.conversation_id,
        target: right.conversation_id,
        weight: Math.round(similarity * 100) / 100,
      });
    }
  }

  return edges;
}

export async function askKnowledgeBase(
  userQuery: string,
  existingSessionId?: string,
  limit = MAX_RAG_SOURCES,
  mode: ExploreMode = "agent",
  options?: ExploreAskOptions
): Promise<RagResponse & { sessionId: string }> {
  const query = userQuery.trim();
  if (!query) {
    throw new Error("QUERY_EMPTY");
  }

  let sessionId = existingSessionId;
  if (!sessionId) {
    sessionId = await createExploreSession(query.slice(0, 100));
  }

  await addExploreMessage(sessionId, {
    role: "user",
    content: query,
    timestamp: Date.now(),
  });

  const recentMessages = await getExploreMessages(sessionId);
  const historyContext = buildHistoryContext(recentMessages.slice(-6));

  const { locale } = await getLanguageSettings();

  const result =
    mode === "classic"
      ? await runClassicKnowledgeBase(query, historyContext, limit, locale, options?.searchScope)
      : await runAgentKnowledgeBase(query, historyContext, limit, locale, options);

  await addExploreMessage(sessionId, {
    role: "assistant",
    content: result.answer,
    sources: result.sources,
    agentMeta: result.agent,
    timestamp: Date.now(),
  });

  await updateExploreSession(sessionId, {
    preview: result.answer.slice(0, 100),
  });

  return {
    ...result,
    sessionId,
  };
}

export async function hybridSearch(query: string): Promise<RagResponse> {
  return askKnowledgeBase(query, undefined, MAX_RAG_SOURCES, "agent");
}

export async function getVectorStats(): Promise<{
  totalVectors: number;
  totalConversations: number;
  vectorizedConversations: number;
  unvectorizedConversations: number;
}> {
  const totalVectors = await db.vectors.count();
  const allConversations = await db.conversations.toArray();
  const totalConversations = allConversations.length;

  const vectorizedIds = new Set<number>();
  const vectors = await db.vectors.toArray();
  vectors.forEach((v) => vectorizedIds.add(v.conversation_id));

  return {
    totalVectors,
    totalConversations,
    vectorizedConversations: vectorizedIds.size,
    unvectorizedConversations: totalConversations - vectorizedIds.size,
  };
}

export async function vectorizeAllConversations(): Promise<number> {
  const conversations = await db.conversations.toArray();

  let created = 0;
  for (const conversation of conversations) {
    if (!conversation?.id) continue;
    try {
      const { text } = await getConversationText(conversation.id);
      await ensureVectorForConversation(conversation.id, text);
      created += 1;
    } catch (err) {
      console.error(
        "[Vectorize] Failed to vectorize conv",
        conversation.id,
        ":",
        (err as Error).message
      );
    }
  }

  return created;
}
