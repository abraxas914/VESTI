import { interceptAndPersistCapture } from "../lib/capture/storage-interceptor"
import {
  clearAllData,
  clearInsightsCache,
  createExploreSession,
  createNote,
  createTopic,
  deleteAnnotation,
  deleteConversation,
  deleteExploreSession,
  deleteNote,
  exportAllData,
  getDashboardStats,
  getDataOverview,
  getExploreMessages,
  getExploreSession,
  getStorageUsage,
  getSummary,
  getTopics,
  getWeeklyReport,
  importAllData,
  importObsidianDirectory,
  importObsidianZip,
  listAnnotations,
  listConversations,
  listExploreSessions,
  listMessages,
  listNotes,
  moveTagAcrossConversations,
  removeTagFromConversations,
  renameTagAcrossConversations,
  saveAnnotation,
  searchConversationIdsByText,
  searchConversationMatchesByText,
  getNoteAsset,
  updateConversation,
  updateConversationTitle,
  updateConversationTopic,
  updateExploreMessageContext,
  updateExploreSession,
  updateNote
} from "../lib/db/repository"
import { isRequestMessage } from "../lib/messaging/protocol"
import type { RequestMessage, ResponseMessage } from "../lib/messaging/protocol"
import {
  exportAnnotationToMyNotes,
  exportAnnotationToNotion
} from "../lib/services/annotationExportService"
import { getCaptureSettings } from "../lib/services/captureSettingsService"
import { runGardener } from "../lib/services/gardenerService"
import {
  generateConversationSummary,
  generateWeeklyRecap,
  generateWeeklyReport
} from "../lib/services/insightGenerationService"
import {
  getLlmAccessMode,
  normalizeLlmSettings
} from "../lib/services/llmConfig"
import { callInference } from "../lib/services/llmService"
import {
  getLlmSettings,
  setLlmSettings
} from "../lib/services/llmSettingsService"
import {
  askKnowledgeBase,
  findAllEdges,
  findRelatedConversations,
  vectorizeAllConversations
} from "../lib/services/searchService"
import type {
  ActiveCaptureStatus,
  CaptureMode,
  ForceArchiveTransientResult,
  LlmConfig,
  Platform
} from "../lib/types"
import { logger } from "../lib/utils/logger"

let isVectorizing = false
let rerunVectorizationRequested = false

async function runVectorizationTask(reason: string): Promise<boolean> {
  if (isVectorizing) {
    rerunVectorizationRequested = true
    return false
  }
  isVectorizing = true
  try {
    const created = await vectorizeAllConversations()
    logger.info("vectorize", "Vectorization task completed", {
      reason,
      created
    })
  } catch (error) {
    logger.warn("vectorize", "Vectorization task failed", {
      reason,
      error: (error as Error)?.message ?? String(error)
    })
  } finally {
    isVectorizing = false
    if (rerunVectorizationRequested) {
      rerunVectorizationRequested = false
      void runVectorizationTask("rerun")
    }
  }
  return true
}

function requireSettings(settings: LlmConfig | null): LlmConfig {
  if (!settings) {
    throw new Error("LLM_CONFIG_MISSING")
  }
  const normalized = normalizeLlmSettings(settings)
  const mode = getLlmAccessMode(normalized)
  if (mode === "demo_proxy") {
    if (
      (!normalized.proxyBaseUrl && !normalized.proxyUrl) ||
      !normalized.modelId
    ) {
      throw new Error("LLM_CONFIG_MISSING")
    }
    return normalized
  }
  if (!normalized.apiKey || !normalized.modelId || !normalized.baseUrl) {
    throw new Error("LLM_CONFIG_MISSING")
  }
  return normalized
}

type ContentTransientStatusResponse =
  | {
      ok: true
      status: {
        available: boolean
        reason: "ok" | "no_transient"
        platform?: Platform
        sessionUUID?: string
        transientKey?: string
        messageCount?: number
        turnCount?: number
        lastDecision?: ActiveCaptureStatus["lastDecision"]
        firstObservedAt?: number
        updatedAt?: number
      }
    }
  | { ok: false; error: string }

type ContentForceArchiveResponse =
  | {
      ok: true
      result: {
        saved: boolean
        newMessages: number
        conversationId?: number
        decision: ForceArchiveTransientResult["decision"]
      }
    }
  | { ok: false; error: string }

