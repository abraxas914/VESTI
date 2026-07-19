import { ArrowUpRight, Sparkles } from "lucide-react";
import { useI18n } from "~lib/i18n";
import type {
  WeeklyGrowthSeriesPoint,
  WeeklyGrowthTag,
  WeeklyMetricComparison,
  WeeklyMostInsight,
} from "~lib/types";
import type { WeeklyGrowthData } from "~lib/types/insightsPresentation";
import { WeeklyContributionGrid } from "./WeeklyContributionGrid";
import { WeeklyTagCloud } from "./WeeklyTagCloud";

interface WeeklyGrowthReportProps {
  data: WeeklyGrowthData;
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
    mosts: "Your week in superlatives",
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
    mosts: "你最 XX",
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
    mosts: "今週の一番",
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
    mosts: "이번 주의 최고",
    noData: "아직 데이터가 없습니다",
    open: "원본 대화 열기",
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

function MostItem({ value }: { value?: WeeklyMostInsight | null }) {
  if (!value?.label) return null;
  return (
    <article className="rounded-md bg-bg-tertiary px-3 py-2">
      <p className="text-vesti-xs font-medium text-text-primary">{value.label}</p>
      {value.detail ? (
        <p className="mt-1 text-[11px] text-text-tertiary">{value.detail}</p>
      ) : null}
    </article>
  );
}

export function WeeklyGrowthReport({
  data,
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
  const mosts = report.mosts;

  return (
    <div className="ins-week-ready-shell">
      <section className="rounded-xl border border-border-subtle bg-surface-card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          {copy.title}
        </p>
        <div className="mt-2 flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">
            {identity?.moodEmoji ?? "✨"}
          </span>
          <div className="min-w-0">
            <h3 className="text-vesti-base font-semibold text-text-primary">
              {report.greeting}
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
        {(report.narrative ?? []).map((paragraph, index) => (
          <p
            key={`growth-narrative-${index}`}
            className="mt-3 text-vesti-sm leading-relaxed text-text-secondary"
          >
            {paragraph}
          </p>
        ))}
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
            <div className="grid grid-cols-3 gap-2">
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

          {(report.highlights ?? []).length > 0 ? (
            <section>
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

          <section className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 rounded-lg border border-border-subtle bg-surface-card p-3">
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

          {mosts ? (
            <section>
              <p className="mb-2 text-vesti-xs font-semibold text-text-primary">
                {copy.mosts}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <MostItem value={mosts.latestConversation} />
                <MostItem value={mosts.topTopic} />
                <MostItem value={mosts.longestConversation} />
                <MostItem value={mosts.unexpectedConversation} />
                <MostItem value={mosts.mentionedEntity} />
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

