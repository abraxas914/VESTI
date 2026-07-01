import type {
  ConversationSummaryV1,
  ConversationSummaryV2,
  ConversationSummaryV2Legacy,
  SummaryRecord,
  WeeklyLiteReportV1,
  WeeklyRecapV1,
  WeeklyReportRecord,
  WeeklyReportV1,
} from "../types";
import type {
  ChatSummaryData,
  WeeklyRecapData,
  WeeklySummaryData,
} from "../types/insightsPresentation";
import {
  isLowSignalNarrativeItem,
  normalizeConversationSummaryV2Legacy,
  normalizeWeeklyNarrativeList,
} from "./insightSchemas";
import { getLocaleDateTag, type SupportedLocale } from "../i18n/locales";

interface WeeklyCrossDomainEcho {
  domain_a: string;
  domain_b: string;
  shared_logic: string;
  evidence_ids: number[];
}

const TECH_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\breact\b/i, label: "React" },
  { pattern: /typescript|\bts\b/i, label: "TypeScript" },
  { pattern: /plasmo/i, label: "Plasmo" },
  { pattern: /tailwind/i, label: "Tailwind CSS" },
  { pattern: /dexie|indexeddb/i, label: "IndexedDB" },
  { pattern: /parser|selector/i, label: "Parser" },
  { pattern: /modelscope|qwen|deepseek/i, label: "Model Inference" },
  { pattern: /prompt|schema/i, label: "Prompt Engineering" },
];
function defaultWeeklySuggestedFocus(locale: SupportedLocale): string {
  return locale === "ko"
    ? "다음 주에는 가치가 높은 질문 하나에 집중해 진전을 만들고, 검증 결과를 기록해 보세요."
    : locale === "ja"
      ? "来週は価値の高い問いを一つに絞って前に進め、検証結果を記録しましょう。"
      : locale === "zh"
        ? "下周优先推进一个高价值问题，并记录验证结果。"
        : "Next week, prioritize one high-value question and record the validation result.";
}

function insightTermLabel(locale: SupportedLocale, index: number): string {
  return locale === "ko"
    ? `인사이트${index}`
    : locale === "ja"
      ? `インサイト${index}`
      : locale === "zh"
        ? `洞察${index}`
        : `Insight ${index}`;
}

interface AdapterDefaults {
  generalTag: string;
  thinkingStyle: string;
  emotionalTone: string;
  v1ThinkingStyle: string;
  v1EmotionalTone: string;
  v1OpeningAssertion: string;
  sparseThinkingStyle: string;
  sparseEmotionalTone: string;
  conversationSummaryTitle: string;
  noStableConclusion: string;
  coreQuestionPrefix: (title: string) => string;
  weeklyFallbackHighlight: string;
}

