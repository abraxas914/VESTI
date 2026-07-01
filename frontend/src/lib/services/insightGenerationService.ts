import type {
  Conversation,
  ConversationSummaryV1,
  ConversationSummaryV2,
  ConversationSummaryV2Legacy,
  InsightFormat,
  InsightStatus,
  LlmConfig,
  Message,
  SummaryRecord,
  WeeklyLiteReportV1,
  WeeklyRecapV1,
  WeeklyReportRecord,
  WeeklyReportV1,
} from "../types";
import type {
  InsightPipelineProgressPayload,
  InsightPipelineRoute,
  InsightPipelineScope,
  InsightPipelineStage,
  InsightPipelineStatus,
} from "../messaging/protocol";
import {
  getConversationById,
  getSummary,
  getTopics,
  getWeeklyReport,
  listConversationsByRange,
  listMessages,
  saveSummary,
  saveWeeklyReport,
} from "../db/repository";
import { getPrompt } from "../prompts";
import type { WeeklyRecapPromptPayload } from "../prompts/types";
import {
  buildWeeklySourceHash,
  callInference,
  sanitizeSummaryText,
  truncateForContext,
} from "./llmService";
import {
  insightSchemaHints,
  normalizeConversationSummaryV2Legacy,
  normalizeWeeklyLiteReport,
  normalizeWeeklyRecap,
  parseConversationSummaryObject,
  parseConversationSummaryV2Object,
  parseJsonObjectFromText,
  parseWeeklyLiteReportObject,
  parseWeeklyRecapObject,
  parseWeeklyReportObject,
  validateWeeklySemanticQuality,
} from "./insightSchemas";
import {
  computeWeeklyStats,
  rankHighlightCandidates,
  type WeeklyStats,
} from "./weeklyStats";
import type { WeeklySemanticIssueCode } from "./insightSchemas";
import { logger } from "../utils/logger";
import { getLanguageSettings } from "./languageSettingsService";
import { getLocaleDateTag, getLlmLanguageName, type SupportedLocale } from "../i18n/locales";
import { getEffectiveModelId, getLlmAccessMode } from "./llmConfig";
import {
  getConversationCaptureFreshnessAt,
  getConversationOriginAt,
} from "../conversations/timestamps";
import {
  createPromptReadyConversationContext,
  type PromptReadyMessage,
} from "../prompts/promptIngestionAdapter";

const SUMMARY_MAX_CHARS = 12000;
const WEEKLY_MAX_CHARS = 12000;
const SUMMARY_PIPELINE_TIME_BUDGET_MS = 45000;
const SUMMARY_COMPACTION_SKIP_MAX_MESSAGES = 14;
const SUMMARY_COMPACTION_SKIP_MAX_CHARS = 3600;
const SUMMARY_LOCAL_SYNTHESIS_MAX_JOURNEY = 6;
const SUMMARY_LOCAL_SYNTHESIS_MAX_ITEMS = 4;
const WEEKLY_DEFAULT_INPUT_LIMIT = 8;
const WEEKLY_CANDIDATE_LIMIT = 10;
const WEEKLY_AUTO_SUMMARY_MAX_ATTEMPTS = 4;
const WEEKLY_AUTO_SUMMARY_CONCURRENCY = 2;
const WEEKLY_SEMANTIC_REPAIR_MAX_ATTEMPTS = 2;
const SUMMARY_REFERENCE_MAX_CHARS = 240;
const COMPACTION_OUTPUT_MIN_CHARS = 24;
const SUMMARY_DENSITY_MIN_ITEMS = 2;
const SUMMARY_DENSITY_MIN_JOURNEY_STEPS = 4;
const SUMMARY_DENSITY_MIN_KEY_INSIGHTS = 3;
const SUMMARY_DENSITY_MIN_MESSAGES = 8;
const SUMMARY_DENSITY_EVIDENCE_SCORE_THRESHOLD = 2;

type PromptType = "compaction" | "conversationSummary" | "weeklyDigest";
type GenerationMode = "plain_text" | "json_mode" | "prompt_json" | "fallback_text";
type SummarySchemaVersion = "conversation_summary.v1" | "conversation_summary.v2";
type WeeklySchemaVersion = "weekly_report.v1" | "weekly_lite.v1";
type SummaryStructured = ConversationSummaryV1 | ConversationSummaryV2;
type WeeklyStructured = WeeklyReportV1 | WeeklyLiteReportV1;
type SummaryPath = "compacted" | "direct";
type WeeklyRangeModeLog = "last_7_days" | "last_full_week" | "custom";

interface ParseResult<T, TVersion extends string> {
  data: T | null;
  errors: string[];
  parseErrorCodes?: string[];
  schemaVersion?: TVersion;
}

interface StructuredGenerationResult<T, TVersion extends string> {
  promptType: PromptType;
  promptVersion: string;
  structured: T | null;
  content: string;
  format: InsightFormat;
  status: InsightStatus;
  schemaVersion?: TVersion;
  mode: GenerationMode;
  attempt: number;
  validationErrors: string[];
  fallbackStage?: "none" | "repair_json" | "fallback_text";
  compactionUsed?: boolean;
  compactionFailed?: boolean;
  compactionCharsIn?: number;
  compactionCharsOut?: number;
  summaryPath?: SummaryPath;
  densityGateTriggered?: boolean;
  densityGatePassed?: boolean;
  densityGateDegraded?: boolean;
  unresolvedCount?: number;
  nextStepsCount?: number;
  evidenceScore?: number;
  weeklySub3Triggered?: boolean;
  weeklySubstantiveCount?: number;
  weeklyStructuredCount?: number;
  weeklyInputMode?: "summary_v2_only";
  weeklySemanticGatePassed?: boolean;
  weeklySemanticIssueCodes?: WeeklySemanticIssueCode[];
  weeklySemanticHardIssueCodes?: WeeklySemanticIssueCode[];
  weeklySemanticWarningIssueCodes?: WeeklySemanticIssueCode[];
  weeklySemanticRepairAttempt?: number;
  weeklyDegradedToInsufficient?: boolean;
  weeklyHighlightsAfterFilter?: number;
  weeklyRecurringAfterFilter?: number;
  summaryLocalSynthesisUsed?: boolean;
  summaryJsonRecoveredFromReasoning?: boolean;
  summaryLlmCallCount?: number;
  summaryParseErrorCodes?: string[];
  summaryCompactionSkipped?: boolean;
  summaryTotalLatencyMs?: number;
}

interface PromptUsageLog {
  promptType: PromptType;
  promptVersion: string;
  mode: GenerationMode;
  attempt: number;
  validationErrors: string[];
  schemaVersion?: string;
  inputCount?: number;
  format?: InsightFormat;
  status?: InsightStatus;
  route?: "proxy" | "modelscope";
  fallbackStage?: "none" | "repair_json" | "fallback_text";
  compactionUsed?: boolean;
  compactionFailed?: boolean;
  compactionCharsIn?: number;
  compactionCharsOut?: number;
  summaryPath?: SummaryPath;
  densityGateTriggered?: boolean;
  densityGatePassed?: boolean;
  densityGateDegraded?: boolean;
  unresolvedCount?: number;
  nextStepsCount?: number;
  evidenceScore?: number;
  weeklySub3Triggered?: boolean;
  weeklySubstantiveCount?: number;
  weeklyStructuredCount?: number;
  weeklyInputMode?: "summary_v2_only";
  weeklySemanticGatePassed?: boolean;
  weeklySemanticIssueCodes?: WeeklySemanticIssueCode[];
  weeklySemanticHardIssueCodes?: WeeklySemanticIssueCode[];
  weeklySemanticWarningIssueCodes?: WeeklySemanticIssueCode[];
  weeklySemanticRepairAttempt?: number;
  weeklyDegradedToInsufficient?: boolean;
  weeklyHighlightsAfterFilter?: number;
  weeklyRecurringAfterFilter?: number;
  summaryLocalSynthesisUsed?: boolean;
  summaryJsonRecoveredFromReasoning?: boolean;
  summaryLlmCallCount?: number;
  summaryParseErrorCodes?: string[];
  summaryCompactionSkipped?: boolean;
  summaryTotalLatencyMs?: number;
  latencyMs: number;
  success: boolean;
}

interface SummaryDensityValidation {
  triggered: boolean;
  passed: boolean;
  degraded: boolean;
  unresolvedCount: number;
  nextStepsCount: number;
  evidenceScore: number;
  errors: string[];
}

interface SummaryGenerationHooks {
  onStage?: (stage: "distilling_core_logic" | "curating_summary") => void;
}

interface WeeklyGenerationHooks {
  onStage?: (stage: "aggregating_weekly_digest") => void;
}

interface PipelineProgressEmitter {
  emit: (
    stage: InsightPipelineStage,
    status: InsightPipelineStatus,
    meta?: {
      attempt?: number;
      promptVersion?: string;
    }
  ) => void;
}

function resolvePipelineRoute(settings: LlmConfig): InsightPipelineRoute {
  return getLlmAccessMode(settings) === "demo_proxy" ? "proxy" : "modelscope";
}

function createPipelineProgressEmitter(params: {
  scope: InsightPipelineScope;
  targetId: string;
  route: InsightPipelineRoute;
  modelId: string;
  promptVersion: string;
}): PipelineProgressEmitter {
  const startedAt = Date.now();
  const pipelineId = `${params.scope}:${params.targetId}:${startedAt.toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  let seq = 0;

  const send = (payload: InsightPipelineProgressPayload) => {
    if (typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) return;

    try {
      chrome.runtime.sendMessage(
        {
          type: "INSIGHT_PIPELINE_PROGRESS",
          payload,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (error) {
      logger.warn("service", "Failed to emit pipeline progress event", {
        pipelineId: payload.pipelineId,
        stage: payload.stage,
        error: (error as Error).message || "UNKNOWN_ERROR",
      });
    }
  };

  return {
    emit(stage, status, meta) {
      seq += 1;
      send({
        pipelineId,
        scope: params.scope,
        targetId: params.targetId,
        stage,
        status,
        attempt: meta?.attempt ?? 1,
        startedAt,
        updatedAt: Date.now(),
        route: params.route,
        modelId: params.modelId,
        promptVersion: meta?.promptVersion ?? params.promptVersion,
        seq,
      });
    },
  };
}

function logPromptUsage(entry: PromptUsageLog): void {
  const message = entry.success
    ? "Prompt usage"
    : "Prompt usage (fallback or validation issue)";

  if (entry.success) {
    logger.info("service", message, entry);
    return;
  }

  logger.warn("service", message, entry);
}

function renderSummaryTextV1(
  summary: ConversationSummaryV1,
  locale: SupportedLocale
): string {
  const lines = [summary.topic_title, ...summary.key_takeaways];
  if (summary.action_items?.length) {
    lines.push(
      locale === "ko"
        ? "실행 항목:"
        : locale === "ja"
          ? "アクション項目："
          : locale === "zh"
            ? "行动项："
            : "Action Items:",
      ...summary.action_items
    );
  }
  return sanitizeSummaryText(lines.join("\n"));
}

function renderSummaryTextV2(
  summary: ConversationSummaryV2,
  locale: SupportedLocale
): string {
  const labels =
    locale === "ko"
      ? {
          deep: "깊이 있는 탐구",
          moderate: "단계적 분석",
          light: "가벼운 확인",
          coreQuestion: "핵심 질문",
          thinkingJourney: "사고의 흐름:",
          realWorldAnchor: "현실의 단서",
          keyInsights: "핵심 인사이트:",
          unresolved: "미해결 논점:",
          nextSteps: "다음 단계:",
          thinkingStyle: "사고 방식",
          emotionalTone: "감정의 톤",
          depthLevel: "깊이 수준",
        }
      : locale === "ja"
      ? {
          deep: "深い掘り下げ",
          moderate: "段階的な分析",
          light: "軽い確認",
          coreQuestion: "核心的な問い",
          thinkingJourney: "思考の流れ：",
          realWorldAnchor: "現実の手がかり",
          keyInsights: "重要なインサイト：",
          unresolved: "未解決の論点：",
          nextSteps: "次のステップ：",
          thinkingStyle: "思考スタイル",
          emotionalTone: "感情のトーン",
          depthLevel: "深さのレベル",
        }
      : locale === "zh"
        ? {
            deep: "深度探讨",
            moderate: "逐步分析",
            light: "轻量浏览",
            coreQuestion: "核心问题",
            thinkingJourney: "思考历程：",
            realWorldAnchor: "现实锚点",
            keyInsights: "关键洞察：",
            unresolved: "未决议题：",
            nextSteps: "下一步：",
            thinkingStyle: "思考风格",
            emotionalTone: "情绪基调",
            depthLevel: "深度级别",
          }
        : {
            deep: "Deep dive",
            moderate: "Stepwise analysis",
            light: "Light scan",
            coreQuestion: "Core question",
            thinkingJourney: "Thinking journey:",
            realWorldAnchor: "Real-world anchor",
            keyInsights: "Key insights:",
            unresolved: "Unresolved threads:",
            nextSteps: "Next steps:",
            thinkingStyle: "Thinking style",
            emotionalTone: "Emotional tone",
            depthLevel: "Depth level",
          };

  const depthLabel =
    summary.meta_observations.depth_level === "deep"
      ? labels.deep
      : summary.meta_observations.depth_level === "moderate"
        ? labels.moderate
        : labels.light;

  const lines = [`${labels.coreQuestion}: ${summary.core_question}`, labels.thinkingJourney];

  for (const step of summary.thinking_journey) {
    lines.push(`${step.step}. [${step.speaker}] ${step.assertion}`);
    if (step.real_world_anchor) {
      lines.push(`   ${labels.realWorldAnchor}: ${step.real_world_anchor}`);
    }
  }

  lines.push(labels.keyInsights);
  for (const [index, insight] of summary.key_insights.entries()) {
    lines.push(`${index + 1}. ${insight.term}: ${insight.definition}`);
  }

  if (summary.unresolved_threads.length) {
    lines.push(
      labels.unresolved,
      ...summary.unresolved_threads.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  if (summary.actionable_next_steps.length) {
    lines.push(
      labels.nextSteps,
      ...summary.actionable_next_steps.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  lines.push(
    `${labels.thinkingStyle}: ${summary.meta_observations.thinking_style}`,
    `${labels.emotionalTone}: ${summary.meta_observations.emotional_tone}`,
    `${labels.depthLevel}: ${depthLabel}`
  );

  return sanitizeSummaryText(lines.join("\n"));
}

function renderSummaryText(
  summary: SummaryStructured,
  schemaVersion: SummarySchemaVersion,
  locale: SupportedLocale
): string {
  if (schemaVersion === "conversation_summary.v2") {
    return renderSummaryTextV2(summary as ConversationSummaryV2, locale);
  }
  return renderSummaryTextV1(summary as ConversationSummaryV1, locale);
}

function renderWeeklyTextV1(
  report: WeeklyReportV1,
  locale: SupportedLocale
): string {
  const lines = [report.period_title, ...report.main_themes, ...report.key_takeaways];
  if (report.action_items?.length) {
    lines.push(
      locale === "ko"
        ? "실행 항목:"
        : locale === "ja"
          ? "アクション項目："
          : locale === "zh"
            ? "行动项："
            : "Action Items:",
      ...report.action_items
    );
  }
  return sanitizeSummaryText(lines.join("\n"));
}

function renderWeeklyTextLite(
  report: WeeklyLiteReportV1,
  locale: SupportedLocale
): string {
  const labels =
    locale === "ko"
      ? {
          timeRange: "기간",
          sampledThreads: "표본 대화 수",
          highlight: "하이라이트",
          recurring: "반복해서 나타난 질문:",
          crossDomain: "영역을 넘나든 공통점:",
          unresolved: "미해결 논점:",
          suggestedFocus: "추천 집중 포인트:",
          note: "참고: 이번 주는 표본이 제한적이라 다이제스트를 가볍게 정리했습니다.",
        }
      : locale === "ja"
      ? {
          timeRange: "対象期間",
          sampledThreads: "サンプル対話数",
          highlight: "ハイライト",
          recurring: "繰り返し現れた問い：",
          crossDomain: "領域をまたぐ共通点：",
          unresolved: "未解決の論点：",
          suggestedFocus: "おすすめの注力ポイント：",
          note: "補足：今週はサンプルが限られているため、ダイジェストは軽めにまとめています。",
        }
      : locale === "zh"
        ? {
            timeRange: "时间范围",
            sampledThreads: "采样对话数",
            highlight: "亮点",
            recurring: "反复出现的问题：",
            crossDomain: "跨领域呼应：",
            unresolved: "未决议题：",
            suggestedFocus: "建议聚焦：",
            note: "说明：本周样本有限，因此周报只做了轻量整理。",
          }
        : {
            timeRange: "Time range",
            sampledThreads: "Sampled threads",
            highlight: "Highlight",
            recurring: "Recurring questions:",
            crossDomain: "Cross-domain echoes:",
            unresolved: "Unresolved threads:",
            suggestedFocus: "Suggested focus:",
            note: "Note: this week has limited samples, so the digest stays lightweight.",
          };

  const lines = [
    `${labels.timeRange}: ${report.time_range.start} ~ ${report.time_range.end}`,
    `${labels.sampledThreads}: ${report.time_range.total_conversations}`,
    ...report.highlights.map((item, index) => `${labels.highlight} ${index + 1}: ${item}`),
  ];

  if (report.recurring_questions.length) {
    lines.push(
      labels.recurring,
      ...report.recurring_questions.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  if (report.cross_domain_echoes.length) {
    lines.push(labels.crossDomain);
    report.cross_domain_echoes.forEach((echo, index) => {
      lines.push(
        `${index + 1}. ${echo.domain_a} <-> ${echo.domain_b}: ${echo.shared_logic}`
      );
    });
  }

  if (report.unresolved_threads.length) {
    lines.push(
      labels.unresolved,
      ...report.unresolved_threads.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  if (report.suggested_focus.length) {
    lines.push(
      labels.suggestedFocus,
      ...report.suggested_focus.map((item, index) => `${index + 1}. ${item}`)
    );
  }

  if (report.insufficient_data) {
    lines.push(labels.note);
  }

  return sanitizeSummaryText(lines.join("\n"));
}

function renderWeeklyText(
  report: WeeklyStructured,
  schemaVersion: WeeklySchemaVersion,
  locale: SupportedLocale
): string {
  if (schemaVersion === "weekly_lite.v1") {
    return renderWeeklyTextLite(report as WeeklyLiteReportV1, locale);
  }
  return renderWeeklyTextV1(report as WeeklyReportV1, locale);
}

function formatRangeLabel(
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

function buildRepairPrompt(
  kind: "summary" | "weekly",
  rawOutput: string,
  validationErrors: string[]
): string {
  const schemaHint =
    kind === "summary" ? insightSchemaHints.summary_v2 : insightSchemaHints.weekly_lite;

  return `Fix the output below into a valid JSON object.
Return JSON only. No markdown fences. No \`\`\`json wrapper.

Critical rules:
- speaker must be exactly "User" or "AI"
- real_world_anchor must be null (not "") when no anchor exists
- depth_level must be one of: "superficial", "moderate", "deep"
- All array fields that are missing should be []
- insufficient_data must be a boolean (true/false), not a string

Target schema: ${JSON.stringify(schemaHint)}
Validation errors: ${validationErrors.join("; ") || "JSON parse failed"}

Raw output:
${rawOutput}`;
}

