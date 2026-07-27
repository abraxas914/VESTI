import { interceptAndPersistCapture } from "../lib/capture/storage-interceptor"
import {
  createPrompt,
  deletePrompt,
  extractPromptsFromLibrary,
  incrementPromptUsage,
  listPrompts,
  searchPrompts,
  togglePromptFavorite,
  updatePrompt
} from "../lib/db/promptRepository"
import {
  bulkAddTagToConversations,
  bulkSetConversationFlags,
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
  getAllSummaries,
  getDashboardStats,
  getDataOverview,
  getExploreMessages,
  getExploreSession,
  getNoteAsset,
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
  updateConversation,
  updateConversationTitle,
  updateConversationTopic,
  updateExploreMessageContext,
  updateExploreSession,
  updateNote
} from "../lib/db/repository"
import { optimizeDeepSeekPromptInBackground } from "../lib/features/deepseekPromptBackgroundService"
import { runCoreRoundTableService } from "../lib/features/roundTableBackgroundService"
import { resolveLocale } from "../lib/i18n/locales"
import { isRequestMessage } from "../lib/messaging/protocol"
import type { RequestMessage, ResponseMessage } from "../lib/messaging/protocol"
import {
  beginOnboardingTour,
  finishOnboarding,
  handleOnboardingActionClick,
  handleOnboardingInstalled,
  recordOnboardingGuideProgress,
  syncOnboardingPanelBehavior
} from "../lib/onboarding/background"
import {
  isSupportedCaptureTabUrl,
  rankSupportedCaptureTabs,
  resolvePlatformFromUrl
} from "../lib/onboarding/targeting"
import {
  exportAnnotationToMyNotes,
  exportAnnotationToNotion
} from "../lib/services/annotationExportService"
import { getCaptureSettings } from "../lib/services/captureSettingsService"
import { exportConversationToNotion } from "../lib/services/conversationExportService"
import {
  autoConnectDesktop,
  clearStaleDesktopSyncFlag,
  DESKTOP_DISCOVER_ALARM,
  DESKTOP_DISCOVER_PERIOD_MINUTES,
  DESKTOP_SYNC_ALARM,
  DESKTOP_SYNC_PERIOD_MINUTES,
  disconnectDesktop,
  getDesktopBridgeStatus,
  pairWithDesktop,
  resumeDesktopAutoConnect,
  syncWithDesktop
} from "../lib/services/desktopBridgeService"
import { runGardener } from "../lib/services/gardenerService"
import {
  generateConversationSummary,
  generateWeeklyRecap,
  generateWeeklyReport
} from "../lib/services/insightGenerationService"
import { getLanguageSettings } from "../lib/services/languageSettingsService"
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
  completePromptDraft,
  distillFragments,
  resolveUsableLlmConfig
} from "../lib/services/promptLlmService"
import {
  clearRelayQueue,
  completeRelayInjection,
  dismissRelayItem,
  getRelayItem,
  listPendingRelayItems,
  markRelayItemFailed,
  pollRelayOutbox,
  refreshRelayBadge,
  RELAY_POLL_ALARM,
  RELAY_POLL_PERIOD_MINUTES
} from "../lib/services/relayService"
import { runRoundtablePanel } from "../lib/services/roundtableService"
import {
  askKnowledgeBase,
  findAllEdges,
  findRelatedConversations,
  vectorizeAllConversations
} from "../lib/services/searchService"
import { getWeeklyGrowthTimeMachine } from "../lib/services/weeklyGrowthTimeMachineService"
import {
  getWeeklyKnowledgeNoteStatus,
  saveWeeklyKnowledgeNote
} from "../lib/services/weeklyKnowledgeNoteService"
import {
  computeNextWeeklyReminderAt,
  getWeeklyPushSettings,
  setWeeklyPushSettings
} from "../lib/services/weeklyPushSettingsService"
import type {
  ActiveCaptureStatus,
  CaptureMode,
  ForceArchiveTransientResult,
  LlmConfig,
  Platform,
  WeeklyGrowthReportV2,
  WeeklyPushSettings
} from "../lib/types"
import { logger } from "../lib/utils/logger"