function getAdapterDefaults(locale: SupportedLocale): AdapterDefaults {
  if (locale === "ko") {
    return {
      generalTag: "종합",
      thinkingStyle: "한 걸음씩 깊이 파고들며, 질문을 거듭할 때마다 범위를 좁혀 나가고 있습니다.",
      emotionalTone: "신중하면서도 호기심을 잃지 않고, 핵심 가설을 꾸준히 검증하고 있습니다.",
      v1ThinkingStyle: "문제를 단계적으로 분해하며, 범위를 점점 좁혀 나가고 있습니다.",
      v1EmotionalTone: "이성적이고 신중한 어조를 유지하며, 가설을 지속적으로 검증하고 있습니다.",
      v1OpeningAssertion: "방향을 정하기 전에 먼저 정리해 두어야 할 질문을 던지고 있습니다.",
      sparseThinkingStyle: "표본이 적어 사고 방식을 안정적으로 추정하기 어렵습니다.",
      sparseEmotionalTone: "표본이 적어 감정의 톤은 중립으로 처리합니다.",
      conversationSummaryTitle: "대화 요약",
      noStableConclusion: "아직 안정적인 결론은 없습니다.",
      coreQuestionPrefix: (title: string) => `이번 대화의 핵심 질문: ${title}`,
      weeklyFallbackHighlight: "이번 주에는 다시 활용할 수 있는 단계적 결론이 정리되었습니다.",
    };
  }
  if (locale === "ja") {
    return {
      generalTag: "総合",
      thinkingStyle: "一歩ずつ掘り下げ、問いを重ねるたびに範囲を絞り込んでいます。",
      emotionalTone: "慎重さと好奇心を併せ持ち、重要な仮説を継続的に検証しています。",
      v1ThinkingStyle: "問題を段階的に分解し、少しずつ範囲を絞り込んでいます。",
      v1EmotionalTone: "理性的で慎重な口調を保ち、仮説を継続的に検証しています。",
      v1OpeningAssertion: "まず方向を決める前に整理しておくべき問いを投げかけています。",
      sparseThinkingStyle: "サンプルが少なく、思考スタイルを安定して推定できません。",
      sparseEmotionalTone: "サンプルが少ないため、感情のトーンは中立として扱います。",
      conversationSummaryTitle: "会話の要約",
      noStableConclusion: "まだ安定した結論はありません。",
      coreQuestionPrefix: (title: string) => `今回の会話の核心的な問い：${title}`,
      weeklyFallbackHighlight: "今週は再利用できる段階的な結論がまとまりました。",
    };
  }
  if (locale === "zh") {
    return {
      generalTag: "综合",
      thinkingStyle: "一步步深挖，每问一次都在收紧范围。",
      emotionalTone: "谨慎又不失好奇，持续验证关键假设。",
      v1ThinkingStyle: "你把问题逐层拆开，并不断收紧范围。",
      v1EmotionalTone: "语气理性而审慎，持续在验证假设。",
      v1OpeningAssertion: "你先抛出一个需要先理清、才能决定方向的问题。",
      sparseThinkingStyle: "样本偏少，暂时难以稳定判断思考风格。",
      sparseEmotionalTone: "样本偏少，情绪基调暂按中性处理。",
      conversationSummaryTitle: "对话摘要",
      noStableConclusion: "暂时还没有稳定的结论。",
      coreQuestionPrefix: (title: string) => `本次对话的核心问题：${title}`,
      weeklyFallbackHighlight: "本周沉淀出了可复用的阶段性结论。",
    };
  }
  return {
    generalTag: "General",
    thinkingStyle: "Drills down step by step, tightening scope with each question.",
    emotionalTone: "Cautious yet curious, continuously validating key assumptions.",
    v1ThinkingStyle: "You break problems down and tighten scope iteratively.",
    v1EmotionalTone:
      "The tone is rational, careful, and continuously validating assumptions.",
    v1OpeningAssertion:
      "You open with a problem that needs to be clarified before deciding on direction.",
    sparseThinkingStyle:
      "Sample is sparse; stable thinking-style inference is unavailable.",
    sparseEmotionalTone: "Sample is sparse; tone is treated as neutral.",
    conversationSummaryTitle: "Conversation Summary",
    noStableConclusion: "No stable conclusion yet.",
    coreQuestionPrefix: (title: string) =>
      `Core question in this conversation: ${title}`,
    weeklyFallbackHighlight:
      "This week produced reusable stage-level conclusions.",
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function dedupeNarrative(items: string[], limit: number): string[] {
  return dedupe(items)
    .filter((item) => !isLowSignalNarrativeItem(item))
    .slice(0, limit);
}

function dedupeJourney(
  steps: ChatSummaryData["thinking_journey"]
): ChatSummaryData["thinking_journey"] {
  const seen = new Set<string>();
  const output: ChatSummaryData["thinking_journey"] = [];

  for (const step of steps) {
    const key = `${step.speaker}:${step.assertion.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(step);
  }

  return output.map((step, index) => ({
    ...step,
    step: index + 1,
  }));
}

function dedupeInsights(
  items: ChatSummaryData["key_insights"]
): ChatSummaryData["key_insights"] {
  const seen = new Set<string>();
  const output: ChatSummaryData["key_insights"] = [];

  for (const item of items) {
    const term = normalizeText(item.term);
    const definition = normalizeText(item.definition);
    if (!term || !definition) continue;
    const key = `${term.toLowerCase()}::${definition.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ term, definition });
  }

  return output;
}

function inferTags(
  explicitTags: string[] | undefined,
  fallbackText: string,
  locale: SupportedLocale
): string[] {
  const fromExplicit = dedupe(explicitTags ?? []).slice(0, 6);
  if (fromExplicit.length > 0) {
    return fromExplicit;
  }

  const inferred: string[] = [];
  for (const item of TECH_KEYWORDS) {
    if (item.pattern.test(fallbackText)) {
      inferred.push(item.label);
    }
    if (inferred.length >= 3) {
      break;
    }
  }

  const deduped = dedupe(inferred);
  if (deduped.length > 0) {
    return deduped;
  }

  return [getAdapterDefaults(locale).generalTag];
}

function toLines(text: string): string[] {
  return dedupe(
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((line) => line.length > 0)
  );
}

function toIsoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function toRangeLabel(
  rangeStart: number,
  rangeEnd: number,
  locale: SupportedLocale
): string {
  const dateLocale = getLocaleDateTag(locale);
  const start = new Date(rangeStart).toLocaleDateString(dateLocale, {
    month: "2-digit",
    day: "2-digit",
  });
  const end = new Date(rangeEnd).toLocaleDateString(dateLocale, {
    month: "2-digit",
    day: "2-digit",
  });
  return `${start} - ${end}`;
}

function isConversationSummaryV2Current(value: unknown): value is ConversationSummaryV2 {
  if (!value || typeof value !== "object") return false;
  const row = value as { core_question?: unknown; thinking_journey?: unknown };
  return typeof row.core_question === "string" && Array.isArray(row.thinking_journey);
}

function isConversationSummaryV2Legacy(value: unknown): value is ConversationSummaryV2Legacy {
  if (!value || typeof value !== "object") return false;
  const row = value as {
    core_question?: unknown;
    thinking_journey?: unknown;
    key_insights?: unknown;
  };
  return (
    typeof row.core_question === "string" &&
    !Array.isArray(row.thinking_journey) &&
    !!row.thinking_journey &&
    Array.isArray(row.key_insights)
  );
}

function isConversationSummaryV1(value: unknown): value is ConversationSummaryV1 {
  if (!value || typeof value !== "object") return false;
  return "topic_title" in value && "key_takeaways" in value;
}

function isWeeklyLiteReportV1(value: unknown): value is WeeklyLiteReportV1 {
  if (!value || typeof value !== "object") return false;
  return "time_range" in value && "highlights" in value;
}

function isWeeklyReportV1(value: unknown): value is WeeklyReportV1 {
  if (!value || typeof value !== "object") return false;
  return "period_title" in value && "main_themes" in value;
}

function isWeeklyRecapV1(value: unknown): value is WeeklyRecapV1 {
  if (!value || typeof value !== "object") return false;
  return "greeting" in value && "stats" in value && "persona_tag" in value;
}

/**
 * Detect whether a stored weekly report is a weekly_recap.v1 (Plan B recap).
 * Checks the schemaVersion first, then structurally falls back to "greeting".
 */
export function isWeeklyRecapReport(report: WeeklyReportRecord): boolean {
  if (report.schemaVersion === "weekly_recap.v1") return true;
  return isWeeklyRecapV1(report.structured);
}

function inferUnresolved(lines: string[]): string[] {
  return lines
    .filter((line) => /unresolved|open|pending|risk|unknown|todo|block/i.test(line))
    .slice(0, 4);
}

function normalizeCrossDomainEchoes(value: unknown): WeeklyCrossDomainEcho[] {
  if (!Array.isArray(value)) return [];

  const output: WeeklyCrossDomainEcho[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      domain_a?: unknown;
      domain_b?: unknown;
      shared_logic?: unknown;
      evidence_ids?: unknown;
    };

    const domainA = normalizeText(String(row.domain_a ?? ""));
    const domainB = normalizeText(String(row.domain_b ?? ""));
    const sharedLogic = normalizeText(String(row.shared_logic ?? ""));
    if (!domainA || !domainB || !sharedLogic) continue;

    const evidenceIds = Array.isArray(row.evidence_ids)
      ? row.evidence_ids
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0)
          .slice(0, 8)
      : [];

    output.push({
      domain_a: domainA,
      domain_b: domainB,
      shared_logic: sharedLogic,
      evidence_ids: evidenceIds,
    });
  }

  return output.slice(0, 4);
}

