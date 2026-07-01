import type { ConversationUpdateChanges } from "../messaging/protocol"
import { sendRequest } from "../messaging/runtime"
import type {
  ActiveCaptureStatus,
  Annotation,
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
  ForceArchiveTransientResult,
  GardenerResult,
  ImportDataResult,
  LlmConfig,
  Message,
  Note,
  NoteAssetRecord,
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
import type { ChatSummaryData } from "../types/insightsPresentation"
import { toChatSummaryData } from "./insightAdapter"
import type { LlmDiagnostic } from "./llmService"

const LONG_RUNNING_TIMEOUT_MS = 120000
const TEST_CONNECTION_TIMEOUT_MS = 45000
const FULL_TEXT_SEARCH_TIMEOUT_MS = 15000

export async function getConversations(filters?: {
  platform?: Platform
  search?: string
  dateRange?: { start: number; end: number }
}): Promise<Conversation[]> {
  return sendRequest({
    type: "GET_CONVERSATIONS",
    target: "offscreen",
    payload: filters
  }) as Promise<Conversation[]>
}

export async function getTopics(): Promise<Topic[]> {
  return sendRequest({
    type: "GET_TOPICS",
    target: "offscreen"
  }) as Promise<Topic[]>
}

export async function createTopic(
  name: string,
  parent_id?: number | null
): Promise<Topic> {
  const result = (await sendRequest({
    type: "CREATE_TOPIC",
    target: "offscreen",
    payload: { name, parent_id }
  })) as { topic: Topic }

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })

  return result.topic
}

export async function updateConversationTopic(
  id: number,
  topic_id: number | null
): Promise<Conversation> {
  const result = (await sendRequest({
    type: "UPDATE_CONVERSATION_TOPIC",
    target: "offscreen",
    payload: { id, topic_id }
  })) as { updated: boolean; conversation: Conversation }

  if (result.updated) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  }

  return result.conversation
}

export async function updateConversation(
  id: number,
  changes: ConversationUpdateChanges
): Promise<{ updated: boolean; conversation: Conversation }> {
  const result = (await sendRequest({
    type: "UPDATE_CONVERSATION",
    target: "offscreen",
    payload: { id, changes }
  })) as { updated: boolean; conversation: Conversation }

  if (result.updated) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  }

  return result
}

export async function runGardener(
  conversationId: number
): Promise<{
  updated: boolean
  conversation: Conversation
  result: GardenerResult
}> {
  const result = (await sendRequest({
    type: "RUN_GARDENER",
    target: "offscreen",
    payload: { conversationId }
  })) as {
    updated: boolean
    conversation: Conversation
    result: GardenerResult
  }

  if (result.updated) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  }

  return result
}

export async function getRelatedConversations(
  conversationId: number,
  limit?: number
): Promise<RelatedConversation[]> {
  return sendRequest(
    {
      type: "GET_RELATED_CONVERSATIONS",
      target: "offscreen",
      payload: { conversationId, limit }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<RelatedConversation[]>
}

export async function getAllEdges(
  options: { threshold?: number; conversationIds?: number[] } = {}
): Promise<Array<{ source: number; target: number; weight: number }>> {
  return sendRequest(
    {
      type: "GET_ALL_EDGES",
      target: "offscreen",
      payload: options
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<Array<{ source: number; target: number; weight: number }>>
}

export async function renameFolderTag(
  from: string,
  to: string
): Promise<{ updated: number }> {
  const result = (await sendRequest(
    {
      type: "RENAME_FOLDER_TAG",
      target: "offscreen",
      payload: { from, to }
    },
    LONG_RUNNING_TIMEOUT_MS
  )) as { updated: number }

  if (result.updated > 0) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  }

  return result
}

export async function moveFolderTag(
  from: string,
  to: string
): Promise<{ updated: number }> {
  const result = (await sendRequest(
    {
      type: "MOVE_FOLDER_TAG",
      target: "offscreen",
      payload: { from, to }
    },
    LONG_RUNNING_TIMEOUT_MS
  )) as { updated: number }

  if (result.updated > 0) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  }

  return result
}

export async function removeFolderTag(
  tag: string
): Promise<{ updated: number }> {
  const result = (await sendRequest(
    {
      type: "REMOVE_FOLDER_TAG",
      target: "offscreen",
      payload: { tag }
    },
    LONG_RUNNING_TIMEOUT_MS
  )) as { updated: number }

  if (result.updated > 0) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  }

  return result
}

export async function getMessages(conversationId: number): Promise<Message[]> {
  return sendRequest({
    type: "GET_MESSAGES",
    target: "offscreen",
    payload: { conversationId }
  }) as Promise<Message[]>
}

export async function getAnnotationsByConversation(
  conversationId: number
): Promise<Annotation[]> {
  return sendRequest({
    type: "GET_ANNOTATIONS_BY_CONVERSATION",
    target: "offscreen",
    payload: { conversationId }
  }) as Promise<Annotation[]>
}

export async function saveAnnotation(payload: {
  conversationId: number
  messageId: number
  contentText: string
}): Promise<Annotation> {
  const result = (await sendRequest({
    type: "SAVE_ANNOTATION",
    target: "offscreen",
    payload
  })) as { annotation: Annotation }

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })

  return result.annotation
}