function buildSummaryDensityRepairPrompt(
  summary: ConversationSummaryV2,
  densityValidation: SummaryDensityValidation
): string {
  return `The JSON below is structurally valid but list density is insufficient.
Return JSON only and keep the exact conversation_summary.v2 schema.

Constraints:
1) Do not invent facts outside the available evidence.
2) Keep unresolved_threads and actionable_next_steps as complete phrases.
3) If evidence is sufficient, target 2-4 items for both unresolved_threads and actionable_next_steps.
4) If evidence is genuinely sparse, keep minimal items but avoid fragments.

Current density signals:
- evidence_score: ${densityValidation.evidenceScore}
- unresolved_count: ${densityValidation.unresolvedCount}
- next_steps_count: ${densityValidation.nextStepsCount}
- threshold: unresolved>=${SUMMARY_DENSITY_MIN_ITEMS}, actionable_next_steps>=${SUMMARY_DENSITY_MIN_ITEMS}

Current JSON:
${JSON.stringify(summary)}`;
}

function clipTextWithMarker(text: string, maxChars: number, marker: string): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= marker.length + 1) {
    return text.slice(0, Math.max(0, maxChars));
  }
  return `${text.slice(0, maxChars - marker.length)}${marker}`;
}

function buildWeeklyPromptWithGuardedBudget(basePrompt: string, maxChars: number): string {
  const guardHead = `Hard constraints for weekly_lite.v1:
1) Output one JSON object only.
2) Keep narrative items as complete short sentences.
3) If total_conversations < 3, force insufficient_data=true and keep only one highlight.`;
  const guardTail = `Final checks:
- No evidence-free claims.
- Keep cross_domain_echoes as [] when no real structural echo exists.
- Do not add or remove weekly_lite.v1 fields.`;

  const baseTemplate = `${guardHead}\n\n${basePrompt}\n\n${guardTail}`;
  if (baseTemplate.length <= maxChars) {
    return baseTemplate;
  }

  const separatorLength = 4;
  const bodyBudget = maxChars - guardHead.length - guardTail.length - separatorLength;
  if (bodyBudget <= 0) {
    return truncateForContext(baseTemplate, maxChars);
  }

  const clippedBody = clipTextWithMarker(
    basePrompt,
    bodyBudget,
    "\n[...truncated-input-data...]"
  );
  return `${guardHead}\n\n${clippedBody}\n\n${guardTail}`;
}

function getPreviousNaturalWeekRangeLocal(referenceDate = new Date()): {
  rangeStart: number;
  rangeEnd: number;
} {
  const cursor = new Date(referenceDate);
  const localDay = cursor.getDay();
  const daysSinceMonday = (localDay + 6) % 7;

  const currentWeekMonday = new Date(cursor);
  currentWeekMonday.setHours(0, 0, 0, 0);
  currentWeekMonday.setDate(currentWeekMonday.getDate() - daysSinceMonday);

  const previousWeekMonday = new Date(currentWeekMonday);
  previousWeekMonday.setDate(previousWeekMonday.getDate() - 7);

  const previousWeekSunday = new Date(previousWeekMonday);
  previousWeekSunday.setDate(previousWeekSunday.getDate() + 6);
  previousWeekSunday.setHours(23, 59, 59, 999);

  return {
    rangeStart: previousWeekMonday.getTime(),
    rangeEnd: previousWeekSunday.getTime(),
  };
}

function getLastSevenDaysRangeLocal(referenceDate = new Date()): {
  rangeStart: number;
  rangeEnd: number;
} {
  const end = new Date(referenceDate);
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  return {
    rangeStart: start.getTime(),
    rangeEnd: end.getTime(),
  };
}

function inferWeeklyRangeMode(
  rangeStart: number,
  rangeEnd: number,
  referenceDate = new Date()
): WeeklyRangeModeLog {
  const last7 = getLastSevenDaysRangeLocal(referenceDate);
  if (rangeStart === last7.rangeStart && rangeEnd === last7.rangeEnd) {
    return "last_7_days";
  }

  const lastFullWeek = getPreviousNaturalWeekRangeLocal(referenceDate);
  if (
    rangeStart === lastFullWeek.rangeStart &&
    rangeEnd === lastFullWeek.rangeEnd
  ) {
    return "last_full_week";
  }

  return "custom";
}

function buildWeeklySemanticRepairPrompt(
  report: WeeklyLiteReportV1,
  issueCodes: WeeklySemanticIssueCode[]
): string {
  const issueBlock =
    issueCodes.map((code) => `- ${code}`).join("\n") || "- UNKNOWN_ISSUE";

  return `The weekly_lite.v1 JSON below is parseable, but its semantic quality is not acceptable. Repair it and output exactly one JSON object only.
Issue list:
${issueBlock}

Repair rules:
1) Every item in highlights, recurring_questions, unresolved_threads, and suggested_focus must be a complete readable short sentence. No single-character fragments or broken token stubs.
2) recurring_questions should be phrased as question-like prompts when the evidence supports that interpretation.
3) Every non-trivial claim must be grounded in the provided evidence. Do not invent new facts.
4) Keep the weekly_lite.v1 schema intact. Do not add or remove fields. Use [] for cross_domain_echoes when there is no evidence.
5) If quality still cannot be guaranteed after repair, keep insufficient_data=true and ensure every list except highlights is empty.
Current JSON:
${JSON.stringify(report)}`;
}

function buildWeeklyInsufficientReport(
  rangeStart: number,
  rangeEnd: number,
  totalConversations: number,
  highlight: string
): WeeklyLiteReportV1 {
  return normalizeWeeklyLiteReport({
    time_range: {
      start: new Date(rangeStart).toISOString().slice(0, 10),
      end: new Date(rangeEnd).toISOString().slice(0, 10),
      total_conversations: totalConversations,
    },
    highlights: [highlight],
    recurring_questions: [],
    cross_domain_echoes: [],
    unresolved_threads: [],
    suggested_focus: [],
    evidence: [],
    insufficient_data: true,
  });
}

function isConversationSummaryV2(
  data: SummaryStructured | null,
  schemaVersion?: SummarySchemaVersion
): data is ConversationSummaryV2 {
  return (
    schemaVersion === "conversation_summary.v2" &&
    !!data &&
    typeof data === "object" &&
    "thinking_journey" in data &&
    Array.isArray((data as ConversationSummaryV2).thinking_journey) &&
    "key_insights" in data &&
    Array.isArray((data as ConversationSummaryV2).key_insights) &&
    "unresolved_threads" in data &&
    Array.isArray((data as ConversationSummaryV2).unresolved_threads) &&
    "actionable_next_steps" in data &&
    Array.isArray((data as ConversationSummaryV2).actionable_next_steps)
  );
}

function createDefaultDensityValidation(
  overrides: Partial<SummaryDensityValidation> = {}
): SummaryDensityValidation {
  return {
    triggered: false,
    passed: true,
    degraded: false,
    unresolvedCount: 0,
    nextStepsCount: 0,
    evidenceScore: 0,
    errors: [],
    ...overrides,
  };
}

function validateSummaryDensity(
  summary: SummaryStructured | null,
  schemaVersion: SummarySchemaVersion | undefined,
  messageCount: number
): SummaryDensityValidation {
  if (!isConversationSummaryV2(summary, schemaVersion)) {
    return createDefaultDensityValidation();
  }

  let evidenceScore = 0;
  if (summary.thinking_journey.length >= SUMMARY_DENSITY_MIN_JOURNEY_STEPS) {
    evidenceScore += 1;
  }
  if (summary.key_insights.length >= SUMMARY_DENSITY_MIN_KEY_INSIGHTS) {
    evidenceScore += 1;
  }
  if (messageCount >= SUMMARY_DENSITY_MIN_MESSAGES) {
    evidenceScore += 1;
  }

  const unresolvedCount = summary.unresolved_threads.length;
  const nextStepsCount = summary.actionable_next_steps.length;
  const triggered = evidenceScore >= SUMMARY_DENSITY_EVIDENCE_SCORE_THRESHOLD;

  // Adaptive density: for shorter conversations (< 20 messages) or lower
  // evidence scores, accept 1 item in each list instead of requiring 2.
  // This prevents the density gate from rejecting perfectly valid summaries
  // for simpler/shorter conversations where the LLM correctly identified
  // fewer unresolved threads or next steps.
  const adaptiveMinItems =
    messageCount < 20 || evidenceScore < 3
      ? 1
      : SUMMARY_DENSITY_MIN_ITEMS;

  const passed =
    !triggered ||
    (unresolvedCount >= adaptiveMinItems &&
      nextStepsCount >= adaptiveMinItems);

  return createDefaultDensityValidation({
    triggered,
    passed,
    unresolvedCount,
    nextStepsCount,
    evidenceScore,
    errors: passed ? [] : ["INSUFFICIENT_LIST_DENSITY"],
  });
}

function getSummaryDensityScore(summary: ConversationSummaryV2): number {
  const unresolvedChars = summary.unresolved_threads.reduce(
    (sum, item) => sum + item.trim().length,
    0
  );
  const nextChars = summary.actionable_next_steps.reduce(
    (sum, item) => sum + item.trim().length,
    0
  );
  const itemCount =
    summary.unresolved_threads.length + summary.actionable_next_steps.length;

  return itemCount * 1000 + unresolvedChars + nextChars;
}

function toParsableJsonText(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, " ").trim();
}