let isVectorizing = false
let rerunVectorizationRequested = false
const WEEKLY_RECAP_TIMEOUT_MS = 120000
const weeklyRecapControllers = new Map<string, AbortController>()
const WEEKLY_PUSH_ALARM = "weekly-growth-reminder"
const WEEKLY_NOTIFICATION_PREFIX = "weekly-growth:"

function getPreviousFullWeekRange(referenceDate = new Date()): {
  rangeStart: number
  rangeEnd: number
} {
  const currentWeekMonday = new Date(referenceDate)
  const daysSinceMonday = (currentWeekMonday.getDay() + 6) % 7
  currentWeekMonday.setHours(0, 0, 0, 0)
  currentWeekMonday.setDate(currentWeekMonday.getDate() - daysSinceMonday)

  const previousWeekMonday = new Date(currentWeekMonday)
  previousWeekMonday.setDate(previousWeekMonday.getDate() - 7)

  const previousWeekSunday = new Date(previousWeekMonday)
  previousWeekSunday.setDate(previousWeekSunday.getDate() + 6)
  previousWeekSunday.setHours(23, 59, 59, 999)

  return {
    rangeStart: previousWeekMonday.getTime(),
    rangeEnd: previousWeekSunday.getTime()
  }
}

function isWeeklyGrowthReport(value: unknown): value is WeeklyGrowthReportV2 {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as WeeklyGrowthReportV2).schema === "weekly_growth_report.v2"
  )
}

function clearWeeklyPushAlarm(): Promise<void> {
  return new Promise((resolve) => {
    chrome.alarms.clear(WEEKLY_PUSH_ALARM, () => {
      void chrome.runtime.lastError
      resolve()
    })
  })
}

async function syncWeeklyPushAlarm(
  suppliedSettings?: WeeklyPushSettings
): Promise<number | null> {
  if (!chrome?.alarms?.create) return null
  const settings = suppliedSettings ?? (await getWeeklyPushSettings())
  await clearWeeklyPushAlarm()
  if (!settings.enabled) return null
  const nextAt = computeNextWeeklyReminderAt(settings)
  chrome.alarms.create(WEEKLY_PUSH_ALARM, { when: nextAt })
  return nextAt
}

function createWeeklyNotification(
  title: string,
  message: string
): Promise<string> {
  const notificationId = `${WEEKLY_NOTIFICATION_PREFIX}${Date.now()}`
  const manifest = chrome.runtime.getManifest()
  const iconPath =
    manifest.icons?.["128"] ??
    manifest.icons?.["64"] ??
    manifest.icons?.["48"] ??
    ""

  return new Promise((resolve, reject) => {
    chrome.notifications.create(
      notificationId,
      {
        type: "basic",
        iconUrl: iconPath ? chrome.runtime.getURL(iconPath) : "",
        title,
        message
      },
      (createdId) => {
        const error = chrome.runtime.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        resolve(createdId)
      }
    )
  })
}

async function showWeeklyPushNotification(): Promise<string> {
  const [{ locale }, range] = await Promise.all([
    getLanguageSettings(),
    Promise.resolve(getPreviousFullWeekRange())
  ])
  const report = await getWeeklyReport(range.rangeStart, range.rangeEnd)
  const growth = isWeeklyGrowthReport(report?.structured)
    ? report.structured
    : null
  const identity = growth?.identity?.label?.trim()
  const greeting = growth?.greeting?.trim()
  const copy = {
    en: {
      title: identity
        ? `Your weekly identity: ${identity}`
        : "Your weekly reflection is ready",
      message:
        greeting ||
        "Last week is complete. Open Vesti to revisit what moved your thinking forward."
    },
    zh: {
      title: identity ? `你的本周身份：${identity}` : "你的个人成长周报待回顾",
      message: greeting || "上周已经收尾，打开 Vesti 回顾推动你思考前进的时刻。"
    },
    ja: {
      title: identity
        ? `今週のあなた：${identity}`
        : "週間レポートを振り返りましょう",
      message:
        greeting || "先週を振り返り、思考が前進した瞬間を見つけましょう。"
    },
    ko: {
      title: identity
        ? `이번 주의 나: ${identity}`
        : "주간 성장 리포트를 돌아보세요",
      message:
        greeting || "지난주를 돌아보고 생각이 성장한 순간을 확인해 보세요."
    }
  }[locale]

  return createWeeklyNotification(copy.title, copy.message)
}

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

