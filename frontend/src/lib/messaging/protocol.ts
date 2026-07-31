import type {
  ActiveCaptureStatus,
  Annotation,
  CaptureDecisionMeta,
  Conversation,
  ConversationMatchSummary,
  CreateNoteInput,
  CreatePromptInput,
  DashboardStats,
  DataOverviewSnapshot,
  DesktopBridgeStatus,
  ExploreAskOptions,
  ExploreMessage,
  ExploreMode,
  ExploreSession,
  ExportFormat,
  ExportPayload,
  ForceArchiveTransientResult,
  GardenerResult,
  ImportDataResult,
  LlmConfig,
  Message,
  MessageArtifact,
  MessageAttachment,
  MessageCitation,
  Note,
  NoteAssetRecord,
  ObsidianImportFileEntry,
  ObsidianImportSummary,
  Platform,
  Prompt,
  PromptCompletionResult,
  PromptExtractionResult,
  PromptListFilter,
  RagResponse,
  RelatedConversation,
  RelayItem,
  RoundtablePersonaId,
  RoundtableResult,
  SearchConversationMatchesQuery,
  StorageUsageSnapshot,
  SummaryRecord,
  Topic,
  UpdateNoteChanges,
  UpdatePromptChanges,
  WeeklyGrowthTimeMachineData,
  WeeklyKnowledgeNoteSaveResult,
  WeeklyKnowledgeNoteStatus,
  WeeklyPushSettings,
  WeeklyReportRecord
} from "../types"
import type { AstRoot, AstVersion } from "../types/ast"

export interface DateRange {
  start: number
  end: number
}

export interface ConversationFilters {
  platform?: Platform
  search?: string
  dateRange?: DateRange
}

export interface ConversationUpdateChanges {
  topic_id?: number | null
  is_starred?: boolean
  tags?: string[]
}

export interface AnnotationSavePayload {
  conversationId: number
  messageId: number
  contentText: string
}

export interface AnnotationActionPayload {
  annotationId: number
}

export interface ConversationDraft {
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
  isMock?: boolean
}

export interface ParsedMessage {
  role: "user" | "ai"
  textContent: string
  contentAst?: AstRoot | null
  contentAstVersion?: AstVersion | null
  degradedNodesCount?: number
  citations?: MessageCitation[]
  attachments?: MessageAttachment[]
  artifacts?: MessageArtifact[]
  normalizedHtmlSnapshot?: string | null
  htmlContent?: string
  timestamp?: number
}

export type CoreRoundtableRoleId =
  | "domain_expert"
  | "devils_advocate"
  | "skeptic"

export interface CoreRoundtableReply {
  role: CoreRoundtableRoleId
  name: string
  content: string
  ok: boolean
  error?: string
  durationMs: number
}

export interface CoreRoundtableResult {
  topic: string
  replies: CoreRoundtableReply[]
  totalDurationMs: number
}

export type InsightPipelineScope = "summary" | "weekly"

export type InsightPipelineStage =
  | "initiating_pipeline"
  | "distilling_core_logic"
  | "curating_summary"
  | "aggregating_weekly_digest"
  | "persisting_result"
  | "completed"
  | "degraded_fallback"

export type InsightPipelineStatus =
  | "in_progress"
  | "completed"
  | "degraded_fallback"

export type InsightPipelineRoute = "proxy" | "modelscope" | "unknown"

export interface InsightPipelineProgressPayload {
  pipelineId: string
  scope: InsightPipelineScope
  targetId: string
  stage: InsightPipelineStage
  status: InsightPipelineStatus
  attempt: number
  startedAt: number
  updatedAt: number
  route: InsightPipelineRoute
  modelId: string
  promptVersion: string
  seq: number
}

export interface InsightPipelineProgressMessage {
  type: "INSIGHT_PIPELINE_PROGRESS"
  payload: InsightPipelineProgressPayload
}

