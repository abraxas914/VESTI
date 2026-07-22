import type {
  WeeklyGrowthReportV2,
  WeeklyGrowthSeriesPoint,
  WeeklyGrowthTimeMachineComparison,
  WeeklyGrowthTimeMachineData,
  WeeklyGrowthTimeMachineMetricComparison,
  WeeklyGrowthTimeMachineMetricKey,
  WeeklyGrowthTimeMachineMetrics,
  WeeklyGrowthTimeMachinePoint,
  WeeklyGrowthTimeMachineTopicMovement,
  WeeklyReportRecord
} from "../types"

export const WEEKLY_GROWTH_TIME_MACHINE_HISTORY_LIMIT = 12
export const WEEKLY_GROWTH_TIME_MACHINE_QUERY_LIMIT = 48

const MAX_TOPICS_PER_POINT = 12
const MAX_IDENTITY_TRAIL = 8
const MIN_COMPARABLE_SPAN_RATIO = 0.8
const MAX_COMPARABLE_SPAN_RATIO = 1.2
const MOMENTUM_THRESHOLD = 4
const CORE_METRICS: WeeklyGrowthTimeMachineMetricKey[] = [
  "focusDepthScore",
  "rhythmScore",
  "topicBreadthScore"
]

function isWeeklyGrowthReportV2(value: unknown): value is WeeklyGrowthReportV2 {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema?: unknown }).schema === "weekly_growth_report.v2"
  )
}

export function isWeeklyGrowthTimeMachineSource(
  record: WeeklyReportRecord
): record is WeeklyReportRecord & { structured: WeeklyGrowthReportV2 } {
  return (
    isWeeklyGrowthReportV2(record.structured) &&
    !record.structured.blankWeek?.isBlank
  )
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const resolved = finiteNumber(value)
  if (resolved === null) return fallback
  return Math.max(minimum, Math.min(maximum, resolved))
}

function metricScore(value: unknown, fallback = 0): number {
  return Number(boundedNumber(value, fallback, 0, 100).toFixed(1))
}

function countMetric(value: unknown, fallback = 0): number {
  return Math.round(boundedNumber(value, fallback, 0, 1_000_000))
}

function normalizeText(value: unknown, maxLength = 160): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : ""
}

function pointKey(rangeStart: number, rangeEnd: number): string {
  return `${rangeStart}:${rangeEnd}`
}

function resolveRange(record: WeeklyReportRecord): {
  rangeStart: number
  rangeEnd: number
} | null {
  const structured = isWeeklyGrowthReportV2(record.structured)
    ? record.structured
    : null
  const rangeStart =
    finiteNumber(structured?.period?.start) ?? finiteNumber(record.rangeStart)
  const rangeEnd =
    finiteNumber(structured?.period?.end) ?? finiteNumber(record.rangeEnd)
  if (
    rangeStart === null ||
    rangeEnd === null ||
    rangeStart < 0 ||
    rangeEnd < rangeStart
  ) {
    return null
  }
  return { rangeStart, rangeEnd }
}

function isWeeklyPeriod(
  record: WeeklyReportRecord,
  report: WeeklyGrowthReportV2
): boolean {
  return (
    (record.periodType === undefined || record.periodType === "week") &&
    (report.period?.type === undefined || report.period.type === "week")
  )
}

export function resolveWeeklyGrowthTimeMachineCurrent(
  record: WeeklyReportRecord
): {
  report: WeeklyGrowthReportV2
  range: { rangeStart: number; rangeEnd: number }
} {
  if (!isWeeklyGrowthTimeMachineSource(record)) {
    throw new Error("WEEKLY_GROWTH_TIME_MACHINE_REQUIRES_NON_BLANK_V2")
  }
  if (!isWeeklyPeriod(record, record.structured)) {
    throw new Error("WEEKLY_GROWTH_TIME_MACHINE_REQUIRES_WEEKLY_PERIOD")
  }
  const range = resolveRange(record)
  if (!range) {
    throw new Error("WEEKLY_GROWTH_TIME_MACHINE_INVALID_CURRENT_RANGE")
  }
  return { report: record.structured, range }
}

