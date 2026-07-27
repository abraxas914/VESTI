import {
  ArrowUpRight,
  BookOpen,
  FilePlus2,
  ImageDown,
  Link2,
  MapPin,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "~lib/i18n";
import { getLocaleDateTag } from "~lib/i18n/locales";
import {
  getWeeklyPushSettings,
  setWeeklyPushSettings,
} from "~lib/services/weeklyPushSettingsService";
import {
  getWeeklyKnowledgeNoteStatus,
  saveWeeklyKnowledgeNote,
} from "~lib/services/storageService";
import type {
  WeeklyGrowthSeriesPoint,
  WeeklyGrowthTag,
  WeeklyMetricComparison,
  WeeklyRecapStyle,
} from "~lib/types";
import type { WeeklyGrowthData } from "~lib/types/insightsPresentation";
import {
  buildPrivacySafeWeeklyText,
  generateWeeklySharePNG,
} from "../../utils/weeklyShareService";
import { WeeklyContributionGrid } from "./WeeklyContributionGrid";
import { WeeklyGrowthTimeMachine } from "./WeeklyGrowthTimeMachine";
import { WeeklyPushCenter } from "./WeeklyPushCenter";
import { WeeklyTagCloud } from "./WeeklyTagCloud";

interface WeeklyGrowthReportProps {
  data: WeeklyGrowthData;
  reportId: number;
  onOpenHighlight?: (conversationId: number, messageId: number) => void;
  onSelectTag?: (tag: WeeklyGrowthTag) => void;
}

const COPY = {
  en: {
    title: "Personal Growth Weekly",
    energy: "Energy dashboard",
    focus: "Focus depth",
    rhythm: "Rhythm health",
    breadth: "Topic breadth",
    growth: "Growth curve",
    previousWeek: "vs. last week",
    previousMonth: "vs. last month",
    highlights: "This week's highlights",
    contribution: "Thinking contribution",
    tags: "Topic cloud",
    newTags: "New",
    hotTags: "Trending",
    mostConcerned: "The topic you cared about most this week was",
    latestQuestionPrefix: "Your latest question this week was at ",
    latestQuestionSuffix: ", when you asked",
    footprint: "Footprint summary",
    noData: "No data yet",
    open: "Open original conversation",
  },
  zh: {
    title: "个人成长周报",
    energy: "能量仪表盘",
    focus: "专注深度",
    rhythm: "节奏健康度",
    breadth: "话题广度",
    growth: "成长曲线",
    previousWeek: "较上周",
    previousMonth: "较上月",
    highlights: "本周精选",
    contribution: "思维贡献",
    tags: "话题标签云",
    newTags: "本周新增",
    hotTags: "本周热门",
    mostConcerned: "本周你最关心的话题为",
    latestQuestionPrefix: "本周最晚在 ",
    latestQuestionSuffix: " 提问，提的问题为",
    footprint: "足迹总结",
    noData: "暂无数据",
    open: "打开原对话",
  },
  ja: {
    title: "個人成長ウィークリー",
    energy: "エネルギーダッシュボード",
    focus: "集中の深さ",
    rhythm: "リズムの健全度",
    breadth: "話題の広さ",
    growth: "成長曲線",
    previousWeek: "先週比",
    previousMonth: "先月比",
    highlights: "今週のハイライト",
    contribution: "思考の貢献",
    tags: "トピッククラウド",
    newTags: "新規",
    hotTags: "人気",
    mostConcerned: "今週もっとも関心を寄せた話題は",
    latestQuestionPrefix: "今週最後に質問したのは",
    latestQuestionSuffix: "で、質問内容は",
    footprint: "足跡まとめ",
    noData: "データはまだありません",
    open: "元の会話を開く",
  },
  ko: {
    title: "개인 성장 주간 리포트",
    energy: "에너지 대시보드",
    focus: "집중 깊이",
    rhythm: "리듬 건강도",
    breadth: "주제 다양성",
    growth: "성장 곡선",
    previousWeek: "지난주 대비",
    previousMonth: "지난달 대비",
    highlights: "이번 주 하이라이트",
    contribution: "생각 기여도",
    tags: "주제 태그 클라우드",
    newTags: "신규",
    hotTags: "인기",
    mostConcerned: "이번 주 가장 관심을 둔 주제는",
    latestQuestionPrefix: "이번 주 가장 늦게 질문한 시각은 ",
    latestQuestionSuffix: "이며, 질문은",
    footprint: "활동 발자취 요약",
    noData: "아직 데이터가 없습니다",
    open: "원본 대화 열기",
  },
} as const;

const SHARE_STATUS = {
  en: {
    done: "Ready to share",
    failed: "Could not create the share item",
  },
  zh: {
    done: "已准备好分享",
    failed: "生成分享内容失败",
  },
  ja: {
    done: "共有の準備ができました",
    failed: "共有内容を作成できませんでした",
  },
  ko: {
    done: "공유할 준비가 되었습니다",
    failed: "공유 콘텐츠를 만들 수 없습니다",
  },
} as const;

const ACTION_COPY = {
  en: {
    exportImage: "Export image",
    shareLink: "Share link",
    comingSoon: "Share links are coming soon. Stay tuned!",
    copyFallback: "Copy weekly text",
    copied: "Weekly text copied",
    close: "Close",
    exportFailed: "Could not generate the image. Please try again later.",
    saveNote: "Save note",
    refreshNote: "Refresh note",
    openNote: "Open note",
    savingNote: "Saving…",
    noteSaved: "Saved to knowledge notes",
    noteRefreshed: "Knowledge note refreshed",
    noteProtected: "Your edited note was kept unchanged",
    noteFailed: "Could not save the knowledge note",
  },
  zh: {
    exportImage: "导出图片",
    shareLink: "分享链接",
    comingSoon: "分享链接功能即将上线，敬请期待！",
    copyFallback: "复制周报文本",
    copied: "周报文本已复制",
    close: "关闭",
    exportFailed: "生成图片失败，请稍后重试",
    saveNote: "沉淀为笔记",
    refreshNote: "更新笔记",
    openNote: "打开笔记",
    savingNote: "保存中…",
    noteSaved: "已沉淀到知识笔记",
    noteRefreshed: "知识笔记已更新",
    noteProtected: "检测到自主改写，已保留原笔记",
    noteFailed: "知识笔记保存失败",
  },
  ja: {
    exportImage: "画像を書き出す",
    shareLink: "リンクを共有",
    comingSoon: "共有リンク機能は近日公開予定です。",
    copyFallback: "週間テキストをコピー",
    copied: "週間テキストをコピーしました",
    close: "閉じる",
    exportFailed: "画像を生成できませんでした。しばらくしてから再試行してください。",
    saveNote: "ノートに保存",
    refreshNote: "ノートを更新",
    openNote: "ノートを開く",
    savingNote: "保存中…",
    noteSaved: "ナレッジノートに保存しました",
    noteRefreshed: "ナレッジノートを更新しました",
    noteProtected: "編集済みのノートを変更せず保持しました",
    noteFailed: "ナレッジノートを保存できませんでした",
  },
  ko: {
    exportImage: "이미지 내보내기",
    shareLink: "링크 공유",
    comingSoon: "공유 링크 기능이 곧 제공될 예정입니다.",
    copyFallback: "주간 텍스트 복사",
    copied: "주간 텍스트를 복사했습니다",
    close: "닫기",
    exportFailed: "이미지를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    saveNote: "노트로 저장",
    refreshNote: "노트 새로고침",
    openNote: "노트 열기",
    savingNote: "저장 중…",
    noteSaved: "지식 노트에 저장했습니다",
    noteRefreshed: "지식 노트를 새로고침했습니다",
    noteProtected: "직접 편집한 노트를 변경하지 않았습니다",
    noteFailed: "지식 노트를 저장하지 못했습니다",
  },
} as const;

function ScoreCard({
  label,
  score,
  detail,
}: {
  label: string;
  score?: number;
  detail?: string;
}) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score ?? 0)));
  return (
    <article className="rounded-lg border border-border-subtle bg-surface-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-vesti-xs font-medium text-text-secondary">{label}</p>
        <strong className="text-vesti-lg text-text-primary">{safeScore}</strong>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className="h-full rounded-full bg-accent-primary"
          style={{ width: `${safeScore}%` }}
        />
      </div>
      {detail ? (
        <p className="mt-2 text-[11px] text-text-tertiary">{detail}</p>
      ) : null}
    </article>
  );
}