function toJourneyFromV2(
  steps: ConversationSummaryV2["thinking_journey"]
): ChatSummaryData["thinking_journey"] {
  const normalized = steps
    .map((step, index) => {
      const speaker: "User" | "AI" = step.speaker === "AI" ? "AI" : "User";
      return {
        step: Number.isFinite(step.step) ? Math.max(1, Math.floor(step.step)) : index + 1,
        speaker,
        assertion: normalizeText(step.assertion),
        real_world_anchor: step.real_world_anchor ? normalizeText(step.real_world_anchor) : null,
      };
    })
    .filter((step) => step.assertion.length > 0)
    .sort((left, right) => left.step - right.step);

  return dedupeJourney(normalized).slice(0, 10);
}

function normalizeDepthLevel(value: unknown): "superficial" | "moderate" | "deep" {
  if (value === "deep" || value === "moderate" || value === "superficial") {
    return value;
  }
  return "moderate";
}

function toInsightObjects(
  insights: ConversationSummaryV2["key_insights"]
): ChatSummaryData["key_insights"] {
  return dedupeInsights(
    insights.map((item) => ({
      term: normalizeText(item.term),
      definition: normalizeText(item.definition),
    }))
  ).slice(0, 8);
}

function toChatSummaryDataFromV2(
  summary: SummaryRecord,
  structured: ConversationSummaryV2,
  locale: SupportedLocale,
  options?: { conversationTitle?: string }
): ChatSummaryData {
  const defaults = getAdapterDefaults(locale);
  const safeJourney = Array.isArray(structured.thinking_journey)
    ? structured.thinking_journey
    : [];
  const safeInsights = Array.isArray(structured.key_insights)
    ? structured.key_insights
    : [];
  const safeUnresolved = Array.isArray(structured.unresolved_threads)
    ? structured.unresolved_threads
    : [];
  const safeNextSteps = Array.isArray(structured.actionable_next_steps)
    ? structured.actionable_next_steps
    : [];
  const safeMeta =
    structured.meta_observations && typeof structured.meta_observations === "object"
      ? structured.meta_observations
      : {
          thinking_style: "",
          emotional_tone: "",
          depth_level: "moderate" as const,
        };

  const insightText = safeInsights
    .map((item) => `${item.term}\n${item.definition}`)
    .join("\n");

  return {
    meta: {
      title: options?.conversationTitle ?? structured.core_question,
      generated_at: toIsoTime(summary.createdAt),
      tags: inferTags([], `${structured.core_question}\n${insightText}`, locale),
      fallback: summary.status === "fallback",
    },
    core_question: normalizeText(structured.core_question),
    thinking_journey: toJourneyFromV2(safeJourney),
    key_insights: toInsightObjects(safeInsights),
    unresolved_threads: dedupeNarrative(safeUnresolved, 6),
    meta_observations: {
      thinking_style:
        normalizeText(String(safeMeta.thinking_style ?? "")) ||
        defaults.thinkingStyle,
      emotional_tone:
        normalizeText(String(safeMeta.emotional_tone ?? "")) ||
        defaults.emotionalTone,
      depth_level: normalizeDepthLevel(safeMeta.depth_level),
    },
    actionable_next_steps: dedupeNarrative(safeNextSteps, 6),
    plain_text: summary.content,
  };
}

