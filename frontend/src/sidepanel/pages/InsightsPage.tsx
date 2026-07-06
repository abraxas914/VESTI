import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Compass,
  ExternalLink,
  FileText,
  Loader2,
  Network,
  Pause,
  Play,
} from "lucide-react";
import { useI18n } from "~lib/i18n";
import type { SupportedLocale } from "~lib/i18n/locales";
import type {
  AsyncStatus,
  Conversation,
  Platform,
  SummaryRecord,
  WeeklyReportRecord,
} from "~lib/types";
import type {
  InsightPipelineProgressPayload,
  InsightPipelineStage,
  InsightPipelineStatus,
} from "~lib/messaging/protocol";
import {
  generateConversationSummary,
  generateWeeklyRecap,
  getConversationSummary,
  getConversations,
  getWeeklyReport,
} from "~lib/services/storageService";
import { resolveTurnCount } from "~lib/capture/turn-metrics";
import {
  toChatSummaryData,
  toWeeklyRecapData,
  toWeeklySummaryData,
} from "~lib/services/insightAdapter";
import { getConversationOriginAt } from "~lib/conversations/timestamps";
import type {
  WeeklyRecapData,
  WeeklySummaryData,
} from "~lib/types/insightsPresentation";
import { InsightsAccordionItem } from "../components/InsightsAccordionItem";
import { InsightsWandIcon } from "../components/InsightsWandIcon";

const COLLAPSE_AT = 3;
const WEEKLY_DIGEST_SOON = false;

type WeeklyDigestUiState =
  | "idle"
  | "generating"
  | "ready"
  | "sparse_week"
  | "error";

type WeeklyStableUiState = "idle" | "ready" | "sparse_week";

type WeeklyRangeMode = "last_7_days" | "last_full_week";

type WeeklySparseReason = "sub3" | "semantic_degraded";

type WeeklyGenerationPhase =
  | "ready_to_compile"
  | "loading_thread_summaries"
  | "pattern_detection"
  | "cross_domain_mapping"
  | "composing_and_persisting";

type ThreadSummaryUiState =
  | "no_thread"
  | "selected_idle"
  | "selected_loading"
  | "selected_error"
  | "ready"
  | "ready_loading"
  | "ready_error";

interface WeeklyPhaseDefinition {
  phase: Exclude<WeeklyGenerationPhase, "ready_to_compile">;
  status: string;
  label: string;
  sublabel: string;
  minDurationMs: number;
  hint: string;
}

const WEEKLY_PHASES: WeeklyPhaseDefinition[] = [
  {
    phase: "loading_thread_summaries",
    status: "Loading this week's thread summaries...",
    label: "Loading thread summaries",
    sublabel: "Reading stored summaries for the selected week",
    minDurationMs: 12000,
    hint: "~12s",
  },
  {
    phase: "pattern_detection",
    status: "Scanning for recurring patterns...",
    label: "Pattern detection",
    sublabel: "Cross-thread frequency and recurrence analysis",
    minDurationMs: 14000,
    hint: "~14s",
  },
  {
    phase: "cross_domain_mapping",
    status: "Mapping cross-domain echoes...",
    label: "Cross-domain mapping",
    sublabel: "Structural isomorphism detection",
    minDurationMs: 15000,
    hint: "~15s",
  },
  {
    phase: "composing_and_persisting",
    status: "Composing and writing digest...",
    label: "Composing and persisting",
    sublabel: "Digest composition and persistence",
    minDurationMs: 10000,
    hint: "~10s",
  },
];

interface ThreadPhaseDefinition {
  status: string;
  label: string;
  sublabel: string;
  hint: string;
  maxElapsedMs: number;
}

const THREAD_PHASES: ThreadPhaseDefinition[] = [
  {
    status: "Preparing conversation context...",
    label: "Initialising pipeline",
    sublabel: "Checking cache and waking context window",
    hint: "~12s",
    maxElapsedMs: 12000,
  },
  {
    status: "Distilling core logic...",
    label: "Distilling logic",
    sublabel: "Tracing what changed across turns",
    hint: "~14s",
    maxElapsedMs: 26000,
  },
  {
    status: "Curating structured summary...",
    label: "Curating summary",
    sublabel: "Building journey steps and insight glossary",
    hint: "~15s",
    maxElapsedMs: 41000,
  },
  {
    status: "Finalising and persisting...",
    label: "Finalising artefacts",
    sublabel: "Writing storage record and refreshing card",
    hint: "~10s",
    maxElapsedMs: Number.POSITIVE_INFINITY,
  },
];

type ThreadTrackedStage =
  | "initiating_pipeline"
  | "distilling_core_logic"
  | "curating_summary"
  | "persisting_result";

const THREAD_TRACKED_STAGE_ORDER: ThreadTrackedStage[] = [
  "initiating_pipeline",
  "distilling_core_logic",
  "curating_summary",
  "persisting_result",
];

interface ThreadPipelineTimingState {
  pipelineId: string;
  stageStarts: Partial<Record<ThreadTrackedStage, number>>;
  stageDurationsMs: Partial<Record<ThreadTrackedStage, number>>;
  activeStage: ThreadTrackedStage | null;
  terminal: boolean;
}

function getErrorMessage(
  t: ReturnType<typeof useI18n>["t"],
  error: unknown
): string {
  if (error instanceof Error) {
    if (error.message.includes("STORAGE_HARD_LIMIT_REACHED")) {
      return t.insights.storageLimitError;
    }
    return error.message;
  }
  return String(error);
}

