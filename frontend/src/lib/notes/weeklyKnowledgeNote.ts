import {
  getLocaleDateTag,
  type SupportedLocale
} from "../i18n/locales"
import type {
  WeeklyGrowthTag,
  WeeklyGrowthReportV2,
  WeeklyMetricComparison,
  WeeklyMostInsight,
  WeeklyReportRecord
} from "../types"

const MANAGED_START_PATTERN =
  /<!-- vesti:weekly-note:start version=1 report=(\d+) source=([A-Za-z0-9._:-]+) -->/

export const WEEKLY_KNOWLEDGE_NOTE_MANAGED_END =
  "<!-- vesti:weekly-note:end -->"

const MAX_INLINE_LENGTH = 1_000
const MAX_LINKED_CONVERSATIONS = 100
const MAX_SOURCE_MESSAGES = 200
const MAX_SECTION_ITEMS = 20
const MAX_NARRATIVE_PARAGRAPHS = 12
const MAX_CONTRIBUTION_DAYS = 400

const COPY = {
  en: {
    title: "Weekly Knowledge",
    overview: "Weekly snapshot",
    period: "Period",
    generated: "Generated",
    identity: "Identity",
    emotions: "Emotional signals",
    energy: "Energy",
    focus: "Focus depth",
    rhythm: "Rhythm health",
    breadth: "Topic breadth",
    reliable: "reliable",
    estimated: "estimated",
    activeDays: "active days",
    topics: "topics",
    deepConversations: "deep conversations",
    narrative: "Growth narrative",
    highlights: "Highlights",
    evidence: "Evidence",
    conversation: "conversation",
    message: "message",
    topicShifts: "Topic shifts",
    current: "Current",
    new: "New",
    hot: "Trending",
    comparisons: "Growth comparisons",
    conversations: "conversations",
    questions: "Questions to carry forward",
    resources: "Next learning moves",
    search: "Suggested search",
    mosts: "Weekly observations",
    food: "Food for thought",
    takeaway: "Takeaway",
    sources: "Source map",
    sourceConversations: "Conversations",
    sourceMessages: "Messages",
    reflections: "My reflections"
  },
  zh: {
    title: "每周知识沉淀",
    overview: "本周快照",
    period: "周期",
    generated: "生成时间",
    identity: "本周身份",
    emotions: "情绪信号",
    energy: "成长能量",
    focus: "专注深度",
    rhythm: "节奏健康度",
    breadth: "话题广度",
    reliable: "可信",
    estimated: "估算",
    activeDays: "活跃天数",
    topics: "个话题",
    deepConversations: "次深度对话",
    narrative: "成长叙事",
    highlights: "本周高光",
    evidence: "依据",
    conversation: "对话",
    message: "消息",
    topicShifts: "话题变化",
    current: "当前",
    new: "新增",
    hot: "热门",
    comparisons: "成长对比",
    conversations: "次对话",
    questions: "值得继续追问",
    resources: "下一步学习",
    search: "建议搜索",
    mosts: "本周观察",
    food: "精神食粮",
    takeaway: "带走一句",
    sources: "来源索引",
    sourceConversations: "对话",
    sourceMessages: "消息",
    reflections: "我的反思"
  },
  ja: {
    title: "週間ナレッジ",
    overview: "今週のスナップショット",
    period: "期間",
    generated: "生成日時",
    identity: "今週の自分",
    emotions: "感情シグナル",
    energy: "成長エネルギー",
    focus: "集中の深さ",
    rhythm: "リズムの健全度",
    breadth: "話題の広さ",
    reliable: "信頼性あり",
    estimated: "推定",
    activeDays: "活動日",
    topics: "トピック",
    deepConversations: "深い会話",
    narrative: "成長ストーリー",
    highlights: "ハイライト",
    evidence: "根拠",
    conversation: "会話",
    message: "メッセージ",
    topicShifts: "トピックの変化",
    current: "現在",
    new: "新規",
    hot: "注目",
    comparisons: "成長比較",
    conversations: "会話",
    questions: "次に考えたい問い",
    resources: "次の学び",
    search: "検索候補",
    mosts: "今週の観察",
    food: "考えるヒント",
    takeaway: "持ち帰り",
    sources: "出典マップ",
    sourceConversations: "会話",
    sourceMessages: "メッセージ",
    reflections: "自分の振り返り"
  },
  ko: {
    title: "주간 지식 노트",
    overview: "이번 주 스냅샷",
    period: "기간",
    generated: "생성 시각",
    identity: "이번 주의 나",
    emotions: "감정 신호",
    energy: "성장 에너지",
    focus: "집중 깊이",
    rhythm: "리듬 건강도",
    breadth: "주제 다양성",
    reliable: "신뢰 가능",
    estimated: "추정",
    activeDays: "활동 일수",
    topics: "개 주제",
    deepConversations: "회 심층 대화",
    narrative: "성장 이야기",
    highlights: "하이라이트",
    evidence: "근거",
    conversation: "대화",
    message: "메시지",
    topicShifts: "주제 변화",
    current: "현재",
    new: "신규",
    hot: "인기",
    comparisons: "성장 비교",
    conversations: "회 대화",
    questions: "계속 가져갈 질문",
    resources: "다음 학습 단계",
    search: "추천 검색어",
    mosts: "이번 주 관찰",
    food: "생각거리",
    takeaway: "핵심 문장",
    sources: "출처 맵",
    sourceConversations: "대화",
    sourceMessages: "메시지",
    reflections: "나의 회고"
  }
} as const