function ComparisonBadge({
  label,
  comparison,
}: {
  label: string;
  comparison?: WeeklyMetricComparison;
}) {
  const delta = comparison?.deltas?.conversationCount ?? 0;
  return (
    <span
      className={`rounded-full px-2 py-1 text-[11px] ${
        delta >= 0
          ? "bg-accent-primary-light text-text-primary"
          : "bg-bg-tertiary text-text-tertiary"
      }`}
    >
      {label} {delta >= 0 ? "+" : ""}
      {Number(delta.toFixed(1))}
    </span>
  );
}

function GrowthCurve({ points = [] }: { points?: WeeklyGrowthSeriesPoint[] }) {
  if (points.length < 2) return null;
  const width = 280;
  const height = 88;
  const metrics: Array<keyof WeeklyGrowthSeriesPoint> = [
    "focusDepthScore",
    "rhythmScore",
    "topicBreadthScore",
  ];
  const colors = ["#26896d", "#6e76c9", "#d1844c"];

  return (
    <svg
      role="img"
      aria-label="Weekly growth trend"
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
    >
      {[0, 1, 2, 3].map((row) => (
        <line
          key={row}
          x1={0}
          x2={width}
          y1={(row * height) / 3}
          y2={(row * height) / 3}
          stroke="currentColor"
          className="text-border-subtle"
          strokeWidth={0.75}
        />
      ))}
      {metrics.map((metric, metricIndex) => {
        const coordinates = points
          .map((point, index) => {
            const x = (index / (points.length - 1)) * width;
            const value = Math.max(
              0,
              Math.min(100, Number(point[metric] ?? 0))
            );
            return `${x},${height - (value / 100) * height}`;
          })
          .join(" ");
        return (
          <polyline
            key={metric}
            points={coordinates}
            fill="none"
            stroke={colors[metricIndex]}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

function formatLatestQuestionTime(
  timestamp: number | null | undefined,
  locale: keyof typeof COPY,
  timezone?: string
): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (timezone) options.timeZone = timezone;
  try {
    return new Intl.DateTimeFormat(getLocaleDateTag(locale), options).format(
      new Date(timestamp)
    );
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat(getLocaleDateTag(locale), options).format(
      new Date(timestamp)
    );
  }
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.left = "-100000px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("WEEKLY_COPY_FAILED");
}

const DASHBOARD_NAV_REQUEST_KEY = "vesti_dashboard_open_tab";

function openKnowledgeNote(noteId: number): void {
  const fallbackUrl = chrome.runtime.getURL(
    `options.html?tab=library&view=notes&noteId=${noteId}`
  );
  const openDashboard = () => {
    if (chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) {
          chrome.tabs.create({ url: fallbackUrl });
        }
      });
      return;
    }
    chrome.tabs.create({ url: fallbackUrl });
  };

  if (chrome.storage?.local) {
    chrome.storage.local.set(
      {
        [DASHBOARD_NAV_REQUEST_KEY]: {
          tab: "library",
          view: "notes",
          noteId,
          requestedAt: Date.now(),
        },
      },
      openDashboard
    );
    return;
  }

  openDashboard();
}

export function WeeklyGrowthReport({
  data,
  reportId,
  onOpenHighlight,
  onSelectTag,
}: WeeklyGrowthReportProps) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const report = data.report;
  const focus = report.energy?.focusDepth;
  const rhythm = report.energy?.rhythmHealth;
  const breadth = report.energy?.topicBreadth;
  const identity = report.identity;
  const footprint = report.footprintSummary;
  const latestQuestionTime = formatLatestQuestionTime(
    footprint?.latestChatAt,
    locale,
    report.period?.timezone
  );
  const reportElementRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<WeeklyRecapStyle>("professional");
  const [shareStatus, setShareStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDialogStatus, setShareDialogStatus] = useState("");
  const [knowledgeNoteId, setKnowledgeNoteId] = useState<number | null>(null);
  const [knowledgeNoteCurrent, setKnowledgeNoteCurrent] = useState(false);
  const [knowledgeNoteProtected, setKnowledgeNoteProtected] = useState(false);
  const [knowledgeNoteStatus, setKnowledgeNoteStatus] = useState("");
  const [isSavingKnowledgeNote, setIsSavingKnowledgeNote] = useState(false);
  const styleVariant = report.pushCenter?.styleVariants?.[style];
  const greeting = styleVariant?.greeting ?? report.greeting;
  const narrative = styleVariant?.narrative ?? report.narrative ?? [];
  const canSaveKnowledgeNote = !report.blankWeek?.isBlank;

  useEffect(() => {
    let active = true;
    void getWeeklyPushSettings().then((settings) => {
      if (active) setStyle(settings.style);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setKnowledgeNoteId(null);
    setKnowledgeNoteCurrent(false);
    setKnowledgeNoteProtected(false);
    setKnowledgeNoteStatus("");
    if (!canSaveKnowledgeNote) {
      return () => {
        active = false;
      };
    }
    void getWeeklyKnowledgeNoteStatus(reportId)
      .then((status) => {
        if (!active) return;
        setKnowledgeNoteId(status.note?.id ?? null);
        setKnowledgeNoteCurrent(status.sourceCurrent);
      })
      .catch(() => {
        // Saving remains available when the optional status read fails.
      });
    return () => {
      active = false;
    };
  }, [canSaveKnowledgeNote, reportId]);

  const handleStyleChange = (nextStyle: WeeklyRecapStyle) => {
    setStyle(nextStyle);
    setShareStatus("");
    void setWeeklyPushSettings({ style: nextStyle });
  };

  const handleDownloadCard = async () => {
    if (!reportElementRef.current || isExporting) return;
    setIsExporting(true);
    setShareStatus("");
    try {
      const generatedAt = Date.parse(data.meta.generated_at);
      const reportDate = Number.isFinite(report.period?.end)
        ? (report.period?.end as number)
        : Number.isFinite(generatedAt)
          ? generatedAt
          : Date.now();
      await generateWeeklySharePNG(reportElementRef.current, reportDate);
      setShareStatus(SHARE_STATUS[locale].done);
    } catch {
      setShareStatus(SHARE_STATUS[locale].failed);
      window.alert(ACTION_COPY[locale].exportFailed);
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareLink = () => {
    setShareDialogStatus("");
    setShareDialogOpen(true);
  };

  const handleCopyText = async () => {
    try {
      await copyTextToClipboard(buildPrivacySafeWeeklyText(data));
      setShareStatus(SHARE_STATUS[locale].done);
      setShareDialogStatus(ACTION_COPY[locale].copied);
    } catch {
      setShareStatus(SHARE_STATUS[locale].failed);
      setShareDialogStatus(SHARE_STATUS[locale].failed);
    }
  };

  const handleKnowledgeNote = async () => {
    if (!canSaveKnowledgeNote) return;
    if (
      knowledgeNoteId &&
      (knowledgeNoteCurrent || knowledgeNoteProtected)
    ) {
      openKnowledgeNote(knowledgeNoteId);
      return;
    }
    if (isSavingKnowledgeNote) return;

    setIsSavingKnowledgeNote(true);
    setKnowledgeNoteStatus("");
    try {
      const result = await saveWeeklyKnowledgeNote(reportId, locale);
      setKnowledgeNoteId(result.note.id);
      setKnowledgeNoteCurrent(!result.preservedUserContent);
      setKnowledgeNoteProtected(result.preservedUserContent);
      setKnowledgeNoteStatus(
        result.preservedUserContent
          ? ACTION_COPY[locale].noteProtected
          : result.created
            ? ACTION_COPY[locale].noteSaved
            : result.refreshed
              ? ACTION_COPY[locale].noteRefreshed
              : ACTION_COPY[locale].noteSaved
      );
    } catch {
      setKnowledgeNoteStatus(ACTION_COPY[locale].noteFailed);
    } finally {
      setIsSavingKnowledgeNote(false);
    }
  };

  const knowledgeNoteActionLabel = isSavingKnowledgeNote
    ? ACTION_COPY[locale].savingNote
    : knowledgeNoteId && (knowledgeNoteCurrent || knowledgeNoteProtected)
      ? ACTION_COPY[locale].openNote
      : knowledgeNoteId
        ? ACTION_COPY[locale].refreshNote
        : ACTION_COPY[locale].saveNote;

  return (
    <div
      ref={reportElementRef}
      data-weekly-report-root
      className="ins-week-ready-shell"
    >
      <section className="rounded-xl border border-border-subtle bg-surface-card p-4">
        <div className="weekly-report-header flex items-center justify-between gap-2">
          <p className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            {copy.title}
          </p>
          <div
            data-weekly-export-exclude
            className="flex shrink-0 items-center gap-1"
          >
            {canSaveKnowledgeNote ? (
              <button
                type="button"
                disabled={isSavingKnowledgeNote}
                onClick={() => {
                  void handleKnowledgeNote();
                }}
                aria-label={knowledgeNoteActionLabel}
                title={knowledgeNoteActionLabel}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-border-focus hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
              >
                {isSavingKnowledgeNote ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : knowledgeNoteId &&
                  (knowledgeNoteCurrent || knowledgeNoteProtected) ? (
                  <BookOpen className="h-3.5 w-3.5" />
                ) : (
                  <FilePlus2 className="h-3.5 w-3.5" />
                )}
                <span className="weekly-report-action-label">
                  {knowledgeNoteActionLabel}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                void handleDownloadCard();
              }}
              aria-label={ACTION_COPY[locale].exportImage}
              title={ACTION_COPY[locale].exportImage}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-border-focus hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
            >
              <ImageDown
                className={`h-3.5 w-3.5 ${
                  isExporting ? "animate-pulse" : ""
                }`}
              />
              <span className="weekly-report-action-label">
                {ACTION_COPY[locale].exportImage}
              </span>
            </button>
            <button
              type="button"
              onClick={handleShareLink}
              aria-label={ACTION_COPY[locale].shareLink}
              title={ACTION_COPY[locale].shareLink}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-border-focus hover:text-text-primary"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="weekly-report-action-label">
                {ACTION_COPY[locale].shareLink}
              </span>
            </button>
          </div>
        </div>
        {knowledgeNoteStatus ? (
          <p
            data-weekly-export-exclude
            role="status"
            className="mt-2 text-right text-[11px] text-text-tertiary"
          >
            {knowledgeNoteStatus}
          </p>
        ) : null}
        <div
          data-weekly-export-private
          className="mt-2 flex items-start gap-3"
        >
          <span className="text-xl" aria-hidden="true">
            {identity?.moodEmoji ?? "✨"}
          </span>
          <div className="min-w-0">
            <h3 className="text-vesti-base font-semibold text-text-primary">
              {greeting}
            </h3>
            {identity?.label ? (
              <span className="mt-2 inline-flex rounded-full bg-accent-primary-light px-2.5 py-1 text-vesti-xs text-text-primary">
                {identity.label}
              </span>
            ) : null}
            {identity?.rationale ? (
              <p className="mt-2 text-vesti-xs leading-relaxed text-text-secondary">
                {identity.rationale}
              </p>
            ) : null}
          </div>
        </div>
        {narrative.map((paragraph, index) => (
          <p
            key={`growth-narrative-${index}`}
            data-weekly-export-private
            className="mt-3 text-vesti-sm leading-relaxed text-text-secondary"
          >
            {paragraph}
          </p>
        ))}
        {styleVariant?.callToAction ? (
          <p
            data-weekly-export-private
            className="mt-3 rounded-md bg-accent-primary-light px-3 py-2 text-vesti-xs font-medium text-text-primary"
          >
            {styleVariant.callToAction}
          </p>
        ) : null}
      </section>

      {report.blankWeek?.isBlank ? (
        <section className="rounded-lg border border-border-subtle bg-bg-tertiary p-4">
          <p className="text-vesti-sm leading-relaxed text-text-secondary">
            {report.blankWeek.gentleMessage}
          </p>
        </section>
      ) : (
        <>
          <section>
            <p className="mb-2 text-vesti-xs font-semibold text-text-primary">
              {copy.energy}
            </p>
            <div className="weekly-report-score-grid grid gap-2">
              <ScoreCard
                label={copy.focus}
                score={focus?.score}
                detail={`${focus?.averageTurns ?? 0} turns`}
              />
              <ScoreCard
                label={copy.rhythm}
                score={rhythm?.score}
                detail={`${rhythm?.activeDays ?? 0} days`}
              />
              <ScoreCard
                label={copy.breadth}
                score={breadth?.score}
                detail={`${breadth?.uniqueTopicCount ?? 0} topics`}
              />
            </div>
          </section>

          {footprint?.summary ? (
            <section
              data-weekly-export-private
              className="rounded-xl border border-accent-primary/20 bg-accent-primary-light p-4"
            >
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-accent-primary" />
                <p className="text-vesti-xs font-semibold text-text-primary">
                  {copy.footprint}
                </p>
              </div>
              <p className="mt-3 text-vesti-sm leading-relaxed text-text-secondary">
                {footprint.summary}
              </p>
              {footprint.encouragement ? (
                <p className="mt-3 rounded-lg bg-surface-card px-3 py-2.5 text-vesti-xs font-medium leading-relaxed text-text-primary">
                  {footprint.encouragement}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-lg border border-border-subtle bg-surface-card p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-vesti-xs font-semibold text-text-primary">
                {copy.growth}
              </p>
              <div className="flex gap-1.5">
                <ComparisonBadge
                  label={copy.previousWeek}
                  comparison={report.growth?.previousWeek}
                />
                <ComparisonBadge
                  label={copy.previousMonth}
                  comparison={report.growth?.previousMonth}
                />
              </div>
            </div>
            <GrowthCurve points={report.growth?.series} />
          </section>

          <WeeklyGrowthTimeMachine reportId={reportId} />

          {(report.highlights ?? []).length > 0 ? (
            <section data-weekly-export-private>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-primary" />
                <p className="text-vesti-xs font-semibold text-text-primary">
                  {copy.highlights}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {(report.highlights ?? []).map((highlight, index) => {
                  const canOpen =
                    typeof highlight.conversationId === "number" &&
                    typeof highlight.messageId === "number";
                  return (
                    <button
                      type="button"
                      key={highlight.id ?? `highlight-${index}`}
                      disabled={!canOpen}
                      onClick={() => {
                        if (!canOpen) return;
                        onOpenHighlight?.(
                          highlight.conversationId as number,
                          highlight.messageId as number
                        );
                      }}
                      className="group rounded-lg border border-border-subtle bg-surface-card p-3 text-left transition-colors hover:border-border-focus disabled:cursor-default"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <strong className="block text-vesti-sm text-text-primary">
                            {highlight.title}
                          </strong>
                          {highlight.excerpt ? (
                            <span className="mt-1 line-clamp-3 block text-vesti-xs leading-relaxed text-text-secondary">
                              “{highlight.excerpt}”
                            </span>
                          ) : null}
                          {highlight.insight ? (
                            <span className="mt-2 block text-[11px] text-text-tertiary">
                              {highlight.insight}
                            </span>
                          ) : null}
                        </span>
                        {canOpen ? (
                          <ArrowUpRight
                            aria-label={copy.open}
                            className="h-4 w-4 shrink-0 text-text-tertiary group-hover:text-accent-primary"
                          />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="weekly-report-content-grid grid gap-3 rounded-lg border border-border-subtle bg-surface-card p-3">
            <div>
              <p className="mb-2 text-vesti-xs font-semibold text-text-primary">
                {copy.contribution}
              </p>
              <WeeklyContributionGrid
                days={report.contributionGrid}
                emptyLabel={copy.noData}
              />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-vesti-xs font-semibold text-text-primary">
                {copy.tags}
              </p>
              <WeeklyTagCloud
                tags={report.tags?.current}
                emptyLabel={copy.noData}
                onSelect={onSelectTag}
              />
              {(report.tags?.new ?? []).length > 0 ? (
                <p className="mt-2 text-[11px] text-text-tertiary">
                  {copy.newTags}:{" "}
                  {(report.tags?.new ?? [])
                    .map((tag) => tag.name)
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
              {(report.tags?.hot ?? []).length > 0 ? (
                <p className="mt-1 text-[11px] text-text-tertiary">
                  {copy.hotTags}:{" "}
                  {(report.tags?.hot ?? [])
                    .map((tag) => tag.name)
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
          </section>

          {footprint?.topDirection ||
          (latestQuestionTime && footprint?.latestQuestion) ? (
            <section
              data-weekly-export-private
              className="weekly-report-summary-grid grid gap-2"
            >
              {footprint?.topDirection ? (
                <article className="rounded-lg bg-bg-tertiary px-3 py-3">
                  <p className="text-[11px] text-text-tertiary">
                    {copy.mostConcerned}
                  </p>
                  <p className="mt-1.5 text-vesti-sm font-semibold leading-relaxed text-text-primary">
                    “{footprint.topDirection}”
                  </p>
                </article>
              ) : null}
              {latestQuestionTime && footprint?.latestQuestion ? (
                <article className="rounded-lg bg-bg-tertiary px-3 py-3">
                  <p className="text-[11px] leading-relaxed text-text-tertiary">
                    {copy.latestQuestionPrefix}
                    <strong className="font-semibold text-text-secondary">
                      {latestQuestionTime}
                    </strong>
                    {copy.latestQuestionSuffix}
                  </p>
                  <p className="mt-1.5 text-vesti-sm font-semibold leading-relaxed text-text-primary">
                    “{footprint.latestQuestion}”
                  </p>
                </article>
              ) : null}
            </section>
          ) : null}

          <WeeklyPushCenter
            report={report}
            style={style}
            shareStatus={shareStatus}
            onStyleChange={handleStyleChange}
            onDownloadCard={() => {
              void handleDownloadCard();
            }}
            onShareLink={handleShareLink}
            onCopyText={() => {
              void handleCopyText();
            }}
          />
        </>
      )}

      {shareDialogOpen ? (
        <div
          data-weekly-export-exclude
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShareDialogOpen(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="weekly-share-dialog-title"
            className="w-full max-w-sm rounded-xl border border-border-subtle bg-surface-card p-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <p
                id="weekly-share-dialog-title"
                className="text-vesti-sm font-semibold text-text-primary"
              >
                {ACTION_COPY[locale].comingSoon}
              </p>
              <button
                type="button"
                onClick={() => setShareDialogOpen(false)}
                aria-label={ACTION_COPY[locale].close}
                className="rounded-md p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleCopyText();
              }}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-primary px-3 py-2.5 text-vesti-xs font-medium text-white hover:opacity-90"
            >
              <Link2 className="h-4 w-4" />
              {ACTION_COPY[locale].copyFallback}
            </button>
            {shareDialogStatus ? (
              <p
                role="status"
                className="mt-2 text-center text-[11px] text-text-tertiary"
              >
                {shareDialogStatus}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