export async function deleteAnnotation(annotationId: number): Promise<void> {
  await sendRequest({
    type: "DELETE_ANNOTATION",
    target: "offscreen",
    payload: { annotationId }
  })

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })
}

export async function exportAnnotationToNote(
  annotationId: number
): Promise<Note> {
  const result = (await sendRequest({
    type: "EXPORT_ANNOTATION_TO_NOTE",
    target: "offscreen",
    payload: { annotationId }
  })) as { note: Note }

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })

  return result.note
}

export async function exportAnnotationToNotion(
  annotationId: number
): Promise<{ pageId: string; url?: string }> {
  const result = (await sendRequest({
    type: "EXPORT_ANNOTATION_TO_NOTION",
    target: "offscreen",
    payload: { annotationId }
  })) as { pageId: string; url?: string }

  return result
}

export async function getNotes(): Promise<Note[]> {
  return sendRequest({
    type: "GET_NOTES",
    target: "offscreen"
  }) as Promise<Note[]>
}

export async function saveNote(
  data: CreateNoteInput
): Promise<Note> {
  const result = (await sendRequest({
    type: "CREATE_NOTE",
    target: "offscreen",
    payload: data
  })) as { note: Note }
  return result.note
}

export async function updateNote(
  id: number,
  changes: UpdateNoteChanges
): Promise<Note> {
  const result = (await sendRequest({
    type: "UPDATE_NOTE",
    target: "offscreen",
    payload: { id, changes }
  })) as { note: Note }
  return result.note
}

export async function deleteNote(id: number): Promise<void> {
  await sendRequest({
    type: "DELETE_NOTE",
    target: "offscreen",
    payload: { id }
  })
}

