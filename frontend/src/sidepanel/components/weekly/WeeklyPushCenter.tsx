import {
  Copy,
  Download,
  ExternalLink,
  Link2,
  Search,
  Sparkles,
} from "lucide-react";

import { useI18n } from "~lib/i18n";
import type {
  WeeklyGrowthReportV2,
  WeeklyRecapStyle,
} from "~lib/types";

interface WeeklyPushCenterProps {
  report: WeeklyGrowthReportV2;
  style: WeeklyRecapStyle;
  shareStatus?: string;
  onStyleChange: (style: WeeklyRecapStyle) => void;
  onDownloadCard: () => void;
  onShareLink: () => void;
  onCopyText: () => void;
}

const COPY = {
  en: {
    title: "Your weekly mind fuel",
    emotions: "Emotion map",
    styles: "Writing style",
    humorous: "Humorous",
    professional: "Professional",
    motivational: "Motivational",
    questions: "Questions worth another look",
    resources: "Suggested next searches",
    search: "Search",
    share: "Share this week",
    download: "Save image",
    copyLink: "Share link",
    copyText: "Copy text",
  },
  zh: {
    title: "你的本周精神食粮",
    emotions: "情绪地图",
    styles: "周报风格",
    humorous: "幽默",
    professional: "专业",
    motivational: "激励",
    questions: "还值得想清楚的问题",
    resources: "下一步可搜索的资源",
    search: "搜索",
    share: "分享本周",
    download: "保存图片",
    copyLink: "分享链接",
    copyText: "复制文字",
  },
  ja: {
    title: "今週の心の栄養",
    emotions: "感情マップ",
    styles: "文章スタイル",
    humorous: "ユーモア",
    professional: "プロ",
    motivational: "励まし",
    questions: "もう一度考えたい問い",
    resources: "次に調べるテーマ",
    search: "検索",
    share: "今週を共有",
    download: "画像を保存",
    copyLink: "リンクを共有",
    copyText: "文章をコピー",
  },
  ko: {
    title: "이번 주 마음의 양식",
    emotions: "감정 지도",
    styles: "글쓰기 스타일",
    humorous: "유머",
    professional: "전문적",
    motivational: "동기부여",
    questions: "다시 생각해 볼 질문",
    resources: "다음 검색 제안",
    search: "검색",
    share: "이번 주 공유",
    download: "이미지 저장",
    copyLink: "링크 공유",
    copyText: "텍스트 복사",
  },
} as const;

const STYLES: WeeklyRecapStyle[] = [
  "humorous",
  "professional",
  "motivational",
];