function getModeFromSettings(mode: CaptureMode): CaptureMode {
  if (mode === "mirror" || mode === "smart" || mode === "manual") {
    return mode
  }
  return "mirror"
}

// Desktop bridge sync entry point (pair / alarm / startup / manual). Every
// failure is swallowed into the bridge state — an offline desktop must never
// surface as background noise for the user.
async function runDesktopSync(reason: string, full = false): Promise<void> {
  try {
    await syncWithDesktop({ reason, full })
  } catch (error) {
    logger.warn("background", "Desktop sync failed", {
      reason,
      error: (error as Error)?.message ?? String(error)
    })
  }
}

// TOFU auto-connect entry point (discover alarm / startup / install / UI
// poll). Probes the desktop, and when unpaired with an open pairing window,
// runs the one-tap association; a fresh token triggers the initial full sync
// and drains whatever the outbox queued while unpaired.
async function runDesktopAutoConnect(reason: string): Promise<void> {
  try {
    const result = await autoConnectDesktop(reason)
    if (result.associated) {
      void runDesktopSync("associate", true)
      void pollRelayOutbox("associate")
    }
  } catch (error) {
    logger.warn("background", "Desktop auto-connect failed", {
      reason,
      error: (error as Error)?.message ?? String(error)
    })
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null)
    })
  })
}