export async function importObsidianDirectory(
  vaultName: string,
  entries: ObsidianImportFileEntry[]
): Promise<ObsidianImportSummary> {
  return sendRequest(
    {
      type: "IMPORT_OBSIDIAN_DIRECTORY",
      target: "offscreen",
      payload: { vaultName, entries }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<ObsidianImportSummary>
}

export async function importObsidianZip(
  fileName: string,
  data: ArrayBuffer
): Promise<ObsidianImportSummary> {
  return sendRequest(
    {
      type: "IMPORT_OBSIDIAN_ZIP",
      target: "offscreen",
      payload: { fileName, data }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<ObsidianImportSummary>
}

export async function getNoteAsset(
  assetId: string
): Promise<NoteAssetRecord | null> {
  return sendRequest({
    type: "GET_NOTE_ASSET",
    target: "offscreen",
    payload: { assetId }
  }) as Promise<NoteAssetRecord | null>
}

export async function searchConversationIdsByText(
  query: string
): Promise<number[]> {
  return sendRequest(
    {
      type: "SEARCH_CONVERSATION_IDS_BY_TEXT",
      target: "offscreen",
      payload: { query }
    },
    FULL_TEXT_SEARCH_TIMEOUT_MS
  ) as Promise<number[]>
}

export async function searchConversationMatchesByText(
  params: SearchConversationMatchesQuery
): Promise<ConversationMatchSummary[]> {
  return sendRequest(
    {
      type: "SEARCH_CONVERSATION_MATCHES_BY_TEXT",
      target: "offscreen",
      payload: params
    },
    FULL_TEXT_SEARCH_TIMEOUT_MS
  ) as Promise<ConversationMatchSummary[]>
}

export async function askKnowledgeBase(
  query: string,
  sessionId?: string,
  limit?: number,
  mode?: ExploreMode,
  options?: ExploreAskOptions
): Promise<RagResponse & { sessionId: string }> {
  return sendRequest(
    {
      type: "ASK_KNOWLEDGE_BASE",
      target: "offscreen",
      payload: { query, sessionId, limit, mode, options }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<RagResponse & { sessionId: string }>
}

// Explore Session APIs
export async function createExploreSession(title: string): Promise<string> {
  const result = (await sendRequest({
    type: "CREATE_EXPLORE_SESSION",
    target: "offscreen",
    payload: { title }
  })) as { sessionId: string }
  return result.sessionId
}

export async function listExploreSessions(
  limit?: number
): Promise<ExploreSession[]> {
  return sendRequest({
    type: "LIST_EXPLORE_SESSIONS",
    target: "offscreen",
    payload: { limit }
  }) as Promise<ExploreSession[]>
}

export async function getExploreSession(
  sessionId: string
): Promise<ExploreSession | null> {
  return sendRequest({
    type: "GET_EXPLORE_SESSION",
    target: "offscreen",
    payload: { sessionId }
  }) as Promise<ExploreSession | null>
}

export async function getExploreMessages(
  sessionId: string
): Promise<ExploreMessage[]> {
  return sendRequest({
    type: "GET_EXPLORE_MESSAGES",
    target: "offscreen",
    payload: { sessionId }
  }) as Promise<ExploreMessage[]>
}

export async function deleteExploreSession(sessionId: string): Promise<void> {
  await sendRequest({
    type: "DELETE_EXPLORE_SESSION",
    target: "offscreen",
    payload: { sessionId }
  })
}

export async function renameExploreSession(
  sessionId: string,
  title: string
): Promise<void> {
  await sendRequest({
    type: "RENAME_EXPLORE_SESSION",
    target: "offscreen",
    payload: { sessionId, title }
  })
}

export async function updateExploreMessageContext(
  messageId: string,
  contextDraft: string,
  selectedContextConversationIds: number[]
): Promise<void> {
  await sendRequest({
    type: "UPDATE_EXPLORE_MESSAGE_CONTEXT",
    target: "offscreen",
    payload: { messageId, contextDraft, selectedContextConversationIds }
  })
}

export async function deleteConversation(id: number): Promise<void> {
  await sendRequest({
    type: "DELETE_CONVERSATION",
    target: "offscreen",
    payload: { id }
  })

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })
}

export async function deleteConversations(ids: number[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ids))
  if (uniqueIds.length === 0) return

  for (const id of uniqueIds) {
    await sendRequest({
      type: "DELETE_CONVERSATION",
      target: "offscreen",
      payload: { id }
    })
  }

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })
}

export async function updateConversationTitle(
  id: number,
  title: string
): Promise<Conversation> {
  const result = (await sendRequest({
    type: "UPDATE_CONVERSATION_TITLE",
    target: "offscreen",
    payload: { id, title }
  })) as { updated: boolean; conversation: Conversation }

  if (result.updated) {
    chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
      void chrome.runtime.lastError
    })
  }

  return result.conversation
}

export async function getDashboardStats(): Promise<DashboardStats> {
  return sendRequest({
    type: "GET_DASHBOARD_STATS",
    target: "offscreen"
  }) as Promise<DashboardStats>
}

export async function getStorageUsage(): Promise<StorageUsageSnapshot> {
  return sendRequest({
    type: "GET_STORAGE_USAGE",
    target: "offscreen"
  }) as Promise<StorageUsageSnapshot>
}

export async function getDataOverview(): Promise<DataOverviewSnapshot> {
  return sendRequest({
    type: "GET_DATA_OVERVIEW",
    target: "offscreen"
  }) as Promise<DataOverviewSnapshot>
}