const SUPPORTED_CAPTURE_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "chat.deepseek.com",
  "www.doubao.com",
  "chat.qwen.ai",
  "www.kimi.com",
  "kimi.com",
  "kimi.moonshot.cn",
  "yuanbao.tencent.com"
])

function resolvePlatformFromUrl(url: string): Platform | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === "chatgpt.com" || host === "chat.openai.com") {
      return "ChatGPT"
    }
    if (host === "claude.ai") {
      return "Claude"
    }
    if (host === "gemini.google.com") {
      return "Gemini"
    }
    if (host === "chat.deepseek.com") {
      return "DeepSeek"
    }
    if (host === "www.doubao.com") {
      return "Doubao"
    }
    if (host === "chat.qwen.ai") {
      return "Qwen"
    }
    if (
      host === "www.kimi.com" ||
      host === "kimi.com" ||
      host === "kimi.moonshot.cn"
    ) {
      return "Kimi"
    }
    if (host === "yuanbao.tencent.com") {
      return "Yuanbao"
    }
  } catch {
    return undefined
  }

  return undefined
}

function isSupportedCaptureTabUrl(url?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return SUPPORTED_CAPTURE_HOSTS.has(host)
  } catch {
    return false
  }
}

function getModeFromSettings(mode: CaptureMode): CaptureMode {
  if (mode === "mirror" || mode === "smart" || mode === "manual") {
    return mode
  }
  return "mirror"
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null)
    })
  })
}

async function sendMessageToTab<T>(
  tabId: number,
  message: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const err = chrome.runtime.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve(response)
    })
  })
}

async function buildActiveCaptureStatus(
  mode: CaptureMode
): Promise<ActiveCaptureStatus> {
  const tab = await getActiveTab()
  if (!tab?.id || !isSupportedCaptureTabUrl(tab.url)) {
    return {
      mode,
      supported: false,
      available: false,
      reason: "unsupported_tab"
    }
  }

  const platform = tab.url ? resolvePlatformFromUrl(tab.url) : undefined

  if (mode === "mirror") {
    return {
      mode,
      supported: true,
      available: false,
      reason: "mode_mirror",
      platform
    }
  }

  try {
    const response = await sendMessageToTab<ContentTransientStatusResponse>(
      tab.id,
      {
        type: "GET_TRANSIENT_CAPTURE_STATUS"
      }
    )

    if (!response?.ok) {
      return {
        mode,
        supported: true,
        available: false,
        reason: "content_unreachable",
        platform
      }
    }

    return {
      mode,
      supported: true,
      available: response.status.available,
      reason: response.status.reason === "ok" ? "ok" : "no_transient",
      platform: response.status.platform ?? platform,
      sessionUUID: response.status.sessionUUID,
      transientKey: response.status.transientKey,
      messageCount: response.status.messageCount,
      turnCount: response.status.turnCount,
      lastDecision: response.status.lastDecision,
      firstObservedAt: response.status.firstObservedAt,
      updatedAt: response.status.updatedAt
    }
  } catch {
    return {
      mode,
      supported: true,
      available: false,
      reason: "content_unreachable",
      platform
    }
  }
}