export type RequestMessage =
  | {
      type: "CAPTURE_CONVERSATION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: {
        conversation: ConversationDraft
        messages: ParsedMessage[]
        forceFlag?: boolean
      }
    }
  | {
      type: "GET_CONVERSATIONS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload?: ConversationFilters
    }
  | {
      type: "GET_TOPICS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "CREATE_TOPIC"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { name: string; parent_id?: number | null }
    }
  | {
      type: "UPDATE_CONVERSATION_TOPIC"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number; topic_id: number | null }
    }
  | {
      type: "UPDATE_CONVERSATION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number; changes: ConversationUpdateChanges }
    }
  | {
      type: "RUN_GARDENER"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { conversationId: number }
    }
  | {
      type: "GET_RELATED_CONVERSATIONS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { conversationId: number; limit?: number }
    }
  | {
      type: "GET_ALL_EDGES"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload?: { threshold?: number; conversationIds?: number[] }
    }
  | {
      type: "RENAME_FOLDER_TAG"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { from: string; to: string }
    }
  | {
      type: "MOVE_FOLDER_TAG"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { from: string; to: string }
    }
  | {
      type: "REMOVE_FOLDER_TAG"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { tag: string }
    }
  | {
      type: "BULK_SET_CONVERSATION_FLAGS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: {
        ids: number[]
        patch: { is_starred?: boolean; is_archived?: boolean }
      }
    }
  | {
      type: "BULK_ADD_TAG_TO_CONVERSATIONS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { ids: number[]; tag: string }
    }
  | {
      type: "ASK_KNOWLEDGE_BASE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: {
        query: string
        limit?: number
        sessionId?: string
        mode?: ExploreMode
        options?: ExploreAskOptions
      }
    }
  | {
      type: "RUN_ROUNDTABLE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: {
        question: string
        personaIds: RoundtablePersonaId[]
        lang?: "zh" | "en"
      }
    }
  | {
      type: "RUN_CORE_ROUNDTABLE"
      target?: "background"
      requestId?: string
      payload: { topic: string }
    }
  | {
      type: "OPTIMIZE_DEEPSEEK_PROMPT"
      target?: "background"
      requestId?: string
      payload: {
        originalText: string
        mode: "expert_explain" | "optimize"
      }
    }
  | {
      type: "CREATE_EXPLORE_SESSION"
      target?: "offscreen"
      requestId?: string
      payload: { title: string; systemPrompt?: string }
    }
  | {
      type: "LIST_EXPLORE_SESSIONS"
      target?: "offscreen"
      requestId?: string
      payload?: { limit?: number }
    }
  | {
      type: "GET_EXPLORE_SESSION"
      target?: "offscreen"
      requestId?: string
      payload: { sessionId: string }
    }
  | {
      type: "GET_EXPLORE_MESSAGES"
      target?: "offscreen"
      requestId?: string
      payload: { sessionId: string }
    }
  | {
      type: "DELETE_EXPLORE_SESSION"
      target?: "offscreen"
      requestId?: string
      payload: { sessionId: string }
    }
  | {
      type: "RENAME_EXPLORE_SESSION"
      target?: "offscreen"
      requestId?: string
      payload: { sessionId: string; title: string }
    }
  | {
      type: "UPDATE_EXPLORE_MESSAGE_CONTEXT"
      target?: "offscreen"
      requestId?: string
      payload: {
        messageId: string
        contextDraft: string
        selectedContextConversationIds: number[]
      }
    }
  | {
      type: "GET_MESSAGES"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { conversationId: number }
    }
  | {
      type: "GET_ANNOTATIONS_BY_CONVERSATION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { conversationId: number }
    }
  | {
      type: "SAVE_ANNOTATION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: AnnotationSavePayload
    }
  | {
      type: "DELETE_ANNOTATION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: AnnotationActionPayload
    }
  | {
      type: "EXPORT_ANNOTATION_TO_NOTE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: AnnotationActionPayload
    }
  | {
      type: "EXPORT_ANNOTATION_TO_NOTION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: AnnotationActionPayload
    }
  | {
      type: "EXPORT_CONVERSATION_TO_NOTION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { title: string; markdown: string }
    }
  | {
      type: "GET_NOTES"
      target: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "CREATE_NOTE"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: CreateNoteInput
    }
  | {
      type: "UPDATE_NOTE"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number; changes: UpdateNoteChanges }
    }
  | {
      type: "DELETE_NOTE"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number }
    }
  | {
      type: "GET_WEEKLY_KNOWLEDGE_NOTE"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { reportId: number }
    }
  | {
      type: "SAVE_WEEKLY_KNOWLEDGE_NOTE"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { reportId: number; locale: string }
    }
  | {
      type: "GET_WEEKLY_GROWTH_TIME_MACHINE"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { reportId: number }
    }
  | {
      type: "IMPORT_OBSIDIAN_DIRECTORY"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { vaultName: string; entries: ObsidianImportFileEntry[] }
    }
  | {
      type: "IMPORT_OBSIDIAN_ZIP"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { fileName: string; data: ArrayBuffer }
    }
  | {
      type: "GET_NOTE_ASSET"
      target: "offscreen"
      via?: "background"
      requestId?: string
      payload: { assetId: string }
    }
  | {
      type: "SEARCH_CONVERSATION_IDS_BY_TEXT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { query: string }
    }
  | {
      type: "SEARCH_CONVERSATION_MATCHES_BY_TEXT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: SearchConversationMatchesQuery
    }
  | {
      type: "DELETE_CONVERSATION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number }
    }
  | {
      type: "UPDATE_CONVERSATION_TITLE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number; title: string }
    }
  | {
      type: "GET_DASHBOARD_STATS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "GET_STORAGE_USAGE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "GET_DATA_OVERVIEW"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "EXPORT_DATA"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { format: ExportFormat }
    }
  | {
      type: "IMPORT_DATA"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { content: string }
    }
  | {
      type: "CLEAR_ALL_DATA"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "CLEAR_INSIGHTS_CACHE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "GET_LLM_SETTINGS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "SET_LLM_SETTINGS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { settings: LlmConfig }
    }
  | {
      type: "TEST_LLM_CONNECTION"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "GET_CONVERSATION_SUMMARY"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { conversationId: number }
    }
  | {
      type: "GET_ALL_SUMMARIES"
      target?: "offscreen"
      via?: "background"
      requestId?: string
    }
  | {
      type: "GENERATE_CONVERSATION_SUMMARY"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { conversationId: number }
    }
  | {
      type: "GET_WEEKLY_REPORT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { rangeStart: number; rangeEnd: number }
    }
  | {
      type: "GENERATE_WEEKLY_REPORT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { rangeStart: number; rangeEnd: number }
    }
  | {
      type: "GENERATE_WEEKLY_RECAP"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { rangeStart: number; rangeEnd: number }
    }
  | {
      type: "CANCEL_WEEKLY_RECAP"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { generationRequestId: string }
    }
  | {
      type: "GET_WEEKLY_PUSH_SETTINGS"
      target?: "background"
      requestId?: string
    }
  | {
      type: "SET_WEEKLY_PUSH_SETTINGS"
      target?: "background"
      requestId?: string
      payload: { changes: Partial<WeeklyPushSettings> }
    }
  | {
      type: "TEST_WEEKLY_PUSH_NOTIFICATION"
      target?: "background"
      requestId?: string
    }
  | {
      type: "GET_ACTIVE_CAPTURE_STATUS"
      target?: "background"
      requestId?: string
    }
  | {
      type: "FORCE_ARCHIVE_TRANSIENT"
      target?: "background"
      requestId?: string
    }
  | {
      type: "ONBOARDING_TOUR_START"
      target?: "background"
      requestId?: string
    }
  | {
      type: "ONBOARDING_GUIDE_PROGRESS"
      target?: "background"
      requestId?: string
      payload: {
        feature:
          | "deepseek"
          | "dashboard"
          | "explore"
          | "aiti"
          | "learn"
          | "roundtable"
          | "insights"
        step?: number
        completed?: boolean
      }
    }
  | {
      type: "ONBOARDING_COMPLETE"
      target?: "background"
      requestId?: string
      payload: {
        via: "quick_start" | "skip"
        hasCleanedMockData?: boolean
      }
    }
  | {
      type: "RUN_VECTORIZATION"
      target?: "background"
      requestId?: string
    }
  | {
      type: "IMPORT_HISTORY_PROBE"
      target?: "background"
      requestId?: string
    }
  | {
      type: "IMPORT_HISTORY_START"
      target?: "background"
      requestId?: string
    }
  | {
      type: "ONBOARDING_IMPORT_RECENT_WEEK"
      target?: "background"
      requestId?: string
      payload: { since: number; until: number }
    }
  | {
      type: "IMPORT_HISTORY_CANCEL"
      target?: "background"
      requestId?: string
    }
  | {
      type: "DESKTOP_BRIDGE_GET_STATE"
      target?: "background"
      requestId?: string
    }
  | {
      type: "DESKTOP_BRIDGE_PAIR"
      target?: "background"
      requestId?: string
      payload: { code: string }
    }
  | {
      type: "DESKTOP_BRIDGE_DISCONNECT"
      target?: "background"
      requestId?: string
    }
  | {
      type: "DESKTOP_BRIDGE_SYNC_NOW"
      target?: "background"
      requestId?: string
      payload?: { full?: boolean }
    }
  | {
      type: "DESKTOP_BRIDGE_AUTO_CONNECT"
      target?: "background"
      requestId?: string
    }
  | {
      type: "RELAY_LIST"
      target?: "background"
      requestId?: string
    }
  | {
      type: "RELAY_INJECT"
      target?: "background"
      requestId?: string
      payload: { id: number }
    }
  | {
      type: "RELAY_DISMISS"
      target?: "background"
      requestId?: string
      payload: { id: number }
    }
  | {
      type: "LIST_PROMPTS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload?: { filter?: PromptListFilter }
    }
  | {
      type: "SEARCH_PROMPTS"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { query: string; limit?: number }
    }
  | {
      type: "CREATE_PROMPT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { input: CreatePromptInput }
    }
  | {
      type: "UPDATE_PROMPT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number; changes: UpdatePromptChanges }
    }
  | {
      type: "DELETE_PROMPT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number }
    }
  | {
      type: "TOGGLE_PROMPT_FAVORITE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number; isFavorite: boolean }
    }
  | {
      type: "INCREMENT_PROMPT_USAGE"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: { id: number }
    }
  | {
      type: "EXTRACT_PROMPTS_FROM_LIBRARY"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload?: { scope?: "all" | "recent"; limit?: number }
    }
  | {
      type: "COMPLETE_PROMPT"
      target?: "offscreen"
      via?: "background"
      requestId?: string
      payload: {
        draft: string
        platform?: Platform
        useLibrary?: boolean
        mode?: "optimize" | "continue"
      }
    }