export async function exportData(
  format: ExportFormat
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const result = (await sendRequest({
    type: "EXPORT_DATA",
    target: "offscreen",
    payload: { format }
  })) as { content: string; filename: string; mime: string }

  return {
    blob: new Blob([result.content], { type: result.mime }),
    filename: result.filename,
    mime: result.mime
  }
}

export async function importData(content: string): Promise<ImportDataResult> {
  const result = (await sendRequest(
    {
      type: "IMPORT_DATA",
      target: "offscreen",
      payload: { content }
    },
    LONG_RUNNING_TIMEOUT_MS
  )) as ImportDataResult

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })

  return result
}

export async function clearAllData(): Promise<void> {
  await sendRequest({
    type: "CLEAR_ALL_DATA",
    target: "offscreen"
  })

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })
}

export async function clearInsightsCache(): Promise<void> {
  await sendRequest({
    type: "CLEAR_INSIGHTS_CACHE",
    target: "offscreen"
  })

  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })
}

export async function getLlmSettings(): Promise<LlmConfig | null> {
  const result = (await sendRequest({
    type: "GET_LLM_SETTINGS",
    target: "offscreen"
  })) as { settings: LlmConfig | null }
  return result.settings
}

export async function setLlmSettings(settings: LlmConfig): Promise<void> {
  await sendRequest({
    type: "SET_LLM_SETTINGS",
    target: "offscreen",
    payload: { settings }
  })
}

export async function testLlmConnection(): Promise<{
  ok: boolean
  message?: string
  diagnostic?: LlmDiagnostic | null
}> {
  return sendRequest(
    {
      type: "TEST_LLM_CONNECTION",
      target: "offscreen"
    },
    TEST_CONNECTION_TIMEOUT_MS
  ) as Promise<{
    ok: boolean
    message?: string
    diagnostic?: LlmDiagnostic | null
  }>
}

export async function getConversationSummary(
  conversationId: number
): Promise<SummaryRecord | null> {
  return sendRequest({
    type: "GET_CONVERSATION_SUMMARY",
    target: "offscreen",
    payload: { conversationId }
  }) as Promise<SummaryRecord | null>
}

export async function getSummary(
  conversationId: number
): Promise<ChatSummaryData | null> {
  const record = await getConversationSummary(conversationId)
  return record ? toChatSummaryData(record) : null
}

export async function generateConversationSummary(
  conversationId: number
): Promise<SummaryRecord> {
  return sendRequest(
    {
      type: "GENERATE_CONVERSATION_SUMMARY",
      target: "offscreen",
      payload: { conversationId }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<SummaryRecord>
}

export async function generateSummary(
  conversationId: number
): Promise<ChatSummaryData> {
  const record = await generateConversationSummary(conversationId)
  return toChatSummaryData(record)
}

export async function getWeeklyReport(
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord | null> {
  return sendRequest({
    type: "GET_WEEKLY_REPORT",
    target: "offscreen",
    payload: { rangeStart, rangeEnd }
  }) as Promise<WeeklyReportRecord | null>
}

export async function generateWeeklyReport(
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord> {
  return sendRequest(
    {
      type: "GENERATE_WEEKLY_REPORT",
      target: "offscreen",
      payload: { rangeStart, rangeEnd }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<WeeklyReportRecord>
}

export async function generateWeeklyRecap(
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord> {
  return sendRequest(
    {
      type: "GENERATE_WEEKLY_RECAP",
      target: "offscreen",
      payload: { rangeStart, rangeEnd }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<WeeklyReportRecord>
}

export async function getActiveCaptureStatus(): Promise<ActiveCaptureStatus> {
  return sendRequest({
    type: "GET_ACTIVE_CAPTURE_STATUS",
    target: "background"
  }) as Promise<ActiveCaptureStatus>
}

export async function forceArchiveTransient(): Promise<ForceArchiveTransientResult> {
  return sendRequest({
    type: "FORCE_ARCHIVE_TRANSIENT",
    target: "background"
  }) as Promise<ForceArchiveTransientResult>
}