export interface WeeklyKnowledgeNoteDraft {
  reportId: number
  sourceHash: string
  title: string
  managedContent: string
  initialContent: string
  linkedConversationIds: number[]
}

export interface WeeklyKnowledgeNoteMergeResult {
  content: string
  changed: boolean
  preservedUserContent: boolean
}

function normalizeInline(value: unknown, maxLength = MAX_INLINE_LENGTH): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function normalizeSourceHash(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "missing"
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function rounded(value: unknown, digits = 0): string | null {
  const number = finiteNumber(value)
  if (number === null) return null
  return Number(number.toFixed(digits)).toString()
}

function formatDate(
  timestamp: number,
  locale: SupportedLocale,
  timezone?: string
): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric"
  }
  if (timezone) options.timeZone = timezone

  try {
    return new Intl.DateTimeFormat(getLocaleDateTag(locale), options).format(
      new Date(timestamp)
    )
  } catch {
    delete options.timeZone
    return new Intl.DateTimeFormat(getLocaleDateTag(locale), options).format(
      new Date(timestamp)
    )
  }
}

function formatDateTime(
  timestamp: number,
  locale: SupportedLocale,
  timezone?: string
): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }
  if (timezone) options.timeZone = timezone

  try {
    return new Intl.DateTimeFormat(getLocaleDateTag(locale), options).format(
      new Date(timestamp)
    )
  } catch {
    delete options.timeZone
    return new Intl.DateTimeFormat(getLocaleDateTag(locale), options).format(
      new Date(timestamp)
    )
  }
}

function addSection(
  sections: string[],
  heading: string,
  body: Array<string | null | undefined>
): void {
  const content = body.filter((line): line is string => Boolean(line?.trim()))
  if (content.length === 0) return
  sections.push(`## ${heading}\n\n${content.join("\n\n")}`)
}

function scoreLine(
  label: string,
  score: unknown,
  details: Array<string | null>,
  confidence: unknown,
  copy: (typeof COPY)[SupportedLocale]
): string | null {
  const scoreValue = rounded(score)
  if (scoreValue === null && details.every((item) => !item)) return null
  const suffix = details.filter(Boolean)
  if (confidence === "reliable") suffix.push(copy.reliable)
  if (confidence === "estimated") suffix.push(copy.estimated)
  const value = scoreValue === null ? "" : `${scoreValue}/100`
  return `- **${label}:** ${[value, ...suffix].filter(Boolean).join(" · ")}`
}

