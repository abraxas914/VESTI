// ============================================================
// --- types/index.ts ---
// All interface definitions for Vesti (kept in sync with frontend)
// ============================================================

import type { AstRoot, AstVersion } from "./ast"

export type Platform =
  | "ChatGPT"
  | "Claude"
  | "Gemini"
  | "DeepSeek"
  | "Qwen"
  | "Doubao"
  | "Kimi"
  | "Yuanbao"

export interface Topic {
  id: number
  name: string
  parent_id: number | null
  created_at: number
  updated_at: number
  count?: number
  children?: Topic[]
}

export interface GardenerStep {
  step: string
  status: "pending" | "running" | "completed"
  details?: string
}

export interface GardenerResult {
  tags: string[]
  matchedTopic?: Topic
  createdTopic?: Topic
  steps: GardenerStep[]
}

export interface Conversation {
  id: number
  uuid: string
  platform: Platform
  title: string
  snippet: string
  url: string
  source_created_at: number | null
  first_captured_at: number
  last_captured_at: number
  created_at: number
  updated_at: number
  message_count: number
  turn_count: number
  is_archived: boolean
  is_trash: boolean
  tags: string[]
  topic_id: number | null
  is_starred: boolean
  has_note?: boolean
}

export interface SearchConversationMatchesQuery {
  query: string
  conversationIds?: number[]
}

export type SearchMatchSurface =
  | "body"
  | "source"
  | "attachment"
  | "artifact"
  | "annotation"

export type SearchReadiness = "empty" | "title_snippet_only" | "fulltext"

export interface MessageSearchEntry {
  surface: SearchMatchSurface
  messageId: number
  targetKey: string
  text: string
}

export interface ConversationMatchSummary {
  conversationId: number
  firstMatchedMessageId: number
  bestExcerpt: string
  firstMatchedSurface: SearchMatchSurface
  matchedSurfaces: SearchMatchSurface[]
  /** relevance score (higher = better); used to rank search results */
  score: number
}

export interface VectorRecord {
  id?: number
  conversation_id: number
  text_hash: string
  embedding: Float32Array
}

export interface RelatedConversation {
  id: number
  title: string
  platform: Platform
  similarity: number
}

export type ExploreMode = "agent" | "classic"

export type ExploreSearchScopeMode = "all" | "selected"

export interface ExploreSearchScope {
  mode: ExploreSearchScopeMode
  conversationIds?: number[]
}

export interface ExploreAskOptions {
  searchScope?: ExploreSearchScope
}

export type ExploreIntentType =
  | "fact_lookup"
  | "cross_conversation_summary"
  | "weekly_review"
  | "timeline"
  | "clarification_needed"

export type ExploreRequestedTimeScopePreset =
  | "none"
  | "current_week_to_date"
  | "last_7_days"
  | "last_full_week"
  | "custom"

export interface ExploreRequestedTimeScope {
  preset: ExploreRequestedTimeScopePreset
  label?: string
  startDate?: string
  endDate?: string
}

export interface ExploreResolvedTimeScope {
  preset: Exclude<ExploreRequestedTimeScopePreset, "none">
  label: string
  rangeStart: number
  rangeEnd: number
  startDate: string
  endDate: string
}

export type ExplorePlannerPath = "rag" | "weekly_summary" | "clarify"

export type ExploreToolName =
  | "intent_planner"
  | "time_scope_resolver"
  | "weekly_summary_tool"
  | "query_planner"
  | "search_rag"
  | "summary_tool"
  | "context_compiler"
  | "answer_synthesizer"

export type ExploreToolStatus = "completed" | "failed" | "skipped"

export interface ExploreToolCall {
  id: string
  name: ExploreToolName
  status: ExploreToolStatus
  startedAt: number
  endedAt: number
  durationMs: number
  description?: string
  inputSummary?: string
  outputSummary?: string
  error?: string
}

export interface ExploreContextCandidate {
  conversationId: number
  title: string
  platform: Platform
  similarity: number
  matchType?: "semantic" | "time_scope"
  selectionReason?: string
  summarySnippet?: string
  excerpt?: string
}

export interface ExploreAgentPlan {
  intent: ExploreIntentType
  reason: string
  preferredPath: ExplorePlannerPath
  sourceLimit: number
  summaryTargetCount: number
  answerGoal?: string
  needsClarification?: boolean
  clarifyingQuestion?: string
  requestedTimeScope?: ExploreRequestedTimeScope
  resolvedTimeScope?: ExploreResolvedTimeScope
  toolPlan?: ExploreToolName[]
}