async function getSupportedCaptureTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({}, (result) => resolve(result))
  })
  return rankSupportedCaptureTabs(tabs)
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
      case "GET_WEEKLY_PUSH_SETTINGS": {
        const settings = await getWeeklyPushSettings()
        const nextAt = settings.enabled
          ? computeNextWeeklyReminderAt(settings)
          : null
        return {
          ok: true,
          type: messageType,
          data: { settings, nextAt }
        }
      }
      case "SET_WEEKLY_PUSH_SETTINGS": {
        const settings = await setWeeklyPushSettings(message.payload.changes)
        const nextAt = await syncWeeklyPushAlarm(settings)
        return {
          ok: true,
          type: messageType,
          data: { settings, nextAt }
        }
      }
      case "TEST_WEEKLY_PUSH_NOTIFICATION": {
        const notificationId = await showWeeklyPushNotification()
        return {
          ok: true,
          type: messageType,
          data: { notificationId }
        }
      }
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
      case "ONBOARDING_TOUR_START": {
        const data = await beginOnboardingTour()
        return { ok: true, type: messageType, data }
      }
      case "ONBOARDING_GUIDE_PROGRESS": {
        const data = await recordOnboardingGuideProgress(
          message.payload.feature,
          message.payload
        )
        return { ok: true, type: messageType, data }
      }
      case "ONBOARDING_COMPLETE": {
        const data = await finishOnboarding(
          message.payload.via,
          message.payload.hasCleanedMockData
        )
        return { ok: true, type: messageType, data }
      }
      case "RUN_CORE_ROUNDTABLE": {
        const data = await runCoreRoundTableService(message.payload.topic)
        return { ok: true, type: messageType, data }
      }
      case "OPTIMIZE_DEEPSEEK_PROMPT": {
        const data = await optimizeDeepSeekPromptInBackground(
          message.payload.originalText,
          message.payload.mode
        )
        return { ok: true, type: messageType, data }
      }
      case "RUN_VECTORIZATION": {
        void runVectorizationTask("message")
        return { ok: true, type: messageType, data: { queued: true } }
      }
      case "IMPORT_HISTORY_PROBE": {
        // Forward to the active platform tab; the content script knows whether
        // a history provider exists for its host and whether it's logged in.
        const tab = await getActiveTab()
        if (!tab?.id || !isSupportedCaptureTabUrl(tab.url)) {
          return { ok: true, type: messageType, data: { supported: false } }
        }
        try {
          const resp = await sendMessageToTab<{
            supported?: boolean
            platform?: Platform
            available?: boolean
          }>(tab.id, { type: "IMPORT_HISTORY_PROBE" })
          return {
            ok: true,
            type: messageType,
            data: {
              supported: !!resp?.supported,
              platform: resp?.platform,
              available: !!resp?.available
            }
          }
        } catch {
          return { ok: true, type: messageType, data: { supported: false } }
        }
      }
      case "IMPORT_HISTORY_START": {
        const tab = await getActiveTab()
        if (!tab?.id) {
          return {
            ok: true,
            type: messageType,
            data: { started: false, reason: "no_active_tab" }
          }
        }
        if (!isSupportedCaptureTabUrl(tab.url)) {
          return {
            ok: true,
            type: messageType,
            data: { started: false, reason: "unsupported_tab" }
          }
        }
        try {
          const resp = await sendMessageToTab<{
            started?: boolean
            platform?: Platform
            reason?: string
          }>(tab.id, { type: "IMPORT_HISTORY_RUN" })
          return {
            ok: true,
            type: messageType,
            data: {
              started: !!resp?.started,
              platform: resp?.platform,
              reason: resp?.reason
            }
          }
        } catch (error) {
          return {
            ok: true,
            type: messageType,
            data: {
              started: false,
              reason: (error as Error).message || "tab_unreachable"
            }
          }
        }
      }
      case "ONBOARDING_IMPORT_RECENT_WEEK": {
        const tabs = await getSupportedCaptureTabs()
        const selected = new Map<Platform, chrome.tabs.Tab>()
        for (const tab of tabs) {
          const platform = tab.url ? resolvePlatformFromUrl(tab.url) : undefined
          if (platform && !selected.has(platform)) selected.set(platform, tab)
        }

        const availablePlatforms: Platform[] = []
        const completedPlatforms: Platform[] = []
        let saved = 0
        let failed = 0

        await Promise.all(
          Array.from(selected.entries()).map(async ([platform, tab]) => {
            if (typeof tab.id !== "number") return
            try {
              const probe = await sendMessageToTab<{
                supported?: boolean
                available?: boolean
              }>(tab.id, { type: "IMPORT_HISTORY_PROBE" })
              if (!probe?.supported || !probe.available) return
              availablePlatforms.push(platform)
              const response = await sendMessageToTab<{
                started?: boolean
                progress?: { saved?: number; failed?: number }
              }>(tab.id, {
                type: "IMPORT_HISTORY_RUN",
                since: message.payload.since,
                until: message.payload.until,
                waitForCompletion: true
              })
              if (!response?.started) return
              completedPlatforms.push(platform)
              saved += response.progress?.saved ?? 0
              failed += response.progress?.failed ?? 0
            } catch {
              failed += 1
            }
          })
        )

        return {
          ok: true,
          type: messageType,
          data: {
            attemptedTabs: selected.size,
            availablePlatforms,
            completedPlatforms,
            saved,
            failed
          }
        }
      }
      case "IMPORT_HISTORY_CANCEL": {
        const tab = await getActiveTab()
        if (tab?.id) {
          try {
            await sendMessageToTab(tab.id, { type: "IMPORT_HISTORY_CANCEL" })
          } catch {
            // tab may have navigated away; cancel is best-effort
          }
        }
        return { ok: true, type: messageType, data: { ok: true } }
      }
      case "DESKTOP_BRIDGE_GET_STATE": {
        // The auto-connect tick probes the desktop live and records
        // reachability / capabilities / pairing window; fire-and-forget so a
        // pending association (up to ~70s) never blocks the panel's polling.
        // The next poll picks up whatever changed.
        void runDesktopAutoConnect("ui_poll")
        const state = await getDesktopBridgeStatus()
        return { ok: true, type: messageType, data: { state } }
      }
      case "DESKTOP_BRIDGE_PAIR": {
        const state = await pairWithDesktop(message.payload.code)
        // Pairing succeeded → kick off the initial full sync right away, in
        // the background; the panel picks up progress by polling GET_STATE.
        void runDesktopSync("pair", true)
        // Same for handoff packets: pull whatever the desktop queued while
        // the extension was unpaired.
        void pollRelayOutbox("pair")
        return { ok: true, type: messageType, data: { state } }
      }
      case "DESKTOP_BRIDGE_AUTO_CONNECT": {
        // Manual retry from the settings card: clear the local cooldown /
        // disconnect suppression, then start a tick in the background — an
        // associate can hang ~70s awaiting the in-app confirm, far past the
        // panel's message timeout, so progress arrives via state polling.
        void resumeDesktopAutoConnect("manual_retry").then((result) => {
          if (result.associated) {
            void runDesktopSync("associate", true)
            void pollRelayOutbox("associate")
          }
        })
        const state = await getDesktopBridgeStatus()
        return { ok: true, type: messageType, data: { state } }
      }
      case "DESKTOP_BRIDGE_DISCONNECT": {
        const state = await disconnectDesktop()
        // The outbox belongs to the bridge session — drop the local queue so
        // a stale badge never outlives the pairing.
        await clearRelayQueue()
        return { ok: true, type: messageType, data: { state } }
      }
      case "DESKTOP_BRIDGE_SYNC_NOW": {
        const result = await syncWithDesktop({
          reason: "manual",
          full: message.payload?.full === true
        })
        const state = await getDesktopBridgeStatus()
        return {
          ok: true,
          type: messageType,
          data: {
            state,
            synced: result.synced,
            skipped: result.skipped,
            conversations: result.conversations,
            messages: result.messages
          }
        }
      }
      case "RELAY_LIST": {
        const [items, bridge] = await Promise.all([
          listPendingRelayItems(),
          getDesktopBridgeStatus()
        ])
        return {
          ok: true,
          type: messageType,
          data: {
            items,
            outboxSupported: bridge.capabilities.includes("outbox"),
            needsRepair: bridge.needsRepair
          }
        }
      }
      case "RELAY_DISMISS": {
        await dismissRelayItem(message.payload.id)
        return { ok: true, type: messageType, data: { dismissed: true } }
      }
      case "RELAY_INJECT": {
        const itemId = message.payload.id
        const item = await getRelayItem(itemId)
        if (!item || item.status !== "pending") {
          throw new Error("RELAY_ITEM_NOT_FOUND")
        }

        // Route by the active tab's URL: each platform's own content script
        // carries the composer injector registered for its host.
        const tab = await getActiveTab()
        const platform = tab?.url ? resolvePlatformFromUrl(tab.url) : undefined
        if (!tab?.id || !platform) {
          throw new Error("RELAY_TAB_UNSUPPORTED")
        }

        let fillResponse: { ok?: boolean; error?: string } | undefined
        try {
          fillResponse = await sendMessageToTab<{
            ok?: boolean
            error?: string
          }>(tab.id, {
            type: "RELAY_INJECT",
            payload: { prompt: item.prompt }
          })
        } catch {
          // Content script missing (page predates the extension install or is
          // mid-navigation) — the item stays pending for a retry.
          await markRelayItemFailed(itemId, "content_unreachable")
          throw new Error("RELAY_CONTENT_UNREACHABLE")
        }

        if (!fillResponse?.ok) {
          // Selector-level failure (composer not found / fill rejected): do
          // NOT ack — record the reason and keep the item pending.
          await markRelayItemFailed(
            itemId,
            fillResponse?.error || "fill_failed"
          )
          throw new Error("RELAY_FILL_FAILED")
        }

        // Fill confirmed by the content script → ack on the desktop and mark
        // injected (ack failure is retried on the next poll).
        const updated = await completeRelayInjection(itemId)
        logger.info("background", "Relay handoff packet injected", {
          id: itemId,
          platform
        })
        return { ok: true, type: messageType, data: { item: updated } }
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
      case "BULK_SET_CONVERSATION_FLAGS": {
        const updated = await bulkSetConversationFlags(
          message.payload.ids,
          message.payload.patch
        )
        return { ok: true, type: messageType, data: { updated } }
      }
      case "BULK_ADD_TAG_TO_CONVERSATIONS": {
        const updated = await bulkAddTagToConversations(
          message.payload.ids,
          message.payload.tag
        )
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
      case "RUN_ROUNDTABLE": {
        const data = await runRoundtablePanel(
          message.payload.question,
          message.payload.personaIds,
          { lang: message.payload.lang }
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
      case "EXPORT_CONVERSATION_TO_NOTION": {
        const data = await exportConversationToNotion({
          title: message.payload.title,
          markdown: message.payload.markdown
        })
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
      case "GET_WEEKLY_KNOWLEDGE_NOTE": {
        const data = await getWeeklyKnowledgeNoteStatus(
          message.payload.reportId
        )
        return { ok: true, type: messageType, data }
      }
      case "SAVE_WEEKLY_KNOWLEDGE_NOTE": {
        const data = await saveWeeklyKnowledgeNote(
          message.payload.reportId,
          resolveLocale(message.payload.locale)
        )
        return { ok: true, type: messageType, data }
      }
      case "GET_WEEKLY_GROWTH_TIME_MACHINE": {
        const data = await getWeeklyGrowthTimeMachine(message.payload.reportId)
        return { ok: true, type: messageType, data }
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
      case "GET_ALL_SUMMARIES": {
        const data = await getAllSummaries()
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
        const generationRequestId = message.requestId ?? crypto.randomUUID()
        const controller = new AbortController()
        weeklyRecapControllers.set(generationRequestId, controller)

        // Independent watchdog: abort even if the sidepanel closes before it
        // can send CANCEL_WEEKLY_RECAP.
        const watchdog = setTimeout(() => {
          controller.abort()
        }, WEEKLY_RECAP_TIMEOUT_MS)

        try {
          const settings = requireSettings(await getLlmSettings())
          const record = await generateWeeklyRecap(
            settings,
            message.payload.rangeStart,
            message.payload.rangeEnd,
            { signal: controller.signal }
          )
          return { ok: true, type: messageType, data: record }
        } finally {
          clearTimeout(watchdog)
          weeklyRecapControllers.delete(generationRequestId)
        }
      }
      case "CANCEL_WEEKLY_RECAP": {
        const controller = weeklyRecapControllers.get(
          message.payload.generationRequestId
        )
        if (!controller) {
          return {
            ok: true,
            type: messageType,
            data: { aborted: false }
          }
        }

        controller.abort()
        return {
          ok: true,
          type: messageType,
          data: { aborted: true }
        }
      }
      case "CREATE_EXPLORE_SESSION": {
        const sessionId = await createExploreSession(
          message.payload.title,
          message.payload.systemPrompt
        )
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
      case "LIST_PROMPTS": {
        const data = await listPrompts(message.payload?.filter)
        return { ok: true, type: messageType, data }
      }
      case "SEARCH_PROMPTS": {
        const data = await searchPrompts(
          message.payload.query,
          message.payload.limit
        )
        return { ok: true, type: messageType, data }
      }
      case "CREATE_PROMPT": {
        const data = await createPrompt(message.payload.input)
        return { ok: true, type: messageType, data }
      }
      case "UPDATE_PROMPT": {
        const prompt = await updatePrompt(
          message.payload.id,
          message.payload.changes
        )
        return { ok: true, type: messageType, data: { prompt } }
      }
      case "DELETE_PROMPT": {
        const deleted = await deletePrompt(message.payload.id)
        return { ok: true, type: messageType, data: { deleted } }
      }
      case "TOGGLE_PROMPT_FAVORITE": {
        const prompt = await togglePromptFavorite(
          message.payload.id,
          message.payload.isFavorite
        )
        return { ok: true, type: messageType, data: { prompt } }
      }
      case "INCREMENT_PROMPT_USAGE": {
        const prompt = await incrementPromptUsage(message.payload.id)
        return { ok: true, type: messageType, data: { prompt } }
      }
      case "EXTRACT_PROMPTS_FROM_LIBRARY": {
        // Prefer LLM-distilled reusable FRAGMENTS when a model is configured;
        // otherwise fall back to offline high-frequency extraction.
        const config = await resolveUsableLlmConfig()
        const data = await extractPromptsFromLibrary({
          scope: message.payload?.scope,
          limit: message.payload?.limit,
          distill: config
            ? (turns) => distillFragments(config, turns)
            : undefined
        })
        return { ok: true, type: messageType, data }
      }
      case "COMPLETE_PROMPT": {
        const config = await resolveUsableLlmConfig()
        const relatedPrompts =
          config && message.payload.useLibrary !== false
            ? await searchPrompts(message.payload.draft, 3)
            : []
        const data = await completePromptDraft(config, {
          draft: message.payload.draft,
          platform: message.payload.platform,
          mode: message.payload.mode,
          relatedPrompts
        })
        return { ok: true, type: messageType, data }
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

// The worker may have been killed mid desktop-sync (or mid-associate); drop
// the stale flags so the UI never shows a phantom "syncing"/"waiting" state.
void clearStaleDesktopSyncFlag()

// Badge text does not survive a browser restart; rebuild it from the queue.
void refreshRelayBadge()

if (chrome?.alarms?.create) {
  chrome.alarms.create("vectorize-job", { periodInMinutes: 5 })
  chrome.alarms.create(DESKTOP_SYNC_ALARM, {
    periodInMinutes: DESKTOP_SYNC_PERIOD_MINUTES
  })
  chrome.alarms.create(DESKTOP_DISCOVER_ALARM, {
    periodInMinutes: DESKTOP_DISCOVER_PERIOD_MINUTES
  })
  chrome.alarms.create(RELAY_POLL_ALARM, {
    periodInMinutes: RELAY_POLL_PERIOD_MINUTES
  })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "vectorize-job") {
      void runVectorizationTask("alarm")
      return
    }
    if (alarm.name === WEEKLY_PUSH_ALARM) {
      void showWeeklyPushNotification()
        .catch((error) => {
          logger.warn("weekly-push", "Weekly notification failed", {
            error: (error as Error)?.message ?? String(error)
          })
        })
        .finally(() => {
          void syncWeeklyPushAlarm()
        })
      return
    }
    if (alarm.name === DESKTOP_SYNC_ALARM) {
      void runDesktopSync("alarm")
    }
    if (alarm.name === DESKTOP_DISCOVER_ALARM) {
      void runDesktopAutoConnect("alarm")
    }
    if (alarm.name === RELAY_POLL_ALARM) {
      void pollRelayOutbox("alarm")
    }
  })
  void syncWeeklyPushAlarm()
  chrome.runtime.onInstalled.addListener(() => {
    void syncWeeklyPushAlarm()
  })
  chrome.runtime.onStartup.addListener(() => {
    void syncWeeklyPushAlarm()
  })
}

// Once per browser launch, retry whatever the last scheduled sync missed.
if (chrome?.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    void runDesktopAutoConnect("startup")
    void runDesktopSync("startup")
    void pollRelayOutbox("startup")
  })
}

// Install/update: the app may already be running with an open pairing
// window (it opens for 10 minutes at app start) — associate right away.
if (chrome?.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    void runDesktopAutoConnect("installed")
    void handleOnboardingInstalled(details).catch((error) => {
      logger.error(
        "background",
        "Onboarding install routing failed",
        error as Error
      )
    })
  })
}

void syncOnboardingPanelBehavior()

// Weekly notification click → open sidepanel with weekly tab.
if (chrome?.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(WEEKLY_NOTIFICATION_PREFIX)) return
    chrome.notifications.clear(notificationId, () => {
      void chrome.runtime.lastError
    })
    chrome.tabs.create({
      url: chrome.runtime.getURL("sidepanel.html#weekly")
    })
  })
}