async function handleBackgroundRequest(
  message: Extract<RequestMessage, { target?: "background" }>
): Promise<ResponseMessage> {
  const messageType = message.type

  try {
    switch (message.type) {
      case "GET_ACTIVE_CAPTURE_STATUS": {
        const settings = await getCaptureSettings()
        const mode = getModeFromSettings(settings.mode)
        const data = await buildActiveCaptureStatus(mode)
        return { ok: true, type: messageType, data }
      }
      case "FORCE_ARCHIVE_TRANSIENT": {
        const settings = await getCaptureSettings()
        const mode = getModeFromSettings(settings.mode)
        if (mode === "mirror") {
          throw new Error("ARCHIVE_MODE_DISABLED")
        }

        const tab = await getActiveTab()
        if (!tab?.id) {
          throw new Error("ACTIVE_TAB_UNAVAILABLE")
        }
        if (!isSupportedCaptureTabUrl(tab.url)) {
          throw new Error("ACTIVE_TAB_UNSUPPORTED")
        }

        let response: ContentForceArchiveResponse
        try {
          response = await sendMessageToTab<ContentForceArchiveResponse>(
            tab.id,
            {
              type: "FORCE_ARCHIVE_TRANSIENT"
            }
          )
        } catch (error) {
          throw new Error((error as Error).message || "FORCE_ARCHIVE_FAILED")
        }

        if (!response || response.ok === false) {
          const errorMessage =
            response && response.ok === false
              ? response.error
              : "FORCE_ARCHIVE_FAILED"
          throw new Error(errorMessage || "FORCE_ARCHIVE_FAILED")
        }

        const data: ForceArchiveTransientResult = {
          forced: true,
          saved: response.result.saved,
          newMessages: response.result.newMessages,
          conversationId: response.result.conversationId,
          decision: response.result.decision
        }

        return { ok: true, type: messageType, data }
      }
      case "RUN_VECTORIZATION": {
        void runVectorizationTask("message")
        return { ok: true, type: messageType, data: { queued: true } }
      }
      default:
        return {
          ok: false,
          type: messageType,
          error: `Unsupported message type: ${messageType}`
        }
    }
  } catch (error) {
    logger.error("background", "Background request failed", error as Error)
    return {
      ok: false,
      type: messageType,
      error: (error as Error).message || "Unknown error"
    }
  }
}

