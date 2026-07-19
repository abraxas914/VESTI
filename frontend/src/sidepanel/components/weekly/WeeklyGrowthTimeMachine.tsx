import { History, RefreshCw, Sparkles } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useI18n } from "~lib/i18n"
import { getLocaleDateTag } from "~lib/i18n/locales"
import { getWeeklyGrowthTimeMachine } from "~lib/services/storageService"
import type {
  WeeklyGrowthTimeMachineComparison,
  WeeklyGrowthTimeMachineData,
  WeeklyGrowthTimeMachineMetricKey,
  WeeklyGrowthTimeMachineTopicMovement
} from "~lib/types"
import { compareWeeklyGrowthTimeMachine } from "~lib/weekly/weeklyGrowthTimeMachine"

interface WeeklyGrowthTimeMachineProps {
  reportId: number
}

const COPY = {
  en: {
    title: "Growth Time Machine",
    subtitle: "Compare this week with an earlier chapter of your thinking.",
    local: "100% local",
    compareWith: "Compare with",
    focusDepthScore: "Focus depth",
    rhythmScore: "Rhythm health",
    topicBreadthScore: "Topic breadth",
    personalBest: "Personal best",
    rising: "Momentum is rising across the three growth signals.",
    steady: "Your growth signals are holding a steady shape.",
    rebalancing: "Your attention is rebalancing across different modes.",
    strongest: "Strongest movement",
    conversations: "conversations",
    activeDays: "active days",
    identityTrail: "Identity trail",
    emerging: "Emerging",
    returning: "Returning",
    cooled: "Cooling",
    unlock:
      "Another active historical week will unlock a meaningful comparison.",
    loadFailed: "Could not load growth history.",
    retry: "Retry",
    storedEvidence: "stored weeks enriched with identity and topics"
  },
  zh: {
    title: "成长时光机",
    subtitle: "把这一周与过去某段思考旅程放在一起看。",
    local: "100% 本地计算",
    compareWith: "对比基线",
    focusDepthScore: "专注深度",
    rhythmScore: "节奏健康度",
    topicBreadthScore: "话题广度",
    personalBest: "个人最佳",
    rising: "三项成长信号整体向上。",
    steady: "你的成长信号保持着稳定形态。",
    rebalancing: "你的注意力正在不同思考模式之间重新分配。",
    strongest: "变化最明显",
    conversations: "次对话",
    activeDays: "个活跃日",
    identityTrail: "身份轨迹",
    emerging: "新生话题",
    returning: "回归话题",
    cooled: "降温话题",
    unlock: "再积累一个有活动的历史周，即可解锁有效对比。",
    loadFailed: "加载成长历史失败。",
    retry: "重试",
    storedEvidence: "个历史周包含身份与话题依据"
  },
  ja: {
    title: "成長タイムマシン",
    subtitle: "今週を、過去の思考の一章と並べて振り返ります。",
    local: "100% ローカル",
    compareWith: "比較する週",
    focusDepthScore: "集中の深さ",
    rhythmScore: "リズムの健全度",
    topicBreadthScore: "話題の広さ",
    personalBest: "自己ベスト",
    rising: "3つの成長シグナルが全体として上向いています。",
    steady: "成長シグナルは安定した形を保っています。",
    rebalancing: "注意の配分が異なる思考モード間で変化しています。",
    strongest: "最も大きな変化",
    conversations: "件の会話",
    activeDays: "活動日",
    identityTrail: "アイデンティティの軌跡",
    emerging: "新しい話題",
    returning: "戻ってきた話題",
    cooled: "落ち着いた話題",
    unlock: "活動のある過去週がもう1つできると比較を表示できます。",
    loadFailed: "成長履歴を読み込めませんでした。",
    retry: "再試行",
    storedEvidence: "週分の履歴にアイデンティティと話題の根拠あり"
  },
  ko: {
    title: "성장 타임머신",
    subtitle: "이번 주를 과거의 한 생각 여정과 나란히 돌아봅니다.",
    local: "100% 로컬",
    compareWith: "비교 기준",
    focusDepthScore: "집중 깊이",
    rhythmScore: "리듬 건강도",
    topicBreadthScore: "주제 다양성",
    personalBest: "개인 최고",
    rising: "세 가지 성장 신호가 전반적으로 상승하고 있습니다.",
    steady: "성장 신호가 안정적인 형태를 유지하고 있습니다.",
    rebalancing: "관심이 서로 다른 사고 방식 사이에서 재조정되고 있습니다.",
    strongest: "가장 큰 변화",
    conversations: "회 대화",
    activeDays: "활동 일수",
    identityTrail: "정체성 흐름",
    emerging: "새로운 주제",
    returning: "돌아온 주제",
    cooled: "잠잠해진 주제",
    unlock: "활동이 있는 과거 주가 하나 더 쌓이면 의미 있는 비교가 열립니다.",
    loadFailed: "성장 기록을 불러오지 못했습니다.",
    retry: "다시 시도",
    storedEvidence: "개 기록 주에 정체성과 주제 근거 포함"
  }
} as const