export interface ExploreAgentMeta {
  mode: ExploreMode
  query?: string
  searchScope?: ExploreSearchScope
  plan?: ExploreAgentPlan
  toolCalls: ExploreToolCall[]
  contextDraft?: string
  contextCandidates?: ExploreContextCandidate[]
  selectedContextConversationIds?: number[]
  totalDurationMs?: number
}

export interface RagResponse {
  answer: string
  sources: RelatedConversation[]
  agent?: ExploreAgentMeta
}

export interface ExploreSession {
  id: string
  title: string
  preview: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

export interface ExploreMessage {
  id: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  sources?: RelatedConversation[]
  agentMeta?: ExploreAgentMeta
  timestamp: number
}

// ---- AI 圆桌 (Roundtable) ----
export type RoundtablePersonaId =
  | "skeptic"
  | "optimist"
  | "pragmatist"
  | "domain_expert"
  | "devils_advocate"
  | "moderator"

export interface RoundtablePersona {
  id: RoundtablePersonaId
  nameZh: string
  nameEn: string
  blurbZh: string
  blurbEn: string
  systemPromptZh: string
  systemPromptEn: string
}

export interface RoundtableSeatTurn {
  personaId: RoundtablePersonaId
  content: string
  ok: boolean
  error?: string
  durationMs: number
}

export interface RoundtableSynthesis {
  consensus: string[]
  disagreements: string[]
  recommendation: string
  openQuestions: string[]
}

export interface RoundtableResult {
  question: string
  lang: "zh" | "en"
  grounded: boolean
  seatTurns: RoundtableSeatTurn[]
  synthesis: RoundtableSynthesis | null
  synthesisRaw: string
  sources: RelatedConversation[]
  totalDurationMs: number
}

export type MessageCitationSourceType =
  | "inline_pill"
  | "search_card"
  | "reference_list"
  | "unknown"

export interface MessageCitation {
  label: string
  href: string
  host: string
  sourceType: MessageCitationSourceType
}

export type MessageArtifactKind =
  | "canvas"
  | "preview"
  | "code_artifact"
  | "download_card"
  | "standalone_artifact"
  | "unknown"

export type MessageArtifactCaptureMode =
  | "presence_only"
  | "embedded_dom_snapshot"
  | "standalone_artifact"

export interface MessageArtifact {
  kind: MessageArtifactKind
  label?: string
  captureMode?: MessageArtifactCaptureMode
  renderDimensions?: { width: number; height: number }
  plainText?: string
  markdownSnapshot?: string
  normalizedHtmlSnapshot?: string
}

export type MessageAttachmentOccurrenceRole = "user_upload"

export interface MessageAttachment {
  indexAlt: string
  label?: string
  mime?: string | null
  occurrenceRole: MessageAttachmentOccurrenceRole
}

export interface Message {
  id: number
  conversation_id: number
  role: "user" | "ai"
  content_text: string
  content_ast?: AstRoot | null
  content_ast_version?: AstVersion | null
  degraded_nodes_count?: number
  citations?: MessageCitation[]
  attachments?: MessageAttachment[]
  artifacts?: MessageArtifact[]
  normalized_html_snapshot?: string | null
  created_at: number
}

// ============================================================
// --- Prompt Management ---
// ============================================================

export type PromptSource = "manual" | "extracted"

export interface Prompt {
  id: number
  title: string
  body: string
  category: string | null
  tags: string[]
  source: PromptSource
  source_platform: Platform | null
  source_conversation_id: number | null
  source_message_id: number | null
  is_favorite: boolean
  is_archived: boolean
  quality_score: number
  summary: string | null
  variables: string[]
  use_count: number
  last_used_at: number | null
  body_hash: string
  created_at: number
  updated_at: number
}

export interface CreatePromptInput {
  title?: string
  body: string
  category?: string | null
  tags?: string[]
  source?: PromptSource
  source_platform?: Platform | null
  source_conversation_id?: number | null
  source_message_id?: number | null
  is_favorite?: boolean
  summary?: string | null
  quality_score?: number
}

export interface UpdatePromptChanges {
  title?: string
  body?: string
  category?: string | null
  tags?: string[]
  is_favorite?: boolean
  is_archived?: boolean
  summary?: string | null
  quality_score?: number
  /** Editing an auto-extracted prompt promotes it to "manual" so a re-extract keeps it. */
  source?: PromptSource
}

export interface PromptListFilter {
  category?: string | null
  favoritesOnly?: boolean
  includeArchived?: boolean
  source?: PromptSource
  search?: string
  sort?: "recent" | "score" | "usage"
}

export interface PromptExtractionResult {
  created: number
  skipped: number
  candidates: number
  usedLlm: boolean
}

export interface PromptCompletionResult {
  completion: string
  usedLlm: boolean
}

export interface Annotation {
  id: number
  conversation_id: number
  message_id: number
  content_text: string
  created_at: number
  days_after: number
}

export type NoteSourceType = "native" | "obsidian"
export type ObsidianImportSourceKind = "directory" | "zip"
export type NoteImportAssetKind = "link" | "embed"

export interface NoteImportAssetRef {
  path: string
  asset_id: string | null
  kind: NoteImportAssetKind
}

export interface NoteImportConflict {
  detected_at: number
  incoming_source_file_hash: string
  incoming_content: string
  incoming_frontmatter: Record<string, unknown> | null
}

export interface NoteImportMeta {
  vault_id: string | null
  vault_name: string | null
  relative_path: string | null
  folder_path: string | null
  frontmatter: Record<string, unknown> | null
  wikilinks: string[]
  embeds: string[]
  tags: string[]
  assets: NoteImportAssetRef[]
  source_mtime: number | null
  source_file_hash: string | null
  last_imported_note_hash: string | null
  imported_at: number | null
  last_imported_at: number | null
  conflict: NoteImportConflict | null
}

export interface NoteObsidianExportMeta {
  vault_id: string
  relative_path: string
  last_exported_at: number
}

export type ObsidianVaultConnectionState =
  | "not_connected"
  | "connected"
  | "needs_reconnect"

export interface ObsidianVaultStatus {
  state: ObsidianVaultConnectionState
  vault_id: string | null
  vault_name: string | null
}

export interface Note {
  id: number
  title: string
  content: string
  excerpt: string
  hash: string
  created_at: number
  updated_at: number
  linked_conversation_ids: number[]
  source_type: NoteSourceType
  source_path: string | null
  import_meta: NoteImportMeta | null
  obsidian_export: NoteObsidianExportMeta | null
  kind?: "user" | "weekly_report"
  source_report_id?: number | null
  is_starred?: boolean
}

export interface CreateNoteInput {
  title: string
  content: string
  linked_conversation_ids: number[]
  source_type?: NoteSourceType
  source_path?: string | null
  import_meta?: NoteImportMeta | null
  obsidian_export?: NoteObsidianExportMeta | null
  kind?: "user" | "weekly_report"
  source_report_id?: number | null
  is_starred?: boolean
}

export interface UpdateNoteChanges {
  title?: string
  content?: string
  linked_conversation_ids?: number[]
  source_type?: NoteSourceType
  source_path?: string | null
  import_meta?: NoteImportMeta | null
  obsidian_export?: NoteObsidianExportMeta | null
  kind?: "user" | "weekly_report"
  source_report_id?: number | null
  is_starred?: boolean
}

export interface NoteSourceRecord {
  id: string
  name: string
  kind: ObsidianImportSourceKind
  created_at: number
  updated_at: number
}

export interface NoteAssetRecord {
  id: string
  vault_id: string
  relative_path: string
  mime_type: string
  hash: string
  byte_size: number
  blob: Blob
  created_at: number
  updated_at: number
}

export interface ObsidianImportFileEntry {
  path: string
  mime_type: string
  last_modified: number
  data: ArrayBuffer
}

export interface ObsidianImportSummary {
  vaultId: string
  importedNotes: number
  updatedNotes: number
  skippedNotes: number
  conflictedNotes: number
  importedAssets: number
  unsupportedFiles: string[]
}

export interface ObsidianNoteExportResult {
  note: Note
  vault_id: string
  vault_name: string
  relative_path: string
  exported_at: number
}

export interface DashboardStats {
  totalConversations: number
  totalTokens: number
  firstCaptureStreak: number
  firstCapturedTodayCount: number
  platformDistribution: Record<Platform, number>
  firstCaptureHeatmapData: { date: string; count: number }[]
}

export type ExportFormat = "json" | "txt" | "md"

export interface ExportPayload {
  content: string
  mime: string
  filename: string
}

export interface ImportDataResult {
  conversations: number
  messages: number
  summaries: number
  weeklyReports: number
  annotations: number
}

export type StorageUsageStatus = "ok" | "warning" | "blocked"

export interface StorageUsageSnapshot {
  originUsed: number
  originQuota: number | null
  localUsed: number
  unlimitedStorageEnabled: boolean
  softLimit: number
  hardLimit: number
  status: StorageUsageStatus
}

export interface DataOverviewSnapshot {
  storage: StorageUsageSnapshot
  totalConversations: number
  compactedThreads: number
  summaryRecordCount: number
  weeklyReportCount: number
  lastCompactionAt: number | null
  indexedDbName: string
}

export type CapsuleState = "RECORDING" | "STANDBY" | "PAUSED" | "SAVED"

export type CaptureMode = "mirror" | "smart" | "manual"

export interface CaptureSettings {
  mode: CaptureMode
  smartConfig: {
    minTurns: number
    blacklistKeywords: string[]
  }
}

export type CaptureDecision = "committed" | "held" | "rejected"

export type CaptureDecisionReason =
  | "missing_conversation_id"
  | "force_archive"
  | "mode_mirror"
  | "mode_manual_hold"
  | "smart_below_min_turns"
  | "smart_keyword_blocked"
  | "smart_pass"
  | "empty_payload"
  | "storage_limit_blocked"
  | "persist_failed"

export interface CaptureDecisionMeta {
  mode: CaptureMode
  decision: CaptureDecision
  reason: CaptureDecisionReason
  messageCount: number
  turnCount: number
  blacklistHit: boolean
  forceFlag: boolean
  intercepted: boolean
  occurredAt: number
}

export type ActiveCaptureStatusReason =
  | "ok"
  | "mode_mirror"
  | "unsupported_tab"
  | "no_transient"
  | "content_unreachable"

export interface ActiveCaptureStatus {
  mode: CaptureMode
  supported: boolean
  available: boolean
  reason: ActiveCaptureStatusReason
  platform?: Platform
  sessionUUID?: string
  transientKey?: string
  messageCount?: number
  turnCount?: number
  lastDecision?: CaptureDecisionMeta
  firstObservedAt?: number
  updatedAt?: number
}

export interface ForceArchiveTransientResult {
  forced: true
  saved: boolean
  newMessages: number
  conversationId?: number
  decision: CaptureDecisionMeta
}

export type PageId = "timeline" | "insights" | "data" | "settings"
export type UiThemeMode = "light" | "dark"

export interface UiSettings {
  themeMode: UiThemeMode
}

// Single source of truth lives in the locale registry; re-exported here so
// existing `~lib/types` importers stay in sync automatically when a language is added.
export type { SupportedLocale } from "../i18n/locales"

export type NotionAuthMode = "disconnected" | "oauth_public" | "legacy_manual"

export interface NotionSettings {
  authMode: NotionAuthMode
  accessToken: string
  workspaceId: string
  workspaceName: string
  selectedDatabaseId: string
  selectedDatabaseTitle: string
  updatedAt: number
}

export interface NotionDatabaseOption {
  id: string
  title: string
  url?: string
}

export type UiSemanticLayer = "app_shell" | "artifact_content"
export type TypographySemantic = "ui_sans" | "reading_serif"
export type VisualDensityMode = "guardrail_v1_1" | "target_v1_2"

export type LlmProvider = "modelscope" | "openai_compatible"
export type LlmAccessMode = "demo_proxy" | "custom_byok"
export type StreamMode = "off" | "on"
export type ReasoningPolicy = "off" | "auto" | "force"
export type CapabilitySource = "model_id_heuristic" | "provider_catalog"
export type ThinkHandlingPolicy = "strip" | "keep_debug" | "keep_raw"
export type LlmGatewayLock = "modelscope" | "openai_compatible"

export interface LlmConfig {
  provider: LlmProvider
  baseUrl: string
  apiKey: string
  modelId: string
  temperature: number
  maxTokens: number
  updatedAt: number
  mode?: LlmAccessMode
  proxyBaseUrl?: string
  proxyUrl?: string
  proxyServiceToken?: string
  gatewayLock?: LlmGatewayLock
  customModelId?: string
  streamMode?: StreamMode
  reasoningPolicy?: ReasoningPolicy
  capabilitySource?: CapabilitySource
  thinkHandlingPolicy?: ThinkHandlingPolicy
}

export type InsightFormat =
  | "plain_text"
  | "structured_v1"
  | "fallback_plain_text"
export type InsightStatus = "ok" | "fallback"

export interface ConversationSummaryV1 {
  topic_title: string
  key_takeaways: string[]
  sentiment: "neutral" | "positive" | "negative"
  action_items?: string[]
  tech_stack_detected: string[]
}

export interface ConversationSummaryV2 {
  core_question: string
  thinking_journey: Array<{
    step: number
    speaker: "User" | "AI"
    assertion: string
    real_world_anchor: string | null
  }>
  key_insights: Array<{
    term: string
    definition: string
  }>
  unresolved_threads: string[]
  meta_observations: {
    thinking_style: string
    emotional_tone: string
    depth_level: "superficial" | "moderate" | "deep"
  }
  actionable_next_steps: string[]
}

export interface ConversationSummaryV2Legacy {
  core_question: string
  thinking_journey: {
    initial_state: string
    key_turns: string[]
    final_understanding: string
  }
  key_insights: string[]
  unresolved_threads: string[]
  meta_observations: {
    thinking_style: string
    emotional_tone: string
    depth_level: "superficial" | "moderate" | "deep"
  }
  actionable_next_steps: string[]
}

export interface WeeklyReportV1 {
  period_title: string
  main_themes: string[]
  key_takeaways: string[]
  action_items?: string[]
  tech_stack_detected: string[]
}

export interface WeeklyLiteReportV1 {
  time_range: {
    start: string
    end: string
    total_conversations: number
  }
  highlights: string[]
  recurring_questions: string[]
  cross_domain_echoes: Array<{
    domain_a: string
    domain_b: string
    shared_logic: string
    evidence_ids: number[]
  }>
  unresolved_threads: string[]
  suggested_focus: string[]
  evidence: Array<{
    conversation_id: number
    note: string
  }>
  insufficient_data: boolean
}

export interface SummaryRecord {
  id: number
  conversationId: number
  content: string
  structured?:
    | ConversationSummaryV1
    | ConversationSummaryV2
    | ConversationSummaryV2Legacy
    | null
  format?: InsightFormat
  status?: InsightStatus
  schemaVersion?: "conversation_summary.v1" | "conversation_summary.v2"
  modelId: string
  createdAt: number
  sourceUpdatedAt: number
}

export interface WeeklyRecapV1 {
  schema?: "weekly_recap.v1"
  greeting: string
  persona_tag: string
  mood_emoji: string
  narrative: string[]
  highlight: { title: string; detail: string } | null
  stats: {
    conversation_count: number
    active_days: number
    streak_weeks: number
    top_platform: string
    week_over_week_delta: number | null
  }
}

export type WeeklyReportPeriodType = "week" | "quarter" | "year"
export type WeeklyMetricConfidence = "estimated" | "reliable"

export interface WeeklyFocusDepthMetric {
  score?: number
  averageTurns?: number
  longestTurns?: number
  averageMessageLength?: number
  deepConversationCount?: number
  deepConversationRate?: number
  confidence?: WeeklyMetricConfidence
}

export interface WeeklyRhythmMetric {
  score?: number
  activeHours?: number[]
  activeDays?: number
  peakHour?: number | null
  lateNightRatio?: number
  activityConcentration?: number
  confidence?: WeeklyMetricConfidence
}

export interface WeeklyTopicBreadthMetric {
  score?: number
  uniqueTopicCount?: number
  entropy?: number
  topTopics?: Array<{
    name?: string
    count?: number
    share?: number
  }>
  confidence?: WeeklyMetricConfidence
}

export interface WeeklyMetricSnapshot {
  conversationCount?: number
  activeDays?: number
  focusDepthScore?: number
  rhythmScore?: number
  topicBreadthScore?: number
}

export interface WeeklyMetricComparison {
  baselineLabel?: string
  current?: WeeklyMetricSnapshot
  baseline?: WeeklyMetricSnapshot
  deltas?: WeeklyMetricSnapshot
}

export interface WeeklyGrowthSeriesPoint extends WeeklyMetricSnapshot {
  rangeStart?: number
  rangeEnd?: number
  label?: string
}

export interface WeeklyEmotionKeyword {
  label?: string
  score?: number
  conversationIds?: number[]
}

export type WeeklyRecapStyle = "humorous" | "professional" | "motivational"

export interface WeeklyStyleVariant {
  greeting?: string
  narrative?: string[]
  callToAction?: string
}

export interface WeeklyOpenQuestion {
  question?: string
  whyItMatters?: string
  conversationIds?: number[]
  messageIds?: number[]
}

export interface WeeklyResourceRecommendation {
  title?: string
  reason?: string
  searchQuery?: string
  conversationIds?: number[]
  messageIds?: number[]
}

export interface WeeklyPushCenter {
  spiritualFood?: {
    title?: string
    summary?: string
    takeaway?: string
  }
  styleVariants?: {
    humorous?: WeeklyStyleVariant
    professional?: WeeklyStyleVariant
    motivational?: WeeklyStyleVariant
  }
  unclearQuestions?: WeeklyOpenQuestion[]
  resourceRecommendations?: WeeklyResourceRecommendation[]
}

export interface WeeklyPushSettings {
  enabled: boolean
  weekday: number
  hour: number
  minute: number
  style: WeeklyRecapStyle
  updatedAt: number
}

export interface WeeklyGrowthHighlight {
  id?: string
  conversationId?: number
  messageId?: number
  title?: string
  excerpt?: string
  insight?: string
  score?: number
  originAt?: number
}

export interface WeeklyContributionDay {
  date?: string
  count?: number
  intensity?: number
  depthScore?: number
  conversationIds?: number[]
}

export interface WeeklyGrowthTag {
  name?: string
  count?: number
  weight?: number
  conversationIds?: number[]
}

export interface WeeklyMostInsight {
  label?: string
  detail?: string
  conversationId?: number | null
  messageIds?: number[]
}

export interface WeeklyGrowthReportV2 {
  schema?: "weekly_growth_report.v2"
  period?: {
    type?: WeeklyReportPeriodType
    start?: number
    end?: number
    timezone?: string
  }
  greeting?: string
  narrative?: string[]
  energy?: {
    focusDepth?: WeeklyFocusDepthMetric
    rhythmHealth?: WeeklyRhythmMetric
    topicBreadth?: WeeklyTopicBreadthMetric
  }
  growth?: {
    previousWeek?: WeeklyMetricComparison
    previousMonth?: WeeklyMetricComparison
    series?: WeeklyGrowthSeriesPoint[]
  }
  identity?: {
    label?: string
    rationale?: string
    moodEmoji?: string
    emotionKeywords?: WeeklyEmotionKeyword[]
  }
  pushCenter?: WeeklyPushCenter
  highlights?: WeeklyGrowthHighlight[]
  contributionGrid?: WeeklyContributionDay[]
  tags?: {
    current?: WeeklyGrowthTag[]
    new?: WeeklyGrowthTag[]
    hot?: WeeklyGrowthTag[]
  }
  mosts?: {
    latestConversation?: WeeklyMostInsight | null
    topTopic?: WeeklyMostInsight | null
    longestConversation?: WeeklyMostInsight | null
    unexpectedConversation?: WeeklyMostInsight | null
    mentionedEntity?: WeeklyMostInsight | null
  }
  blankWeek?: {
    isBlank?: boolean
    reason?: "no_data" | "low_activity" | "capture_uncertain" | "none"
    gentleMessage?: string
    conversationCount?: number
    baselineMedian?: number | null
  }
}

export interface WeeklyReportRecord {
  id: number
  rangeStart: number
  rangeEnd: number
  content: string
  structured?:
    | WeeklyReportV1
    | WeeklyLiteReportV1
    | WeeklyRecapV1
    | WeeklyGrowthReportV2
    | null
  format?: InsightFormat
  status?: InsightStatus
  schemaVersion?:
    | "weekly_report.v1"
    | "weekly_lite.v1"
    | "weekly_recap.v1"
    | "weekly_growth_report.v2"
  periodType?: WeeklyReportPeriodType
  modelId: string
  createdAt: number
  sourceHash: string
}

export type AsyncStatus = "idle" | "loading" | "ready" | "error"