function openSidepanelForTab(
  tabId: number,
  done?: (ok: boolean) => void
): void {
  if (!chrome?.sidePanel?.open) {
    logger.warn("background", "sidePanel API not available")
    done?.(false)
    return
  }
  // Configure the panel (async completion is fine), then open it SYNCHRONOUSLY
  // in the same tick: open() consumes the user gesture, and nesting it inside
  // setOptions' callback drops the gesture so the panel never appears.
  chrome.sidePanel.setOptions(
    { tabId, path: "sidepanel.html", enabled: true },
    () => {
      void chrome.runtime.lastError
    }
  )
  chrome.sidePanel.open({ tabId }, () => {
    const lastError = chrome.runtime.lastError
    if (lastError) {
      logger.warn("background", "sidePanel.open failed", {
        error: lastError.message
      })
    }
    done?.(!lastError)
  })
}

// Before onboarding completes, the action resumes setup or focuses the welcome
// page. Afterwards Chrome's native openPanelOnActionClick behavior owns the click.
if (chrome?.action?.onClicked) {
  chrome.action.onClicked.addListener(() => {
    void handleOnboardingActionClick()
  })
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
      openSidepanelForTab(tabId, (ok) => sendResponse?.({ ok }))
      return true
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeId = tabs[0]?.id
      if (typeof activeId === "number") {
        openSidepanelForTab(activeId, (ok) => sendResponse?.({ ok }))
      } else {
        sendResponse?.({ ok: false })
      }
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