function formatRange(
  rangeStart: number,
  rangeEnd: number,
  locale: keyof typeof COPY
): string {
  const formatter = new Intl.DateTimeFormat(getLocaleDateTag(locale), {
    month: "short",
    day: "numeric"
  })
  return `${formatter.format(new Date(rangeStart))} – ${formatter.format(
    new Date(rangeEnd)
  )}`
}

function signed(value: number): string {
  const normalized = Number(value.toFixed(1))
  return `${normalized > 0 ? "+" : ""}${normalized}`
}

function metricTone(delta: number): string {
  if (delta > 0) return "text-accent-primary"
  if (delta < 0) return "text-text-tertiary"
  return "text-text-secondary"
}

function TopicMovement({
  movement,
  copy
}: {
  movement: WeeklyGrowthTimeMachineTopicMovement
  copy: (typeof COPY)[keyof typeof COPY]
}) {
  const groups = [
    {
      label: copy.emerging,
      values: movement.emerging,
      tone: "bg-accent-primary-light"
    },
    {
      label: copy.returning,
      values: movement.returning,
      tone: "bg-bg-tertiary"
    },
    { label: copy.cooled, values: movement.cooled, tone: "bg-bg-tertiary" }
  ].filter((group) => group.values.length > 0)
  if (groups.length === 0) return null

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {groups.map((group) => (
        <div key={group.label} className={`rounded-lg p-2.5 ${group.tone}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
            {group.label}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
            {group.values.join(" · ")}
          </p>
        </div>
      ))}
    </div>
  )
}

function MetricCards({
  comparison,
  copy
}: {
  comparison: WeeklyGrowthTimeMachineComparison
  copy: (typeof COPY)[keyof typeof COPY]
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {comparison.metrics.map((metric) => (
        <article
          key={metric.key}
          className="rounded-lg border border-border-subtle bg-bg-primary p-2.5">
          <p className="truncate text-[10px] font-medium text-text-tertiary">
            {copy[metric.key]}
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-1">
            <strong className="text-vesti-base text-text-primary">
              {Number(metric.current.toFixed(1))}
            </strong>
            <span
              className={`text-[11px] font-medium ${metricTone(metric.delta)}`}>
              {signed(metric.delta)}
            </span>
          </div>
          {metric.personalBest ? (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-accent-primary-light px-1.5 py-0.5 text-[9px] font-medium text-text-primary">
              <Sparkles className="h-2.5 w-2.5" />
              {copy.personalBest}
            </span>
          ) : null}
        </article>
      ))}
    </div>
  )
}

export function WeeklyGrowthTimeMachine({
  reportId
}: WeeklyGrowthTimeMachineProps) {
  const { locale } = useI18n()
  const copy = COPY[locale]
  const [data, setData] = useState<WeeklyGrowthTimeMachineData | null>(null)
  const [baselineKey, setBaselineKey] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setStatus("loading")
    setData(null)
    setBaselineKey(null)
    void getWeeklyGrowthTimeMachine(reportId)
      .then((result) => {
        if (!active) return
        setData(result)
        setBaselineKey(result.history[0]?.key ?? null)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadToken, reportId])

  const comparison = useMemo(
    () => (data ? compareWeeklyGrowthTimeMachine(data, baselineKey) : null),
    [baselineKey, data]
  )

  if (status === "loading") {
    return (
      <section
        aria-live="polite"
        aria-busy="true"
        className="rounded-lg border border-border-subtle bg-surface-card p-3">
        <div className="flex items-center gap-2 text-text-tertiary">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          <span className="text-vesti-xs">{copy.title}</span>
        </div>
      </section>
    )
  }

  if (status === "error") {
    return (
      <section
        role="status"
        className="rounded-lg border border-border-subtle bg-surface-card p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-vesti-xs text-text-tertiary">{copy.loadFailed}</p>
          <button
            data-weekly-export-exclude
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
            className="text-vesti-xs font-medium text-accent-primary">
            {copy.retry}
          </button>
        </div>
      </section>
    )
  }

  if (!data || !comparison) {
    return (
      <section className="rounded-lg border border-dashed border-border-subtle bg-surface-card p-3">
        <div className="flex items-start gap-2">
          <History className="mt-0.5 h-4 w-4 text-text-tertiary" />
          <div>
            <p className="text-vesti-xs font-semibold text-text-primary">
              {copy.title}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
              {copy.unlock}
            </p>
          </div>
        </div>
      </section>
    )
  }

  const strongestMetric = comparison.strongestMetric
    ? copy[comparison.strongestMetric]
    : null
  const momentumText = copy[comparison.momentum]

  return (
    <section className="rounded-lg border border-border-subtle bg-surface-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <History className="h-4 w-4 text-accent-primary" />
            <p className="text-vesti-xs font-semibold text-text-primary">
              {copy.title}
            </p>
            <span className="rounded-full bg-accent-primary-light px-2 py-0.5 text-[9px] font-medium text-text-secondary">
              {copy.local}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
            {copy.subtitle}
          </p>
          <p className="mt-1 text-[10px] text-text-tertiary">
            {copy.compareWith}:{" "}
            {formatRange(
              comparison.baseline.rangeStart,
              comparison.baseline.rangeEnd,
              locale
            )}
          </p>
        </div>
        <label
          data-weekly-export-exclude
          className="shrink-0 text-[10px] text-text-tertiary">
          <span className="mb-1 block">{copy.compareWith}</span>
          <select
            value={comparison.baseline.key}
            onChange={(event) => setBaselineKey(event.target.value)}
            className="max-w-[130px] rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[10px] text-text-secondary outline-none focus:border-border-focus">
            {data.history.map((point) => (
              <option key={point.key} value={point.key}>
                {formatRange(point.rangeStart, point.rangeEnd, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 rounded-lg bg-bg-tertiary px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-text-secondary">
            {momentumText}
          </p>
          <span className={metricTone(comparison.momentumScore)}>
            {signed(comparison.momentumScore)}
          </span>
        </div>
        {strongestMetric ? (
          <p className="mt-1 text-[10px] text-text-tertiary">
            {copy.strongest}: {strongestMetric}
          </p>
        ) : null}
      </div>

      <div className="mt-3">
        <MetricCards comparison={comparison} copy={copy} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-text-tertiary">
        <span className="rounded-full bg-bg-tertiary px-2 py-1">
          {signed(comparison.conversationDelta)} {copy.conversations}
        </span>
        <span className="rounded-full bg-bg-tertiary px-2 py-1">
          {signed(comparison.activeDaysDelta)} {copy.activeDays}
        </span>
        {data.enrichedHistoryCount > 0 ? (
          <span className="rounded-full bg-bg-tertiary px-2 py-1">
            {data.enrichedHistoryCount} {copy.storedEvidence}
          </span>
        ) : null}
      </div>

      {comparison.identityTrail.length > 1 ? (
        <div data-weekly-export-private className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
            {copy.identityTrail}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
            {comparison.identityTrail.join(" → ")}
          </p>
        </div>
      ) : null}

      {comparison.topicMovement ? (
        <div className="mt-3">
          <TopicMovement movement={comparison.topicMovement} copy={copy} />
        </div>
      ) : null}
    </section>
  )
}