export function toChatSummaryData(
  summary: SummaryRecord,
  options?: { conversationTitle?: string; locale?: SupportedLocale }
): ChatSummaryData {
  const locale = options?.locale ?? "en";
  const defaults = getAdapterDefaults(locale);
  const fallbackLines = toLines(summary.content);
  const structured = summary.structured;

  if (isConversationSummaryV2Current(structured)) {
    return toChatSummaryDataFromV2(summary, structured, locale, options);
  }

  if (isConversationSummaryV2Legacy(structured)) {
    return toChatSummaryDataFromV2(
      summary,
      normalizeConversationSummaryV2Legacy(structured),
      locale,
      options
    );
  }

  if (isConversationSummaryV1(structured)) {
    const keyInsights = dedupe(structured.key_takeaways).slice(0, 6);
    const actionItems = dedupe(structured.action_items ?? []).slice(0, 6);
    const linesSource = [...keyInsights, ...actionItems];

    const thinkingJourney = dedupeJourney([
      {
        step: 1,
        speaker: "User",
        assertion: defaults.v1OpeningAssertion,
        real_world_anchor: null,
      },
      ...linesSource.slice(0, 5).map((line, index) => {
        const speaker: "User" | "AI" = index % 2 === 0 ? "AI" : "User";
        return {
          step: index + 2,
          speaker,
          assertion: line,
          real_world_anchor: null,
        };
      }),
    ]).slice(0, 8);

    return {
      meta: {
        title: options?.conversationTitle ?? structured.topic_title,
        generated_at: toIsoTime(summary.createdAt),
        tags: inferTags(
          structured.tech_stack_detected,
          `${structured.topic_title}\n${keyInsights.join("\n")}`,
          locale
        ),
        fallback: summary.status === "fallback",
      },
      core_question: options?.conversationTitle ?? structured.topic_title,
      thinking_journey: thinkingJourney,
      key_insights: keyInsights.map((item, index) => ({
        term: insightTermLabel(locale, index + 1),
        definition: item,
      })),
      unresolved_threads: inferUnresolved(linesSource),
      meta_observations: {
        thinking_style: defaults.v1ThinkingStyle,
        emotional_tone: defaults.v1EmotionalTone,
        depth_level: "moderate",
      },
      actionable_next_steps: actionItems,
      plain_text: summary.content,
    };
  }

  const firstLine =
    fallbackLines[0] ?? options?.conversationTitle ?? defaults.conversationSummaryTitle;
  const secondLine =
    fallbackLines[1] ?? fallbackLines[0] ?? defaults.noStableConclusion;

  return {
    meta: {
      title: options?.conversationTitle ?? firstLine,
      generated_at: toIsoTime(summary.createdAt),
      tags: inferTags([], summary.content, locale),
      fallback: true,
    },
    core_question: options?.conversationTitle
      ? defaults.coreQuestionPrefix(options.conversationTitle)
      : firstLine,
    thinking_journey: [
      {
        step: 1,
        speaker: "User",
        assertion: firstLine,
        real_world_anchor: null,
      },
      {
        step: 2,
        speaker: "AI",
        assertion: secondLine,
        real_world_anchor: null,
      },
    ],
    key_insights: fallbackLines.slice(0, 5).map((line, index) => ({
      term: insightTermLabel(locale, index + 1),
      definition: line,
    })),
    unresolved_threads: inferUnresolved(fallbackLines),
    meta_observations: {
      thinking_style: defaults.sparseThinkingStyle,
      emotional_tone: defaults.sparseEmotionalTone,
      depth_level: "superficial",
    },
    actionable_next_steps: fallbackLines
      .filter((line) => /next|todo|action|follow-up/i.test(line))
      .slice(0, 4),
    plain_text: summary.content,
  };
}