function parseSummaryFromRaw(raw: string): ParseResult<SummaryStructured, SummarySchemaVersion> {
  try {
    const parsedJson = parseJsonObjectFromText(toParsableJsonText(raw));

    const v2 = parseConversationSummaryV2Object(parsedJson);
    if (v2.success) {
      return {
        data: v2.data,
        errors: [],
        parseErrorCodes: [],
        schemaVersion: "conversation_summary.v2",
      };
    }
    const v2Errors = v2.success === false ? v2.errors : [];
    const v2ErrorCodes = v2.success === false ? v2.errorCodes : [];

    const v1 = parseConversationSummaryObject(parsedJson);
    if (v1.success) {
      return {
        data: v1.data,
        errors: [],
        parseErrorCodes: v2ErrorCodes,
        schemaVersion: "conversation_summary.v1",
      };
    }
    const v1Errors = v1.success === false ? v1.errors : [];

    return {
      data: null,
      errors: [...v2Errors, ...v1Errors],
      parseErrorCodes: [...new Set([...v2ErrorCodes, "SUMMARY_V1_SCHEMA_MISMATCH"])],
    };
  } catch (error) {
    return {
      data: null,
      errors: [(error as Error).message || "INVALID_JSON_PAYLOAD"],
      parseErrorCodes: ["SUMMARY_JSON_PARSE_FAILED"],
    };
  }
}

function parseWeeklyFromRaw(raw: string): ParseResult<WeeklyStructured, WeeklySchemaVersion> {
  try {
    const parsedJson = parseJsonObjectFromText(toParsableJsonText(raw));

    const lite = parseWeeklyLiteReportObject(parsedJson);
    if (lite.success) {
      return {
        data: lite.data,
        errors: [],
        schemaVersion: "weekly_lite.v1",
      };
    }
    const liteErrors = lite.success === false ? lite.errors : [];

    const legacy = parseWeeklyReportObject(parsedJson);
    if (legacy.success) {
      return {
        data: legacy.data,
        errors: [],
        schemaVersion: "weekly_report.v1",
      };
    }
    const legacyErrors = legacy.success === false ? legacy.errors : [];

    return {
      data: null,
      errors: [...liteErrors, ...legacyErrors],
    };
  } catch (error) {
    return {
      data: null,
      errors: [(error as Error).message || "INVALID_JSON_PAYLOAD"],
    };
  }
}

interface WeeklyGenerationStageResult {
  report: WeeklyLiteReportV1 | null;
  parseErrors: string[];
  issueCodes: WeeklySemanticIssueCode[];
  hardIssueCodes: WeeklySemanticIssueCode[];
  warningIssueCodes: WeeklySemanticIssueCode[];
  semanticPassed: boolean;
}

function evaluateWeeklyStage(
  parsed: ParseResult<WeeklyStructured, WeeklySchemaVersion>
): WeeklyGenerationStageResult {
  if (!parsed.data || !parsed.schemaVersion) {
    return {
      report: null,
      parseErrors: parsed.errors,
      issueCodes: [],
      hardIssueCodes: [],
      warningIssueCodes: [],
      semanticPassed: false,
    };
  }

  if (parsed.schemaVersion !== "weekly_lite.v1") {
    return {
      report: null,
      parseErrors: [...parsed.errors, "WEEKLY_SCHEMA_NOT_LITE"],
      issueCodes: [],
      hardIssueCodes: [],
      warningIssueCodes: [],
      semanticPassed: false,
    };
  }

  const report = normalizeWeeklyLiteReport(parsed.data as WeeklyLiteReportV1);
  const quality = validateWeeklySemanticQuality(report);
  return {
    report,
    parseErrors: parsed.errors,
    issueCodes: quality.issueCodes,
    hardIssueCodes: quality.hardIssueCodes,
    warningIssueCodes: quality.warningIssueCodes,
    semanticPassed: quality.passed,
  };
}

function toWeeklySemanticErrors(issueCodes: WeeklySemanticIssueCode[]): string[] {
  return issueCodes.map((code) => `WEEKLY_SEMANTIC_${code}`);
}

function getWeeklySemanticScore(report: WeeklyLiteReportV1): number {
  const listCounts =
    report.highlights.length +
    report.recurring_questions.length +
    report.unresolved_threads.length +
    report.suggested_focus.length;
  const narrativeChars = [
    ...report.highlights,
    ...report.recurring_questions,
    ...report.unresolved_threads,
    ...report.suggested_focus,
  ].reduce((sum, item) => sum + item.trim().length, 0);

  return (
    listCounts * 1000 +
    narrativeChars +
    report.cross_domain_echoes.length * 200 +
    report.evidence.length * 80
  );
}

interface CompactionExecution {
  used: boolean;
  failed: boolean;
  skipped: boolean;
  content: string;
  charsIn: number;
  charsOut: number;
  llmCallCount: number;
}

function countInputChars(messages: PromptReadyMessage[]): number {
  return messages.reduce((sum, message) => sum + message.bodyText.length, 0);
}

function shouldSkipSummaryCompaction(
  conversation: Conversation,
  messages: PromptReadyMessage[]
): boolean {
  if (conversation.message_count <= SUMMARY_COMPACTION_SKIP_MAX_MESSAGES) {
    return true;
  }
  return countInputChars(messages) <= SUMMARY_COMPACTION_SKIP_MAX_CHARS;
}

function buildSummaryPromptFromCompaction(
  conversation: Conversation,
  compactedContext: string,
  locale: SupportedLocale
): string {
  return `Generate conversation_summary.v2 JSON from the compacted skeleton below.

Conversation title: ${conversation.title}
Platform: ${conversation.platform}
Message count: ${conversation.message_count}
Locale: ${locale}

Compacted skeleton:
${compactedContext}

Constraints:
1) Output JSON object only. No markdown fences. No \`\`\`json wrapper.
2) Do not introduce facts absent from the compacted skeleton.
3) If evidence is missing for a field, use [] or null (not "" empty string).
4) thinking_journey assertion must be 2-3 complete sentences per step.
5) Each assertion should include: why this step appears now + what it opens next.
6) real_world_anchor: use null when no anchor exists (not "").
7) speaker must be exactly "User" or "AI" (case-sensitive).
8) Keep [User]/[AI] speaker ownership aligned with the compacted skeleton.
9) meta_observations should use natural user-facing phrases, not technical labels.
10) depth_level must be one of: "superficial", "moderate", "deep" (lowercase only).
11) unresolved_threads and actionable_next_steps must be complete phrases, not fragments.
12) When evidence is sufficient, target 2-4 items for unresolved_threads and actionable_next_steps; when sparse, 1 item or [] is acceptable.
13) Write all user-facing text values in ${getLlmLanguageName(
    locale
  )}. Keep JSON keys and enum values (speaker, depth_level) in English.`;
}

async function runCompaction(
  settings: LlmConfig,
  conversation: Conversation,
  messages: PromptReadyMessage[],
  transcriptOverride: string,
  locale: SupportedLocale
): Promise<CompactionExecution> {
  const prompt = getPrompt("compaction", { variant: "current" });
  const charsIn = countInputChars(messages);
  const payload = {
    conversationTitle: conversation.title,
    conversationPlatform: conversation.platform,
    conversationOriginAt: getConversationOriginAt(conversation),
    messages,
    transcriptOverride,
    locale,
  };

  const startedAt = Date.now();
  try {
    const compactionPrompt = truncateForContext(
      prompt.userTemplate(payload),
      SUMMARY_MAX_CHARS
    );
    const result = await callInference(settings, compactionPrompt, {
      systemPrompt: prompt.system,
    });
    const content = result.content.trim();
    const charsOut = content.length;

    if (charsOut < COMPACTION_OUTPUT_MIN_CHARS) {
      throw new Error("COMPACTION_OUTPUT_TOO_SHORT");
    }

    logPromptUsage({
      promptType: "compaction",
      promptVersion: prompt.version,
      mode: result.mode,
      attempt: 1,
      validationErrors: [],
      inputCount: messages.length,
      route: result.route,
      fallbackStage: "none",
      compactionUsed: true,
      compactionFailed: false,
      compactionCharsIn: charsIn,
      compactionCharsOut: charsOut,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    return {
      used: true,
      failed: false,
      skipped: false,
      content,
      charsIn,
      charsOut,
      llmCallCount: 1,
    };
  } catch (error) {
    const reason = (error as Error).message || "COMPACTION_FAILED";
    logPromptUsage({
      promptType: "compaction",
      promptVersion: prompt.version,
      mode: "fallback_text",
      attempt: 1,
      validationErrors: [reason],
      inputCount: messages.length,
      fallbackStage: "fallback_text",
      compactionUsed: false,
      compactionFailed: true,
      compactionCharsIn: charsIn,
      compactionCharsOut: 0,
      latencyMs: Date.now() - startedAt,
      success: false,
    });

    return {
      used: false,
      failed: true,
      skipped: false,
      content: "",
      charsIn,
      charsOut: 0,
      llmCallCount: 1,
    };
  }
}

function buildSummaryReference(content: string): string {
  const compact = sanitizeSummaryText(content).replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(summary unavailable)";
  }
  if (compact.length <= SUMMARY_REFERENCE_MAX_CHARS) {
    return compact;
  }
  return `${compact.slice(0, SUMMARY_REFERENCE_MAX_CHARS)}...`;
}

function buildStructuredSummaryReference(
  structured: SummaryRecord["structured"]
): string | null {
  if (!structured || typeof structured !== "object") {
    return null;
  }

  if ("core_question" in structured) {
    const v2 = structured as ConversationSummaryV2;
    const parts: string[] = [];
    if (v2.core_question) {
      parts.push(v2.core_question);
    }
    if (Array.isArray(v2.key_insights) && v2.key_insights.length > 0) {
      parts.push(
        ...v2.key_insights
          .slice(0, 2)
          .map((item) => `${item.term}: ${item.definition}`)
      );
    }
    if (Array.isArray(v2.unresolved_threads) && v2.unresolved_threads.length > 0) {
      parts.push(v2.unresolved_threads[0]);
    }
    const text = parts.join(" ");
    return text ? buildSummaryReference(text) : null;
  }

  if ("topic_title" in structured) {
    const v1 = structured as ConversationSummaryV1;
    const text = [v1.topic_title, ...(v1.key_takeaways || []).slice(0, 2)].join(" ");
    return text ? buildSummaryReference(text) : null;
  }

  return null;
}

function buildWeeklyBridgeReference(summary: ConversationSummaryV2): string {
  return (
    buildStructuredSummaryReference(summary) ??
    buildSummaryReference(summary.core_question || "")
  );
}

function selectWeeklyCandidates(conversations: Conversation[]): Conversation[] {
  const sorted = [...conversations].sort(
    (a, b) => getConversationOriginAt(b) - getConversationOriginAt(a)
  );
  return sorted.slice(0, WEEKLY_CANDIDATE_LIMIT);
}

function isConversationSummaryV2Current(
  value: unknown
): value is ConversationSummaryV2 {
  if (!value || typeof value !== "object") return false;
  const row = value as { core_question?: unknown; thinking_journey?: unknown };
  return (
    typeof row.core_question === "string" && Array.isArray(row.thinking_journey)
  );
}

function isConversationSummaryV2Legacy(
  value: unknown
): value is ConversationSummaryV2Legacy {
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

function toSummaryV2ForWeekly(summaryRecord: SummaryRecord | null): ConversationSummaryV2 | null {
  if (!summaryRecord?.structured) return null;

  if (isConversationSummaryV2Current(summaryRecord.structured)) {
    return summaryRecord.structured;
  }

  if (isConversationSummaryV2Legacy(summaryRecord.structured)) {
    return normalizeConversationSummaryV2Legacy(summaryRecord.structured);
  }

  return null;
}

function isSubstantiveSummary(summary: ConversationSummaryV2): boolean {
  return summary.thinking_journey.length > 0 && summary.key_insights.length > 0;
}

interface WeeklySummaryEntry {
  conversationId: number;
  summary: ConversationSummaryV2;
}

async function buildWeeklyLiteInput(
  settings: LlmConfig,
  conversations: Conversation[]
): Promise<{
  selectedConversations: Conversation[];
  summaryEntries: WeeklySummaryEntry[];
  selectedSummaries: Array<{ conversationId: number; summary: string }>;
  substantiveCount: number;
  structuredCount: number;
  autoGeneratedCount: number;
  autoAttemptedCount: number;
}> {
  const candidates = selectWeeklyCandidates(conversations);
  const summaries = await Promise.all(
    candidates.map(async (conversation) => {
      const summaryRecord = await getSummary(conversation.id);
      return {
        conversation,
        summaryRecord,
      };
    })
  );

  const ranked = summaries
    .sort((a, b) => {
      const aHasStructured = a.summaryRecord?.structured ? 1 : 0;
      const bHasStructured = b.summaryRecord?.structured ? 1 : 0;
      if (aHasStructured !== bHasStructured) {
        return bHasStructured - aHasStructured;
      }

      const aHasSummary = a.summaryRecord?.content ? 1 : 0;
      const bHasSummary = b.summaryRecord?.content ? 1 : 0;
      if (aHasSummary !== bHasSummary) {
        return bHasSummary - aHasSummary;
      }
      if (a.conversation.message_count !== b.conversation.message_count) {
        return b.conversation.message_count - a.conversation.message_count;
      }
      return (
        getConversationOriginAt(b.conversation) -
        getConversationOriginAt(a.conversation)
      );
    })
    .slice(0, WEEKLY_DEFAULT_INPUT_LIMIT);

  const collectSummaryEntries = (): WeeklySummaryEntry[] =>
    ranked
      .map((item) => {
        const summary = toSummaryV2ForWeekly(item.summaryRecord ?? null);
        if (!summary) return null;
        return {
          conversationId: item.conversation.id,
          summary,
        };
      })
      .filter((item): item is WeeklySummaryEntry => item !== null);

  let summaryEntries = collectSummaryEntries();
  let substantiveCount = summaryEntries.filter((item) =>
    isSubstantiveSummary(item.summary)
  ).length;
  let autoGeneratedCount = 0;
  let autoAttemptedCount = 0;

  if (substantiveCount < 3) {
    const pending = ranked.filter((item) => {
      const existing = toSummaryV2ForWeekly(item.summaryRecord ?? null);
      return !(existing && isSubstantiveSummary(existing));
    });

    let cursor = 0;
    while (
      substantiveCount < 3 &&
      autoAttemptedCount < WEEKLY_AUTO_SUMMARY_MAX_ATTEMPTS &&
      cursor < pending.length
    ) {
      const remainingAttempts =
        WEEKLY_AUTO_SUMMARY_MAX_ATTEMPTS - autoAttemptedCount;
      const batchSize = Math.min(
        WEEKLY_AUTO_SUMMARY_CONCURRENCY,
        remainingAttempts,
        pending.length - cursor
      );

      if (batchSize <= 0) {
        break;
      }

      const batch = pending.slice(cursor, cursor + batchSize);
      cursor += batchSize;
      autoAttemptedCount += batchSize;

      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const generated = await generateConversationSummary(
              settings,
              item.conversation.id
            );
            return { ok: true as const, item, generated };
          } catch (error) {
            return {
              ok: false as const,
              conversationId: item.conversation.id,
              reason: (error as Error).message || "WEEKLY_AUTO_SUMMARY_FAILED",
            };
          }
        })
      );

      for (const result of batchResults) {
        if (result.ok) {
          result.item.summaryRecord = result.generated;
          autoGeneratedCount += 1;
          continue;
        }

        logger.warn("service", "Weekly auto summary generation failed", {
          conversationId: result.conversationId,
          reason: result.reason,
        });
      }

      summaryEntries = collectSummaryEntries();
      substantiveCount = summaryEntries.filter((entry) =>
        isSubstantiveSummary(entry.summary)
      ).length;
    }
  }

  const selectedConversations = ranked.map((item) => item.conversation);
  const selectedSummaries = ranked.flatMap((item) => {
    const summary = toSummaryV2ForWeekly(item.summaryRecord ?? null);
    if (!summary) {
      return [];
    }

    return [
      {
        conversationId: item.conversation.id,
        summary: buildWeeklyBridgeReference(summary),
      },
    ];
  });

  return {
    selectedConversations,
    summaryEntries,
    selectedSummaries,
    substantiveCount,
    structuredCount: summaryEntries.length,
    autoGeneratedCount,
    autoAttemptedCount,
  };
}

