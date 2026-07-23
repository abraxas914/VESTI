import type { ConversationUpdateChanges } from "../messaging/protocol"
import type { SupportedLocale } from "../i18n/locales"
import { sendRequest } from "../messaging/runtime"
import type {
  ActiveCaptureStatus,
  Annotation,
  Conversation,
  ConversationMatchSummary,
  CreateNoteInput,
  DashboardStats,
  DataOverviewSnapshot,
  DesktopBridgeStatus,
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
  Prompt,
  CreatePromptInput,
  UpdatePromptChanges,
  PromptListFilter,
  PromptExtractionResult,
  PromptCompletionResult,
  RagResponse,
  RelayItem,
  RoundtablePersonaId,
  RoundtableResult,
  RelatedConversation,
  SearchConversationMatchesQuery,
  StorageUsageSnapshot,
  SummaryRecord,
  Topic,
  UpdateNoteChanges,
  WeeklyGrowthTimeMachineData,
  WeeklyKnowledgeNoteSaveResult,
  WeeklyKnowledgeNoteStatus,
  WeeklyPushSettings,
  WeeklyReportRecord
} from "../types"
import type { ChatSummaryData } from "../types/insightsPresentation"
import { toChatSummaryData } from "./insightAdapter"
import type { LlmDiagnostic } from "./llmService"

const LONG_RUNNING_TIMEOUT_MS = 120000
const TEST_CONNECTION_TIMEOUT_MS = 45000
const FULL_TEXT_SEARCH_TIMEOUT_MS = 15000
// Dashboard reads can run during a cold service-worker spin-up or over a large
// KB; the 4 s default request timeout then spuriously fails them as "load failed".
const READ_TIMEOUT_MS = 20000

export async function getConversations(filters?: {
  platform?: Platform
  search?: string
  dateRange?: { start: number; end: number }
}): Promise<Conversation[]> {
  return sendRequest({
    type: "GET_CONVERSATIONS",
    target: "offscreen",
    payload: filters
  }, READ_TIMEOUT_MS) as Promise<Conversation[]>
}