function signedMetric(value: unknown): string | null {
  const number = finiteNumber(value)
  if (number === null) return null
  const rendered = Number(number.toFixed(1))
  return `${rendered > 0 ? "+" : ""}${rendered}`
}

function comparisonLine(
  comparison: WeeklyMetricComparison | undefined,
  fallbackLabel: string,
  copy: (typeof COPY)[SupportedLocale]
): string | null {
  if (!comparison?.deltas) return null
  const parts = [
    signedMetric(comparison.deltas.conversationCount)
      ? `${copy.conversations} ${signedMetric(comparison.deltas.conversationCount)}`
      : null,
    signedMetric(comparison.deltas.focusDepthScore)
      ? `${copy.focus} ${signedMetric(comparison.deltas.focusDepthScore)}`
      : null,
    signedMetric(comparison.deltas.rhythmScore)
      ? `${copy.rhythm} ${signedMetric(comparison.deltas.rhythmScore)}`
      : null,
    signedMetric(comparison.deltas.topicBreadthScore)
      ? `${copy.breadth} ${signedMetric(comparison.deltas.topicBreadthScore)}`
      : null
  ].filter((part): part is string => Boolean(part))

  if (parts.length === 0) return null
  const label = normalizeInline(comparison.baselineLabel) || fallbackLabel
  return `- **${label}:** ${parts.join(" · ")}`
}

function evidenceLine(
  conversationIds: number[],
  messageIds: number[],
  copy: (typeof COPY)[SupportedLocale]
): string | null {
  const parts = [
    ...conversationIds.map((id) => `${copy.conversation} #${id}`),
    ...messageIds.map((id) => `${copy.message} #${id}`)
  ]
  return parts.length > 0
    ? `_${copy.evidence}: ${parts.join(" · ")}_`
    : null
}

function validIds(values: unknown, limit: number): number[] {
  if (!Array.isArray(values)) return []
  const result: number[] = []
  for (const value of values) {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0
    ) {
      result.push(value)
      if (result.length >= limit) break
    }
  }
  return result
}

function addIds(target: Set<number>, values: unknown, limit: number): void {
  for (const id of validIds(values, limit)) {
    if (target.size >= limit) return
    target.add(id)
  }
}

function collectSources(report: WeeklyGrowthReportV2): {
  conversationIds: number[]
  messageIds: number[]
} {
  const conversationIds = new Set<number>()
  const messageIds = new Set<number>()
  const addConversationIds = (values: unknown) =>
    addIds(conversationIds, values, MAX_LINKED_CONVERSATIONS)
  const addMessageIds = (values: unknown) =>
    addIds(messageIds, values, MAX_SOURCE_MESSAGES)

  for (const highlight of (report.highlights ?? []).slice(
    0,
    MAX_SECTION_ITEMS
  )) {
    addConversationIds([highlight.conversationId])
    addMessageIds([highlight.messageId])
  }
  for (const day of (report.contributionGrid ?? []).slice(
    0,
    MAX_CONTRIBUTION_DAYS
  )) {
    addConversationIds(day.conversationIds)
  }
  for (const emotion of (report.identity?.emotionKeywords ?? []).slice(
    0,
    MAX_SECTION_ITEMS
  )) {
    addConversationIds(emotion.conversationIds)
  }
  for (const tag of [
    ...(report.tags?.current ?? []),
    ...(report.tags?.new ?? []),
    ...(report.tags?.hot ?? [])
  ].slice(0, MAX_SECTION_ITEMS * 3)) {
    addConversationIds(tag.conversationIds)
  }
  for (const question of (report.pushCenter?.unclearQuestions ?? []).slice(
    0,
    MAX_SECTION_ITEMS
  )) {
    addConversationIds(question.conversationIds)
    addMessageIds(question.messageIds)
  }
  for (const resource of (
    report.pushCenter?.resourceRecommendations ?? []
  ).slice(0, MAX_SECTION_ITEMS)) {
    addConversationIds(resource.conversationIds)
    addMessageIds(resource.messageIds)
  }
  for (const most of Object.values(report.mosts ?? {})) {
    if (!most) continue
    addConversationIds([most.conversationId])
    addMessageIds(most.messageIds)
  }

  return {
    conversationIds: Array.from(conversationIds),
    messageIds: Array.from(messageIds)
  }
}