export function toWeeklySummaryData(
  report: WeeklyReportRecord,
  locale: SupportedLocale = "en"
): WeeklySummaryData {
  const fallbackLines = toLines(report.content);
  const rangeLabel = toRangeLabel(report.rangeStart, report.rangeEnd, locale);
  const structured = report.structured;

  if (isWeeklyLiteReportV1(structured)) {
    const crossDomainEchoes = normalizeCrossDomainEchoes(
      (structured as unknown as { cross_domain_echoes?: unknown }).cross_domain_echoes
    );
    const highlights = normalizeWeeklyNarrativeList(
      "highlights",
      structured.highlights,
      6
    );
    const recurring = normalizeWeeklyNarrativeList(
      "recurring_questions",
      structured.recurring_questions,
      4
    );
    const unresolved = normalizeWeeklyNarrativeList(
      "unresolved_threads",
      structured.unresolved_threads,
      6
    );
    const suggested = normalizeWeeklyNarrativeList(
      "suggested_focus",
      structured.suggested_focus,
      6
    );
    const suggestedFocus = suggested;

    return {
      meta: {
        title: `Weekly Lite ${rangeLabel}`,
        generated_at: toIsoTime(report.createdAt),
        tags: inferTags([], `${structured.highlights.join("\n")}\n${structured.suggested_focus.join("\n")}`, locale),
        fallback: report.status === "fallback",
        range_label: rangeLabel,
      },
      highlights:
        highlights.length > 0
          ? highlights
          : dedupe(structured.highlights).slice(0, 1),
      recurring_questions: recurring,
      cross_domain_echoes: crossDomainEchoes,
      unresolved_threads: unresolved,
      suggested_focus: suggestedFocus,
      evidence: (structured.evidence || []).slice(0, 8),
      insufficient_data: structured.insufficient_data,
      plain_text: report.content,
    };
  }

  if (isWeeklyReportV1(structured)) {
    const themes = dedupe(structured.main_themes).slice(0, 6);
    const keyInsights = dedupe(structured.key_takeaways).slice(0, 8);
    const highlights = normalizeWeeklyNarrativeList(
      "highlights",
      keyInsights.length ? keyInsights : themes,
      6
    );
    const actionItems = dedupeNarrative(structured.action_items ?? [], 6);
    const unresolved = dedupeNarrative(
      inferUnresolved([...themes, ...keyInsights]),
      6
    );
    const suggestedFocus =
      actionItems.length > 0
        ? actionItems
        : [defaultWeeklySuggestedFocus(locale)];

    return {
      meta: {
        title: structured.period_title || `Weekly Summary ${rangeLabel}`,
        generated_at: toIsoTime(report.createdAt),
        tags: inferTags(
          structured.tech_stack_detected,
          `${structured.period_title}\n${themes.join("\n")}\n${keyInsights.join("\n")}`,
          locale
        ),
        fallback: report.status === "fallback",
        range_label: rangeLabel,
      },
      highlights:
        highlights.length > 0
          ? highlights
          : [
              keyInsights[0] ??
                themes[0] ??
                getAdapterDefaults(locale).weeklyFallbackHighlight,
            ],
      recurring_questions: [],
      cross_domain_echoes: [],
      unresolved_threads: unresolved,
      suggested_focus: suggestedFocus,
      evidence: [],
      insufficient_data: false,
      plain_text: report.content,
    };
  }

  const highlights = fallbackLines.slice(0, 5);
  const filteredFallbackHighlights = dedupeNarrative(highlights, 5);
  const fallbackRecurring = dedupeNarrative(
    fallbackLines.filter((line) => /repeat|recurr|question|why|how/i.test(line)).slice(0, 3),
    3
  );

  return {
    meta: {
      title: `Weekly Lite ${rangeLabel}`,
      generated_at: toIsoTime(report.createdAt),
      tags: inferTags([], report.content, locale),
      fallback: true,
      range_label: rangeLabel,
    },
    highlights:
      filteredFallbackHighlights.length > 0
        ? filteredFallbackHighlights
        : highlights.slice(0, 1),
    recurring_questions: fallbackRecurring,
    cross_domain_echoes: [],
    unresolved_threads: dedupeNarrative(inferUnresolved(fallbackLines), 6),
    suggested_focus: [],
    evidence: [],
    insufficient_data: true,
    plain_text: report.content,
  };
}