function seriesPointRange(point: WeeklyGrowthSeriesPoint): {
  rangeStart: number
  rangeEnd: number
} | null {
  const rangeStart = finiteNumber(point.rangeStart)
  const rangeEnd = finiteNumber(point.rangeEnd)
  if (
    rangeStart === null ||
    rangeEnd === null ||
    rangeStart < 0 ||
    rangeEnd < rangeStart
  ) {
    return null
  }
  return { rangeStart, rangeEnd }
}

function isComparableRange(
  currentRange: { rangeStart: number; rangeEnd: number },
  candidateRange: { rangeStart: number; rangeEnd: number }
): boolean {
  if (candidateRange.rangeEnd >= currentRange.rangeStart) return false
  const currentSpan = currentRange.rangeEnd - currentRange.rangeStart + 1
  const candidateSpan = candidateRange.rangeEnd - candidateRange.rangeStart + 1
  if (currentSpan <= 0 || candidateSpan <= 0) return false
  const ratio = candidateSpan / currentSpan
  return (
    ratio >= MIN_COMPARABLE_SPAN_RATIO && ratio <= MAX_COMPARABLE_SPAN_RATIO
  )
}

function metricsFromSeriesPoint(
  point: WeeklyGrowthSeriesPoint | undefined,
  fallback?: WeeklyGrowthTimeMachineMetrics
): WeeklyGrowthTimeMachineMetrics {
  const base = fallback ?? {
    conversationCount: 0,
    activeDays: 0,
    focusDepthScore: 0,
    rhythmScore: 0,
    topicBreadthScore: 0
  }
  return {
    conversationCount: countMetric(
      point?.conversationCount,
      base.conversationCount
    ),
    activeDays: countMetric(point?.activeDays, base.activeDays),
    focusDepthScore: metricScore(point?.focusDepthScore, base.focusDepthScore),
    rhythmScore: metricScore(point?.rhythmScore, base.rhythmScore),
    topicBreadthScore: metricScore(
      point?.topicBreadthScore,
      base.topicBreadthScore
    )
  }
}

function findCurrentSeriesPoint(
  report: WeeklyGrowthReportV2,
  range: { rangeStart: number; rangeEnd: number }
): WeeklyGrowthSeriesPoint | undefined {
  const points = report.growth?.series ?? []
  const exact = points.find((point) => {
    const pointRange = seriesPointRange(point)
    return (
      pointRange?.rangeStart === range.rangeStart &&
      pointRange.rangeEnd === range.rangeEnd
    )
  })
  return exact ?? points[points.length - 1]
}

function metricsFromReport(
  report: WeeklyGrowthReportV2,
  range: { rangeStart: number; rangeEnd: number },
  fallback?: WeeklyGrowthTimeMachineMetrics
): WeeklyGrowthTimeMachineMetrics {
  const fromSeries = metricsFromSeriesPoint(
    findCurrentSeriesPoint(report, range),
    fallback
  )
  return {
    ...fromSeries,
    focusDepthScore: metricScore(
      report.energy?.focusDepth?.score,
      fromSeries.focusDepthScore
    ),
    rhythmScore: metricScore(
      report.energy?.rhythmHealth?.score,
      fromSeries.rhythmScore
    ),
    topicBreadthScore: metricScore(
      report.energy?.topicBreadth?.score,
      fromSeries.topicBreadthScore
    )
  }
}

function hasMeaningfulMetrics(
  metrics: WeeklyGrowthTimeMachineMetrics
): boolean {
  return (
    metrics.conversationCount > 0 ||
    metrics.activeDays > 0 ||
    metrics.focusDepthScore > 0 ||
    metrics.rhythmScore > 0 ||
    metrics.topicBreadthScore > 0
  )
}