function renderMost(
  value: WeeklyMostInsight | null | undefined,
  copy: (typeof COPY)[SupportedLocale]
): string | null {
  const label = normalizeInline(value?.label)
  const detail = normalizeInline(value?.detail)
  if (!label && !detail) return null
  const evidence = evidenceLine(
    validIds([value?.conversationId], 1),
    validIds(value?.messageIds, 12),
    copy
  )
  return [
    `- **${label || copy.mosts}**${detail ? ` — ${detail}` : ""}`,
    evidence ? `  ${evidence}` : ""
  ]
    .filter(Boolean)
    .join("\n")
}

function tagLine(
  label: string,
  tags: WeeklyGrowthTag[] | undefined
): string | null {
  if (!Array.isArray(tags)) return null
  const rendered = tags
    .slice(0, MAX_SECTION_ITEMS)
    .map((tag) => {
      if (!tag || typeof tag !== "object") return ""
      const name = normalizeInline((tag as { name?: unknown }).name, 120)
      const count = rounded((tag as { count?: unknown }).count)
      return name ? `${name}${count ? ` (${count})` : ""}` : ""
    })
    .filter(Boolean)
    .join(" · ")
  return rendered ? `- **${label}:** ${rendered}` : null
}

function isWeeklyGrowthReportV2(
  value: unknown
): value is WeeklyGrowthReportV2 {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema?: unknown }).schema === "weekly_growth_report.v2"
  )
}

export function isWeeklyKnowledgeSourceReport(
  record: WeeklyReportRecord
): record is WeeklyReportRecord & { structured: WeeklyGrowthReportV2 } {
  return (
    isWeeklyGrowthReportV2(record.structured) &&
    !record.structured.blankWeek?.isBlank
  )
}

function getStructuredReport(record: WeeklyReportRecord): WeeklyGrowthReportV2 {
  if (!isWeeklyGrowthReportV2(record.structured)) {
    throw new Error("WEEKLY_KNOWLEDGE_NOTE_REQUIRES_V2_REPORT")
  }
  if (record.structured.blankWeek?.isBlank) {
    throw new Error("WEEKLY_KNOWLEDGE_NOTE_BLANK_REPORT")
  }
  return record.structured
}