function formatDateTime(ts: number, locale: string = "en"): string {
  const d = new Date(ts);
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function formatWeekRangeLabel(rangeStart: number, rangeEnd: number, locale: string = "en"): string {
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const sameYear = start.getFullYear() === end.getFullYear();

  const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const dateOptsYear: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

  if (sameYear) {
    return `${start.toLocaleDateString(locale, dateOpts)} - ${end.toLocaleDateString(locale, dateOpts)}, ${end.getFullYear()}`;
  }

  return `${start.toLocaleDateString(locale, dateOptsYear)} - ${end.toLocaleDateString(locale, dateOptsYear)}`;
}

function formatTimer(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function parsePlainTextLines(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeJourneyCopy(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function hasRenderableJourneyCopy(value: string): boolean {
  const normalized = normalizeJourneyCopy(value);
  if (!normalized) return false;
  if (/^[^A-Za-z0-9\u3400-\u9FFF]+$/.test(normalized)) return false;
  const semanticChars = normalized.replace(/[^A-Za-z0-9\u3400-\u9FFF]/g, "");
  if (semanticChars.length >= 6) return true;
  return normalized.length >= 12;
}

function getThreadPhaseIndex(elapsedMs: number): number {
  for (let index = 0; index < THREAD_PHASES.length; index += 1) {
    if (elapsedMs <= THREAD_PHASES[index].maxElapsedMs) {
      return index;
    }
  }
  return THREAD_PHASES.length - 1;
}

function getThreadPhaseIndexFromPipelineStage(
  stage: InsightPipelineStage
): number | null {
  switch (stage) {
    case "initiating_pipeline":
      return 0;
    case "distilling_core_logic":
      return 1;
    case "curating_summary":
      return 2;
    case "persisting_result":
    case "completed":
    case "degraded_fallback":
      return 3;
    default:
      return null;
  }
}

function getThreadStatusFromPipelineStage(
  t: ReturnType<typeof useI18n>["t"],
  stage: InsightPipelineStage,
  status: InsightPipelineStatus
): string {
  if (status === "degraded_fallback" || stage === "degraded_fallback") {
    return t.insights.summaryDegraded;
  }

  switch (stage) {
    case "initiating_pipeline":
      return t.insights.threadPhases.preparing.status;
    case "distilling_core_logic":
      return t.insights.threadPhases.distilling.status;
    case "curating_summary":
      return t.insights.threadPhases.curating.status;
    case "persisting_result":
      return t.insights.threadPhases.finalising.status;
    case "completed":
      return t.insights.summaryGenerated;
    default:
      return t.insights.generating;
  }
}

function getWeeklyPhaseByElapsed(elapsedMs: number): WeeklyGenerationPhase {
  let threshold = 0;
  for (const phase of WEEKLY_PHASES) {
    threshold += phase.minDurationMs;
    if (elapsedMs < threshold) {
      return phase.phase;
    }
  }
  return WEEKLY_PHASES[WEEKLY_PHASES.length - 1]?.phase ?? "loading_thread_summaries";
}

function getThreadPhaseLabel(
  t: ReturnType<typeof useI18n>["t"],
  phase: ThreadTrackedStage
): string {
  switch (phase) {
    case "initiating_pipeline":
      return t.insights.threadPhases.preparing.label;
    case "distilling_core_logic":
      return t.insights.threadPhases.distilling.label;
    case "curating_summary":
      return t.insights.threadPhases.curating.label;
    case "persisting_result":
      return t.insights.threadPhases.finalising.label;
    default:
      return "";
  }
}

function getThreadPhaseSublabel(
  t: ReturnType<typeof useI18n>["t"],
  phase: ThreadTrackedStage
): string {
  switch (phase) {
    case "initiating_pipeline":
      return t.insights.threadPhases.preparing.desc;
    case "distilling_core_logic":
      return t.insights.threadPhases.distilling.desc;
    case "curating_summary":
      return t.insights.threadPhases.curating.desc;
    case "persisting_result":
      return t.insights.threadPhases.finalising.desc;
    default:
      return "";
  }
}

function getThreadPhaseStatus(
  t: ReturnType<typeof useI18n>["t"],
  phase: ThreadTrackedStage
): string {
  switch (phase) {
    case "initiating_pipeline":
      return t.insights.threadPhases.preparing.status;
    case "distilling_core_logic":
      return t.insights.threadPhases.distilling.status;
    case "curating_summary":
      return t.insights.threadPhases.curating.status;
    case "persisting_result":
      return t.insights.threadPhases.finalising.status;
    default:
      return t.insights.generating;
  }
}

function getWeeklyPhaseLabel(
  t: ReturnType<typeof useI18n>["t"],
  phase: WeeklyGenerationPhase
): string {
  switch (phase) {
    case "loading_thread_summaries":
      return t.insights.phases.loadingSummaries.label;
    case "pattern_detection":
      return t.insights.phases.patternDetection.label;
    case "cross_domain_mapping":
      return t.insights.phases.crossDomainMapping.label;
    case "composing_and_persisting":
      return t.insights.phases.composing.label;
    default:
      return "";
  }
}

function getWeeklyPhaseSublabel(
  t: ReturnType<typeof useI18n>["t"],
  phase: WeeklyGenerationPhase
): string {
  switch (phase) {
    case "loading_thread_summaries":
      return t.insights.phases.loadingSummaries.desc;
    case "pattern_detection":
      return t.insights.phases.patternDetection.desc;
    case "cross_domain_mapping":
      return t.insights.phases.crossDomainMapping.desc;
    case "composing_and_persisting":
      return t.insights.phases.composing.desc;
    default:
      return "";
  }
}

function getWeeklyPhaseStatus(
  t: ReturnType<typeof useI18n>["t"],
  phase: WeeklyGenerationPhase
): string {
  switch (phase) {
    case "loading_thread_summaries":
      return t.insights.phases.loadingSummaries.status;
    case "pattern_detection":
      return t.insights.phases.patternDetection.status;
    case "cross_domain_mapping":
      return t.insights.phases.crossDomainMapping.status;
    case "composing_and_persisting":
      return t.insights.phases.composing.status;
    default:
      return t.insights.generatingDigest;
  }
}

function toThreadTrackedStage(
  stage: InsightPipelineStage
): ThreadTrackedStage | null {
  switch (stage) {
    case "initiating_pipeline":
      return "initiating_pipeline";
    case "distilling_core_logic":
      return "distilling_core_logic";
    case "curating_summary":
      return "curating_summary";
    case "persisting_result":
      return "persisting_result";
    default:
      return null;
  }
}

function formatPhaseDuration(ms: number): string {
  const seconds = Math.max(ms, 0) / 1000;
  if (seconds >= 100) {
    return `${Math.round(seconds)}s`;
  }
  return `${seconds.toFixed(1)}s`;
}

function toDepthLabel(
  t: ReturnType<typeof useI18n>["t"],
  depth: "superficial" | "moderate" | "deep"
): string {
  if (depth === "deep") return t.insights.depthLabels.deep;
  if (depth === "moderate") return t.insights.depthLabels.moderate;
  return t.insights.depthLabels.superficial;
}

function getPlatformBadgeClass(platform: Platform): string {
  switch (platform) {
    case "ChatGPT":
      return "ins-platform-badge-chatgpt";
    case "DeepSeek":
      return "ins-platform-badge-deepseek";
    case "Qwen":
      return "ins-platform-badge-qwen";
    case "Doubao":
      return "ins-platform-badge-doubao";
    case "Gemini":
      return "ins-platform-badge-gemini";
    case "Claude":
      return "ins-platform-badge-claude";
    case "Kimi":
      return "ins-platform-badge-kimi";
    case "Yuanbao":
      return "ins-platform-badge-yuanbao";
    default:
      return "ins-platform-badge-chatgpt";
  }
}

function getThreadThemeClass(platform: Platform): string {
  switch (platform) {
    case "ChatGPT":
      return "ins-thread-theme-chatgpt";
    case "Claude":
      return "ins-thread-theme-claude";
    case "Gemini":
      return "ins-thread-theme-gemini";
    case "DeepSeek":
      return "ins-thread-theme-deepseek";
    case "Qwen":
      return "ins-thread-theme-qwen";
    case "Doubao":
      return "ins-thread-theme-doubao";
    case "Kimi":
      return "ins-thread-theme-kimi";
    case "Yuanbao":
      return "ins-thread-theme-yuanbao";
    default:
      return "ins-thread-theme-chatgpt";
  }
}

function formatConversationWeekday(conversation: Conversation, locale: string = "en"): string {
  const ts = getConversationOriginAt(conversation);
  return new Date(ts).toLocaleDateString(locale, { weekday: "short" });
}

function toThreadSummaryUiState(
  conversation: Conversation | null,
  summaryStatus: AsyncStatus,
  summaryData: ReturnType<typeof toChatSummaryData> | null
): ThreadSummaryUiState {
  if (!conversation) return "no_thread";

  if (summaryData) {
    if (summaryStatus === "loading") return "ready_loading";
    if (summaryStatus === "error") return "ready_error";
    return "ready";
  }

  if (summaryStatus === "loading") return "selected_loading";
  if (summaryStatus === "error") return "selected_error";
  return "selected_idle";
}

function toWeeklyStableState(data: WeeklySummaryData | null): WeeklyStableUiState {
  if (!data) return "idle";
  return data.insufficient_data ? "sparse_week" : "ready";
}

// A weekly_recap.v1 report is always "ready" (warm recap never goes sparse);
// other reports fall back to the weekly_lite stable-state logic.
function resolveWeeklyStableState(
  report: WeeklyReportRecord | null,
  locale: SupportedLocale
): WeeklyStableUiState {
  if (!report) return "idle";
  if (toWeeklyRecapData(report, locale)) return "ready";
  return toWeeklyStableState(toWeeklySummaryData(report, locale));
}

interface InsightsPageProps {
  conversation: Conversation | null;
  refreshToken: number;
  pipelineProgressEvent?: InsightPipelineProgressPayload | null;
}

export function InsightsPage({
  conversation,
  refreshToken,
  pipelineProgressEvent = null,
}: InsightsPageProps) {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState<SummaryRecord | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<AsyncStatus>("idle");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportRecord | null>(null);
  const [weeklyUiState, setWeeklyUiState] = useState<WeeklyDigestUiState>("idle");
  const [weeklyStableState, setWeeklyStableState] = useState<WeeklyStableUiState>("idle");
  const [weeklyError, setWeeklyError] = useState<string | null>(null);

  const [weeklyConversations, setWeeklyConversations] = useState<Conversation[]>([]);
  const [isWeeklyListExpanded, setIsWeeklyListExpanded] = useState(false);
  const [weeklyRangeMode, setWeeklyRangeMode] =
    useState<WeeklyRangeMode>("last_full_week");

  const [weeklyPhase, setWeeklyPhase] =
    useState<WeeklyGenerationPhase>("ready_to_compile");
  const [weeklyGenerationStartedAt, setWeeklyGenerationStartedAt] =
    useState<number | null>(null);
  const [weeklyElapsedMs, setWeeklyElapsedMs] = useState(0);
  const [weeklyGenerationPaused, setWeeklyGenerationPaused] = useState(false);
  const [weeklyPauseStartedAt, setWeeklyPauseStartedAt] =
    useState<number | null>(null);
  const [weeklyPausedAccumulatedMs, setWeeklyPausedAccumulatedMs] = useState(0);
  const [threadGenerationStartedAt, setThreadGenerationStartedAt] =
    useState<number | null>(null);
  const [threadElapsedMs, setThreadElapsedMs] = useState(0);
  const [threadPipelineTiming, setThreadPipelineTiming] =
    useState<ThreadPipelineTimingState | null>(null);

  const [threadSummaryOpen, setThreadSummaryOpen] = useState(true);
  const [weeklyDigestOpen, setWeeklyDigestOpen] = useState(true);
  const [discoveryOpen, setDiscoveryOpen] = useState(true);

  const weeklyStableRef = useRef<WeeklyStableUiState>("idle");
  const weeklyUiStateRef = useRef<WeeklyDigestUiState>("idle");
  const weeklyHasReportRef = useRef(false);
  const weeklyGenerationRunRef = useRef(0);
  // Tracks which last-full-week range we've already auto-generated, so the
  // automatic recap fires at most once per range (no retry loop on failure).
  const weeklyAutoGenRangeRef = useRef<string | null>(null);

  const weekAnchorKey = new Date().toDateString();
  const weeklyRange = useMemo(
    () =>
      weeklyRangeMode === "last_full_week"
        ? getPreviousNaturalWeekRangeLocal(new Date())
        : getLastSevenDaysRangeLocal(new Date()),
    [weekAnchorKey, weeklyRangeMode]
  );

  const summaryData = useMemo(
    () =>
      summary
        ? toChatSummaryData(summary, {
            conversationTitle: conversation?.title,
            locale,
          })
        : null,
    [summary, conversation?.title, locale]
  );

  const weeklyData = useMemo(
    () => (weeklyReport ? toWeeklySummaryData(weeklyReport, locale) : null),
    [weeklyReport, locale]
  );
  const weeklyRecapData = useMemo<WeeklyRecapData | null>(
    () => (weeklyReport ? toWeeklyRecapData(weeklyReport, locale) : null),
    [weeklyReport, locale]
  );
  const activeThreadPipelineEvent = useMemo(() => {
    if (!pipelineProgressEvent || !conversation) return null;
    if (pipelineProgressEvent.scope !== "summary") return null;
    if (pipelineProgressEvent.targetId !== String(conversation.id)) return null;
    return pipelineProgressEvent;
  }, [pipelineProgressEvent, conversation]);
  const threadPipelinePhaseIndex =
    activeThreadPipelineEvent
      ? getThreadPhaseIndexFromPipelineStage(activeThreadPipelineEvent.stage)
      : null;

  const threadSummaryUiState = toThreadSummaryUiState(
    conversation,
    summaryStatus,
    summaryData
  );
  const threadJourneySteps = useMemo(() => {
    const rawSteps = summaryData?.thinking_journey ?? [];
    const normalized = rawSteps
      .map((step) => {
        const assertion = normalizeJourneyCopy(step.assertion);
        const anchor = step.real_world_anchor
          ? normalizeJourneyCopy(step.real_world_anchor)
          : null;

        const assertionRenderable = hasRenderableJourneyCopy(assertion);
        const anchorRenderable = anchor ? hasRenderableJourneyCopy(anchor) : false;

        if (!assertionRenderable && step.speaker === "AI" && anchorRenderable) {
          return {
            ...step,
            assertion: anchor!,
            real_world_anchor: null,
          };
        }

        return {
          ...step,
          assertion,
          real_world_anchor: anchorRenderable ? anchor : null,
        };
      })
      .filter((step) => hasRenderableJourneyCopy(step.assertion))
      .map((step, index) => ({
        ...step,
        step: index + 1,
      }));

    return normalized;
  }, [summaryData?.thinking_journey]);
  const threadInsightItems = summaryData?.key_insights ?? [];
  const threadUnresolvedItems = summaryData?.unresolved_threads ?? [];
  const threadNextStepItems = summaryData?.actionable_next_steps ?? [];
  const threadRealWorldAnchors = threadJourneySteps
    .map((step) => step.real_world_anchor)
    .filter((anchor): anchor is string => Boolean(anchor && anchor.trim().length > 0));
  const threadPhaseIndex =
    summaryStatus === "loading"
      ? threadPipelinePhaseIndex ?? getThreadPhaseIndex(threadElapsedMs)
      : threadGenerationStartedAt
        ? getThreadPhaseIndex(threadElapsedMs)
        : -1;
  const threadStatusText =
    summaryStatus === "loading" && activeThreadPipelineEvent
      ? getThreadStatusFromPipelineStage(
          t,
          activeThreadPipelineEvent.stage,
          activeThreadPipelineEvent.status
        )
      : threadPhaseIndex >= 0
        ? getThreadPhaseStatus(
            t,
            THREAD_TRACKED_STAGE_ORDER[threadPhaseIndex]!
          )
        : t.insights.readyToGenerate;
  const getThreadPhaseTimeLabel = (index: number): string => {
    const fallbackHint = THREAD_PHASES[index]?.hint ?? "~10s";
    const stageKey = THREAD_TRACKED_STAGE_ORDER[index];
    if (!stageKey || !threadPipelineTiming) {
      return fallbackHint;
    }

    const measured = threadPipelineTiming.stageDurationsMs[stageKey];
    if (typeof measured === "number") {
      return formatPhaseDuration(measured);
    }

    if (threadPipelineTiming.activeStage === stageKey) {
      const start = threadPipelineTiming.stageStarts[stageKey];
      if (typeof start === "number") {
        return formatPhaseDuration(Date.now() - start);
      }
    }

    return fallbackHint;
  };

  const weeklyRangeLabel =
    weeklyData?.meta.range_label ??
    formatWeekRangeLabel(weeklyRange.rangeStart, weeklyRange.rangeEnd, locale);

  const weeklyThreadCount = weeklyConversations.length;
  const weeklyCountLabel = weeklyThreadCount === 1
    ? `${weeklyThreadCount} ${t.insights.threadInRange}`
    : `${weeklyThreadCount} ${t.insights.threadsInRange}`;

  const sortedWeeklyConversations = useMemo(() => {
    return [...weeklyConversations].sort(
      (a, b) => getConversationOriginAt(b) - getConversationOriginAt(a)
    );
  }, [weeklyConversations]);

  const visibleWeeklyConversations = isWeeklyListExpanded
    ? sortedWeeklyConversations
    : sortedWeeklyConversations.slice(0, COLLAPSE_AT);

  const hiddenWeeklyConversationCount = Math.max(
    sortedWeeklyConversations.length - COLLAPSE_AT,
    0
  );

  const turnCount = conversation
    ? resolveTurnCount(conversation.turn_count, conversation.message_count)
    : 0;

  const weeklyPhaseIndex = WEEKLY_PHASES.findIndex(
    (phase) => phase.phase === weeklyPhase
  );

  const isWeeklyGenerating = weeklyUiState === "generating";

  const weeklyStatusText =
    weeklyPhase === "ready_to_compile"
      ? t.insights.readyToCompile
      : getWeeklyPhaseStatus(t, weeklyPhase);
  const weeklyRangeModeLabel =
    weeklyRangeMode === "last_7_days" ? t.insights.last7Days : t.insights.lastFullWeek;

  const weeklyHighlightItems =
    weeklyData?.highlights && weeklyData.highlights.length > 0
      ? weeklyData.highlights
      : parsePlainTextLines(weeklyData?.plain_text).slice(0, 3);

  const weeklyRecurringItems = weeklyData?.recurring_questions ?? [];
  const weeklyCrossDomainEchoes = weeklyData?.cross_domain_echoes ?? [];
  const weeklyUnresolvedItems = weeklyData?.unresolved_threads ?? [];
  const weeklyNextWeekItems = weeklyData?.suggested_focus ?? [];
  const weeklySubstantialCount = useMemo(() => {
    const structured = weeklyReport?.structured as
      | { time_range?: { total_conversations?: unknown } }
      | null
      | undefined;
    const total = structured?.time_range?.total_conversations;
    return typeof total === "number" ? total : null;
  }, [weeklyReport]);
  const weeklySparseReason: WeeklySparseReason =
    weeklySubstantialCount !== null && weeklySubstantialCount < 3
      ? "sub3"
      : "semantic_degraded";

  useEffect(() => {
    weeklyStableRef.current = weeklyStableState;
  }, [weeklyStableState]);

  useEffect(() => {
    weeklyUiStateRef.current = weeklyUiState;
  }, [weeklyUiState]);

  useEffect(() => {
    weeklyHasReportRef.current = Boolean(weeklyReport);
  }, [weeklyReport]);

  useEffect(() => {
    if (!activeThreadPipelineEvent) return;

    setThreadPipelineTiming((prev) => {
      const trackedStage = toThreadTrackedStage(activeThreadPipelineEvent.stage);
      const isTerminal =
        activeThreadPipelineEvent.stage === "completed" ||
        activeThreadPipelineEvent.stage === "degraded_fallback";

      if (!prev || prev.pipelineId !== activeThreadPipelineEvent.pipelineId) {
        const stageStarts: Partial<Record<ThreadTrackedStage, number>> = {};
        if (trackedStage) {
          stageStarts[trackedStage] = activeThreadPipelineEvent.updatedAt;
        }
        return {
          pipelineId: activeThreadPipelineEvent.pipelineId,
          stageStarts,
          stageDurationsMs: {},
          activeStage: trackedStage,
          terminal: isTerminal,
        };
      }

      const stageStarts = { ...prev.stageStarts };
      const stageDurationsMs = { ...prev.stageDurationsMs };
      let activeStage = prev.activeStage;

      const finalizeStage = (stage: ThreadTrackedStage, endAt: number) => {
        const startAt = stageStarts[stage];
        if (typeof startAt !== "number") return;
        stageDurationsMs[stage] = Math.max(0, endAt - startAt);
      };

      if (trackedStage && activeStage !== trackedStage) {
        if (activeStage) {
          finalizeStage(activeStage, activeThreadPipelineEvent.updatedAt);
        }
        if (typeof stageStarts[trackedStage] !== "number") {
          stageStarts[trackedStage] = activeThreadPipelineEvent.updatedAt;
        }
        activeStage = trackedStage;
      }

      if (isTerminal && activeStage) {
        finalizeStage(activeStage, activeThreadPipelineEvent.updatedAt);
        activeStage = null;
      }

      return {
        pipelineId: prev.pipelineId,
        stageStarts,
        stageDurationsMs,
        activeStage,
        terminal: prev.terminal || isTerminal,
      };
    });
  }, [activeThreadPipelineEvent]);

  useEffect(() => {
    if (weeklyUiStateRef.current === "generating") {
      return;
    }
    setWeeklyReport(null);
    setWeeklyStableState("idle");
    setWeeklyUiState("idle");
    setWeeklyError(null);
    setWeeklyPhase("ready_to_compile");
  }, [weekAnchorKey, weeklyRangeMode]);

  useEffect(() => {
    return () => {
      weeklyGenerationRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!weeklyGenerationStartedAt) {
      setWeeklyElapsedMs(0);
      return;
    }

    const tick = () => {
      const now = Date.now();
      const livePauseMs =
        weeklyGenerationPaused && weeklyPauseStartedAt
          ? now - weeklyPauseStartedAt
          : 0;
      const elapsed = Math.max(
        0,
        now - weeklyGenerationStartedAt - weeklyPausedAccumulatedMs - livePauseMs
      );
      setWeeklyElapsedMs(elapsed);
      setWeeklyPhase((prev) => {
        const next = getWeeklyPhaseByElapsed(elapsed);
        return prev === next ? prev : next;
      });
    };

    tick();
    const timerId = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(timerId);
    };
  }, [
    weeklyGenerationPaused,
    weeklyGenerationStartedAt,
    weeklyPauseStartedAt,
    weeklyPausedAccumulatedMs,
  ]);

  useEffect(() => {
    if (summaryStatus === "loading") {
      setThreadGenerationStartedAt((prev) => prev ?? Date.now());
      return;
    }
    setThreadGenerationStartedAt(null);
    setThreadElapsedMs(0);
  }, [summaryStatus]);

  useEffect(() => {
    if (!threadGenerationStartedAt) {
      setThreadElapsedMs(0);
      return;
    }

    const tick = () => {
      setThreadElapsedMs(Date.now() - threadGenerationStartedAt);
    };

    tick();
    const timerId = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(timerId);
    };
  }, [threadGenerationStartedAt]);

  useEffect(() => {
    if (!conversation) {
      setSummary(null);
      setSummaryStatus("idle");
      setSummaryError(null);
      setThreadPipelineTiming(null);
      return;
    }

    let active = true;
    setSummaryStatus("loading");
    setSummaryError(null);

    getConversationSummary(conversation.id)
      .then((data) => {
        if (!active) return;
        setSummary(data);
        setSummaryStatus(data ? "ready" : "idle");
      })
      .catch((error) => {
        if (!active) return;
        setSummary(null);
        setSummaryStatus("error");
        setSummaryError(getErrorMessage(t, error));
      });

    return () => {
      active = false;
    };
  }, [conversation?.id, refreshToken]);

  useEffect(() => {
    setThreadPipelineTiming(null);
  }, [conversation?.id]);

  useEffect(() => {
    if (WEEKLY_DIGEST_SOON) {
      setWeeklyConversations([]);
      setIsWeeklyListExpanded(false);
      return;
    }

    let active = true;

    getConversations({
      dateRange: {
        start: weeklyRange.rangeStart,
        end: weeklyRange.rangeEnd,
      },
    })
      .then((items) => {
        if (!active) return;
        setWeeklyConversations(items.filter((item) => !item.is_trash));
        setIsWeeklyListExpanded(false);
      })
      .catch(() => {
        if (!active) return;
        setWeeklyConversations([]);
        setIsWeeklyListExpanded(false);
      });

    return () => {
      active = false;
    };
  }, [refreshToken, weeklyRange.rangeStart, weeklyRange.rangeEnd]);

  useEffect(() => {
    if (WEEKLY_DIGEST_SOON) {
      setWeeklyReport(null);
      setWeeklyStableState("idle");
      setWeeklyUiState("idle");
      setWeeklyError(null);
      setWeeklyPhase("ready_to_compile");
      return;
    }

    if (weeklyUiStateRef.current === "generating") {
      return;
    }

    let active = true;
    setWeeklyError(null);

    getWeeklyReport(weeklyRange.rangeStart, weeklyRange.rangeEnd)
      .then((data) => {
        if (!active) return;
        setWeeklyReport(data);
        const nextStableState = resolveWeeklyStableState(data, locale);
        setWeeklyStableState(nextStableState);
        setWeeklyUiState(nextStableState);
        setWeeklyPhase("ready_to_compile");

        // Auto-generate the recap for the completed week ("上周") once it has no
        // stored report yet. "近 7 天" stays manual (it changes daily, so an
        // auto recap would be stale immediately).
        const rangeKey = `${weeklyRange.rangeStart}:${weeklyRange.rangeEnd}`;
        if (
          !data &&
          weeklyRangeMode === "last_full_week" &&
          weeklyAutoGenRangeRef.current !== rangeKey
        ) {
          weeklyAutoGenRangeRef.current = rangeKey;
          void handleGenerateWeekly();
        }
      })
      .catch((error) => {
        if (!active) return;
        setWeeklyError(getErrorMessage(t, error));
        setWeeklyUiState(weeklyHasReportRef.current ? weeklyStableRef.current : "error");
      });

    return () => {
      active = false;
    };
  }, [refreshToken, weeklyRange.rangeStart, weeklyRange.rangeEnd]);

  const handleGenerateSummary = async () => {
    if (!conversation) return;

    setThreadSummaryOpen(true);
    setThreadGenerationStartedAt(Date.now());
    setThreadElapsedMs(0);
    setThreadPipelineTiming(null);
    setSummaryStatus("loading");
    setSummaryError(null);

    try {
      const data = await generateConversationSummary(conversation.id);
      setSummary(data);
      setSummaryStatus("ready");
    } catch (error) {
      setSummaryStatus("error");
      setSummaryError(getErrorMessage(t, error));
    }
  };

  const handleGenerateWeekly = async () => {
    if (WEEKLY_DIGEST_SOON) {
      return;
    }

    const runId = weeklyGenerationRunRef.current + 1;
    weeklyGenerationRunRef.current = runId;

    setWeeklyDigestOpen(true);
    setWeeklyUiState("generating");
    setWeeklyError(null);
    setWeeklyPhase("loading_thread_summaries");
    setWeeklyGenerationStartedAt(Date.now());
    setWeeklyGenerationPaused(false);
    setWeeklyPauseStartedAt(null);
    setWeeklyPausedAccumulatedMs(0);

    const result = await generateWeeklyRecap(weeklyRange.rangeStart, weeklyRange.rangeEnd)
      .then((data) => ({ ok: true as const, data }))
      .catch((error) => ({ ok: false as const, error }));

    if (weeklyGenerationRunRef.current !== runId) {
      return;
    }

    setWeeklyGenerationStartedAt(null);
    setWeeklyGenerationPaused(false);
    setWeeklyPauseStartedAt(null);
    setWeeklyPausedAccumulatedMs(0);
    setWeeklyPhase("ready_to_compile");

    if (result.ok === true) {
      setWeeklyReport(result.data);
      const nextStableState = resolveWeeklyStableState(result.data, locale);
      setWeeklyStableState(nextStableState);
      setWeeklyUiState(nextStableState);
      setWeeklyError(null);
      return;
    }

    const nextError = getErrorMessage(
      t,
      result.ok === false ? result.error : "UNKNOWN_ERROR"
    );
    setWeeklyError(nextError);

    if (weeklyHasReportRef.current) {
      setWeeklyUiState(weeklyStableRef.current);
    } else {
      setWeeklyUiState("error");
    }
  };

  const handleToggleWeeklyPause = () => {
    if (!isWeeklyGenerating || !weeklyGenerationStartedAt) {
      return;
    }

    const now = Date.now();
    if (weeklyGenerationPaused) {
      if (weeklyPauseStartedAt) {
        setWeeklyPausedAccumulatedMs(
          (prev) => prev + (now - weeklyPauseStartedAt)
        );
      }
      setWeeklyPauseStartedAt(null);
      setWeeklyGenerationPaused(false);
      return;
    }

    setWeeklyPauseStartedAt(now);
    setWeeklyGenerationPaused(true);
  };

  const renderThreadContext = () => {
    if (!conversation) return null;

    return (
      <div className="ins-thread-ctx">
        <span
          className={`ins-platform-badge ${getPlatformBadgeClass(
            conversation.platform
          )} ins-thread-platform-badge`}
        >
          {conversation.platform}
        </span>
        <div className="min-w-0 flex-1">
          <p className="ins-thread-title line-clamp-2">{conversation.title}</p>
          <p className="ins-thread-meta">
            {conversation.message_count} messages - {turnCount} turns
          </p>
        </div>
      </div>
    );
  };

  const renderThreadSummaryBody = () => {
    if (threadSummaryUiState === "no_thread") {
      return (
        <p className="ins-empty">
          {t.insights.selectThreadHint}
        </p>
      );
    }

    const showGeneratingShell =
      threadSummaryUiState === "selected_loading" ||
      threadSummaryUiState === "ready_loading";
    const showReadyShell =
      threadSummaryUiState === "ready" ||
      threadSummaryUiState === "ready_loading" ||
      threadSummaryUiState === "ready_error";

    return (
      <div className="flex flex-col gap-2">
        {renderThreadContext()}

        {showGeneratingShell && (
          <div className="ins-thread-gen-shell">
            <div className="ins-thread-gen-header">
              <span className="ins-thread-wand-wrap" aria-hidden="true">
                <span className="ins-thread-wand-ring" />
                <span className="ins-thread-wand-chip">
                  <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="ins-thread-status-copy">{threadStatusText}</p>
              </div>

              <span className="ins-thread-timer">{formatTimer(threadElapsedMs)}</span>
            </div>

            <div className="ins-thread-phase-track">
              {THREAD_PHASES.map((phase, index) => {
                const rowState =
                  threadPhaseIndex > index
                    ? "ins-thread-phase-done"
                    : threadPhaseIndex === index
                      ? "ins-thread-phase-active"
                      : "ins-thread-phase-idle";
                const trackedPhase = THREAD_TRACKED_STAGE_ORDER[index]!;
                return (
                  <div key={trackedPhase} className={`ins-thread-phase-row ${rowState}`}>
                    <span className="ins-thread-phase-dot" />
                    <span className="min-w-0 flex-1">
                      <span className="ins-thread-phase-label">{getThreadPhaseLabel(t, trackedPhase)}</span>
                      <span className="ins-thread-phase-sublabel">{getThreadPhaseSublabel(t, trackedPhase)}</span>
                    </span>
                    <span className="ins-thread-phase-time">
                      {getThreadPhaseTimeLabel(index)}
                    </span>
                    <span className="ins-thread-phase-tick">OK</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showReadyShell && summaryData && (
          <div
            className={`ins-thread-ready-shell ${
              conversation ? getThreadThemeClass(conversation.platform) : ""
            }`}
          >
            <section className="ins-thread-core-card">
              <p className="ins-thread-core-label">{t.insights.coreQuestion}</p>
              <p className="ins-thread-core-text">{summaryData.core_question}</p>
            </section>

            {threadJourneySteps.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{t.insights.thinkingJourney}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadJourneySteps.length}</span>
                </div>
                <div className="ins-thread-journey-list">
                  {threadJourneySteps.map((step, index) => (
                    <article
                      key={`${index + 1}-${step.speaker}-${step.assertion}`}
                      className={`ins-thread-step-card ${
                        step.speaker === "User" ? "ins-thread-step-user" : "ins-thread-step-ai"
                      }`}
                    >
                      <div className="ins-thread-step-head">
                        <span className="ins-thread-step-num">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={`ins-thread-speaker-chip ${
                            step.speaker === "User"
                              ? "ins-thread-speaker-user"
                              : "ins-thread-speaker-ai"
                          }`}
                        >
                          {step.speaker === "User" ? t.message.you : t.message.aiPrefix}
                        </span>
                      </div>
                      <p className="ins-thread-step-assertion">{step.assertion}</p>

                      {step.speaker === "AI" && step.real_world_anchor && (
                        <blockquote className="ins-thread-anchor-quote">
                          <p className="ins-thread-anchor-text">{step.real_world_anchor}</p>
                        </blockquote>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {threadInsightItems.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{t.insights.keyInsights}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadInsightItems.length}</span>
                </div>
                <div className="ins-thread-insight-list">
                  {threadInsightItems.map((item, index) => (
                    <article className="ins-thread-insight-card" key={`${item.term}-${index}`}>
                      <p className="ins-thread-insight-term">{item.term}</p>
                      <p className="ins-thread-insight-def">{item.definition}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {threadUnresolvedItems.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{t.insights.unresolvedThreads}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadUnresolvedItems.length}</span>
                </div>
                <div className="ins-thread-unresolved-list">
                  {threadUnresolvedItems.map((item, index) => (
                    <article className="ins-thread-unresolved-item" key={`${item}-${index}`}>
                      <span className="ins-thread-unresolved-dot" />
                      <p className="ins-thread-unresolved-text">{item}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {threadNextStepItems.length > 0 && (
              <section>
                <div className="ins-thread-sec-head">
                  <span className="ins-thread-sec-label">{t.insights.nextSteps}</span>
                  <span className="ins-thread-sec-line" />
                  <span className="ins-thread-sec-count">{threadNextStepItems.length}</span>
                </div>
                <div className="ins-thread-next-list">
                  {threadNextStepItems.map((item, index) => (
                    <article className="ins-thread-next-item" key={`${item}-${index}`}>
                      <span className="ins-thread-next-num">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p className="ins-thread-next-text">{item}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="ins-thread-sec-head">
                <span className="ins-thread-sec-label">{t.insights.metaObservations}</span>
                <span className="ins-thread-sec-line" />
              </div>
              <div className="ins-thread-meta-row">
                <span className="ins-thread-meta-chip ins-thread-meta-chip-depth">
                  {toDepthLabel(t, summaryData.meta_observations.depth_level)}
                </span>
                <span className="ins-thread-meta-chip">
                  {summaryData.meta_observations.thinking_style}
                </span>
                <span className="ins-thread-meta-chip">
                  {summaryData.meta_observations.emotional_tone}
                </span>
              </div>
            </section>

            {threadRealWorldAnchors.length > 0 && (
              <p className="ins-meta-line">
                {t.insights.reasoningNodes.replace("{count}", String(threadRealWorldAnchors.length))}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleGenerateSummary}
          disabled={summaryStatus === "loading"}
          className="ins-generate-btn"
        >
          {summaryStatus === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-primary" />
          ) : (
            <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
          )}
          {summaryData ? t.insights.regenerate : t.insights.generateSummary}
        </button>

        {(threadSummaryUiState === "selected_idle" ||
          threadSummaryUiState === "selected_error") && (
          <p className="ins-empty ins-empty-left">
            {t.insights.noSummaryYet}
          </p>
        )}

        {(threadSummaryUiState === "selected_error" ||
          threadSummaryUiState === "ready_error") && (
          <p className="ins-status-row ins-status-error">
            {t.insights.failedToGenerateSummary} {summaryError}
            <button
              type="button"
              onClick={handleGenerateSummary}
              className="ins-inline-link"
            >
              {t.common.retry}
            </button>
          </p>
        )}

        {summary && (
          <div className="ins-model-meta">
            <p className="ins-model-meta-line">
              <span className="ins-model-meta-label">{t.insights.modelLabel}:</span>
              <span className="ins-model-meta-value">{summary.modelId}</span>
            </p>
            <p className="ins-model-meta-line">
              <span className="ins-model-meta-label">{t.insights.generatedLabel}:</span>
              <span className="ins-model-meta-value">
                {formatDateTime(summary.createdAt, locale)}
              </span>
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderWeeklyRangeToggle = () => {
    return (
      <div
        className={`ins-week-range-toggle ${isWeeklyGenerating ? "is-disabled" : ""}`}
        role="radiogroup"
        aria-label={t.insights.weeklyDigest}
      >
        <button
          type="button"
          role="radio"
          aria-checked={weeklyRangeMode === "last_7_days"}
          disabled={isWeeklyGenerating}
          onClick={() => setWeeklyRangeMode("last_7_days")}
          className={`ins-week-range-btn ${
            weeklyRangeMode === "last_7_days" ? "is-active" : ""
          }`}
        >
          {t.insights.last7Days}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={weeklyRangeMode === "last_full_week"}
          disabled={isWeeklyGenerating}
          onClick={() => setWeeklyRangeMode("last_full_week")}
          className={`ins-week-range-btn ${
            weeklyRangeMode === "last_full_week" ? "is-active" : ""
          }`}
        >
          {t.insights.lastFullWeek}
        </button>
      </div>
    );
  };

  const renderWeeklyIdle = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">
            {weeklyCountLabel} - {weeklyRangeModeLabel}
          </span>
        </div>
        {renderWeeklyRangeToggle()}

        <div className="ins-week-thread-list">
          {visibleWeeklyConversations.map((item) => (
            <div className="ins-week-thread-row" key={item.id}>
              <span
                className={`ins-platform-badge ${getPlatformBadgeClass(
                  item.platform
                )}`}
              >
                {item.platform}
              </span>
              <p className="ins-week-thread-title">{item.title}</p>
              <span className="ins-week-thread-day">
                {formatConversationWeekday(item, locale)}
              </span>
            </div>
          ))}

          {hiddenWeeklyConversationCount > 0 && (
            <button
              type="button"
              onClick={() => setIsWeeklyListExpanded((prev) => !prev)}
              className="ins-week-toggle"
            >
              <span className="ins-week-toggle-line" />
              <span className="ins-week-toggle-label">
                {isWeeklyListExpanded
                  ? t.common.collapse
                  : t.insights.moreThreads.replace("{count}", String(hiddenWeeklyConversationCount))}
              </span>
              <span className="ins-week-toggle-line" />
            </button>
          )}

          {sortedWeeklyConversations.length === 0 && (
            <p className="ins-empty">{t.insights.noThreadsThisWeek}</p>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerateWeekly}
          className="ins-week-generate-trigger"
        >
          <InsightsWandIcon className="h-3.5 w-3.5 ins-week-generate-trigger-icon" />
          <span className="ins-week-generate-trigger-text">
            {t.insights.generateDigest}
          </span>
        </button>
      </>
    );
  };

  const renderWeeklyGenerating = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">
            {weeklyCountLabel} - {weeklyRangeModeLabel}
          </span>
        </div>
        {renderWeeklyRangeToggle()}

        <div className="ins-week-gen-shell">
          <div className="ins-week-gen-header">
            <Loader2 className="h-4 w-4 animate-spin text-accent-primary" />
            <div className="min-w-0 flex-1">
              <p className="ins-week-status-copy">{t.insights.recapGenerating}</p>
            </div>
            <span className="ins-week-timer">{formatTimer(weeklyElapsedMs)}</span>
          </div>
        </div>
      </>
    );
  };

  const renderWeeklyRecap = (recap: WeeklyRecapData) => {
    const statStripParts: string[] = [
      t.insights.recapStatConversations.replace(
        "{count}",
        String(recap.stats.conversation_count)
      ),
      t.insights.recapStatActiveDays.replace(
        "{count}",
        String(recap.stats.active_days)
      ),
    ];
    if (recap.stats.streak_weeks >= 1) {
      statStripParts.push(
        t.insights.recapStatStreak.replace(
          "{count}",
          String(recap.stats.streak_weeks)
        )
      );
    }
    if (recap.stats.top_platform && recap.stats.top_platform !== "—") {
      statStripParts.push(
        t.insights.recapStatPlatform.replace(
          "{platform}",
          recap.stats.top_platform
        )
      );
    }
    const statStrip = statStripParts.join(" · ");

    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">
            {weeklyCountLabel} - {weeklyRangeModeLabel}
          </span>
        </div>
        {renderWeeklyRangeToggle()}

        {weeklyError && (
          <p className="ins-status-row ins-status-error ins-week-inline-gap">
            {t.insights.latestRegenerationFailed} {weeklyError}
            <button
              type="button"
              onClick={handleGenerateWeekly}
              className="ins-inline-link"
            >
              {t.common.retry}
            </button>
          </p>
        )}

        <div className="ins-week-ready-shell">
          <section className="ins-thread-core-card">
            <p className="ins-thread-core-label">{t.insights.recapTitle}</p>
            <p className="ins-thread-core-text">
              {recap.mood_emoji} {recap.greeting}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {recap.persona_tag && (
                <span className="ins-week-count-chip">{recap.persona_tag}</span>
              )}
              {statStrip && (
                <span className="text-[11px] text-text-tertiary">{statStrip}</span>
              )}
            </div>
          </section>

          {recap.narrative.length > 0 && (
            <section className="flex flex-col gap-2">
              {recap.narrative.map((paragraph, index) => (
                <p className="ins-thread-core-text" key={`recap-p-${index}`}>
                  {paragraph}
                </p>
              ))}
            </section>
          )}

          {recap.highlight && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">{t.insights.recapHighlight}</span>
                <span className="ins-week-sec-line" />
              </div>
              <article className="ins-week-highlight-item">
                <p className="ins-week-highlight-text">{recap.highlight.title}</p>
                <p className="ins-thread-insight-def">{recap.highlight.detail}</p>
              </article>
            </section>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerateWeekly}
          className="ins-generate-btn"
        >
          <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
          {t.insights.regenerate}
        </button>

        {weeklyReport && (
          <div className="ins-model-meta">
            <p className="ins-model-meta-line">
              <span className="ins-model-meta-label">{t.insights.modelLabel}:</span>
              <span className="ins-model-meta-value">{weeklyReport.modelId}</span>
            </p>
            <p className="ins-model-meta-line">
              <span className="ins-model-meta-label">{t.insights.generatedLabel}:</span>
              <span className="ins-model-meta-value">
                {formatDateTime(weeklyReport.createdAt, locale)}
              </span>
            </p>
          </div>
        )}
      </>
    );
  };

  const renderWeeklyReady = () => {
    if (weeklyRecapData) {
      return renderWeeklyRecap(weeklyRecapData);
    }

    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">
            {weeklyCountLabel} - {weeklyRangeModeLabel}
          </span>
        </div>
        {renderWeeklyRangeToggle()}

        {weeklyError && (
          <p className="ins-status-row ins-status-error ins-week-inline-gap">
            {t.insights.latestRegenerationFailed} {weeklyError}
            <button
              type="button"
              onClick={handleGenerateWeekly}
              className="ins-inline-link"
            >
              {t.common.retry}
            </button>
          </p>
        )}

        <div className="ins-week-ready-shell">
          {weeklyHighlightItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">{t.insights.highlights}</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-highlight-list">
                {weeklyHighlightItems.map((item, index) => (
                  <article className="ins-week-highlight-item" key={`${item}-${index}`}>
                    <p className="ins-week-highlight-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyRecurringItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">{t.insights.recurringQuestions}</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-recurring-list">
                {weeklyRecurringItems.map((item, index) => (
                  <article className="ins-week-recurring-item" key={`${item}-${index}`}>
                    <span className="ins-week-recurring-mark">"</span>
                    <p className="ins-week-recurring-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyCrossDomainEchoes.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">{t.insights.crossDomainEcho}</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-echo-list">
                {weeklyCrossDomainEchoes.map((echo, index) => (
                  <article className="ins-week-echo-card" key={`${echo.domain_a}-${index}`}>
                    <div className="ins-week-echo-domains">
                      <span className="ins-week-echo-domain-tag">{echo.domain_a}</span>
                      <span className="ins-week-echo-arrow">&lt;-&gt;</span>
                      <span className="ins-week-echo-domain-tag">{echo.domain_b}</span>
                    </div>
                    <p className="ins-week-echo-label">{t.insights.sharedLogic}</p>
                    <p className="ins-week-echo-text">{echo.shared_logic}</p>
                    {echo.evidence_ids.length > 0 && (
                      <div className="ins-week-ref-list">
                        {echo.evidence_ids.map((id) => (
                          <span key={id} className="ins-week-ref-chip">
                            {t.insights.thread} {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyUnresolvedItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">{t.insights.unresolved}</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-unresolved-list">
                {weeklyUnresolvedItems.map((item, index) => (
                  <article className="ins-week-unresolved-item" key={`${item}-${index}`}>
                    <span className="ins-week-unresolved-dot" />
                    <p className="ins-week-unresolved-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {weeklyNextWeekItems.length > 0 && (
            <section>
              <div className="ins-week-sec-head">
                <span className="ins-week-sec-label">{t.insights.nextWeek}</span>
                <span className="ins-week-sec-line" />
              </div>
              <div className="ins-week-focus-list">
                {weeklyNextWeekItems.map((item, index) => (
                  <article className="ins-week-focus-item" key={`${item}-${index}`}>
                    <span className="ins-week-focus-arrow">-&gt;</span>
                    <p className="ins-week-focus-text">{item}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        <button
          type="button"
          onClick={handleGenerateWeekly}
          className="ins-generate-btn"
        >
          <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
          {t.insights.regenerate}
        </button>

        {weeklyReport && (
          <div className="ins-model-meta">
            <p className="ins-model-meta-line">
              <span className="ins-model-meta-label">{t.insights.modelLabel}:</span>
              <span className="ins-model-meta-value">{weeklyReport.modelId}</span>
            </p>
            <p className="ins-model-meta-line">
              <span className="ins-model-meta-label">{t.insights.generatedLabel}:</span>
              <span className="ins-model-meta-value">
                {formatDateTime(weeklyReport.createdAt, locale)}
              </span>
            </p>
          </div>
        )}
      </>
    );
  };

  const renderWeeklySparse = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">
            {weeklyCountLabel} - {weeklyRangeModeLabel}
          </span>
        </div>
        {renderWeeklyRangeToggle()}

        {weeklyError && (
          <p className="ins-status-row ins-status-error ins-week-inline-gap">
            {t.insights.latestRegenerationFailed} {weeklyError}
            <button
              type="button"
              onClick={handleGenerateWeekly}
              className="ins-inline-link"
            >
              {t.common.retry}
            </button>
          </p>
        )}

        <div className="ins-week-sparse-card">
          <p className="ins-week-sparse-title">
            {t.insights.notEnoughData}
          </p>
          {weeklySparseReason === "sub3" && (
            <p className="ins-week-sparse-body">
              {t.insights.sub3Hint}
            </p>
          )}
          {weeklySparseReason === "semantic_degraded" && (
            <p className="ins-week-quality-note">
              {t.insights.semanticDegradedHint}
            </p>
          )}
          <div className="ins-week-sparse-stats">
            <span>{t.insights.threadsStartedInRange}: {weeklyThreadCount}</span>
            <span>
              {t.insights.substantialSummaries}:{" "}
              {weeklySubstantialCount === null ? t.common.unknown : weeklySubstantialCount}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerateWeekly}
          className="ins-generate-btn"
        >
          <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
          {t.insights.regenerate}
        </button>
      </>
    );
  };

  const renderWeeklyError = () => {
    return (
      <>
        <div className="ins-week-banner">
          <p className="ins-week-range">{weeklyRangeLabel}</p>
          <span className="ins-week-count-chip">
            {weeklyCountLabel} - {weeklyRangeModeLabel}
          </span>
        </div>
        {renderWeeklyRangeToggle()}

        <div className="ins-summary-result">
          <p className="ins-status-row ins-status-error">
            {t.insights.failedToGenerateWeekly} {weeklyError ?? t.insights.unknownError}
          </p>
          <button
            type="button"
            onClick={handleGenerateWeekly}
            className="ins-generate-btn ins-week-inline-gap"
          >
            <InsightsWandIcon className="h-3.5 w-3.5 text-accent-primary" />
            {t.common.retry}
          </button>
        </div>
      </>
    );
  };

  const renderWeeklyBody = () => {
    if (weeklyUiState === "generating") {
      return renderWeeklyGenerating();
    }

    if (weeklyUiState === "ready") {
      return renderWeeklyReady();
    }

    if (weeklyUiState === "sparse_week") {
      return renderWeeklySparse();
    }

    if (weeklyUiState === "error") {
      return renderWeeklyError();
    }

    return renderWeeklyIdle();
  };

  function openDashboard(tab: "explore" | "network") {
    const url = chrome.runtime.getURL(`options.html?tab=${tab}`);
    chrome.tabs.create({ url });
  }

  return (
    <div className="vesti-shell flex h-full flex-col overflow-y-auto vesti-scroll bg-bg-app">
      <header className="vesti-page-header">
        <h1 className="vesti-page-title text-text-primary">{t.pages.insights}</h1>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <p className="ins-group-label">{t.insights.onDemand}</p>

        <InsightsAccordionItem
          title={t.insights.threadSummary}
          description={t.insights.threadSummaryDesc}
          open={threadSummaryOpen}
          onToggle={() => setThreadSummaryOpen((prev) => !prev)}
          icon={
            <span className="relative inline-flex h-4 w-4 items-center justify-center">
              <FileText className="h-4 w-4" strokeWidth={1.5} />
              <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            </span>
          }
        >
          {renderThreadSummaryBody()}
        </InsightsAccordionItem>

        <p className="ins-group-label">{t.insights.scheduled}</p>

        <InsightsAccordionItem
          title={t.insights.weeklyDigest}
          description={t.insights.weeklyDigestDesc}
          open={weeklyDigestOpen}
          onToggle={
            WEEKLY_DIGEST_SOON ? undefined : () => setWeeklyDigestOpen((prev) => !prev)
          }
          icon={<CalendarDays className="h-4 w-4" strokeWidth={1.5} />}
          disabled={WEEKLY_DIGEST_SOON}
          soonTag={WEEKLY_DIGEST_SOON ? t.common.soon : undefined}
        >
          {renderWeeklyBody()}
        </InsightsAccordionItem>

        <p className="ins-group-label">{t.insights.discovery}</p>

        <InsightsAccordionItem
          title={t.insights.exploreNetwork}
          description={t.insights.exploreNetworkDesc}
          open={discoveryOpen}
          onToggle={() => setDiscoveryOpen((prev) => !prev)}
          icon={<Network className="h-4 w-4" strokeWidth={1.5} />}
        >
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={() => openDashboard("explore")}
              className="flex items-center justify-between w-full px-3 py-2.5
                   rounded-md bg-bg-surface-card hover:bg-bg-surface-card-hover
                   transition-colors duration-150 group"
            >
              <div className="flex items-center gap-2.5">
                <Compass className="w-4 h-4 text-text-secondary" strokeWidth={1.75} />
                <div className="text-left">
                  <p className="text-[13px] font-medium text-text-primary">{t.insights.explore}</p>
                  <p className="text-[11px] text-text-tertiary">
                    {t.insights.exploreDesc}
                  </p>
                </div>
              </div>
              <ExternalLink
                className="w-3.5 h-3.5 text-text-tertiary
                                 group-hover:text-accent-primary transition-colors"
                strokeWidth={1.75}
              />
            </button>
            <button
              type="button"
              onClick={() => openDashboard("network")}
              className="flex items-center justify-between w-full px-3 py-2.5
                   rounded-md bg-bg-surface-card hover:bg-bg-surface-card-hover
                   transition-colors duration-150 group"
            >
              <div className="flex items-center gap-2.5">
                <Network className="w-4 h-4 text-text-secondary" strokeWidth={1.75} />
                <div className="text-left">
                  <p className="text-[13px] font-medium text-text-primary">{t.insights.network}</p>
                  <p className="text-[11px] text-text-tertiary">
                    {t.insights.networkDesc}
                  </p>
                </div>
              </div>
              <ExternalLink
                className="w-3.5 h-3.5 text-text-tertiary
                                 group-hover:text-accent-primary transition-colors"
                strokeWidth={1.75}
              />
            </button>
          </div>
        </InsightsAccordionItem>
      </div>
    </div>
  );
}