function normalizeTopics(report: WeeklyGrowthReportV2): string[] | null {
  if (!Array.isArray(report.tags?.current)) return null
  const seen = new Set<string>()
  const topics: string[] = []
  for (const tag of report.tags.current) {
    const label = normalizeText(tag.name, 100)
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    topics.push(label)
    if (topics.length >= MAX_TOPICS_PER_POINT) break
  }
  return topics
}

function pointFromReport(
  record: WeeklyReportRecord,
  fallback?: WeeklyGrowthTimeMachinePoint
): WeeklyGrowthTimeMachinePoint | null {
  if (!isWeeklyGrowthTimeMachineSource(record)) return null
  const range = resolveRange(record)
  if (!range) return null
  return {
    key: pointKey(range.rangeStart, range.rangeEnd),
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd,
    storedEvidence: true,
    metrics: metricsFromReport(record.structured, range, fallback?.metrics),
    identityLabel:
      normalizeText(record.structured.identity?.label, 120) || null,
    topics: normalizeTopics(record.structured)
  }
}

function pointFromSeries(
  point: WeeklyGrowthSeriesPoint
): WeeklyGrowthTimeMachinePoint | null {
  const range = seriesPointRange(point)
  if (!range) return null
  return {
    key: pointKey(range.rangeStart, range.rangeEnd),
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd,
    storedEvidence: false,
    metrics: metricsFromSeriesPoint(point),
    identityLabel: null,
    topics: null
  }
}

function comparePointChronology(
  left: WeeklyGrowthTimeMachinePoint,
  right: WeeklyGrowthTimeMachinePoint
): number {
  return right.rangeStart - left.rangeStart || right.rangeEnd - left.rangeEnd
}

export function buildWeeklyGrowthTimeMachine(
  currentRecord: WeeklyReportRecord,
  candidateRecords: readonly WeeklyReportRecord[]
): WeeklyGrowthTimeMachineData {
  const { report: currentReport, range: currentRange } =
    resolveWeeklyGrowthTimeMachineCurrent(currentRecord)
  const current = pointFromReport(currentRecord)
  if (!current) {
    throw new Error("WEEKLY_GROWTH_TIME_MACHINE_INVALID_CURRENT_REPORT")
  }

  const pointsByRange = new Map<string, WeeklyGrowthTimeMachinePoint>()
  const embeddedSeries = (currentReport.growth?.series ?? []).slice(
    -(WEEKLY_GROWTH_TIME_MACHINE_HISTORY_LIMIT + 1)
  )
  for (const seriesPoint of embeddedSeries) {
    const point = pointFromSeries(seriesPoint)
    if (!point || !isComparableRange(currentRange, point)) continue
    if (!hasMeaningfulMetrics(point.metrics)) continue
    pointsByRange.set(point.key, point)
  }

  const sortedCandidates = candidateRecords
    .slice(0, WEEKLY_GROWTH_TIME_MACHINE_QUERY_LIMIT)
    .filter(isWeeklyGrowthTimeMachineSource)
    .sort(
      (left, right) =>
        right.rangeStart - left.rangeStart ||
        right.createdAt - left.createdAt ||
        right.id - left.id
    )

  for (const record of sortedCandidates) {
    if (!isWeeklyPeriod(record, record.structured)) continue
    const range = resolveRange(record)
    if (!range || !isComparableRange(currentRange, range)) continue
    const key = pointKey(range.rangeStart, range.rangeEnd)
    const existing = pointsByRange.get(key)
    if (existing?.storedEvidence) continue
    const enriched = pointFromReport(record, existing)
    if (enriched) pointsByRange.set(key, enriched)
  }

  const history = Array.from(pointsByRange.values())
    .sort(comparePointChronology)
    .slice(0, WEEKLY_GROWTH_TIME_MACHINE_HISTORY_LIMIT)

  return {
    current,
    history,
    enrichedHistoryCount: history.filter((point) => point.storedEvidence).length
  }
}