/**
 * Adapt a stored weekly_recap.v1 report into presentation data. Returns null
 * when the report is not a recap (caller should fall back to the digest path).
 */
export function toWeeklyRecapData(
  report: WeeklyReportRecord,
  locale: SupportedLocale = "en"
): WeeklyRecapData | null {
  const structured = report.structured;
  if (!isWeeklyRecapV1(structured)) {
    return null;
  }

  const rangeLabel = toRangeLabel(report.rangeStart, report.rangeEnd, locale);

  const greeting = normalizeText(structured.greeting);
  const personaTag = normalizeText(structured.persona_tag);
  const moodEmoji = normalizeText(structured.mood_emoji) || "✨";
  const narrative = Array.isArray(structured.narrative)
    ? structured.narrative
        .map((paragraph) => normalizeText(paragraph))
        .filter((paragraph) => paragraph.length > 0)
    : [];

  const highlight =
    structured.highlight &&
    normalizeText(structured.highlight.title) &&
    normalizeText(structured.highlight.detail)
      ? {
          title: normalizeText(structured.highlight.title),
          detail: normalizeText(structured.highlight.detail),
        }
      : null;

  const delta = structured.stats.week_over_week_delta;

  return {
    meta: {
      title: `Weekly Recap ${rangeLabel}`,
      generated_at: toIsoTime(report.createdAt),
      tags: inferTags([], `${greeting}\n${narrative.join("\n")}`, locale),
      fallback: report.status === "fallback",
      range_label: rangeLabel,
    },
    greeting,
    persona_tag: personaTag,
    mood_emoji: moodEmoji,
    stats: {
      conversation_count: Math.max(0, Math.floor(structured.stats.conversation_count)),
      active_days: Math.max(0, Math.floor(structured.stats.active_days)),
      streak_weeks: Math.max(0, Math.floor(structured.stats.streak_weeks)),
      top_platform: normalizeText(structured.stats.top_platform) || "—",
      week_over_week_delta:
        typeof delta === "number" && Number.isFinite(delta) ? Math.trunc(delta) : null,
    },
    highlight,
    narrative,
    plain_text: report.content,
  };
}