export type ResponseDataMap = {
  CAPTURE_CONVERSATION: {
    saved: boolean
    newMessages: number
    conversationId?: number
    decision: CaptureDecisionMeta
  }
  GET_CONVERSATIONS: Conversation[]
  GET_TOPICS: Topic[]
  CREATE_TOPIC: { topic: Topic }
  UPDATE_CONVERSATION_TOPIC: { updated: boolean; conversation: Conversation }
  UPDATE_CONVERSATION: { updated: boolean; conversation: Conversation }
  RUN_GARDENER: {
    updated: boolean
    conversation: Conversation
    result: GardenerResult
  }
  GET_RELATED_CONVERSATIONS: RelatedConversation[]
  GET_ALL_EDGES: Array<{ source: number; target: number; weight: number }>
  RENAME_FOLDER_TAG: { updated: number }
  MOVE_FOLDER_TAG: { updated: number }
  REMOVE_FOLDER_TAG: { updated: number }
  BULK_SET_CONVERSATION_FLAGS: { updated: number }
  BULK_ADD_TAG_TO_CONVERSATIONS: { updated: number }
  ASK_KNOWLEDGE_BASE: RagResponse & { sessionId: string }
  RUN_ROUNDTABLE: RoundtableResult
  RUN_CORE_ROUNDTABLE: CoreRoundtableResult
  OPTIMIZE_DEEPSEEK_PROMPT: { optimized: string; usedLlm: boolean }
  CREATE_EXPLORE_SESSION: { sessionId: string }
  LIST_EXPLORE_SESSIONS: ExploreSession[]
  GET_EXPLORE_SESSION: ExploreSession | null
  GET_EXPLORE_MESSAGES: ExploreMessage[]
  DELETE_EXPLORE_SESSION: { deleted: boolean }
  RENAME_EXPLORE_SESSION: { updated: boolean }
  UPDATE_EXPLORE_MESSAGE_CONTEXT: { updated: boolean }
  GET_MESSAGES: Message[]
  GET_ANNOTATIONS_BY_CONVERSATION: Annotation[]
  SAVE_ANNOTATION: { annotation: Annotation }
  DELETE_ANNOTATION: { deleted: boolean }
  EXPORT_ANNOTATION_TO_NOTE: { note: Note }
  EXPORT_ANNOTATION_TO_NOTION: { pageId: string; url?: string }
  EXPORT_CONVERSATION_TO_NOTION: { pageId: string; url?: string }
  GET_NOTES: Note[]
  CREATE_NOTE: { note: Note }
  UPDATE_NOTE: { note: Note }
  DELETE_NOTE: { deleted: boolean }
  GET_WEEKLY_KNOWLEDGE_NOTE: WeeklyKnowledgeNoteStatus
  SAVE_WEEKLY_KNOWLEDGE_NOTE: WeeklyKnowledgeNoteSaveResult
  GET_WEEKLY_GROWTH_TIME_MACHINE: WeeklyGrowthTimeMachineData
  IMPORT_OBSIDIAN_DIRECTORY: ObsidianImportSummary
  IMPORT_OBSIDIAN_ZIP: ObsidianImportSummary
  GET_NOTE_ASSET: NoteAssetRecord | null
  SEARCH_CONVERSATION_IDS_BY_TEXT: number[]
  SEARCH_CONVERSATION_MATCHES_BY_TEXT: ConversationMatchSummary[]
  DELETE_CONVERSATION: { deleted: boolean }
  UPDATE_CONVERSATION_TITLE: { updated: boolean; conversation: Conversation }
  GET_DASHBOARD_STATS: DashboardStats
  GET_STORAGE_USAGE: StorageUsageSnapshot
  GET_DATA_OVERVIEW: DataOverviewSnapshot
  EXPORT_DATA: ExportPayload
  IMPORT_DATA: ImportDataResult
  CLEAR_ALL_DATA: { cleared: boolean }
  CLEAR_INSIGHTS_CACHE: { cleared: boolean }
  GET_LLM_SETTINGS: { settings: LlmConfig | null }
  SET_LLM_SETTINGS: { saved: boolean }
  TEST_LLM_CONNECTION: {
    ok: boolean
    message?: string
    diagnostic?: {
      code: string
      route: string
      status: number | null
      requestId: string | null
      rawMessage: string
      userMessage: string
      technicalSummary: string
    }
  }
  GET_CONVERSATION_SUMMARY: SummaryRecord | null
  GET_ALL_SUMMARIES: SummaryRecord[]
  GENERATE_CONVERSATION_SUMMARY: SummaryRecord
  GET_WEEKLY_REPORT: WeeklyReportRecord | null
  GENERATE_WEEKLY_REPORT: WeeklyReportRecord
  GENERATE_WEEKLY_RECAP: WeeklyReportRecord
  CANCEL_WEEKLY_RECAP: { aborted: boolean }
  GET_WEEKLY_PUSH_SETTINGS: {
    settings: WeeklyPushSettings
    nextAt: number | null
  }
  SET_WEEKLY_PUSH_SETTINGS: {
    settings: WeeklyPushSettings
    nextAt: number | null
  }
  TEST_WEEKLY_PUSH_NOTIFICATION: { notificationId: string }
  GET_ACTIVE_CAPTURE_STATUS: ActiveCaptureStatus
  FORCE_ARCHIVE_TRANSIENT: ForceArchiveTransientResult
  ONBOARDING_TOUR_START: { started: true }
  ONBOARDING_GUIDE_PROGRESS: {
    completed: boolean
    allCompleted: boolean
  }
  ONBOARDING_COMPLETE: { completed: true }
  RUN_VECTORIZATION: { queued: boolean }
  IMPORT_HISTORY_PROBE: {
    supported: boolean
    platform?: Platform
    available?: boolean
  }
  IMPORT_HISTORY_START: {
    started: boolean
    platform?: Platform
    reason?: string
  }
  ONBOARDING_IMPORT_RECENT_WEEK: {
    attemptedTabs: number
    availablePlatforms: Platform[]
    completedPlatforms: Platform[]
    saved: number
    failed: number
  }
  IMPORT_HISTORY_CANCEL: { ok: boolean }
  DESKTOP_BRIDGE_GET_STATE: { state: DesktopBridgeStatus }
  DESKTOP_BRIDGE_PAIR: { state: DesktopBridgeStatus }
  DESKTOP_BRIDGE_DISCONNECT: { state: DesktopBridgeStatus }
  DESKTOP_BRIDGE_SYNC_NOW: {
    state: DesktopBridgeStatus
    synced: boolean
    skipped?: string
    conversations?: number
    messages?: number
  }
  DESKTOP_BRIDGE_AUTO_CONNECT: { state: DesktopBridgeStatus }
  RELAY_LIST: {
    items: RelayItem[]
    outboxSupported: boolean
    needsRepair: boolean
  }
  RELAY_INJECT: { item: RelayItem }
  RELAY_DISMISS: { dismissed: boolean }
  LIST_PROMPTS: Prompt[]
  SEARCH_PROMPTS: Prompt[]
  CREATE_PROMPT: { prompt: Prompt; created: boolean }
  UPDATE_PROMPT: { prompt: Prompt }
  DELETE_PROMPT: { deleted: boolean }
  TOGGLE_PROMPT_FAVORITE: { prompt: Prompt }
  INCREMENT_PROMPT_USAGE: { prompt: Prompt }
  EXTRACT_PROMPTS_FROM_LIBRARY: PromptExtractionResult
  COMPLETE_PROMPT: PromptCompletionResult
}