function buildWeeklySparseHighlight(
  substantiveCount: number,
  locale: SupportedLocale
): string {
  if (substantiveCount <= 0) {
    return locale === "ko"
      ? "이번 주에는 주간 집계에 사용할 수 있는 유효한 구조화 대화가 없었습니다."
      : locale === "ja"
        ? "今週は週次集約に使える有効な構造化対話がありませんでした。"
        : locale === "zh"
          ? "本周没有可用于周报聚合的有效结构化对话。"
          : "No valid structured conversations are available for weekly aggregation.";
  }
  return locale === "ko"
    ? `이번 주에는 유효한 구조화 대화가 ${substantiveCount}건뿐이라 주제 간 집계는 건너뛰었습니다.`
    : locale === "ja"
      ? `今週は有効な構造化対話が ${substantiveCount} 件しかないため、テーマ横断の集約はスキップしました。`
      : locale === "zh"
        ? `本周只有 ${substantiveCount} 条有效结构化对话，因此跳过了跨主题聚合。`
        : `Only ${substantiveCount} valid structured conversations are available this week, so cross-topic aggregation is skipped.`;
}

function dedupeNarrativeItems(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeSynthesisLine(value: string, maxChars = 320): string {
  return sanitizeSummaryText(value)
    .replace(/\s+/g, " ")
    .replace(/^\s*[-*+]+\s*/, "")
    .trim()
    .slice(0, maxChars);
}

function splitSynthesisLines(raw: string): string[] {
  const normalized = sanitizeSummaryText(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/\r/g, "\n")
    .replace(/[;]+/g, "\n")
    .replace(/\n?\s*[-*+]+\s+/g, "\n")
    .replace(/\n?\s*\d+[.)]\s+/g, "\n");
  return dedupeNarrativeItems(
    normalized
      .split(/\n+/)
      .map((line) => normalizeSynthesisLine(line))
      .filter((line) => line.length >= 12 && !/^[\[\]{}":,]+$/.test(line))
  );
}
function buildJourneySeedsFromMessages(messages: PromptReadyMessage[]): Array<{
  speaker: "User" | "AI";
  assertion: string;
}> {
  return messages
    .map((message) => {
      const speaker: "User" | "AI" = message.role === "ai" ? "AI" : "User";
      const seedText = message.bodyText || message.transcriptText;
      return {
        speaker,
        assertion: normalizeSynthesisLine(seedText, 500),
      };
    })
    .filter((item) => item.assertion.length > 0);
}

function synthesizeDegradedSummaryV2FromRaw(params: {
  conversation: Conversation;
  messages: PromptReadyMessage[];
  rawCandidates: string[];
  locale: SupportedLocale;
}): ConversationSummaryV2 | null {
  const locale = params.locale;
  const synthLabels =
    locale === "ko"
      ? {
          insight: (index: number) => `인사이트 ${index}`,
          coreQuestionFallback: "당신이 답을 찾고자 하는 핵심 질문은 무엇인가요?",
          stillUnresolved: (item: string) => `미해결: ${item}`,
          validateAndClose: (item: string) => `검증하고 마무리하기: ${item}`,
          thinkingStyle: "가설을 조금씩 좁혀 가며, 전제를 하나씩 검증하고 있습니다.",
          emotionalTone: "여러 제약을 살피면서 분석적이고 신중한 톤을 유지하고 있습니다.",
        }
      : locale === "ja"
      ? {
          insight: (index: number) => `インサイト ${index}`,
          coreQuestionFallback: "あなたが答えを出したい核心的な問いは何ですか？",
          stillUnresolved: (item: string) => `未解決：${item}`,
          validateAndClose: (item: string) => `検証して締めくくる：${item}`,
          thinkingStyle: "仮説を少しずつ絞り込みながら、一つずつ前提を検証しています。",
          emotionalTone: "制約を探りながら、分析的で慎重なトーンを保っています。",
        }
      : locale === "zh"
        ? {
            insight: (index: number) => `洞察 ${index}`,
            coreQuestionFallback: "你最想弄清楚的核心问题是什么？",
            stillUnresolved: (item: string) => `仍未解决：${item}`,
            validateAndClose: (item: string) => `验证并收尾：${item}`,
            thinkingStyle: "你在一步步收紧假设，并逐一验证自己的设想。",
            emotionalTone: "在厘清各种约束时，语气保持分析性而审慎。",
          }
        : {
            insight: (index: number) => `Insight ${index}`,
            coreQuestionFallback: "What is the core question you are trying to answer?",
            stillUnresolved: (item: string) => `Still unresolved: ${item}`,
            validateAndClose: (item: string) => `Validate and close: ${item}`,
            thinkingStyle:
              "You iteratively narrow hypotheses and test assumptions step by step.",
            emotionalTone:
              "The tone stays analytical and cautious while probing constraints.",
          };
  const rawLines = dedupeNarrativeItems(
    params.rawCandidates.flatMap((raw) => splitSynthesisLines(raw))
  );
  const messageSeeds = buildJourneySeedsFromMessages(params.messages);

  const candidateLines = dedupeNarrativeItems([
    ...rawLines,
    ...messageSeeds.map((item) => item.assertion),
  ]);

  if (candidateLines.length === 0) {
    return null;
  }

  const coreQuestionSource =
    messageSeeds.find((item) => item.speaker === "User")?.assertion ||
    normalizeSynthesisLine(params.conversation.title, 160) ||
    candidateLines[0];
  const coreQuestion = coreQuestionSource.slice(0, 180);

  const journey: ConversationSummaryV2["thinking_journey"] = [];
  const seenJourney = new Set<string>();
  const pushJourney = (speaker: "User" | "AI", assertion: string) => {
    const normalized = normalizeSynthesisLine(assertion, 500);
    if (!normalized) return;
    const key = `${speaker}:${normalized.toLowerCase()}`;
    if (seenJourney.has(key)) return;
    seenJourney.add(key);
    journey.push({
      step: journey.length + 1,
      speaker,
      assertion: normalized,
      real_world_anchor: null,
    });
  };

  for (const seed of messageSeeds) {
    pushJourney(seed.speaker, seed.assertion);
    if (journey.length >= SUMMARY_LOCAL_SYNTHESIS_MAX_JOURNEY) {
      break;
    }
  }
  for (const line of candidateLines) {
    if (journey.length >= SUMMARY_LOCAL_SYNTHESIS_MAX_JOURNEY) {
      break;
    }
    const speaker = journey.length % 2 === 0 ? "User" : "AI";
    pushJourney(speaker, line);
  }

  if (journey.length < 2) {
    pushJourney("User", coreQuestion);
    pushJourney("AI", candidateLines[1] || candidateLines[0] || coreQuestion);
  }
  if (journey.length < 2) {
    return null;
  }

  const keyInsights: ConversationSummaryV2["key_insights"] = dedupeNarrativeItems(
    candidateLines
  )
    .slice(0, SUMMARY_LOCAL_SYNTHESIS_MAX_ITEMS)
    .map((line, index) => {
      const split = line.match(/^(.*?)\s*:\s*(.+)$/);
      if (split) {
        return {
          term: normalizeSynthesisLine(split[1], 120) || synthLabels.insight(index + 1),
          definition: normalizeSynthesisLine(split[2], 320) || line,
        };
      }
      return {
        term: synthLabels.insight(index + 1),
        definition: normalizeSynthesisLine(line, 320),
      };
    })
    .filter((item) => item.definition.length > 0);

  const unresolved = dedupeNarrativeItems(
    candidateLines.filter((line) =>
      /(unresolved|pending|unknown|open|unclear|tension|tradeoff|constraint|risk|question|issue)/i.test(
        line
      )
    )
  )
    .slice(0, SUMMARY_LOCAL_SYNTHESIS_MAX_ITEMS)
    .map((line) => normalizeSynthesisLine(line, 280));
  const unresolvedThreads =
    unresolved.length > 0
      ? unresolved
      : [normalizeSynthesisLine(synthLabels.stillUnresolved(candidateLines[0]), 280)];

  const nextSteps = dedupeNarrativeItems(
    candidateLines.filter((line) =>
      /(next|step|todo|follow-up|should|plan|validate|action|implement|improve|fix)/i.test(
        line
      )
    )
  )
    .slice(0, SUMMARY_LOCAL_SYNTHESIS_MAX_ITEMS)
    .map((line) => normalizeSynthesisLine(line, 280));
  const actionableNextSteps =
    nextSteps.length > 0
      ? nextSteps
      : unresolvedThreads
          .slice(0, SUMMARY_LOCAL_SYNTHESIS_MAX_ITEMS)
          .map((item) => normalizeSynthesisLine(synthLabels.validateAndClose(item), 280));

  const synthesized: ConversationSummaryV2 = {
    core_question: coreQuestion || synthLabels.coreQuestionFallback,
    thinking_journey: journey.slice(0, SUMMARY_LOCAL_SYNTHESIS_MAX_JOURNEY),
    key_insights:
      keyInsights.length > 0
        ? keyInsights
        : [
            {
              term: synthLabels.insight(1),
              definition: normalizeSynthesisLine(candidateLines[0], 320),
            },
          ],
    unresolved_threads: unresolvedThreads,
    meta_observations: {
      thinking_style: synthLabels.thinkingStyle,
      emotional_tone: synthLabels.emotionalTone,
      depth_level: "moderate",
    },
    actionable_next_steps: actionableNextSteps,
  };

  const parsed = parseConversationSummaryV2Object(synthesized);
  if (parsed.success) {
    return parsed.data;
  }
  return null;
}

async function generateStructuredSummary(
  settings: LlmConfig,
  conversation: Conversation,
  messages: Message[],
  locale: SupportedLocale,
  hooks?: SummaryGenerationHooks
): Promise<
  StructuredGenerationResult<SummaryStructured, SummarySchemaVersion>
> {
  const summaryStartedAt = Date.now();
  const prompt = getPrompt("conversationSummary", { variant: "current" });
  const dedupeErrors = (errors: string[]): string[] => [...new Set(errors)];
  const parseErrorCodes = new Set<string>();
  const promptContext = createPromptReadyConversationContext({
    conversation,
    messages,
  });
  const promptMessages = promptContext.messages;

  hooks?.onStage?.("distilling_core_logic");
  const compactionSkipped = shouldSkipSummaryCompaction(conversation, promptMessages);
  const compaction = compactionSkipped
    ? {
        used: false,
        failed: false,
        skipped: true,
        content: "",
        charsIn: countInputChars(promptMessages),
        charsOut: 0,
        llmCallCount: 0,
      }
    : await runCompaction(
        settings,
        conversation,
        promptMessages,
        promptContext.transcript,
        locale
      );
  const summaryPath: SummaryPath = compaction.used ? "compacted" : "direct";
  let summaryLlmCallCount = compaction.llmCallCount;
  let summaryJsonRecoveredFromReasoning = false;

  const payload = {
    conversationTitle: conversation.title,
    conversationPlatform: conversation.platform,
    conversationOriginAt: getConversationOriginAt(conversation),
    messages: promptMessages,
    transcriptOverride: promptContext.transcript,
    locale,
  };

  const summaryPromptInput = compaction.used
    ? buildSummaryPromptFromCompaction(conversation, compaction.content, locale)
    : prompt.userTemplate(payload);
  hooks?.onStage?.("curating_summary");

  const callStructuredInference = async (inputPrompt: string) => {
    summaryLlmCallCount += 1;
    const result = await callInference(settings, inputPrompt, {
      responseFormat: "json_object",
      systemPrompt: prompt.system,
    });
    if (result.contentSource === "reasoning_content") {
      summaryJsonRecoveredFromReasoning = true;
    }
    return result;
  };

  const firstAttemptStartedAt = Date.now();
  const primaryPrompt = truncateForContext(summaryPromptInput, SUMMARY_MAX_CHARS);
  const first = await callStructuredInference(primaryPrompt);
  const firstParsed = parseSummaryFromRaw(first.content);
  (firstParsed.parseErrorCodes || []).forEach((code) => parseErrorCodes.add(code));
  const firstDensity = validateSummaryDensity(
    firstParsed.data,
    firstParsed.schemaVersion,
    promptMessages.length
  );
  const firstValidationErrors = dedupeErrors([
    ...firstParsed.errors,
    ...firstDensity.errors,
  ]);

  logPromptUsage({
    promptType: "conversationSummary",
    promptVersion: prompt.version,
    mode: first.mode,
    attempt: 1,
    validationErrors: firstValidationErrors,
    schemaVersion: firstParsed.schemaVersion,
    inputCount: promptMessages.length,
    route: first.route,
    fallbackStage:
      firstParsed.data && firstDensity.passed ? "none" : "repair_json",
    compactionUsed: compaction.used,
    compactionFailed: compaction.failed,
    compactionCharsIn: compaction.charsIn,
    compactionCharsOut: compaction.charsOut,
    summaryPath,
    densityGateTriggered: firstDensity.triggered,
    densityGatePassed: firstDensity.passed,
    densityGateDegraded: false,
    unresolvedCount: firstDensity.unresolvedCount,
    nextStepsCount: firstDensity.nextStepsCount,
    evidenceScore: firstDensity.evidenceScore,
    summaryLocalSynthesisUsed: false,
    summaryJsonRecoveredFromReasoning,
    summaryLlmCallCount,
    summaryParseErrorCodes: [...parseErrorCodes],
    summaryCompactionSkipped: compaction.skipped,
    summaryTotalLatencyMs: Date.now() - summaryStartedAt,
    latencyMs: Date.now() - firstAttemptStartedAt,
    success: !!firstParsed.data && firstDensity.passed,
  });

  if (firstParsed.data && firstParsed.schemaVersion && firstDensity.passed) {
    return {
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      structured: firstParsed.data,
      content: renderSummaryText(firstParsed.data, firstParsed.schemaVersion, locale),
      format: "structured_v1",
      status: "ok",
      schemaVersion: firstParsed.schemaVersion,
      mode: first.mode,
      attempt: 1,
      validationErrors: [],
      fallbackStage: "none",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
      densityGateTriggered: firstDensity.triggered,
      densityGatePassed: true,
      densityGateDegraded: false,
      unresolvedCount: firstDensity.unresolvedCount,
      nextStepsCount: firstDensity.nextStepsCount,
      evidenceScore: firstDensity.evidenceScore,
      summaryLocalSynthesisUsed: false,
      summaryJsonRecoveredFromReasoning,
      summaryLlmCallCount,
      summaryParseErrorCodes: [...parseErrorCodes],
      summaryCompactionSkipped: compaction.skipped,
      summaryTotalLatencyMs: Date.now() - summaryStartedAt,
    };
  }

  const secondPromptInput =
    firstParsed.data &&
    firstParsed.schemaVersion &&
    firstDensity.triggered &&
    !firstDensity.passed &&
    isConversationSummaryV2(firstParsed.data, firstParsed.schemaVersion)
      ? buildSummaryDensityRepairPrompt(firstParsed.data, firstDensity)
      : buildRepairPrompt("summary", first.content, firstValidationErrors);

  let second: Awaited<ReturnType<typeof callInference>> | null = null;
  let secondParsed: ParseResult<SummaryStructured, SummarySchemaVersion> = {
    data: null,
    errors: [],
    parseErrorCodes: [],
  };
  let secondDensity = createDefaultDensityValidation();
  let secondValidationErrors: string[] = [];

  const timeElapsedBeforeSecond = Date.now() - summaryStartedAt;
  const shouldRunSecondAttempt = timeElapsedBeforeSecond < SUMMARY_PIPELINE_TIME_BUDGET_MS;

  if (shouldRunSecondAttempt) {
    const secondAttemptStartedAt = Date.now();
    const repairPrompt = truncateForContext(secondPromptInput, SUMMARY_MAX_CHARS);
    second = await callStructuredInference(repairPrompt);
    secondParsed = parseSummaryFromRaw(second.content);
    (secondParsed.parseErrorCodes || []).forEach((code) => parseErrorCodes.add(code));
    secondDensity = validateSummaryDensity(
      secondParsed.data,
      secondParsed.schemaVersion,
      promptMessages.length
    );
    secondValidationErrors = dedupeErrors([
      ...secondParsed.errors,
      ...secondDensity.errors,
    ]);

    logPromptUsage({
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      mode: second.mode,
      attempt: 2,
      validationErrors: secondValidationErrors,
      schemaVersion: secondParsed.schemaVersion,
      inputCount: promptMessages.length,
      route: second.route,
      fallbackStage:
        secondParsed.data && secondDensity.passed ? "none" : "repair_json",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
      densityGateTriggered:
        firstDensity.triggered || secondDensity.triggered,
      densityGatePassed: secondDensity.passed,
      densityGateDegraded:
        !!secondParsed.data && !!secondParsed.schemaVersion && !secondDensity.passed,
      unresolvedCount: secondDensity.unresolvedCount,
      nextStepsCount: secondDensity.nextStepsCount,
      evidenceScore: secondDensity.evidenceScore,
      summaryLocalSynthesisUsed: false,
      summaryJsonRecoveredFromReasoning,
      summaryLlmCallCount,
      summaryParseErrorCodes: [...parseErrorCodes],
      summaryCompactionSkipped: compaction.skipped,
      summaryTotalLatencyMs: Date.now() - summaryStartedAt,
      latencyMs: Date.now() - secondAttemptStartedAt,
      success: !!secondParsed.data && secondDensity.passed,
    });
  } else {
    parseErrorCodes.add("SUMMARY_TIME_BUDGET_EXCEEDED");
    secondValidationErrors = dedupeErrors([
      ...firstValidationErrors,
      "SUMMARY_TIME_BUDGET_EXCEEDED",
    ]);
    logPromptUsage({
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      mode: first.mode,
      attempt: 2,
      validationErrors: secondValidationErrors,
      schemaVersion: firstParsed.schemaVersion,
      inputCount: promptMessages.length,
      route: first.route,
      fallbackStage: "repair_json",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
      densityGateTriggered: firstDensity.triggered,
      densityGatePassed: false,
      densityGateDegraded: false,
      unresolvedCount: firstDensity.unresolvedCount,
      nextStepsCount: firstDensity.nextStepsCount,
      evidenceScore: firstDensity.evidenceScore,
      summaryLocalSynthesisUsed: false,
      summaryJsonRecoveredFromReasoning,
      summaryLlmCallCount,
      summaryParseErrorCodes: [...parseErrorCodes],
      summaryCompactionSkipped: compaction.skipped,
      summaryTotalLatencyMs: Date.now() - summaryStartedAt,
      latencyMs: 0,
      success: false,
    });
  }

  if (secondParsed.data && secondParsed.schemaVersion && secondDensity.passed) {
    return {
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      structured: secondParsed.data,
      content: renderSummaryText(secondParsed.data, secondParsed.schemaVersion, locale),
      format: "structured_v1",
      status: "ok",
      schemaVersion: secondParsed.schemaVersion,
      mode: second.mode,
      attempt: 2,
      validationErrors: secondValidationErrors,
      fallbackStage: "repair_json",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
      densityGateTriggered: firstDensity.triggered || secondDensity.triggered,
      densityGatePassed: true,
      densityGateDegraded: false,
      unresolvedCount: secondDensity.unresolvedCount,
      nextStepsCount: secondDensity.nextStepsCount,
      evidenceScore: secondDensity.evidenceScore,
      summaryLocalSynthesisUsed: false,
      summaryJsonRecoveredFromReasoning,
      summaryLlmCallCount,
      summaryParseErrorCodes: [...parseErrorCodes],
      summaryCompactionSkipped: compaction.skipped,
      summaryTotalLatencyMs: Date.now() - summaryStartedAt,
    };
  }

  if (
    firstParsed.data &&
    firstParsed.schemaVersion &&
    !firstDensity.passed &&
    isConversationSummaryV2(firstParsed.data, firstParsed.schemaVersion)
  ) {
    let selectedData: SummaryStructured = firstParsed.data;
    let selectedSchemaVersion: SummarySchemaVersion = firstParsed.schemaVersion;
    let selectedMode: GenerationMode = first.mode;
    let selectedAttempt = 1;
    let selectedDensity = {
      ...firstDensity,
      degraded: true,
    };
    let selectedValidationErrors = dedupeErrors([
      ...firstValidationErrors,
      "INSUFFICIENT_LIST_DENSITY_DEGRADED",
    ]);

    if (
      secondParsed.data &&
      secondParsed.schemaVersion &&
      isConversationSummaryV2(secondParsed.data, secondParsed.schemaVersion)
    ) {
      const firstScore = getSummaryDensityScore(firstParsed.data);
      const secondScore = getSummaryDensityScore(secondParsed.data);

      if (secondScore >= firstScore) {
        selectedData = secondParsed.data;
        selectedSchemaVersion = secondParsed.schemaVersion;
        selectedMode = second.mode;
        selectedAttempt = 2;
        selectedDensity = {
          ...secondDensity,
          degraded: true,
        };
        selectedValidationErrors = dedupeErrors([
          ...secondValidationErrors,
          "INSUFFICIENT_LIST_DENSITY_DEGRADED",
        ]);
      }
    }

    return {
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      structured: selectedData,
      content: renderSummaryText(selectedData, selectedSchemaVersion, locale),
      format: "structured_v1",
      status: "ok",
      schemaVersion: selectedSchemaVersion,
      mode: selectedMode,
      attempt: selectedAttempt,
      validationErrors: selectedValidationErrors,
      fallbackStage: "repair_json",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
      densityGateTriggered: true,
      densityGatePassed: false,
      densityGateDegraded: true,
      unresolvedCount: selectedDensity.unresolvedCount,
      nextStepsCount: selectedDensity.nextStepsCount,
      evidenceScore: selectedDensity.evidenceScore,
      summaryLocalSynthesisUsed: false,
      summaryJsonRecoveredFromReasoning,
      summaryLlmCallCount,
      summaryParseErrorCodes: [...parseErrorCodes],
      summaryCompactionSkipped: compaction.skipped,
      summaryTotalLatencyMs: Date.now() - summaryStartedAt,
    };
  }

  const synthesized = synthesizeDegradedSummaryV2FromRaw({
    conversation,
    messages: promptMessages,
    rawCandidates: [
      first.content,
      second?.content || "",
    ],
    locale,
  });

  if (synthesized) {
    const synthDensity = validateSummaryDensity(
      synthesized,
      "conversation_summary.v2",
      promptMessages.length
    );
    const synthValidationErrors = dedupeErrors([
      ...firstValidationErrors,
      ...secondValidationErrors,
      "SUMMARY_LOCAL_SYNTHESIS_USED",
    ]);

    logPromptUsage({
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      mode: second?.mode ?? first.mode,
      attempt: second ? 2 : 1,
      validationErrors: synthValidationErrors,
      schemaVersion: "conversation_summary.v2",
      inputCount: promptMessages.length,
      route: second?.route ?? first.route,
      fallbackStage: "repair_json",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
      densityGateTriggered: firstDensity.triggered || secondDensity.triggered,
      densityGatePassed: synthDensity.passed,
      densityGateDegraded: true,
      unresolvedCount: synthDensity.unresolvedCount,
      nextStepsCount: synthDensity.nextStepsCount,
      evidenceScore: synthDensity.evidenceScore,
      summaryLocalSynthesisUsed: true,
      summaryJsonRecoveredFromReasoning,
      summaryLlmCallCount,
      summaryParseErrorCodes: [...parseErrorCodes],
      summaryCompactionSkipped: compaction.skipped,
      summaryTotalLatencyMs: Date.now() - summaryStartedAt,
      latencyMs: 0,
      success: true,
    });

    return {
      promptType: "conversationSummary",
      promptVersion: prompt.version,
      structured: synthesized,
      content: renderSummaryText(synthesized, "conversation_summary.v2", locale),
      format: "structured_v1",
      status: "ok",
      schemaVersion: "conversation_summary.v2",
      mode: second?.mode ?? first.mode,
      attempt: second ? 2 : 1,
      validationErrors: synthValidationErrors,
      fallbackStage: "repair_json",
      compactionUsed: compaction.used,
      compactionFailed: compaction.failed,
      compactionCharsIn: compaction.charsIn,
      compactionCharsOut: compaction.charsOut,
      summaryPath,
      densityGateTriggered: firstDensity.triggered || secondDensity.triggered,
      densityGatePassed: synthDensity.passed,
      densityGateDegraded: true,
      unresolvedCount: synthDensity.unresolvedCount,
      nextStepsCount: synthDensity.nextStepsCount,
      evidenceScore: synthDensity.evidenceScore,
      summaryLocalSynthesisUsed: true,
      summaryJsonRecoveredFromReasoning,
      summaryLlmCallCount,
      summaryParseErrorCodes: [...parseErrorCodes],
      summaryCompactionSkipped: compaction.skipped,
      summaryTotalLatencyMs: Date.now() - summaryStartedAt,
    };
  }

  const fallbackContent = sanitizeSummaryText(second?.content || first.content);
  const terminalValidationErrors = dedupeErrors([
    ...firstValidationErrors,
    ...secondValidationErrors,
    "SUMMARY_NO_STRUCTURED_OUTPUT",
  ]);
  parseErrorCodes.add("SUMMARY_NO_STRUCTURED_OUTPUT");

  logPromptUsage({
    promptType: "conversationSummary",
    promptVersion: prompt.version,
    mode: "fallback_text",
    attempt: second ? 3 : 2,
    validationErrors: terminalValidationErrors,
    inputCount: promptMessages.length,
    route: second?.route ?? first.route,
    fallbackStage: "fallback_text",
    compactionUsed: compaction.used,
    compactionFailed: compaction.failed,
    compactionCharsIn: compaction.charsIn,
    compactionCharsOut: compaction.charsOut,
    summaryPath,
    densityGateTriggered: firstDensity.triggered || secondDensity.triggered,
    densityGatePassed: false,
    densityGateDegraded: false,
    unresolvedCount: Math.max(
      firstDensity.unresolvedCount,
      secondDensity.unresolvedCount
    ),
    nextStepsCount: Math.max(
      firstDensity.nextStepsCount,
      secondDensity.nextStepsCount
    ),
    evidenceScore: Math.max(
      firstDensity.evidenceScore,
      secondDensity.evidenceScore
    ),
    summaryLocalSynthesisUsed: false,
    summaryJsonRecoveredFromReasoning,
    summaryLlmCallCount,
    summaryParseErrorCodes: [...parseErrorCodes],
    summaryCompactionSkipped: compaction.skipped,
    summaryTotalLatencyMs: Date.now() - summaryStartedAt,
    latencyMs: 0,
    format: "fallback_plain_text",
    status: "fallback",
    success: false,
  });

  return {
    promptType: "conversationSummary",
    promptVersion: prompt.version,
    structured: null,
    content: fallbackContent || "Summary generation failed. Please retry.",
    format: "fallback_plain_text",
    status: "fallback",
    mode: "fallback_text",
    attempt: second ? 3 : 2,
    validationErrors: terminalValidationErrors,
    fallbackStage: "fallback_text",
    compactionUsed: compaction.used,
    compactionFailed: compaction.failed,
    compactionCharsIn: compaction.charsIn,
    compactionCharsOut: compaction.charsOut,
    summaryPath,
    densityGateTriggered: firstDensity.triggered || secondDensity.triggered,
    densityGatePassed: false,
    densityGateDegraded: false,
    unresolvedCount: Math.max(
      firstDensity.unresolvedCount,
      secondDensity.unresolvedCount
    ),
    nextStepsCount: Math.max(
      firstDensity.nextStepsCount,
      secondDensity.nextStepsCount
    ),
    evidenceScore: Math.max(
      firstDensity.evidenceScore,
      secondDensity.evidenceScore
    ),
    summaryLocalSynthesisUsed: false,
    summaryJsonRecoveredFromReasoning,
    summaryLlmCallCount,
    summaryParseErrorCodes: [...parseErrorCodes],
    summaryCompactionSkipped: compaction.skipped,
    summaryTotalLatencyMs: Date.now() - summaryStartedAt,
  };
}

async function generateStructuredWeekly(
  settings: LlmConfig,
  conversations: Conversation[],
  rangeStart: number,
  rangeEnd: number,
  locale: SupportedLocale,
  hooks?: WeeklyGenerationHooks
): Promise<StructuredGenerationResult<WeeklyStructured, WeeklySchemaVersion>> {
  hooks?.onStage?.("aggregating_weekly_digest");
  const prompt = getPrompt("weeklyDigest", { variant: "current" });
  const weeklyInputMode: "summary_v2_only" = "summary_v2_only";
  const weeklyRangeMode = inferWeeklyRangeMode(rangeStart, rangeEnd);
  const dedupeErrors = (errors: string[]): string[] => [...new Set(errors)];
  const buildStageValidationErrors = (stage: WeeklyGenerationStageResult): string[] =>
    dedupeErrors([
      ...stage.parseErrors,
      ...toWeeklySemanticErrors(stage.hardIssueCodes),
    ]);

  if (conversations.length === 0) {
    const emptyReport = buildWeeklyInsufficientReport(
      rangeStart,
      rangeEnd,
      0,
      "No conversations are available in this range."
    );

    return {
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      structured: emptyReport,
      content: renderWeeklyText(emptyReport, "weekly_lite.v1", locale),
      format: "structured_v1",
      status: "ok",
      schemaVersion: "weekly_lite.v1",
      mode: "prompt_json",
      attempt: 0,
      validationErrors: [],
      fallbackStage: "none",
      weeklySub3Triggered: true,
      weeklySubstantiveCount: 0,
      weeklyStructuredCount: 0,
      weeklyInputMode,
      weeklySemanticGatePassed: true,
      weeklySemanticIssueCodes: [],
      weeklySemanticHardIssueCodes: [],
      weeklySemanticWarningIssueCodes: [],
      weeklySemanticRepairAttempt: 0,
      weeklyDegradedToInsufficient: false,
      weeklyHighlightsAfterFilter: emptyReport.highlights.length,
      weeklyRecurringAfterFilter: emptyReport.recurring_questions.length,
    };
  }

  const weeklyInput = await buildWeeklyLiteInput(settings, conversations);
  const substantiveEntries = weeklyInput.summaryEntries.filter((item) =>
    isSubstantiveSummary(item.summary)
  );
  const sub3Triggered = weeklyInput.substantiveCount < 3;
  const payload = {
    conversations: weeklyInput.selectedConversations,
    summaryEntries: substantiveEntries,
    selectedSummaries: weeklyInput.selectedSummaries,
    rangeStart,
    rangeEnd,
    maxConversations: substantiveEntries.length,
    locale,
  };

  logger.info("service", "Weekly input assembled", {
    candidateCount: conversations.length,
    selectedConversationCount: weeklyInput.selectedConversations.length,
    weekly_range_mode: weeklyRangeMode,
    weekly_sub3_triggered: sub3Triggered,
    weekly_substantive_count: weeklyInput.substantiveCount,
    weekly_structured_count: weeklyInput.structuredCount,
    weekly_auto_summary_attempted: weeklyInput.autoAttemptedCount,
    weekly_auto_summary_generated: weeklyInput.autoGeneratedCount,
    weekly_auto_summary_mode: "full_compaction",
    weekly_input_mode: weeklyInputMode,
  });

  if (sub3Triggered) {
    const sparseReport = buildWeeklyInsufficientReport(
      rangeStart,
      rangeEnd,
      weeklyInput.substantiveCount,
      buildWeeklySparseHighlight(weeklyInput.substantiveCount, locale)
    );

    logPromptUsage({
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      mode: "prompt_json",
      attempt: 0,
      validationErrors: [],
      schemaVersion: "weekly_lite.v1",
      inputCount: substantiveEntries.length,
      fallbackStage: "none",
      weeklySub3Triggered: true,
      weeklySubstantiveCount: weeklyInput.substantiveCount,
      weeklyStructuredCount: weeklyInput.structuredCount,
      weeklyInputMode,
      weeklySemanticGatePassed: true,
      weeklySemanticIssueCodes: [],
      weeklySemanticHardIssueCodes: [],
      weeklySemanticWarningIssueCodes: [],
      weeklySemanticRepairAttempt: 0,
      weeklyDegradedToInsufficient: false,
      weeklyHighlightsAfterFilter: sparseReport.highlights.length,
      weeklyRecurringAfterFilter: sparseReport.recurring_questions.length,
      latencyMs: 0,
      success: true,
    });

    return {
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      structured: sparseReport,
      content: renderWeeklyText(sparseReport, "weekly_lite.v1", locale),
      format: "structured_v1",
      status: "ok",
      schemaVersion: "weekly_lite.v1",
      mode: "prompt_json",
      attempt: 0,
      validationErrors: [],
      fallbackStage: "none",
      weeklySub3Triggered: true,
      weeklySubstantiveCount: weeklyInput.substantiveCount,
      weeklyStructuredCount: weeklyInput.structuredCount,
      weeklyInputMode,
      weeklySemanticGatePassed: true,
      weeklySemanticIssueCodes: [],
      weeklySemanticHardIssueCodes: [],
      weeklySemanticWarningIssueCodes: [],
      weeklySemanticRepairAttempt: 0,
      weeklyDegradedToInsufficient: false,
      weeklyHighlightsAfterFilter: sparseReport.highlights.length,
      weeklyRecurringAfterFilter: sparseReport.recurring_questions.length,
    };
  }

  let bestReport: WeeklyLiteReportV1 | null = null;
  let bestMode: GenerationMode = "prompt_json";
  let bestAttempt = 1;
  let bestIssueCodes: WeeklySemanticIssueCode[] = [];
  let bestHardIssueCodes: WeeklySemanticIssueCode[] = [];
  let bestWarningIssueCodes: WeeklySemanticIssueCode[] = [];

  let latestRaw = "";
  let latestStage: WeeklyGenerationStageResult = {
    report: null,
    parseErrors: [],
    issueCodes: [],
    hardIssueCodes: [],
    warningIssueCodes: [],
    semanticPassed: false,
  };
  let latestValidationErrors: string[] = [];
  let latestIssueCodes: WeeklySemanticIssueCode[] = [];
  let latestHardIssueCodes: WeeklySemanticIssueCode[] = [];
  let latestWarningIssueCodes: WeeklySemanticIssueCode[] = [];
  let latestMode: GenerationMode = "prompt_json";
  let semanticRepairAttempt = 0;

  const firstAttemptStartedAt = Date.now();
  const primaryPrompt = buildWeeklyPromptWithGuardedBudget(
    prompt.userTemplate(payload),
    WEEKLY_MAX_CHARS
  );
  const first = await callInference(settings, primaryPrompt, {
    responseFormat: "json_object",
    systemPrompt: prompt.system,
  });
  const firstParsed = parseWeeklyFromRaw(first.content);
  const firstStage = evaluateWeeklyStage(firstParsed);
  const firstValidationErrors = buildStageValidationErrors(firstStage);

  latestRaw = first.content;
  latestStage = firstStage;
  latestValidationErrors = firstValidationErrors;
  latestIssueCodes = firstStage.issueCodes;
  latestHardIssueCodes = firstStage.hardIssueCodes;
  latestWarningIssueCodes = firstStage.warningIssueCodes;
  latestMode = first.mode;

  if (firstStage.report) {
    bestReport = firstStage.report;
    bestMode = first.mode;
    bestAttempt = 1;
    bestIssueCodes = firstStage.issueCodes;
    bestHardIssueCodes = firstStage.hardIssueCodes;
    bestWarningIssueCodes = firstStage.warningIssueCodes;
  }

  logPromptUsage({
    promptType: "weeklyDigest",
    promptVersion: prompt.version,
    mode: first.mode,
    attempt: 1,
    validationErrors: firstValidationErrors,
    schemaVersion: firstParsed.schemaVersion ?? "weekly_lite.v1",
    inputCount: substantiveEntries.length,
    route: first.route,
    fallbackStage: firstStage.semanticPassed ? "none" : "repair_json",
    weeklySub3Triggered: false,
    weeklySubstantiveCount: weeklyInput.substantiveCount,
    weeklyStructuredCount: weeklyInput.structuredCount,
    weeklyInputMode,
    weeklySemanticGatePassed: firstStage.semanticPassed,
    weeklySemanticIssueCodes: firstStage.issueCodes,
    weeklySemanticHardIssueCodes: firstStage.hardIssueCodes,
    weeklySemanticWarningIssueCodes: firstStage.warningIssueCodes,
    weeklySemanticRepairAttempt: 0,
    weeklyDegradedToInsufficient: false,
    weeklyHighlightsAfterFilter: firstStage.report?.highlights.length ?? 0,
    weeklyRecurringAfterFilter: firstStage.report?.recurring_questions.length ?? 0,
    latencyMs: Date.now() - firstAttemptStartedAt,
    success: !!firstStage.report && firstStage.semanticPassed,
  });

  if (firstStage.report && firstStage.semanticPassed) {
    return {
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      structured: firstStage.report,
      content: renderWeeklyText(firstStage.report, "weekly_lite.v1", locale),
      format: "structured_v1",
      status: "ok",
      schemaVersion: "weekly_lite.v1",
      mode: first.mode,
      attempt: 1,
      validationErrors: [],
      fallbackStage: "none",
      weeklySub3Triggered: false,
      weeklySubstantiveCount: weeklyInput.substantiveCount,
      weeklyStructuredCount: weeklyInput.structuredCount,
      weeklyInputMode,
      weeklySemanticGatePassed: true,
      weeklySemanticIssueCodes: firstStage.issueCodes,
      weeklySemanticHardIssueCodes: firstStage.hardIssueCodes,
      weeklySemanticWarningIssueCodes: firstStage.warningIssueCodes,
      weeklySemanticRepairAttempt: 0,
      weeklyDegradedToInsufficient: false,
      weeklyHighlightsAfterFilter: firstStage.report.highlights.length,
      weeklyRecurringAfterFilter: firstStage.report.recurring_questions.length,
    };
  }

  for (
    let repairRound = 1;
    repairRound <= WEEKLY_SEMANTIC_REPAIR_MAX_ATTEMPTS;
    repairRound += 1
  ) {
    semanticRepairAttempt = repairRound;
    const attempt = repairRound + 1;
    const repairStartedAt = Date.now();
    const useSemanticRepair =
      !!latestStage.report && latestStage.hardIssueCodes.length > 0;
    const repairPromptInput = useSemanticRepair
      ? buildWeeklySemanticRepairPrompt(latestStage.report!, latestStage.issueCodes)
      : buildRepairPrompt("weekly", latestRaw, latestValidationErrors);
    const repairPrompt = buildWeeklyPromptWithGuardedBudget(
      repairPromptInput,
      WEEKLY_MAX_CHARS
    );
    const repaired = await callInference(settings, repairPrompt, {
      responseFormat: "json_object",
      systemPrompt: prompt.system,
    });
    const repairedParsed = parseWeeklyFromRaw(repaired.content);
    const repairedStage = evaluateWeeklyStage(repairedParsed);
    const repairedValidationErrors = buildStageValidationErrors(repairedStage);

    latestRaw = repaired.content;
    latestStage = repairedStage;
    latestValidationErrors = repairedValidationErrors;
    latestIssueCodes = repairedStage.issueCodes;
    latestHardIssueCodes = repairedStage.hardIssueCodes;
    latestWarningIssueCodes = repairedStage.warningIssueCodes;
    latestMode = repaired.mode;

    if (repairedStage.report) {
      const repairedScore = getWeeklySemanticScore(repairedStage.report);
      const bestScore = bestReport ? getWeeklySemanticScore(bestReport) : -1;
      if (repairedScore >= bestScore) {
        bestReport = repairedStage.report;
        bestMode = repaired.mode;
        bestAttempt = attempt;
        bestIssueCodes = repairedStage.issueCodes;
        bestHardIssueCodes = repairedStage.hardIssueCodes;
        bestWarningIssueCodes = repairedStage.warningIssueCodes;
      }
    }

    logPromptUsage({
      promptType: "weeklyDigest",
      promptVersion: prompt.version,
      mode: repaired.mode,
      attempt,
      validationErrors: repairedValidationErrors,
      schemaVersion: repairedParsed.schemaVersion ?? "weekly_lite.v1",
      inputCount: substantiveEntries.length,
      route: repaired.route,
      fallbackStage: repairedStage.semanticPassed ? "none" : "repair_json",
      weeklySub3Triggered: false,
      weeklySubstantiveCount: weeklyInput.substantiveCount,
      weeklyStructuredCount: weeklyInput.structuredCount,
      weeklyInputMode,
      weeklySemanticGatePassed: repairedStage.semanticPassed,
      weeklySemanticIssueCodes: repairedStage.issueCodes,
      weeklySemanticHardIssueCodes: repairedStage.hardIssueCodes,
      weeklySemanticWarningIssueCodes: repairedStage.warningIssueCodes,
      weeklySemanticRepairAttempt: repairRound,
      weeklyDegradedToInsufficient: false,
      weeklyHighlightsAfterFilter: repairedStage.report?.highlights.length ?? 0,
      weeklyRecurringAfterFilter:
        repairedStage.report?.recurring_questions.length ?? 0,
      latencyMs: Date.now() - repairStartedAt,
      success: !!repairedStage.report && repairedStage.semanticPassed,
    });

    if (repairedStage.report && repairedStage.semanticPassed) {
      return {
        promptType: "weeklyDigest",
        promptVersion: prompt.version,
        structured: repairedStage.report,
        content: renderWeeklyText(repairedStage.report, "weekly_lite.v1", locale),
        format: "structured_v1",
        status: "ok",
        schemaVersion: "weekly_lite.v1",
        mode: repaired.mode,
        attempt,
        validationErrors: [],
        fallbackStage: "repair_json",
        weeklySub3Triggered: false,
        weeklySubstantiveCount: weeklyInput.substantiveCount,
        weeklyStructuredCount: weeklyInput.structuredCount,
        weeklyInputMode,
        weeklySemanticGatePassed: true,
        weeklySemanticIssueCodes: repairedStage.issueCodes,
        weeklySemanticHardIssueCodes: repairedStage.hardIssueCodes,
        weeklySemanticWarningIssueCodes: repairedStage.warningIssueCodes,
        weeklySemanticRepairAttempt: repairRound,
        weeklyDegradedToInsufficient: false,
        weeklyHighlightsAfterFilter: repairedStage.report.highlights.length,
        weeklyRecurringAfterFilter:
          repairedStage.report.recurring_questions.length,
      };
    }
  }

  const degradedHighlight =
    bestReport?.highlights[0] && !bestReport.insufficient_data
      ? bestReport.highlights[0]
      : buildWeeklySparseHighlight(weeklyInput.substantiveCount, locale);
  const degradedReport = buildWeeklyInsufficientReport(
    rangeStart,
    rangeEnd,
    weeklyInput.substantiveCount,
    degradedHighlight
  );
  const degradedIssueCodes = latestIssueCodes.length
    ? latestIssueCodes
    : bestIssueCodes;
  const degradedHardIssueCodes = latestHardIssueCodes.length
    ? latestHardIssueCodes
    : bestHardIssueCodes;
  const degradedWarningIssueCodes = latestWarningIssueCodes.length
    ? latestWarningIssueCodes
    : bestWarningIssueCodes;
  const degradedValidationErrors = dedupeErrors([
    ...latestValidationErrors,
    ...toWeeklySemanticErrors(degradedHardIssueCodes),
    "WEEKLY_SEMANTIC_GATE_DEGRADED_TO_INSUFFICIENT",
  ]);

  logPromptUsage({
    promptType: "weeklyDigest",
    promptVersion: prompt.version,
    mode: latestMode,
    attempt: WEEKLY_SEMANTIC_REPAIR_MAX_ATTEMPTS + 2,
    validationErrors: degradedValidationErrors,
    schemaVersion: "weekly_lite.v1",
    inputCount: substantiveEntries.length,
    fallbackStage: "repair_json",
    weeklySub3Triggered: false,
    weeklySubstantiveCount: weeklyInput.substantiveCount,
    weeklyStructuredCount: weeklyInput.structuredCount,
    weeklyInputMode,
    weeklySemanticGatePassed: false,
    weeklySemanticIssueCodes: degradedIssueCodes,
    weeklySemanticHardIssueCodes: degradedHardIssueCodes,
    weeklySemanticWarningIssueCodes: degradedWarningIssueCodes,
    weeklySemanticRepairAttempt: semanticRepairAttempt,
    weeklyDegradedToInsufficient: true,
    weeklyHighlightsAfterFilter: degradedReport.highlights.length,
    weeklyRecurringAfterFilter: degradedReport.recurring_questions.length,
    latencyMs: 0,
    format: "structured_v1",
    status: "fallback",
    success: false,
  });

  return {
    promptType: "weeklyDigest",
    promptVersion: prompt.version,
    structured: degradedReport,
    content: renderWeeklyText(degradedReport, "weekly_lite.v1", locale),
    format: "structured_v1",
    status: "fallback",
    schemaVersion: "weekly_lite.v1",
    mode: bestMode,
    attempt: bestAttempt,
    validationErrors: degradedValidationErrors,
    fallbackStage: "repair_json",
    weeklySub3Triggered: false,
    weeklySubstantiveCount: weeklyInput.substantiveCount,
    weeklyStructuredCount: weeklyInput.structuredCount,
    weeklyInputMode,
    weeklySemanticGatePassed: false,
    weeklySemanticIssueCodes: degradedIssueCodes,
    weeklySemanticHardIssueCodes: degradedHardIssueCodes,
    weeklySemanticWarningIssueCodes: degradedWarningIssueCodes,
    weeklySemanticRepairAttempt: semanticRepairAttempt,
    weeklyDegradedToInsufficient: true,
    weeklyHighlightsAfterFilter: degradedReport.highlights.length,
    weeklyRecurringAfterFilter: degradedReport.recurring_questions.length,
  };
}

export async function generateConversationSummary(
  settings: LlmConfig,
  conversationId: number
): Promise<SummaryRecord> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const messages = await listMessages(conversationId);
  if (messages.length === 0) {
    throw new Error("CONVERSATION_MESSAGES_EMPTY");
  }

  const { locale } = await getLanguageSettings();

  const pipelineEmitter = createPipelineProgressEmitter({
    scope: "summary",
    targetId: String(conversationId),
    route: resolvePipelineRoute(settings),
    modelId: getEffectiveModelId(settings),
    promptVersion: getPrompt("conversationSummary", { variant: "current" }).version,
  });
  pipelineEmitter.emit("initiating_pipeline", "in_progress");

  try {
    const previous = await getSummary(conversationId);
    const generated = await generateStructuredSummary(settings, conversation, messages, locale, {
      onStage: (stage) => {
        pipelineEmitter.emit(stage, "in_progress");
      },
    });
    pipelineEmitter.emit("persisting_result", "in_progress", {
      attempt: generated.attempt,
      promptVersion: generated.promptVersion,
    });

    logger.info("service", "Summary generation result", {
      promptType: generated.promptType,
      promptVersion: generated.promptVersion,
      schemaVersion: generated.schemaVersion,
      mode: generated.mode,
      attempt: generated.attempt,
      validationErrors: generated.validationErrors,
      format: generated.format,
      status: generated.status,
      fallbackStage: generated.fallbackStage ?? "none",
      compactionUsed: generated.compactionUsed ?? false,
      compactionFailed: generated.compactionFailed ?? false,
      compactionCharsIn: generated.compactionCharsIn ?? 0,
      compactionCharsOut: generated.compactionCharsOut ?? 0,
      summaryPath: generated.summaryPath ?? "direct",
      density_gate_triggered: generated.densityGateTriggered ?? false,
      density_gate_passed: generated.densityGatePassed ?? true,
      density_gate_degraded: generated.densityGateDegraded ?? false,
      unresolved_count: generated.unresolvedCount ?? 0,
      next_steps_count: generated.nextStepsCount ?? 0,
      evidence_score: generated.evidenceScore ?? 0,
      summary_json_recovered_from_reasoning:
        generated.summaryJsonRecoveredFromReasoning ?? false,
      summary_local_synthesis_used: generated.summaryLocalSynthesisUsed ?? false,
      summary_llm_call_count: generated.summaryLlmCallCount ?? 0,
      summary_parse_error_codes: generated.summaryParseErrorCodes ?? [],
      summary_compaction_skipped: generated.summaryCompactionSkipped ?? false,
      summary_total_latency_ms: generated.summaryTotalLatencyMs ?? 0,
    });

    if (previous?.status === "fallback" && generated.status === "fallback") {
      logger.warn("service", "Summary hit consecutive fallback", {
        conversationId,
        promptVersion: generated.promptVersion,
        schemaVersion: generated.schemaVersion,
        validationErrors: generated.validationErrors,
        summary_parse_error_codes: generated.summaryParseErrorCodes ?? [],
        summary_llm_call_count: generated.summaryLlmCallCount ?? 0,
        summary_json_recovered_from_reasoning:
          generated.summaryJsonRecoveredFromReasoning ?? false,
      });
    }

    const saved = await saveSummary({
      conversationId: conversation.id,
      content: generated.content,
      structured: generated.structured,
      format: generated.format,
      status: generated.status,
      schemaVersion: generated.schemaVersion,
      modelId: getEffectiveModelId(settings),
      createdAt: Date.now(),
      sourceUpdatedAt: getConversationCaptureFreshnessAt(conversation),
    });

    if (generated.status === "fallback") {
      pipelineEmitter.emit("degraded_fallback", "degraded_fallback", {
        attempt: generated.attempt,
        promptVersion: generated.promptVersion,
      });
    } else {
      pipelineEmitter.emit("completed", "completed", {
        attempt: generated.attempt,
        promptVersion: generated.promptVersion,
      });
    }

    return saved;
  } catch (error) {
    pipelineEmitter.emit("degraded_fallback", "degraded_fallback");
    throw error;
  }
}

export async function generateWeeklyReport(
  settings: LlmConfig,
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord> {
  const targetId = `${rangeStart}:${rangeEnd}`;
  const pipelineEmitter = createPipelineProgressEmitter({
    scope: "weekly",
    targetId,
    route: resolvePipelineRoute(settings),
    modelId: getEffectiveModelId(settings),
    promptVersion: getPrompt("weeklyDigest", { variant: "current" }).version,
  });
  pipelineEmitter.emit("initiating_pipeline", "in_progress");

  try {
    const conversations = await listConversationsByRange(rangeStart, rangeEnd);
    const sourceHash = buildWeeklySourceHash(conversations, rangeStart, rangeEnd);
    const previous = await getWeeklyReport(rangeStart, rangeEnd);
    const { locale } = await getLanguageSettings();

    const generated = await generateStructuredWeekly(
      settings,
      conversations,
      rangeStart,
      rangeEnd,
      locale,
      {
        onStage: (stage) => {
          pipelineEmitter.emit(stage, "in_progress");
        },
      }
    );
    const weeklyRangeMode = inferWeeklyRangeMode(rangeStart, rangeEnd);
    pipelineEmitter.emit("persisting_result", "in_progress", {
      attempt: generated.attempt,
      promptVersion: generated.promptVersion,
    });

    logger.info("service", "Weekly generation result", {
      promptType: generated.promptType,
      promptVersion: generated.promptVersion,
      schemaVersion: generated.schemaVersion,
      mode: generated.mode,
      attempt: generated.attempt,
      validationErrors: generated.validationErrors,
      format: generated.format,
      status: generated.status,
      fallbackStage: generated.fallbackStage ?? "none",
      weekly_range_mode: weeklyRangeMode,
      weekly_sub3_triggered: generated.weeklySub3Triggered ?? false,
      weekly_substantive_count: generated.weeklySubstantiveCount ?? 0,
      weekly_structured_count: generated.weeklyStructuredCount ?? 0,
      weekly_auto_summary_mode: "full_compaction",
      weekly_input_mode: generated.weeklyInputMode ?? "summary_v2_only",
      weekly_semantic_gate_passed: generated.weeklySemanticGatePassed ?? true,
      weekly_semantic_issue_codes: generated.weeklySemanticIssueCodes ?? [],
      weekly_semantic_hard_issue_codes:
        generated.weeklySemanticHardIssueCodes ?? [],
      weekly_semantic_warning_issue_codes:
        generated.weeklySemanticWarningIssueCodes ?? [],
      weekly_semantic_repair_attempt: generated.weeklySemanticRepairAttempt ?? 0,
      weekly_degraded_to_insufficient:
        generated.weeklyDegradedToInsufficient ?? false,
      weekly_highlights_after_filter: generated.weeklyHighlightsAfterFilter ?? 0,
      weekly_recurring_after_filter: generated.weeklyRecurringAfterFilter ?? 0,
    });

    if (previous?.status === "fallback" && generated.status === "fallback") {
      logger.warn("service", "Weekly report hit consecutive fallback", {
        rangeStart,
        rangeEnd,
        promptVersion: generated.promptVersion,
        schemaVersion: generated.schemaVersion,
        validationErrors: generated.validationErrors,
      });
    }

    const saved = await saveWeeklyReport({
      rangeStart,
      rangeEnd,
      content: generated.content,
      structured: generated.structured,
      format: generated.format,
      status: generated.status,
      schemaVersion: generated.schemaVersion,
      modelId: getEffectiveModelId(settings),
      createdAt: Date.now(),
      sourceHash,
    });

    if (generated.status === "fallback") {
      pipelineEmitter.emit("degraded_fallback", "degraded_fallback", {
        attempt: generated.attempt,
        promptVersion: generated.promptVersion,
      });
    } else {
      pipelineEmitter.emit("completed", "completed", {
        attempt: generated.attempt,
        promptVersion: generated.promptVersion,
      });
    }

    return saved;
  } catch (error) {
    pipelineEmitter.emit("degraded_fallback", "degraded_fallback");
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Weekly Recap (Plan B): code-computed stats + ONE warm LLM copy pass.
// Additive and independent from generateWeeklyReport / generateStructuredWeekly.
// ──────────────────────────────────────────────────────────────────────────

const WEEKLY_RECAP_MAX_CHARS = 8000;
const WEEKLY_RECAP_PRIOR_WEEKS = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function buildPriorWeekRanges(
  rangeStart: number,
  rangeEnd: number,
  weeks: number
): Array<{ start: number; end: number }> {
  const span = Math.max(rangeEnd - rangeStart, WEEK_MS - 1);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 1; i <= weeks; i += 1) {
    const end = rangeStart - i * (span + 1) + span;
    const start = rangeStart - i * (span + 1);
    ranges.push({ start, end });
  }
  return ranges;
}

function buildRecapHighlightContext(
  conversations: Conversation[],
  topics: Awaited<ReturnType<typeof getTopics>>,
  summaryGist?: string
): WeeklyRecapPromptPayload["highlightContext"] {
  const ranked = rankHighlightCandidates(conversations, { topics });
  const top = ranked[0];
  if (!top) {
    return null;
  }
  return {
    title: top.title,
    topic: top.topic,
    messageCount: top.messageCount,
    turnCount: top.turnCount,
    isStarred: top.isStarred,
    summaryGist: summaryGist || top.snippet || undefined,
  };
}

function buildSummaryGistFromV2(summary: ConversationSummaryV2): string {
  const parts: string[] = [];
  if (summary.core_question) {
    parts.push(summary.core_question);
  }
  if (Array.isArray(summary.key_insights) && summary.key_insights.length > 0) {
    parts.push(
      ...summary.key_insights.slice(0, 2).map((item) => `${item.term}: ${item.definition}`)
    );
  }
  return buildSummaryReference(parts.join(" "));
}

function renderWeeklyRecapText(
  recap: WeeklyRecapV1,
  locale: SupportedLocale
): string {
  const labels =
    locale === "ko"
      ? {
          stats: "이번 주 기록",
          conversations: "대화 수",
          activeDays: "활동 일수",
          streak: "연속 주차",
          platform: "가장 많이 사용한 플랫폼",
          highlight: "하이라이트",
          nextWeek: "다음 주를 위해",
        }
      : locale === "ja"
      ? {
          stats: "今週の記録",
          conversations: "対話数",
          activeDays: "アクティブ日数",
          streak: "継続週数",
          platform: "よく使ったプラットフォーム",
          highlight: "ハイライト",
          nextWeek: "来週に向けて",
        }
      : locale === "zh"
        ? {
            stats: "本周记录",
            conversations: "对话数",
            activeDays: "活跃天数",
            streak: "连续周数",
            platform: "最常用平台",
            highlight: "亮点",
            nextWeek: "下周建议",
          }
        : {
            stats: "This week",
            conversations: "Conversations",
            activeDays: "Active days",
            streak: "Streak (weeks)",
            platform: "Top platform",
            highlight: "Highlight",
            nextWeek: "Next week",
          };

  const lines = [
    `${recap.mood_emoji} ${recap.greeting} (${recap.persona_tag})`,
    `${labels.stats}: ${labels.conversations} ${recap.stats.conversation_count} · ${labels.activeDays} ${recap.stats.active_days} · ${labels.streak} ${recap.stats.streak_weeks} · ${labels.platform} ${recap.stats.top_platform}`,
  ];

  if (recap.highlight) {
    lines.push(`${labels.highlight}: ${recap.highlight.title} — ${recap.highlight.detail}`);
  }

  for (const paragraph of recap.narrative) {
    lines.push(paragraph);
  }

  return sanitizeSummaryText(lines.join("\n"));
}

function buildCodeOnlyRecap(
  stats: WeeklyStats,
  highlightContext: WeeklyRecapPromptPayload["highlightContext"],
  locale: SupportedLocale
): WeeklyRecapV1 {
  const topPlatform = stats.topPlatforms[0]?.platform ?? "—";
  const hasPlatform = Boolean(topPlatform && topPlatform !== "—");
  const delta = stats.weekOverWeekDelta;
  const title = highlightContext?.title ?? "";

  let greeting: string;
  let persona: string;
  const narrative: string[] = [];

  if (locale === "ko") {
    greeting = "이번 주도 꾸준히 대화하셨네요 👏";
    persona = "꾸준한 탐구가";
    narrative.push(
      `이번 주에는 ${stats.conversationCount}건의 대화를 나누고 ${stats.activeDays}일 동안 활동했습니다${
        hasPlatform ? `(주로 ${topPlatform})` : ""
      }.`
    );
    if (delta !== null && delta > 0) {
      narrative.push(`지난주보다 ${delta}건 더 많아요. 흐름이 아주 좋습니다 🔥.`);
    } else if (delta !== null && delta < 0) {
      narrative.push(`지난주보다 ${Math.abs(delta)}건 적지만, 페이스는 당신이 정하는 거예요.`);
    } else if (stats.streakWeeks >= 2) {
      narrative.push(`${stats.streakWeeks}주 연속으로 탐구를 이어 가고 있습니다. 멋진 꾸준함이에요.`);
    } else {
      narrative.push("이 호기심을 그대로 간직하며, 조급해하지 말고 천천히 나아가요.");
    }
    narrative.push(
      title
        ? `특히 "${title}"에 깊이 파고들었어요. 다음 주에는 관심 있는 주제를 하나 골라 더 깊이 탐구해 보세요.`
        : "다음 주에는 관심 있는 주제를 하나 골라 깊이 탐구해 보세요."
    );
  } else if (locale === "ja") {
    greeting = "今週もよく対話しましたね 👏";
    persona = "コツコツ探究家";
    narrative.push(
      `今週は ${stats.conversationCount} 件の対話に取り組み、${stats.activeDays} 日アクティブでした${
        hasPlatform ? `（主に ${topPlatform}）` : ""
      }。`
    );
    if (delta !== null && delta > 0) {
      narrative.push(`先週より ${delta} 件多く、いい流れです 🔥。`);
    } else if (delta !== null && delta < 0) {
      narrative.push(`先週より ${Math.abs(delta)} 件少なめでも、ペースはあなた次第です。`);
    } else if (stats.streakWeeks >= 2) {
      narrative.push(`${stats.streakWeeks} 週連続で探究を続けています。すばらしい継続です。`);
    } else {
      narrative.push("この好奇心のまま、焦らず進んでいきましょう。");
    }
    narrative.push(
      title
        ? `特に「${title}」にじっくり向き合いました。来週は気になるテーマを一つ選んで、さらに深掘りしてみましょう。`
        : "来週は気になるテーマを一つ選んで深掘りしてみましょう。"
    );
  } else if (locale === "zh") {
    greeting = "这一周你很投入 👏";
    persona = "稳步探索者";
    narrative.push(
      `这一周，你完成了 ${stats.conversationCount} 次对话，活跃了 ${stats.activeDays} 天${
        hasPlatform ? `，最常去 ${topPlatform}` : ""
      }。`
    );
    if (delta !== null && delta > 0) {
      narrative.push(`比上一周多聊了 ${delta} 次，势头正好 🔥。`);
    } else if (delta !== null && delta < 0) {
      narrative.push(`比上一周少了 ${Math.abs(delta)} 次，节奏由你自己说了算。`);
    } else if (stats.streakWeeks >= 2) {
      narrative.push(`已经连续 ${stats.streakWeeks} 周保持探索，这份坚持很难得。`);
    } else {
      narrative.push("保持这股好奇心，慢慢来也很好。");
    }
    narrative.push(
      title
        ? `你在「${title}」上聊得最深，值得回看。下周不妨挑一个最感兴趣的方向再聊聊。`
        : "下周不妨挑一个你最感兴趣的话题深入聊聊。"
    );
  } else {
    greeting = "Nice week — you showed up 👏";
    persona = "Steady Explorer";
    narrative.push(
      `This week you had ${stats.conversationCount} conversations across ${stats.activeDays} active days${
        hasPlatform ? `, mostly on ${topPlatform}` : ""
      }.`
    );
    if (delta !== null && delta > 0) {
      narrative.push(`That's ${delta} more than last week — great momentum 🔥.`);
    } else if (delta !== null && delta < 0) {
      narrative.push(`That's ${Math.abs(delta)} fewer than last week, and that's perfectly fine — you set the pace.`);
    } else if (stats.streakWeeks >= 2) {
      narrative.push(`You're on a ${stats.streakWeeks}-week streak of staying curious. That consistency adds up.`);
    } else {
      narrative.push("Keep that curiosity going — slow and steady works too.");
    }
    narrative.push(
      title
        ? `You went deepest on "${title}" — worth a revisit. Next week, pick one topic you care about and go further.`
        : "Next week, pick one topic you care about and go deeper."
    );
  }

  return normalizeWeeklyRecap({
    schema: "weekly_recap.v1",
    greeting,
    persona_tag: persona,
    mood_emoji: stats.conversationCount > 0 ? "✨" : "🌱",
    narrative,
    highlight: title
      ? {
          title,
          detail: highlightContext?.summaryGist || highlightContext?.title || "",
        }
      : null,
    stats: {
      conversation_count: stats.conversationCount,
      active_days: stats.activeDays,
      streak_weeks: stats.streakWeeks,
      top_platform: topPlatform,
      week_over_week_delta: stats.weekOverWeekDelta,
    },
  });
}

export async function generateWeeklyRecap(
  settings: LlmConfig,
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord> {
  const targetId = `${rangeStart}:${rangeEnd}`;
  const pipelineEmitter = createPipelineProgressEmitter({
    scope: "weekly",
    targetId,
    route: resolvePipelineRoute(settings),
    modelId: getEffectiveModelId(settings),
    promptVersion: getPrompt("weeklyRecap", { variant: "current" }).version,
  });
  pipelineEmitter.emit("initiating_pipeline", "in_progress");

  try {
    const { locale } = await getLanguageSettings();
    const allConversations = await listConversationsByRange(rangeStart, rangeEnd);
    const conversations = allConversations.filter(
      (conversation) => !conversation.is_trash
    );
    const sourceHash = buildWeeklySourceHash(conversations, rangeStart, rangeEnd);
    const topics = await getTopics();

    // Prior-week counts (local DB, cheap) for streak + week-over-week delta.
    const priorRanges = buildPriorWeekRanges(
      rangeStart,
      rangeEnd,
      WEEKLY_RECAP_PRIOR_WEEKS
    );
    const previousWeekCounts: number[] = [];
    for (const range of priorRanges) {
      const priorConversations = await listConversationsByRange(
        range.start,
        range.end
      );
      previousWeekCounts.push(
        priorConversations.filter((conversation) => !conversation.is_trash).length
      );
    }

    const stats = computeWeeklyStats(conversations, {
      topics,
      previousWeekCounts,
      dateTag: getLocaleDateTag(locale),
    });

    pipelineEmitter.emit("aggregating_weekly_digest", "in_progress");

    // PLAN B — bounded top-1 summary: take the heaviest conversation; reuse a
    // substantive summary if it already exists, else generate exactly ONE.
    const ranked = rankHighlightCandidates(conversations, { topics });
    const heaviest = ranked[0];
    let summaryGist: string | undefined;

    if (heaviest) {
      try {
        const existing = toSummaryV2ForWeekly(
          await getSummary(heaviest.conversationId)
        );
        if (existing && isSubstantiveSummary(existing)) {
          summaryGist = buildSummaryGistFromV2(existing);
        } else {
          const generatedRecord = await generateConversationSummary(
            settings,
            heaviest.conversationId
          );
          const generated = toSummaryV2ForWeekly(generatedRecord);
          if (generated && isSubstantiveSummary(generated)) {
            summaryGist = buildSummaryGistFromV2(generated);
          } else if (generatedRecord.content) {
            summaryGist = buildSummaryReference(generatedRecord.content);
          }
        }
      } catch (error) {
        // Never throw — emotional product must always return something.
        logger.warn("service", "Weekly recap top-1 summary failed", {
          conversationId: heaviest.conversationId,
          reason: (error as Error).message || "WEEKLY_RECAP_SUMMARY_FAILED",
        });
        summaryGist = heaviest.snippet || undefined;
      }
    }

    const highlightContext = buildRecapHighlightContext(
      conversations,
      topics,
      summaryGist
    );

    const prompt = getPrompt("weeklyRecap", { variant: "current" });
    const payload: WeeklyRecapPromptPayload = {
      stats,
      highlightContext,
      rangeStart,
      rangeEnd,
      locale,
    };

    let recap: WeeklyRecapV1 | null = null;
    let status: InsightStatus = "ok";

    const parseRecapRaw = (raw: string) => {
      try {
        return parseWeeklyRecapObject(
          parseJsonObjectFromText(toParsableJsonText(raw))
        );
      } catch {
        return { success: false as const, errors: ["INVALID_JSON_PAYLOAD"] };
      }
    };

    try {
      const primaryPrompt = truncateForContext(
        prompt.userTemplate(payload),
        WEEKLY_RECAP_MAX_CHARS
      );
      const first = await callInference(settings, primaryPrompt, {
        responseFormat: "json_object",
        systemPrompt: prompt.system,
      });

      let parsed = parseRecapRaw(first.content);

      if (!parsed.success) {
        // ONE repair attempt.
        const repairPrompt = truncateForContext(
          buildRepairPrompt(
            "weekly",
            first.content,
            parsed.success === false ? parsed.errors : []
          ),
          WEEKLY_RECAP_MAX_CHARS
        );
        const repaired = await callInference(settings, repairPrompt, {
          responseFormat: "json_object",
          systemPrompt: prompt.system,
        });
        parsed = parseRecapRaw(repaired.content);
      }

      if (parsed.success) {
        // Trust code-computed stats over whatever the model echoed back.
        recap = normalizeWeeklyRecap({
          ...parsed.data,
          stats: {
            conversation_count: stats.conversationCount,
            active_days: stats.activeDays,
            streak_weeks: stats.streakWeeks,
            top_platform:
              stats.topPlatforms[0]?.platform ?? parsed.data.stats.top_platform,
            week_over_week_delta: stats.weekOverWeekDelta,
          },
        });
      }
    } catch (error) {
      logger.warn("service", "Weekly recap LLM copy failed", {
        rangeStart,
        rangeEnd,
        reason: (error as Error).message || "WEEKLY_RECAP_COPY_FAILED",
      });
    }

    if (!recap) {
      recap = buildCodeOnlyRecap(stats, highlightContext, locale);
      status = "fallback";
    }

    pipelineEmitter.emit("persisting_result", "in_progress", {
      promptVersion: prompt.version,
    });

    logger.info("service", "Weekly recap generation result", {
      promptVersion: prompt.version,
      schemaVersion: "weekly_recap.v1",
      status,
      weekly_conversation_count: stats.conversationCount,
      weekly_active_days: stats.activeDays,
      weekly_streak_weeks: stats.streakWeeks,
      weekly_recap_has_highlight: Boolean(highlightContext),
    });

    const saved = await saveWeeklyReport({
      rangeStart,
      rangeEnd,
      content: renderWeeklyRecapText(recap, locale),
      structured: recap,
      format: "structured_v1",
      status,
      schemaVersion: "weekly_recap.v1",
      modelId: getEffectiveModelId(settings),
      createdAt: Date.now(),
      sourceHash,
    });

    if (status === "fallback") {
      pipelineEmitter.emit("degraded_fallback", "degraded_fallback", {
        promptVersion: prompt.version,
      });
    } else {
      pipelineEmitter.emit("completed", "completed", {
        promptVersion: prompt.version,
      });
    }

    return saved;
  } catch (error) {
    pipelineEmitter.emit("degraded_fallback", "degraded_fallback");
    throw error;
  }
}