function roundedDelta(current: number, baseline: number): number {
  return Number((current - baseline).toFixed(1))
}

function identityTrail(data: WeeklyGrowthTimeMachineData): string[] {
  const chronological = [...data.history, data.current].sort(
    (left, right) =>
      left.rangeStart - right.rangeStart || left.rangeEnd - right.rangeEnd
  )
  const result: string[] = []
  for (const point of chronological) {
    if (!point.identityLabel) continue
    if (result[result.length - 1] === point.identityLabel) continue
    result.push(point.identityLabel)
  }
  return result.slice(-MAX_IDENTITY_TRAIL)
}

function topicKey(value: string): string {
  return value.toLowerCase()
}

function topicMovement(
  data: WeeklyGrowthTimeMachineData,
  baseline: WeeklyGrowthTimeMachinePoint
): WeeklyGrowthTimeMachineTopicMovement | null {
  if (data.current.topics === null || baseline.topics === null) return null
  const currentByKey = new Map(
    data.current.topics.map((topic) => [topicKey(topic), topic])
  )
  const baselineByKey = new Map(
    baseline.topics.map((topic) => [topicKey(topic), topic])
  )
  const recordedBefore = new Set<string>()
  for (const point of data.history) {
    if (point.key === baseline.key || point.topics === null) continue
    for (const topic of point.topics) recordedBefore.add(topicKey(topic))
  }

  const emerging: string[] = []
  const returning: string[] = []
  for (const [key, topic] of currentByKey) {
    if (baselineByKey.has(key)) continue
    if (recordedBefore.has(key)) {
      returning.push(topic)
    } else {
      emerging.push(topic)
    }
  }
  const cooled = Array.from(baselineByKey)
    .filter(([key]) => !currentByKey.has(key))
    .map(([, topic]) => topic)

  return {
    emerging: emerging.slice(0, MAX_TOPICS_PER_POINT),
    returning: returning.slice(0, MAX_TOPICS_PER_POINT),
    cooled: cooled.slice(0, MAX_TOPICS_PER_POINT)
  }
}

export function compareWeeklyGrowthTimeMachine(
  data: WeeklyGrowthTimeMachineData,
  baselineKey?: string | null
): WeeklyGrowthTimeMachineComparison | null {
  const baseline =
    data.history.find((point) => point.key === baselineKey) ?? data.history[0]
  if (!baseline) return null

  const allPoints = [data.current, ...data.history]
  const metrics: WeeklyGrowthTimeMachineMetricComparison[] = CORE_METRICS.map(
    (key) => {
      const current = data.current.metrics[key]
      const baselineValue = baseline.metrics[key]
      const timelineMax = Math.max(
        ...allPoints.map((point) => point.metrics[key])
      )
      return {
        key,
        current,
        baseline: baselineValue,
        delta: roundedDelta(current, baselineValue),
        personalBest: current > 0 && current >= timelineMax
      }
    }
  )

  const momentumScore = Number(
    (
      metrics.reduce((sum, metric) => sum + metric.delta, 0) / metrics.length
    ).toFixed(1)
  )
  const momentum =
    momentumScore >= MOMENTUM_THRESHOLD
      ? "rising"
      : momentumScore <= -MOMENTUM_THRESHOLD
        ? "rebalancing"
        : "steady"
  const strongest = [...metrics].sort(
    (left, right) => right.delta - left.delta
  )[0]

  return {
    baseline,
    metrics,
    conversationDelta: roundedDelta(
      data.current.metrics.conversationCount,
      baseline.metrics.conversationCount
    ),
    activeDaysDelta: roundedDelta(
      data.current.metrics.activeDays,
      baseline.metrics.activeDays
    ),
    momentumScore,
    momentum,
    strongestMetric: strongest && strongest.delta > 0 ? strongest.key : null,
    topicMovement: topicMovement(data, baseline),
    identityTrail: identityTrail(data)
  }
}