export async function getTopics(): Promise<Topic[]> {
  return sendRequest({
    type: "GET_TOPICS",
    target: "offscreen"
  }, READ_TIMEOUT_MS) as Promise<Topic[]>
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

export async function bulkSetConversationFlags(
  ids: number[],
  patch: { is_starred?: boolean; is_archived?: boolean }
): Promise<{ updated: number }> {
  const result = (await sendRequest(
    {
      type: "BULK_SET_CONVERSATION_FLAGS",
      target: "offscreen",
      payload: { ids, patch }
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

export async function bulkAddTagToConversations(
  ids: number[],
  tag: string
): Promise<{ updated: number }> {
  const result = (await sendRequest(
    {
      type: "BULK_ADD_TAG_TO_CONVERSATIONS",
      target: "offscreen",
      payload: { ids, tag }
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
  }, READ_TIMEOUT_MS) as Promise<Message[]>
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

export async function exportConversationToNotion(
  input: { title: string; markdown: string }
): Promise<{ pageId: string; url?: string }> {
  return (await sendRequest(
    {
      type: "EXPORT_CONVERSATION_TO_NOTION",
      target: "offscreen",
      payload: input
    },
    LONG_RUNNING_TIMEOUT_MS
  )) as { pageId: string; url?: string }
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

export async function getWeeklyKnowledgeNoteStatus(
  reportId: number
): Promise<WeeklyKnowledgeNoteStatus> {
  return sendRequest({
    type: "GET_WEEKLY_KNOWLEDGE_NOTE",
    target: "offscreen",
    payload: { reportId }
  }) as Promise<WeeklyKnowledgeNoteStatus>
}

export async function saveWeeklyKnowledgeNote(
  reportId: number,
  locale: SupportedLocale
): Promise<WeeklyKnowledgeNoteSaveResult> {
  return sendRequest({
    type: "SAVE_WEEKLY_KNOWLEDGE_NOTE",
    target: "offscreen",
    payload: { reportId, locale }
  }) as Promise<WeeklyKnowledgeNoteSaveResult>
}

export async function getWeeklyGrowthTimeMachine(
  reportId: number
): Promise<WeeklyGrowthTimeMachineData> {
  return sendRequest({
    type: "GET_WEEKLY_GROWTH_TIME_MACHINE",
    target: "offscreen",
    payload: { reportId }
  }) as Promise<WeeklyGrowthTimeMachineData>
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

export async function runRoundtable(
  question: string,
  personaIds: RoundtablePersonaId[],
  opts?: { lang?: "zh" | "en" }
): Promise<RoundtableResult> {
  return sendRequest(
    {
      type: "RUN_ROUNDTABLE",
      target: "offscreen",
      payload: { question, personaIds, lang: opts?.lang }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<RoundtableResult>
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
  }, READ_TIMEOUT_MS) as Promise<DashboardStats>
}

export async function getStorageUsage(): Promise<StorageUsageSnapshot> {
  return sendRequest({
    type: "GET_STORAGE_USAGE",
    target: "offscreen"
  }, READ_TIMEOUT_MS) as Promise<StorageUsageSnapshot>
}

export async function getDataOverview(): Promise<DataOverviewSnapshot> {
  return sendRequest({
    type: "GET_DATA_OVERVIEW",
    target: "offscreen"
  }, READ_TIMEOUT_MS) as Promise<DataOverviewSnapshot>
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

/** Raw summary records (with `structured` payloads) for local analytics like AITI. */
export async function getAllSummaries(): Promise<SummaryRecord[]> {
  return sendRequest({
    type: "GET_ALL_SUMMARIES",
    target: "offscreen"
  }) as Promise<SummaryRecord[]>
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
  const generationRequestId = crypto.randomUUID()

  return sendRequest(
    {
      type: "GENERATE_WEEKLY_RECAP",
      target: "offscreen",
      requestId: generationRequestId,
      payload: { rangeStart, rangeEnd }
    },
    LONG_RUNNING_TIMEOUT_MS,
    () => {
      void sendRequest(
        {
          type: "CANCEL_WEEKLY_RECAP",
          target: "offscreen",
          payload: { generationRequestId }
        },
        READ_TIMEOUT_MS
      ).catch(() => {
        // The UI is already in a timeout state. Cancellation is best-effort;
        // the background watchdog remains the final safety net.
      })
    }
  ) as Promise<WeeklyReportRecord>
}

export async function getWeeklyPushSettings(): Promise<{
  settings: WeeklyPushSettings
  nextAt: number | null
}> {
  return sendRequest({
    type: "GET_WEEKLY_PUSH_SETTINGS",
    target: "background"
  }) as Promise<{
    settings: WeeklyPushSettings
    nextAt: number | null
  }>
}

export async function setWeeklyPushSettings(
  changes: Partial<WeeklyPushSettings>
): Promise<{
  settings: WeeklyPushSettings
  nextAt: number | null
}> {
  return sendRequest({
    type: "SET_WEEKLY_PUSH_SETTINGS",
    target: "background",
    payload: { changes }
  }) as Promise<{
    settings: WeeklyPushSettings
    nextAt: number | null
  }>
}

export async function testWeeklyPushNotification(): Promise<string> {
  const result = (await sendRequest({
    type: "TEST_WEEKLY_PUSH_NOTIFICATION",
    target: "background"
  })) as { notificationId: string }
  return result.notificationId
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

// ---- VESTI Desktop Bridge --------------------------------------------------

export async function getDesktopBridgeState(): Promise<{
  state: DesktopBridgeStatus
}> {
  return sendRequest(
    {
      type: "DESKTOP_BRIDGE_GET_STATE",
      target: "background"
    },
    10000
  ) as Promise<{ state: DesktopBridgeStatus }>
}

export async function pairDesktopBridge(code: string): Promise<{
  state: DesktopBridgeStatus
}> {
  return sendRequest(
    {
      type: "DESKTOP_BRIDGE_PAIR",
      target: "background",
      payload: { code }
    },
    20000
  ) as Promise<{ state: DesktopBridgeStatus }>
}

export async function disconnectDesktopBridge(): Promise<{
  state: DesktopBridgeStatus
}> {
  return sendRequest({
    type: "DESKTOP_BRIDGE_DISCONNECT",
    target: "background"
  }) as Promise<{ state: DesktopBridgeStatus }>
}

/**
 * Manual retry for TOFU auto-connect (after a decline/timeout, a closed
 * pairing window, or an explicit disconnect). The background clears the
 * local cooldown/suppression and starts a discovery tick; progress arrives
 * via the regular state polling.
 */
export async function retryDesktopBridgeAutoConnect(): Promise<{
  state: DesktopBridgeStatus
}> {
  return sendRequest(
    {
      type: "DESKTOP_BRIDGE_AUTO_CONNECT",
      target: "background"
    },
    10000
  ) as Promise<{ state: DesktopBridgeStatus }>
}

export async function syncDesktopBridgeNow(full?: boolean): Promise<{
  state: DesktopBridgeStatus
  synced: boolean
  skipped?: string
  conversations?: number
  messages?: number
}> {
  return sendRequest(
    {
      type: "DESKTOP_BRIDGE_SYNC_NOW",
      target: "background",
      payload: { full: full === true }
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<{
    state: DesktopBridgeStatus
    synced: boolean
    skipped?: string
    conversations?: number
    messages?: number
  }>
}

// ---- Relay handoff packets (desktop outbox → platform composer) -------------

export async function listRelayOutbox(): Promise<{
  items: RelayItem[]
  outboxSupported: boolean
  needsRepair: boolean
}> {
  return sendRequest(
    {
      type: "RELAY_LIST",
      target: "background"
    },
    10000
  ) as Promise<{
    items: RelayItem[]
    outboxSupported: boolean
    needsRepair: boolean
  }>
}

export async function injectRelayItem(id: number): Promise<{
  item: RelayItem
}> {
  return sendRequest(
    {
      type: "RELAY_INJECT",
      target: "background",
      payload: { id }
    },
    15000
  ) as Promise<{ item: RelayItem }>
}

export async function dismissRelayItem(id: number): Promise<{
  dismissed: boolean
}> {
  return sendRequest({
    type: "RELAY_DISMISS",
    target: "background",
    payload: { id }
  }) as Promise<{ dismissed: boolean }>
}

// ---- Prompt Management -----------------------------------------------------

export async function listPrompts(filter?: PromptListFilter): Promise<Prompt[]> {
  return sendRequest({
    type: "LIST_PROMPTS",
    target: "offscreen",
    payload: { filter }
  }, READ_TIMEOUT_MS) as Promise<Prompt[]>
}

export async function searchPrompts(
  query: string,
  limit?: number
): Promise<Prompt[]> {
  return sendRequest({
    type: "SEARCH_PROMPTS",
    target: "offscreen",
    payload: { query, limit }
  }) as Promise<Prompt[]>
}

export async function createPrompt(
  input: CreatePromptInput
): Promise<{ prompt: Prompt; created: boolean }> {
  return sendRequest({
    type: "CREATE_PROMPT",
    target: "offscreen",
    payload: { input }
  }) as Promise<{ prompt: Prompt; created: boolean }>
}

export async function updatePrompt(
  id: number,
  changes: UpdatePromptChanges
): Promise<Prompt> {
  const result = (await sendRequest({
    type: "UPDATE_PROMPT",
    target: "offscreen",
    payload: { id, changes }
  })) as { prompt: Prompt }
  return result.prompt
}

export async function deletePrompt(id: number): Promise<void> {
  await sendRequest({
    type: "DELETE_PROMPT",
    target: "offscreen",
    payload: { id }
  })
}

export async function togglePromptFavorite(
  id: number,
  isFavorite: boolean
): Promise<Prompt> {
  const result = (await sendRequest({
    type: "TOGGLE_PROMPT_FAVORITE",
    target: "offscreen",
    payload: { id, isFavorite }
  })) as { prompt: Prompt }
  return result.prompt
}

export async function incrementPromptUsage(id: number): Promise<Prompt> {
  const result = (await sendRequest({
    type: "INCREMENT_PROMPT_USAGE",
    target: "offscreen",
    payload: { id }
  })) as { prompt: Prompt }
  return result.prompt
}

export async function extractPromptsFromLibrary(options?: {
  scope?: "all" | "recent"
  limit?: number
}): Promise<PromptExtractionResult> {
  return sendRequest(
    {
      type: "EXTRACT_PROMPTS_FROM_LIBRARY",
      target: "offscreen",
      payload: options
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<PromptExtractionResult>
}

export async function completePrompt(payload: {
  draft: string
  platform?: Platform
  useLibrary?: boolean
}): Promise<PromptCompletionResult> {
  return sendRequest(
    {
      type: "COMPLETE_PROMPT",
      target: "offscreen",
      payload
    },
    LONG_RUNNING_TIMEOUT_MS
  ) as Promise<PromptCompletionResult>
}