export function buildWeeklyKnowledgeNoteDraft(
  record: WeeklyReportRecord,
  locale: SupportedLocale
): WeeklyKnowledgeNoteDraft {
  if (!Number.isSafeInteger(record.id) || record.id <= 0) {
    throw new Error("WEEKLY_KNOWLEDGE_NOTE_REQUIRES_STORED_REPORT")
  }

  const report = getStructuredReport(record)
  const copy = COPY[locale]
  const timezone = normalizeInline(report.period?.timezone, 100)
  const rangeStart = finiteNumber(report.period?.start) ?? record.rangeStart
  const rangeEnd = finiteNumber(report.period?.end) ?? record.rangeEnd
  const rangeLabel = `${formatDate(rangeStart, locale, timezone)} – ${formatDate(
    rangeEnd,
    locale,
    timezone
  )}`
  const sourceHash = normalizeSourceHash(record.sourceHash)
  const startMarker =
    `<!-- vesti:weekly-note:start version=1 report=${record.id} ` +
    `source=${sourceHash} -->`
  const sections: string[] = []

  addSection(sections, copy.overview, [
    `- **${copy.period}:** ${rangeLabel}`,
    `- **${copy.generated}:** ${formatDateTime(
      record.createdAt,
      locale,
      timezone
    )}`,
    normalizeInline(report.identity?.label)
      ? `- **${copy.identity}:** ${[
          normalizeInline(report.identity?.moodEmoji, 20),
          normalizeInline(report.identity?.label)
        ]
          .filter(Boolean)
          .join(" ")}`
      : null,
    normalizeInline(report.identity?.rationale)
      ? `  ${normalizeInline(report.identity?.rationale)}`
      : null,
    (report.identity?.emotionKeywords ?? []).length > 0
      ? `- **${copy.emotions}:** ${(report.identity?.emotionKeywords ?? [])
          .slice(0, MAX_SECTION_ITEMS)
          .map((emotion) => normalizeInline(emotion.label, 80))
          .filter(Boolean)
          .join(" · ")}`
      : null
  ])

  addSection(sections, copy.energy, [
    scoreLine(
      copy.focus,
      report.energy?.focusDepth?.score,
      [
        rounded(report.energy?.focusDepth?.deepConversationCount)
          ? `${rounded(report.energy?.focusDepth?.deepConversationCount)} ${copy.deepConversations}`
          : null
      ],
      report.energy?.focusDepth?.confidence,
      copy
    ),
    scoreLine(
      copy.rhythm,
      report.energy?.rhythmHealth?.score,
      [
        rounded(report.energy?.rhythmHealth?.activeDays)
          ? `${rounded(report.energy?.rhythmHealth?.activeDays)} ${copy.activeDays}`
          : null
      ],
      report.energy?.rhythmHealth?.confidence,
      copy
    ),
    scoreLine(
      copy.breadth,
      report.energy?.topicBreadth?.score,
      [
        rounded(report.energy?.topicBreadth?.uniqueTopicCount)
          ? `${rounded(report.energy?.topicBreadth?.uniqueTopicCount)} ${copy.topics}`
          : null
      ],
      report.energy?.topicBreadth?.confidence,
      copy
    )
  ])

  addSection(sections, copy.comparisons, [
    comparisonLine(report.growth?.previousWeek, "Previous week", copy),
    comparisonLine(report.growth?.previousMonth, "Previous month", copy)
  ])

  const narrative = [
    normalizeInline(report.greeting),
    ...(report.narrative ?? [])
      .slice(0, MAX_NARRATIVE_PARAGRAPHS)
      .map((paragraph) => normalizeInline(paragraph, 2_000))
  ].filter(Boolean)
  addSection(sections, copy.narrative, narrative)

  addSection(
    sections,
    copy.highlights,
    (report.highlights ?? [])
      .slice(0, MAX_SECTION_ITEMS)
      .flatMap((highlight) => {
        const title = normalizeInline(highlight.title) || copy.highlights
        const detail =
          normalizeInline(highlight.insight, 2_000) ||
          normalizeInline(highlight.excerpt, 2_000)
        const evidence = evidenceLine(
          validIds([highlight.conversationId], 1),
          validIds([highlight.messageId], 1),
          copy
        )
        return [`### ${title}`, detail || null, evidence]
      })
  )

  addSection(sections, copy.topicShifts, [
    tagLine(copy.current, report.tags?.current),
    tagLine(copy.new, report.tags?.new),
    tagLine(copy.hot, report.tags?.hot)
  ])

  addSection(
    sections,
    copy.questions,
    (report.pushCenter?.unclearQuestions ?? [])
      .slice(0, MAX_SECTION_ITEMS)
      .flatMap((question) => {
        const text = normalizeInline(question.question, 1_500)
        if (!text) return []
        const why = normalizeInline(question.whyItMatters, 1_500)
        return [
          `### ${text}`,
          why || null,
          evidenceLine(
            validIds(question.conversationIds, 12),
            validIds(question.messageIds, 24),
            copy
          )
        ]
      })
  )

  addSection(
    sections,
    copy.resources,
    (report.pushCenter?.resourceRecommendations ?? [])
      .slice(0, MAX_SECTION_ITEMS)
      .flatMap((resource) => {
        const title = normalizeInline(resource.title) || copy.resources
        const reason = normalizeInline(resource.reason, 1_500)
        const searchQuery = normalizeInline(resource.searchQuery, 500)
        return [
          `### ${title}`,
          reason || null,
          searchQuery ? `- **${copy.search}:** \`${searchQuery.replace(/`/g, "'")}\`` : null,
          evidenceLine(
            validIds(resource.conversationIds, 12),
            validIds(resource.messageIds, 24),
            copy
          )
        ]
      })
  )

  addSection(sections, copy.mosts, [
    renderMost(report.mosts?.latestConversation, copy),
    renderMost(report.mosts?.topTopic, copy),
    renderMost(report.mosts?.longestConversation, copy),
    renderMost(report.mosts?.unexpectedConversation, copy),
    renderMost(report.mosts?.mentionedEntity, copy)
  ])

  const spiritualFood = report.pushCenter?.spiritualFood
  addSection(sections, copy.food, [
    normalizeInline(spiritualFood?.title)
      ? `### ${normalizeInline(spiritualFood?.title)}`
      : null,
    normalizeInline(spiritualFood?.summary, 2_000) || null,
    normalizeInline(spiritualFood?.takeaway, 1_500)
      ? `- **${copy.takeaway}:** ${normalizeInline(
          spiritualFood?.takeaway,
          1_500
        )}`
      : null
  ])

  const sources = collectSources(report)
  addSection(sections, copy.sources, [
    sources.conversationIds.length > 0
      ? `- **${copy.sourceConversations}:** ${sources.conversationIds
          .map((id) => `#${id}`)
          .join(" · ")}`
      : null,
    sources.messageIds.length > 0
      ? `- **${copy.sourceMessages}:** ${sources.messageIds
          .map((id) => `#${id}`)
          .join(" · ")}`
      : null
  ])

  const managedContent = [
    startMarker,
    `# ${copy.title} · ${rangeLabel}`,
    ...sections,
    WEEKLY_KNOWLEDGE_NOTE_MANAGED_END
  ].join("\n\n")

  return {
    reportId: record.id,
    sourceHash,
    title: `${copy.title} · ${rangeLabel}`,
    managedContent,
    initialContent: `${managedContent}\n\n## ${copy.reflections}\n`,
    linkedConversationIds: sources.conversationIds
  }
}