export type ResponseMessage<
  T extends keyof ResponseDataMap = keyof ResponseDataMap
> =
  | {
      ok: true
      type: T
      requestId?: string
      data: ResponseDataMap[T]
    }
  | {
      ok: false
      type: T
      requestId?: string
      error: string
    }

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (!value || typeof value !== "object") return false
  const msg = value as { type?: unknown }
  return typeof msg.type === "string"
}

export function isInsightPipelineProgressMessage(
  value: unknown
): value is InsightPipelineProgressMessage {
  if (!value || typeof value !== "object") return false

  const message = value as {
    type?: unknown
    payload?: Partial<InsightPipelineProgressPayload>
  }
  if (message.type !== "INSIGHT_PIPELINE_PROGRESS") return false
  if (!message.payload || typeof message.payload !== "object") return false

  const payload = message.payload
  return (
    typeof payload.pipelineId === "string" &&
    typeof payload.scope === "string" &&
    typeof payload.targetId === "string" &&
    typeof payload.stage === "string" &&
    typeof payload.status === "string" &&
    typeof payload.attempt === "number" &&
    typeof payload.startedAt === "number" &&
    typeof payload.updatedAt === "number" &&
    typeof payload.route === "string" &&
    typeof payload.modelId === "string" &&
    typeof payload.promptVersion === "string" &&
    typeof payload.seq === "number"
  )
}