async function handleOffscreenRequest(
  message: RequestMessage
): Promise<ResponseMessage> {
  const messageType = message.type
  try {
    switch (message.type) {
      case "CAPTURE_CONVERSATION": {
        const result = await interceptAndPersistCapture(message.payload)
        return { ok: true, type: messageType, data: result }
      }
      case "GET_CONVERSATIONS": {
        const data = await listConversations(message.payload)
        return { ok: true, type: messageType, data }
      }
      case "GET_TOPICS": {
        const data = await getTopics()
        return { ok: true, type: messageType, data }
      }
      case "CREATE_TOPIC": {
        const topic = await createTopic(message.payload)
        return { ok: true, type: messageType, data: { topic } }
      }
      case "UPDATE_CONVERSATION_TOPIC": {
        const conversation = await updateConversationTopic(
          message.payload.id,
          message.payload.topic_id
        )
        return {
          ok: true,
          type: messageType,
          data: { updated: true, conversation }
        }
      }
      case "UPDATE_CONVERSATION": {
        const data = await updateConversation(
          message.payload.id,
          message.payload.changes
        )
        return { ok: true, type: messageType, data }
      }
      case "RUN_GARDENER": {
        const data = await runGardener(message.payload.conversationId)
        return { ok: true, type: messageType, data }
      }
      case "GET_RELATED_CONVERSATIONS": {
        const data = await findRelatedConversations(
          message.payload.conversationId,
          message.payload.limit
        )
        return { ok: true, type: messageType, data }
      }
      case "GET_ALL_EDGES": {
        const data = await findAllEdges(message.payload)
        return { ok: true, type: messageType, data }
      }
      case "RENAME_FOLDER_TAG": {
        const updated = await renameTagAcrossConversations(
          message.payload.from,
          message.payload.to
        )
        return { ok: true, type: messageType, data: { updated } }
      }
      case "MOVE_FOLDER_TAG": {
        const updated = await moveTagAcrossConversations(
          message.payload.from,
          message.payload.to
        )
        return { ok: true, type: messageType, data: { updated } }
      }
      case "REMOVE_FOLDER_TAG": {
        const updated = await removeTagFromConversations(message.payload.tag)
        return { ok: true, type: messageType, data: { updated } }
      }
      case "ASK_KNOWLEDGE_BASE": {
        const data = await askKnowledgeBase(
          message.payload.query,
          message.payload.sessionId,
          message.payload.limit,
          message.payload.mode,
          message.payload.options
        )
        return { ok: true, type: messageType, data }
      }
      case "GET_MESSAGES": {
        const data = await listMessages(message.payload.conversationId)
        return { ok: true, type: messageType, data }
      }
      case "GET_ANNOTATIONS_BY_CONVERSATION": {
        const data = await listAnnotations(message.payload.conversationId)
        return { ok: true, type: messageType, data }
      }
      case "SAVE_ANNOTATION": {
        const annotation = await saveAnnotation(message.payload)
        return { ok: true, type: messageType, data: { annotation } }
      }
      case "DELETE_ANNOTATION": {
        await deleteAnnotation(message.payload.annotationId)
        return { ok: true, type: messageType, data: { deleted: true } }
      }
      case "EXPORT_ANNOTATION_TO_NOTE": {
        const note = await exportAnnotationToMyNotes(
          message.payload.annotationId
        )
        return { ok: true, type: messageType, data: { note } }
      }
      case "EXPORT_ANNOTATION_TO_NOTION": {
        const data = await exportAnnotationToNotion(
          message.payload.annotationId
        )
        return { ok: true, type: messageType, data }
      }
      case "GET_NOTES": {
        const data = await listNotes()
        return { ok: true, type: messageType, data }
      }
      case "CREATE_NOTE": {
        const note = await createNote(message.payload)
        return { ok: true, type: messageType, data: { note } }
      }
      case "UPDATE_NOTE": {
        const note = await updateNote(
          message.payload.id,
          message.payload.changes
        )
        return { ok: true, type: messageType, data: { note } }
      }
      case "DELETE_NOTE": {
        await deleteNote(message.payload.id)
        return { ok: true, type: messageType, data: { deleted: true } }
      }
      case "IMPORT_OBSIDIAN_DIRECTORY": {
        const data = await importObsidianDirectory(
          message.payload.vaultName,
          message.payload.entries
        )
        return { ok: true, type: messageType, data }
      }
      case "IMPORT_OBSIDIAN_ZIP": {
        const data = await importObsidianZip(
          message.payload.fileName,
          message.payload.data
        )
        return { ok: true, type: messageType, data }
      }
      case "GET_NOTE_ASSET": {
        const data = await getNoteAsset(message.payload.assetId)
        return { ok: true, type: messageType, data }
      }
      case "SEARCH_CONVERSATION_IDS_BY_TEXT": {
        const data = await searchConversationIdsByText(message.payload.query)
        return { ok: true, type: messageType, data }
      }
      case "SEARCH_CONVERSATION_MATCHES_BY_TEXT": {
        const data = await searchConversationMatchesByText(message.payload)
        return { ok: true, type: messageType, data }
      }
      case "DELETE_CONVERSATION": {
        const deleted = await deleteConversation(message.payload.id)
        return { ok: true, type: messageType, data: { deleted } }
      }
      case "UPDATE_CONVERSATION_TITLE": {
        const conversation = await updateConversationTitle(
          message.payload.id,
          message.payload.title
        )
        return {
          ok: true,
          type: messageType,
          data: { updated: true, conversation }
        }
      }
      case "GET_DASHBOARD_STATS": {
        const data = await getDashboardStats()
        return { ok: true, type: messageType, data }
      }
      case "GET_STORAGE_USAGE": {
        const data = await getStorageUsage()
        return { ok: true, type: messageType, data }
      }
      case "GET_DATA_OVERVIEW": {
        const data = await getDataOverview()
        return { ok: true, type: messageType, data }
      }
      case "EXPORT_DATA": {
        const data = await exportAllData(message.payload.format)
        return { ok: true, type: messageType, data }
      }
      case "IMPORT_DATA": {
        const data = await importAllData(message.payload.content)
        void runVectorizationTask("import_data")
        return { ok: true, type: messageType, data }
      }
      case "CLEAR_ALL_DATA": {
        const cleared = await clearAllData()
        return { ok: true, type: messageType, data: { cleared } }
      }
      case "CLEAR_INSIGHTS_CACHE": {
        const cleared = await clearInsightsCache()
        return { ok: true, type: messageType, data: { cleared } }
      }
      case "GET_LLM_SETTINGS": {
        const settings = await getLlmSettings()
        return { ok: true, type: messageType, data: { settings } }
      }
      case "SET_LLM_SETTINGS": {
        await setLlmSettings(message.payload.settings)
        return { ok: true, type: messageType, data: { saved: true } }
      }
      case "TEST_LLM_CONNECTION": {
        const settings = requireSettings(await getLlmSettings())
        await callInference(settings, "Reply with OK only.", {
          systemPrompt: "You are a connectivity probe. Reply with OK only."
        })
        return {
          ok: true,
          type: messageType,
          data: { ok: true, message: "Connection verified." }
        }
      }
      case "GET_CONVERSATION_SUMMARY": {
        const data = await getSummary(message.payload.conversationId)
        return { ok: true, type: messageType, data }
      }
      case "GENERATE_CONVERSATION_SUMMARY": {
        const settings = requireSettings(await getLlmSettings())
        const record = await generateConversationSummary(
          settings,
          message.payload.conversationId
        )
        return { ok: true, type: messageType, data: record }
      }
      case "GET_WEEKLY_REPORT": {
        const data = await getWeeklyReport(
          message.payload.rangeStart,
          message.payload.rangeEnd
        )
        return { ok: true, type: messageType, data }
      }
      case "GENERATE_WEEKLY_REPORT": {
        const settings = requireSettings(await getLlmSettings())
        const record = await generateWeeklyReport(
          settings,
          message.payload.rangeStart,
          message.payload.rangeEnd
        )
        return { ok: true, type: messageType, data: record }
      }
      case "GENERATE_WEEKLY_RECAP": {
        const settings = requireSettings(await getLlmSettings())
        const record = await generateWeeklyRecap(
          settings,
          message.payload.rangeStart,
          message.payload.rangeEnd
        )
        return { ok: true, type: messageType, data: record }
      }
      case "CREATE_EXPLORE_SESSION": {
        const sessionId = await createExploreSession(message.payload.title)
        return { ok: true, type: messageType, data: { sessionId } }
      }
      case "LIST_EXPLORE_SESSIONS": {
        const sessions = await listExploreSessions(message.payload?.limit)
        return { ok: true, type: messageType, data: sessions }
      }
      case "GET_EXPLORE_SESSION": {
        const session = await getExploreSession(message.payload.sessionId)
        return { ok: true, type: messageType, data: session }
      }
      case "GET_EXPLORE_MESSAGES": {
        const msgs = await getExploreMessages(message.payload.sessionId)
        return { ok: true, type: messageType, data: msgs }
      }
      case "DELETE_EXPLORE_SESSION": {
        await deleteExploreSession(message.payload.sessionId)
        return { ok: true, type: messageType, data: { deleted: true } }
      }
      case "RENAME_EXPLORE_SESSION": {
        await updateExploreSession(message.payload.sessionId, {
          title: message.payload.title
        })
        return { ok: true, type: messageType, data: { updated: true } }
      }
      case "UPDATE_EXPLORE_MESSAGE_CONTEXT": {
        await updateExploreMessageContext(
          message.payload.messageId,
          message.payload.contextDraft,
          message.payload.selectedContextConversationIds
        )
        return { ok: true, type: messageType, data: { updated: true } }
      }
      default:
        return {
          ok: false,
          type: messageType,
          error: `Unsupported message type: ${messageType}`
        }
    }
  } catch (error) {
    logger.error("background", "Request failed", error as Error)
    return {
      ok: false,
      type: messageType,
      error: (error as Error).message || "Unknown error"
    }
  }
}