export function mergeWeeklyKnowledgeNoteContent(
  existingContent: string,
  nextManagedContent: string
): WeeklyKnowledgeNoteMergeResult {
  const match = MANAGED_START_PATTERN.exec(existingContent)
  if (!match || match.index < 0) {
    return {
      content: existingContent,
      changed: false,
      preservedUserContent: true
    }
  }

  const managedEndIndex = existingContent.indexOf(
    WEEKLY_KNOWLEDGE_NOTE_MANAGED_END,
    match.index + match[0].length
  )
  if (managedEndIndex < 0) {
    return {
      content: existingContent,
      changed: false,
      preservedUserContent: true
    }
  }

  const afterManagedIndex =
    managedEndIndex + WEEKLY_KNOWLEDGE_NOTE_MANAGED_END.length
  const content =
    existingContent.slice(0, match.index) +
    nextManagedContent +
    existingContent.slice(afterManagedIndex)

  return {
    content,
    changed: content !== existingContent,
    preservedUserContent: false
  }
}

export function isWeeklyKnowledgeNoteCurrent(
  content: string,
  reportId: number,
  sourceHash: string
): boolean {
  const match = MANAGED_START_PATTERN.exec(content)
  if (!match) return false
  return (
    Number(match[1]) === reportId &&
    match[2] === normalizeSourceHash(sourceHash) &&
    content.indexOf(
      WEEKLY_KNOWLEDGE_NOTE_MANAGED_END,
      match.index + match[0].length
    ) >= 0
  )
}