function openSearch(searchQuery: string): void {
  const url = `https://www.google.com/search?q=${encodeURIComponent(
    searchQuery
  )}`;
  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function WeeklyPushCenter({
  report,
  style,
  shareStatus,
  onStyleChange,
  onDownloadCard,
  onShareLink,
  onCopyText,
}: WeeklyPushCenterProps) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const pushCenter = report.pushCenter;
  const emotions = report.identity?.emotionKeywords ?? [];
  const questions = pushCenter?.unclearQuestions ?? [];
  const resources = pushCenter?.resourceRecommendations ?? [];
  const spiritualFood = pushCenter?.spiritualFood;

  if (!pushCenter && emotions.length === 0) return null;

  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-primary" />
        <p className="text-vesti-xs font-semibold text-text-primary">
          {copy.title}
        </p>
      </div>

      {spiritualFood?.title || spiritualFood?.summary ? (
        <div
          data-weekly-export-private
          className="mt-3 rounded-lg bg-accent-primary-light p-3"
        >
          {spiritualFood.title ? (
            <p className="text-vesti-sm font-semibold text-text-primary">
              {spiritualFood.title}
            </p>
          ) : null}
          {spiritualFood.summary ? (
            <p className="mt-1 text-vesti-xs leading-relaxed text-text-secondary">
              {spiritualFood.summary}
            </p>
          ) : null}
          {spiritualFood.takeaway ? (
            <p className="mt-2 text-[11px] font-medium text-accent-primary">
              {spiritualFood.takeaway}
            </p>
          ) : null}
        </div>
      ) : null}

      {emotions.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold text-text-secondary">
            {copy.emotions}
          </p>
          <div className="flex flex-col gap-2">
            {emotions.slice(0, 5).map((emotion, index) => {
              const rawScore = emotion.score ?? 0;
              const score = Math.max(
                0,
                Math.min(
                  100,
                  Math.round(rawScore <= 1 ? rawScore * 100 : rawScore)
                )
              );
              return (
                <div
                  key={`${emotion.label ?? "emotion"}-${index}`}
                  className="grid grid-cols-[72px_minmax(0,1fr)_28px] items-center gap-2"
                >
                  <span className="truncate text-[11px] text-text-secondary">
                    {emotion.label}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                    <span
                      className="block h-full rounded-full bg-accent-primary"
                      style={{ width: `${score}%` }}
                    />
                  </span>
                  <span className="text-right text-[10px] text-text-tertiary">
                    {score}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div data-weekly-export-exclude className="mt-4">
        <p className="mb-2 text-[11px] font-semibold text-text-secondary">
          {copy.styles}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {STYLES.map((candidateStyle) => (
            <button
              key={candidateStyle}
              type="button"
              aria-pressed={style === candidateStyle}
              onClick={() => onStyleChange(candidateStyle)}
              className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                style === candidateStyle
                  ? "border-accent-primary bg-accent-primary-light text-text-primary"
                  : "border-border-subtle bg-bg-primary text-text-secondary hover:border-border-focus"
              }`}
            >
              {copy[candidateStyle]}
            </button>
          ))}
        </div>
      </div>

      {questions.length > 0 ? (
        <div data-weekly-export-private className="mt-4">
          <p className="mb-2 text-[11px] font-semibold text-text-secondary">
            {copy.questions}
          </p>
          <div className="flex flex-col gap-2">
            {questions.slice(0, 3).map((item, index) => (
              <article
                key={`${item.question ?? "question"}-${index}`}
                className="rounded-lg border border-border-subtle bg-bg-primary p-3"
              >
                <p className="text-vesti-xs font-medium text-text-primary">
                  {item.question}
                </p>
                {item.whyItMatters ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
                    {item.whyItMatters}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {resources.length > 0 ? (
        <div data-weekly-export-private className="mt-4">
          <p className="mb-2 text-[11px] font-semibold text-text-secondary">
            {copy.resources}
          </p>
          <div className="flex flex-col gap-2">
            {resources.slice(0, 3).map((item, index) => (
              <article
                key={`${item.searchQuery ?? "resource"}-${index}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle bg-bg-primary p-3"
              >
                <span className="min-w-0">
                  <strong className="block text-vesti-xs text-text-primary">
                    {item.title}
                  </strong>
                  {item.reason ? (
                    <span className="mt-1 block text-[11px] leading-relaxed text-text-tertiary">
                      {item.reason}
                    </span>
                  ) : null}
                </span>
                {item.searchQuery ? (
                  <button
                    type="button"
                    onClick={() => openSearch(item.searchQuery as string)}
                    aria-label={`${copy.search}: ${item.title ?? item.searchQuery}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-bg-tertiary px-2 py-1.5 text-[11px] text-text-secondary hover:text-accent-primary"
                  >
                    <Search className="h-3 w-3" />
                    {copy.search}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div
        data-weekly-export-exclude
        className="mt-4 border-t border-border-subtle pt-3"
      >
        <p className="mb-2 text-[11px] font-semibold text-text-secondary">
          {copy.share}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={onDownloadCard}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-border-subtle px-2 py-2 text-[11px] text-text-secondary hover:border-border-focus"
          >
            <Download className="h-3.5 w-3.5" />
            {copy.download}
          </button>
          <button
            type="button"
            onClick={onShareLink}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-border-subtle px-2 py-2 text-[11px] text-text-secondary hover:border-border-focus"
          >
            <Link2 className="h-3.5 w-3.5" />
            {copy.copyLink}
          </button>
          <button
            type="button"
            onClick={onCopyText}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-border-subtle px-2 py-2 text-[11px] text-text-secondary hover:border-border-focus"
          >
            <Copy className="h-3.5 w-3.5" />
            {copy.copyText}
          </button>
        </div>
        {shareStatus ? (
          <p
            role="status"
            className="mt-2 text-center text-[11px] text-text-tertiary"
          >
            {shareStatus}
          </p>
        ) : null}
      </div>
    </section>
  );
}