if (chrome?.alarms?.create) {
  chrome.alarms.create("vectorize-job", { periodInMinutes: 5 })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "vectorize-job") {
      void runVectorizationTask("alarm")
    }
  })
}

function openSidepanelForTab(tabId: number): void {
  if (!chrome?.sidePanel?.open) {
    logger.warn("background", "sidePanel API not available")
    return
  }
  chrome.sidePanel.setOptions(
    { tabId, path: "sidepanel.html", enabled: true },
    () => {
      chrome.sidePanel.open({ tabId }, () => {
        void chrome.runtime.lastError
      })
    }
  )
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (!message || typeof message !== "object") return
    const type = (message as { type?: string }).type
    if (type !== "OPEN_SIDEPANEL") return

    const tabId = sender.tab?.id
    if (typeof tabId === "number") {
      openSidepanelForTab(tabId)
      sendResponse?.({ ok: true })
      return
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeId = tabs[0]?.id
      if (typeof activeId === "number") {
        openSidepanelForTab(activeId)
      }
      sendResponse?.({ ok: true })
    })

    return true
  }
)
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (!isRequestMessage(message)) return
    if (message.target !== "offscreen") return

    void (async () => {
      const response = await handleOffscreenRequest(message)
      sendResponse(response)
    })()

    return true
  }
)

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (!isRequestMessage(message)) return
    if (message.target !== "background") return

    void (async () => {
      const response = await handleBackgroundRequest(
        message as Extract<RequestMessage, { target?: "background" }>
      )
      sendResponse(response)
    })()

    return true
  }
)
