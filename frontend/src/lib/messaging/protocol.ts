import type {
  ActiveCaptureStatus,
  Annotation,
  CaptureDecisionMeta,
  Conversation,
  ConversationMatchSummary,
  CreateNoteInput,
  DashboardStats,
  DataOverviewSnapshot,
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
  NoteAssetRecord,
  MessageArtifact,
  MessageAttachment,
  MessageCitation,
  Note,
  ObsidianImportFileEntry,
  ObsidianImportSummary,
  Platform,
  RagResponse,
  RelatedConversation,
  SearchConversationMatchesQuery,
  StorageUsageSnapshot,
  SummaryRecord,
  Topic,
  UpdateNoteChanges,
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
      type: "CREATE_EXPLORE_SESSION"
      target?: "offscreen"
      requestId?: string
      payload: { title: string }
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
      type: "RUN_VECTORIZATION"
      target?: "background"
      requestId?: string
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
  ASK_KNOWLEDGE_BASE: RagResponse & { sessionId: string }
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
  GET_NOTES: Note[]
  CREATE_NOTE: { note: Note }
  UPDATE_NOTE: { note: Note }
  DELETE_NOTE: { deleted: boolean }
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
  GENERATE_CONVERSATION_SUMMARY: SummaryRecord
  GET_WEEKLY_REPORT: WeeklyReportRecord | null
  GENERATE_WEEKLY_REPORT: WeeklyReportRecord
  GENERATE_WEEKLY_RECAP: WeeklyReportRecord
  GET_ACTIVE_CAPTURE_STATUS: ActiveCaptureStatus
  FORCE_ARCHIVE_TRANSIENT: ForceArchiveTransientResult
  RUN_VECTORIZATION: { queued: boolean }
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
