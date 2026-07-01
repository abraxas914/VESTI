import {
  Archive,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  FolderGit2,
  Github,
  Languages,
  Loader2,
  Mail,
  Megaphone,
  Moon,
  ShieldCheck,
  Sun
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import {
  DEFAULT_CAPTURE_SETTINGS,
  getCaptureSettings,
  setCaptureSettings
} from "~lib/services/captureSettingsService"
import {
  buildDefaultLlmSettings,
  BYOK_MODEL_WHITELIST,
  DEFAULT_BACKUP_MODEL,
  DEFAULT_PROXY_BASE_URL,
  DEFAULT_PROXY_URL,
  DEFAULT_STABLE_MODEL,
  getLlmAccessMode,
  getProxyBaseUrl,
  MODELSCOPE_BASE_URL,
  normalizeLlmSettings,
  sanitizeByokModelId
} from "~lib/services/llmConfig"
import type { LlmDiagnostic } from "~lib/services/llmService"
import { getLlmDiagnostic } from "~lib/services/llmService"
import {
  connectToNotion,
  disconnectNotion,
  formatNotionErrorMessage,
  getNotionSettings,
  isNotionConnected,
  isNotionExportConfigured,
  listNotionDatabases,
  selectNotionDatabase
} from "~lib/services/notionSettingsService"
import {
  forceArchiveTransient,
  getActiveCaptureStatus,
  getLlmSettings,
  setLlmSettings,
  testLlmConnection
} from "~lib/services/storageService"
import {
  applyUiTheme,
  getUiSettings,
  setUiThemeMode,
  subscribeUiSettings
} from "~lib/services/uiSettingsService"
import type {
  ActiveCaptureStatus,
  AsyncStatus,
  CaptureMode,
  CaptureSettings,
  LlmConfig,
  NotionDatabaseOption,
  NotionSettings,
  UiThemeMode
} from "~lib/types"

import { useI18n } from "~lib/i18n"
import type { SupportedLocale } from "~lib/types"
import { SUPPORTED_LOCALES, getLocaleNativeName } from "~lib/i18n/locales"
import { DisclosureSection } from "../components/DisclosureSection"

const MIN_TURNS_DEFAULT = DEFAULT_CAPTURE_SETTINGS.smartConfig.minTurns

function getCaptureModeOptions(t: {
  settings: {
    captureEngine: {
      fullMirror: { label: string; desc: string }
      smartDenoising: { label: string; desc: string }
      manualArchive: { label: string; desc: string }
    }
  }
}): Array<{
  value: CaptureMode
  label: string
  description: string
}> {
  return [
    {
      value: "mirror",
      label: t.settings.captureEngine.fullMirror.label,
      description: t.settings.captureEngine.fullMirror.desc
    },
    {
      value: "smart",
      label: t.settings.captureEngine.smartDenoising.label,
      description: t.settings.captureEngine.smartDenoising.desc
    },
    {
      value: "manual",
      label: t.settings.captureEngine.manualArchive.label,
      description: t.settings.captureEngine.manualArchive.desc
    }
  ]
}

const DOCS_HELP_URL = "https://github.com/abraxas914/VESTI#readme"
const FEEDBACK_ISSUE_URL =
  "https://github.com/abraxas914/VESTI/issues/new/choose"
const WHATS_NEW_URL = "https://github.com/abraxas914/VESTI/releases"
const FEEDBACK_EMAIL = "suyc23@gmail.com"
const FEEDBACK_COPY_RESET_MS = 1600

function openExternalUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer")
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "absolute"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textarea)
  if (!copied) {
    throw new Error("COPY_FAILED")
  }
}

function SettingsGroupLabel({ label }: { label: string }) {
  return (
    <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
      {label}
    </p>
  )
}

function SettingsIconTile({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary transition-colors duration-150 group-open:text-text-primary">
      {children}
    </span>
  )
}

function LanguageSelector({
  locale,
  onChange
}: {
  locale: SupportedLocale
  onChange: (locale: SupportedLocale) => void
}) {
  const { t } = useI18n()
  return (
    <div className="card-shadow-warm flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary">
        <Languages className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text-primary">{t.settings.language.title}</p>
        <p className="mt-0.5 text-[11px] text-text-tertiary">
          {t.settings.language.description}
        </p>
      </div>
      <select
        value={locale}
        onChange={(e) => onChange(e.target.value as SupportedLocale)}
        className="rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[12px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code}>
            {getLocaleNativeName(code)}
          </option>
        ))}
      </select>
    </div>
  )
}

interface SupportRowProps {
  label: string
  icon: ReactNode
  onClick: () => void
  expanded?: boolean
}

function SupportRow({
  label,
  icon,
  onClick,
  expanded = false
}: SupportRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="settings-support-row flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary">
          {icon}
        </span>
        <span className="text-[13px] font-medium text-text-primary">
          {label}
        </span>
      </span>
      <ArrowRight
        className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-150 ${
          expanded ? "rotate-90" : ""
        }`}
        strokeWidth={1.5}
      />
    </button>
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const MODEL_ACCESS_FEEDBACK_MAX_CHARS = 180

interface ModelAccessFeedback {
  summary: string
  detail?: string
  hint?: string
}

function normalizeModelAccessFeedback(
  message: string | null | undefined,
  fallback: string
): string {
  const collapsed = (message || "").replace(/\s+/g, " ").trim()
  if (!collapsed) return fallback
  if (collapsed.length <= MODEL_ACCESS_FEEDBACK_MAX_CHARS) return collapsed
  return `${collapsed.slice(0, MODEL_ACCESS_FEEDBACK_MAX_CHARS - 3)}...`
}

function toModelAccessFeedback(
  summary: string | null | undefined,
  fallback: string,
  options: Partial<Omit<ModelAccessFeedback, "summary">> = {}
): ModelAccessFeedback {
  return {
    summary: normalizeModelAccessFeedback(summary, fallback),
    detail: options.detail
      ? normalizeModelAccessFeedback(options.detail, options.detail)
      : undefined,
    hint: options.hint
      ? normalizeModelAccessFeedback(options.hint, options.hint)
      : undefined
  }
}

function feedbackFromDiagnostic(
  diagnostic: LlmDiagnostic
): ModelAccessFeedback {
  return {
    summary: diagnostic.userMessage,
    detail: diagnostic.technicalSummary
  }
}

function formatModelTestResultMessage(
  result: {
    ok: boolean
    message?: string
    diagnostic?: LlmDiagnostic | null
  },
  t: { settings: { modelAccess: { connectionVerified: string; testFailed: string } } }
): ModelAccessFeedback {
  if (result.ok) {
    return { summary: t.settings.modelAccess.connectionVerified }
  }
  if (result.diagnostic) {
    return feedbackFromDiagnostic(result.diagnostic)
  }
  return toModelAccessFeedback(result.message, t.settings.modelAccess.testFailed)
}

function parseKeywordsInput(value: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const segment of value.split(",")) {
    const keyword = segment.trim()
    if (!keyword || seen.has(keyword)) continue
    seen.add(keyword)
    result.push(keyword)
  }

  return result
}

function formatCaptureStatusReason(
  reason?: ActiveCaptureStatus["reason"],
  t?: { capture: { status: Record<string, string> } }
): string {
  if (!t) {
    switch (reason) {
      case "ok":
        return t?.capture.status.ready ?? "Ready"
      case "mode_mirror":
        return "Mirror mode does not need manual archive."
      case "unsupported_tab":
        return "Open a ChatGPT, Claude, Gemini, DeepSeek, Doubao, Qwen, Kimi, or Yuanbao thread in the active tab."
      case "no_transient":
        return "No active thread snapshot detected yet."
      case "content_unreachable":
        return "Cannot reach page content script. Refresh the page and try again."
      default:
        return "Status unavailable"
    }
  }
  switch (reason) {
    case "ok":
      return t.capture.status.ready
    case "mode_mirror":
      return t.capture.status.mirrorMode
    case "unsupported_tab":
      return t.capture.status.unsupported_tab
    case "no_transient":
      return t.capture.status.no_transient
    case "content_unreachable":
      return t.capture.status.content_unreachable
    default:
      return t.capture.status.ready
  }
}

function mapArchiveErrorMessage(error: unknown, t?: { capture: { errors: Record<string, string> } }): string {
  const code = getErrorMessage(error)
  if (!t) {
    switch (code) {
      case "ARCHIVE_MODE_DISABLED":
        return "Manual archive is available only in Smart or Manual mode."
      case "ACTIVE_TAB_UNSUPPORTED":
        return "Active tab is unsupported. Open ChatGPT, Claude, Gemini, DeepSeek, Doubao, Qwen, Kimi, or Yuanbao."
      case "ACTIVE_TAB_UNAVAILABLE":
        return "No active tab found."
      case "TRANSIENT_NOT_FOUND":
        return "No active thread snapshot found. Send one message and try again."
      case "missing_conversation_id":
        return "Current URL has no stable conversation ID yet. Continue the thread and retry."
      case "empty_payload":
        return "No parsed messages available to archive."
      case "storage_limit_blocked":
        return "Storage hard limit reached. Export or clear data before archiving."
      case "persist_failed":
        return "Archive write failed. Please retry."
      case "FORCE_ARCHIVE_FAILED":
        return "Manual archive failed. Please retry."
      default:
        return code
    }
  }
  switch (code) {
    case "ARCHIVE_MODE_DISABLED":
      return t.capture.errors.archiveModeDisabled
    case "ACTIVE_TAB_UNSUPPORTED":
      return t.capture.errors.activeTabUnsupported
    case "ACTIVE_TAB_UNAVAILABLE":
      return t.capture.errors.activeTabUnavailable
    case "TRANSIENT_NOT_FOUND":
      return t.capture.errors.transientNotFound
    case "missing_conversation_id":
      return t.capture.errors.missingConversationId
    case "empty_payload":
      return t.capture.errors.emptyPayload
    case "storage_limit_blocked":
      return t.capture.errors.storageLimit
    case "persist_failed":
      return t.capture.errors.persistFailed
    case "FORCE_ARCHIVE_FAILED":
      return t.capture.errors.forceArchiveFailed
    default:
      return code
  }
}

function formatStatusTimestamp(value?: number): string {
  if (!value) return "N/A"
  const date = new Date(value)
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  const ss = String(date.getSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

function getEndpointHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

function resolveSettingsForMode(settings: LlmConfig): LlmConfig {
  const mode = getLlmAccessMode(settings)
  const next = normalizeLlmSettings({
    ...settings,
    baseUrl: MODELSCOPE_BASE_URL,
    gatewayLock: "modelscope",
    updatedAt: Date.now()
  })

  if (mode === "demo_proxy") {
    return normalizeLlmSettings({
      ...next,
      mode,
      modelId: DEFAULT_STABLE_MODEL,
      proxyBaseUrl:
        (next.proxyBaseUrl || next.proxyUrl || "").trim() ||
        DEFAULT_PROXY_BASE_URL,
      proxyUrl: DEFAULT_PROXY_URL,
      proxyServiceToken: (next.proxyServiceToken || "").trim(),
      thinkHandlingPolicy: next.thinkHandlingPolicy ?? "strip"
    })
  }

  const customModel = sanitizeByokModelId(next.customModelId || next.modelId)
  return normalizeLlmSettings({
    ...next,
    mode,
    modelId: customModel || DEFAULT_STABLE_MODEL,
    customModelId: customModel || DEFAULT_STABLE_MODEL
  })
}

interface SettingsPageProps {
  onNavigateToData?: () => void
}

export function SettingsPage({ onNavigateToData }: SettingsPageProps) {
  const { locale, t, setLocale } = useI18n()
  const [llmSettings, setLlmSettingsState] = useState<LlmConfig>(
    buildDefaultLlmSettings()
  )
  const [captureSettings, setCaptureSettingsState] = useState<CaptureSettings>(
    DEFAULT_CAPTURE_SETTINGS
  )
  const [minTurnsInput, setMinTurnsInput] = useState(
    String(DEFAULT_CAPTURE_SETTINGS.smartConfig.minTurns)
  )
  const [blacklistInput, setBlacklistInput] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [showProxyToken, setShowProxyToken] = useState(false)
  const [modelStatus, setModelStatus] = useState<AsyncStatus>("idle")
  const [modelFeedback, setModelFeedback] =
    useState<ModelAccessFeedback | null>(null)
  const [savedLlmSettingsState, setSavedLlmSettingsState] =
    useState<LlmConfig | null>(null)
  const [captureStatus, setCaptureStatus] = useState<AsyncStatus>("idle")
  const [captureMessage, setCaptureMessage] = useState<string | null>(null)
  const [activeCaptureStatus, setActiveCaptureStatus] =
    useState<ActiveCaptureStatus | null>(null)
  const [archiveStatus, setArchiveStatus] = useState<AsyncStatus>("idle")
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null)
  const [archiveSummary, setArchiveSummary] = useState<{
    reason: string
    messageCount: number
    time: number
  } | null>(null)
  const [themeMode, setThemeMode] = useState<UiThemeMode>("light")
  const [themeStatus, setThemeStatus] = useState<AsyncStatus>("idle")
  const [themeMessage, setThemeMessage] = useState<string | null>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [compactCardsPreviewOn, setCompactCardsPreviewOn] = useState(false)
  const [modelAccessOpen, setModelAccessOpen] = useState(false)
  const [notionOpen, setNotionOpen] = useState(false)
  const [notionSettings, setNotionSettingsState] = useState<NotionSettings>({
    authMode: "disconnected",
    accessToken: "",
    workspaceId: "",
    workspaceName: "",
    selectedDatabaseId: "",
    selectedDatabaseTitle: "",
    updatedAt: 0
  })
  const [notionStatus, setNotionStatus] = useState<AsyncStatus>("idle")
  const [notionMessage, setNotionMessage] = useState<string | null>(null)
  const [notionDatabaseQuery, setNotionDatabaseQuery] = useState("")
  const [notionDatabases, setNotionDatabases] = useState<
    NotionDatabaseOption[]
  >([])
  const [notionDatabasesStatus, setNotionDatabasesStatus] =
    useState<AsyncStatus>("idle")
  const [notionDatabasesMessage, setNotionDatabasesMessage] = useState<
    string | null
  >(null)
  const [feedbackExpanded, setFeedbackExpanded] = useState(false)
  const [feedbackCopyState, setFeedbackCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle")
  const feedbackCopyTimerRef = useRef<number | null>(null)

  const mode = getLlmAccessMode(llmSettings)
  const isCustomMode = mode === "custom_byok"
  const isSmartMode = captureSettings.mode === "smart"
  const isManualMode = captureSettings.mode === "manual"
  const byokEndpointHost = getEndpointHost(MODELSCOPE_BASE_URL)
  const proxyContextSource =
    savedLlmSettingsState &&
    getLlmAccessMode(savedLlmSettingsState) === "demo_proxy"
      ? savedLlmSettingsState
      : llmSettings
  const proxyConnectionBaseUrl = getProxyBaseUrl(proxyContextSource)
  const proxyServiceTokenAttached = Boolean(
    (proxyContextSource.proxyServiceToken || "").trim()
  )
  const archiveMode = activeCaptureStatus?.mode
  const notionAvailable =
    typeof chrome !== "undefined" &&
    Boolean(chrome.storage?.local) &&
    Boolean(chrome.identity?.launchWebAuthFlow)
  const notionConnected = isNotionConnected(notionSettings)
  const notionExportReady = isNotionExportConfigured(notionSettings)
  const canArchiveByMode = archiveMode === "smart" || archiveMode === "manual"
  const canArchiveNow =
    canArchiveByMode &&
    activeCaptureStatus?.supported === true &&
    activeCaptureStatus?.available === true &&
    activeCaptureStatus?.reason === "ok" &&
    archiveStatus !== "loading"

  const refreshActiveCaptureStatus = useCallback(async () => {
    try {
      const status = await getActiveCaptureStatus()
      setActiveCaptureStatus(status)
    } catch (error) {
      setActiveCaptureStatus((prev) => ({
        mode: prev?.mode ?? captureSettings.mode,
        supported: false,
        available: false,
        reason: "content_unreachable"
      }))
    }
  }, [captureSettings.mode])

  useEffect(() => {
    getLlmSettings()
      .then((settings) => {
        if (settings) {
          const normalized = normalizeLlmSettings(settings)
          setLlmSettingsState(normalized)
          setSavedLlmSettingsState(normalized)
        } else {
          const fallback = buildDefaultLlmSettings()
          setLlmSettingsState(fallback)
          setSavedLlmSettingsState(fallback)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    getCaptureSettings()
      .then((settings) => {
        setCaptureSettingsState(settings)
        setMinTurnsInput(String(settings.smartConfig.minTurns))
        setBlacklistInput(settings.smartConfig.blacklistKeywords.join(", "))
      })
      .catch((error) => {
        setCaptureStatus("error")
        setCaptureMessage(getErrorMessage(error))
      })
  }, [])

  useEffect(() => {
    let cancelled = false

    getUiSettings()
      .then((settings) => {
        if (cancelled) return
        setThemeMode(settings.themeMode)
        applyUiTheme(settings.themeMode)
      })
      .catch((error) => {
        if (cancelled) return
        setThemeStatus("error")
        setThemeMessage(getErrorMessage(error))
      })

    const unsubscribe = subscribeUiSettings((settings) => {
      if (cancelled) return
      setThemeMode(settings.themeMode)
      applyUiTheme(settings.themeMode)
      setThemeStatus("idle")
      setThemeMessage(null)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    getNotionSettings()
      .then((settings) => {
        setNotionSettingsState(settings)
      })
      .catch((error) => {
        setNotionStatus("error")
        setNotionMessage(formatNotionErrorMessage(error))
      })
  }, [])

  const loadNotionDatabases = useCallback(
    async (query = notionDatabaseQuery) => {
      if (!notionConnected) {
        setNotionDatabases([])
        setNotionDatabasesStatus("idle")
        setNotionDatabasesMessage(null)
        return
      }

      setNotionDatabasesStatus("loading")
      setNotionDatabasesMessage(null)

      try {
        const results = await listNotionDatabases(query)
        setNotionDatabases(results)
        setNotionDatabasesStatus("ready")
        setNotionDatabasesMessage(
          results.length === 0
            ? "No shared databases found yet. Share the database with the integration, then refresh."
            : null
        )
      } catch (error) {
        setNotionDatabasesStatus("error")
        setNotionDatabasesMessage(formatNotionErrorMessage(error))
      }
    },
    [notionConnected, notionDatabaseQuery]
  )

  useEffect(() => {
    if (!notionConnected) {
      setNotionDatabases([])
      setNotionDatabasesStatus("idle")
      setNotionDatabasesMessage(null)
      return
    }

    void loadNotionDatabases("")
  }, [loadNotionDatabases, notionConnected])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (cancelled) return
      await refreshActiveCaptureStatus()
    }

    void run()
    const intervalId = window.setInterval(() => {
      void run()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [refreshActiveCaptureStatus])

  const setMode = (custom: boolean) => {
    setLlmSettingsState((prev) =>
      resolveSettingsForMode({
        ...prev,
        mode: custom ? "custom_byok" : "demo_proxy"
      })
    )
    setModelFeedback(null)
    setModelStatus("idle")
  }

  const handleSave = async () => {
    setModelStatus("loading")
    setModelFeedback(null)

    try {
      const next = resolveSettingsForMode(llmSettings)
      if (getLlmAccessMode(next) === "custom_byok" && !next.apiKey.trim()) {
        setModelStatus("error")
        setModelFeedback({ summary: t.settings.modelAccess.apiKeyRequired })
        return
      }

      await setLlmSettings(next)
      setLlmSettingsState(next)
      setSavedLlmSettingsState(next)
      setModelStatus("ready")
      setModelFeedback({ summary: t.settings.modelAccess.saved })
    } catch (error) {
      const diagnostic = getLlmDiagnostic(error)
      setModelStatus("error")
      setModelFeedback(
        diagnostic
          ? feedbackFromDiagnostic(diagnostic)
          : toModelAccessFeedback(getErrorMessage(error), t.settings.modelAccess.save + " " + t.common.error.toLowerCase() + ".")
      )
    }
  }

  const handleTest = async () => {
    setModelStatus("loading")
    setModelFeedback(null)

    try {
      const next = resolveSettingsForMode(llmSettings)
      if (getLlmAccessMode(next) === "custom_byok" && !next.apiKey.trim()) {
        setModelStatus("error")
        setModelFeedback({ summary: t.settings.modelAccess.apiKeyRequired })
        return
      }

      await setLlmSettings(next)
      setLlmSettingsState(next)
      setSavedLlmSettingsState(next)
      const result = await testLlmConnection()
      setModelStatus(result.ok ? "ready" : "error")
      setModelFeedback(formatModelTestResultMessage(result, t))
    } catch (error) {
      const diagnostic = getLlmDiagnostic(error)
      setModelStatus("error")
      setModelFeedback(
        diagnostic
          ? feedbackFromDiagnostic(diagnostic)
          : toModelAccessFeedback(
              getErrorMessage(error),
              t.settings.modelAccess.testFailed
            )
      )
    }
  }

  const handleConnectNotion = async () => {
    setNotionStatus("loading")
    setNotionMessage(null)

    try {
      const saved = await connectToNotion()
      setNotionSettingsState(saved)
      setNotionStatus("ready")
      setNotionMessage(t.settings.notionExport.connectedMsg)
      setNotionDatabaseQuery("")
      await loadNotionDatabases("")
    } catch (error) {
      setNotionStatus("error")
      setNotionMessage(formatNotionErrorMessage(error))
    }
  }

  const handleDisconnectNotion = async () => {
    setNotionStatus("loading")
    setNotionMessage(null)

    try {
      const next = await disconnectNotion()
      setNotionSettingsState(next)
      setNotionDatabases([])
      setNotionDatabasesStatus("idle")
      setNotionDatabasesMessage(null)
      setNotionDatabaseQuery("")
      setNotionStatus("ready")
      setNotionMessage(t.settings.notionExport.disconnectedMsg)
    } catch (error) {
      setNotionStatus("error")
      setNotionMessage(formatNotionErrorMessage(error))
    }
  }

  const handleSelectNotionDatabase = async (database: NotionDatabaseOption) => {
    setNotionStatus("loading")
    setNotionMessage(null)

    try {
      const saved = await selectNotionDatabase(database)
      setNotionSettingsState(saved)
      setNotionStatus("ready")
      setNotionMessage(`${t.settings.notionExport.selected} ${database.title}.`)
    } catch (error) {
      setNotionStatus("error")
      setNotionMessage(formatNotionErrorMessage(error))
    }
  }

  const setCaptureMode = (nextMode: CaptureMode) => {
    setCaptureSettingsState((prev) => ({
      ...prev,
      mode: nextMode
    }))
    setCaptureStatus("idle")
    setCaptureMessage(null)
  }

  const handleSaveCaptureSettings = async () => {
    setCaptureStatus("loading")
    setCaptureMessage(null)

    try {
      const draft: CaptureSettings = {
        ...captureSettings,
        smartConfig: {
          minTurns:
            minTurnsInput.trim().length === 0
              ? MIN_TURNS_DEFAULT
              : Number(minTurnsInput),
          blacklistKeywords: parseKeywordsInput(blacklistInput)
        }
      }

      await setCaptureSettings(draft)
      const normalized = await getCaptureSettings()
      setCaptureSettingsState(normalized)
      setMinTurnsInput(String(normalized.smartConfig.minTurns))
      setBlacklistInput(normalized.smartConfig.blacklistKeywords.join(", "))
      setCaptureStatus("ready")
      setCaptureMessage(t.settings.captureEngine.settingsSaved)
      await refreshActiveCaptureStatus()
    } catch (error) {
      setCaptureStatus("error")
      setCaptureMessage(getErrorMessage(error))
    }
  }

  const handleArchiveActiveThread = async () => {
    setArchiveStatus("loading")
    setArchiveMessage(null)

    try {
      const result = await forceArchiveTransient()
      if (result.saved) {
        setArchiveStatus("ready")
        setArchiveSummary({
          reason: result.decision.reason,
          messageCount: result.decision.messageCount,
          time: Date.now()
        })
        setArchiveMessage(
          `Saved (${result.decision.reason}) \u00b7 ${result.decision.messageCount} messages`
        )
      } else {
        setArchiveStatus("error")
        setArchiveMessage(mapArchiveErrorMessage(result.decision.reason, t))
      }
    } catch (error) {
      setArchiveStatus("error")
      setArchiveMessage(mapArchiveErrorMessage(error, t))
    } finally {
      await refreshActiveCaptureStatus()
    }
  }

  const handleToggleThemeMode = async () => {
    const previous = themeMode
    const next: UiThemeMode = previous === "dark" ? "light" : "dark"

    setThemeMode(next)
    applyUiTheme(next)
    setThemeStatus("loading")
    setThemeMessage(null)

    try {
      const saved = await setUiThemeMode(next)
      setThemeMode(saved.themeMode)
      applyUiTheme(saved.themeMode)
      setThemeStatus("ready")
      setThemeMessage(
        saved.themeMode === "dark"
          ? t.settings.appearance.darkEnabled
          : t.settings.appearance.lightEnabled
      )
    } catch (error) {
      setThemeMode(previous)
      applyUiTheme(previous)
      setThemeStatus("error")
      setThemeMessage(getErrorMessage(error))
    }
  }

  useEffect(() => {
    return () => {
      if (feedbackCopyTimerRef.current !== null) {
        window.clearTimeout(feedbackCopyTimerRef.current)
      }
    }
  }, [])

  const handleToggleFeedback = () => {
    setFeedbackExpanded((prev) => !prev)
  }

  const handleCopyFeedbackEmail = async () => {
    try {
      await copyToClipboard(FEEDBACK_EMAIL)
      setFeedbackCopyState("copied")
    } catch {
      setFeedbackCopyState("error")
    }

    if (feedbackCopyTimerRef.current !== null) {
      window.clearTimeout(feedbackCopyTimerRef.current)
    }
    feedbackCopyTimerRef.current = window.setTimeout(() => {
      setFeedbackCopyState("idle")
    }, FEEDBACK_COPY_RESET_MS)
  }

  const handleToggleAppearance = () => {
    setAppearanceOpen((prev) => !prev)
  }

  const handleToggleModelAccess = () => {
    setModelAccessOpen((prev) => !prev)
  }

  const handleToggleNotion = () => {
    setNotionOpen((prev) => !prev)
  }

  return (
    <div className="vesti-shell flex h-full flex-col overflow-y-auto vesti-scroll bg-bg-app">
      <header className="vesti-page-header">
        <h1 className="vesti-page-title text-text-primary">{t.settings.title}</h1>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <SettingsGroupLabel label={t.settings.groups.personalisation} />

        <section
          className="appearance-shell"
          data-open={appearanceOpen ? "true" : "false"}>
          <button
            type="button"
            onClick={handleToggleAppearance}
            aria-expanded={appearanceOpen}
            aria-controls="settings-appearance-panel"
            className="appearance-trigger">
            <span className="appearance-trigger-main">
              <span className="appearance-icon-tile">
                {themeMode === "dark" ? (
                  <Moon className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <Sun className="h-4 w-4" strokeWidth={1.5} />
                )}
              </span>
              <span className="min-w-0">
                <span className="appearance-title">{t.settings.appearance.title}</span>
                <span className="appearance-description">
                  {t.settings.appearance.description}
                </span>
              </span>
            </span>
            <ChevronDown
              className="appearance-chevron h-4 w-4"
              strokeWidth={1.8}
            />
          </button>

          {appearanceOpen ? (
            <div id="settings-appearance-panel" className="appearance-body">
              <div className="appearance-inner-row">
                <div className="min-w-0">
                  <span className="appearance-inner-label">{t.settings.appearance.darkMode}</span>
                  <span className="appearance-inner-sub">
                    {t.settings.appearance.darkModeDesc}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={themeMode === "dark"}
                  onClick={handleToggleThemeMode}
                  data-state={themeMode === "dark" ? "checked" : "unchecked"}
                  className="settings-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                  <span className="settings-switch-thumb" />
                </button>
              </div>

              <div className="appearance-inner-row">
                <div className="min-w-0">
                  <span className="appearance-inner-label">{t.settings.appearance.compactCards}</span>
                  <span className="appearance-inner-sub">
                    {t.settings.appearance.compactCardsDesc}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={compactCardsPreviewOn}
                  onClick={() => setCompactCardsPreviewOn((prev) => !prev)}
                  data-state={compactCardsPreviewOn ? "checked" : "unchecked"}
                  className="settings-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                  <span className="settings-switch-thumb" />
                </button>
              </div>

              {(themeStatus === "loading" || themeMessage) && (
                <p
                  className={`appearance-theme-message ${
                    themeStatus === "error"
                      ? "text-danger"
                      : "text-text-secondary"
                  }`}>
                  {themeStatus === "loading"
                    ? t.settings.appearance.themeLoading
                    : themeMessage}
                </p>
              )}
            </div>
          ) : null}
        </section>

        <LanguageSelector locale={locale} onChange={setLocale} />

        <SettingsGroupLabel label={t.settings.groups.system} />

        <section
          className="model-access-shell"
          data-open={modelAccessOpen ? "true" : "false"}>
          <button
            type="button"
            onClick={handleToggleModelAccess}
            aria-expanded={modelAccessOpen}
            aria-controls="settings-model-access-panel"
            className="model-access-trigger">
            <span className="model-access-trigger-main">
              <span className="model-access-icon-tile">
                <Cpu className="h-4 w-4" strokeWidth={1.4} />
              </span>
              <span className="min-w-0">
                <span className="model-access-title">{t.settings.modelAccess.title}</span>
                <span className="model-access-description">
                  {t.settings.modelAccess.description}
                </span>
              </span>
            </span>
            <ChevronDown
              className="model-access-chevron h-4 w-4"
              strokeWidth={1.8}
            />
          </button>

          {modelAccessOpen ? (
            <div id="settings-model-access-panel" className="model-access-body">
              <div className="model-access-mode-row">
                <div>
                  <p className="model-access-mode-label">{t.settings.modelAccess.useCustomApiKey}</p>
                  <p className="model-access-mode-sub">
                    {t.settings.modelAccess.byokDesc}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isCustomMode}
                  onClick={() => setMode(!isCustomMode)}
                  data-state={isCustomMode ? "checked" : "unchecked"}
                  className="model-access-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                  <span className="model-access-switch-thumb" />
                </button>
              </div>

              {!isCustomMode ? (
                <>
                  <div className="model-access-info-block">
                    <div className="model-access-info-head">
                      <span className="model-access-status-chip model-access-status-chip-demo">
                        <span className="model-access-status-dot" />
                        {t.settings.modelAccess.proxyActive}
                      </span>
                      <CircleAlert
                        className="h-3.5 w-3.5 text-text-tertiary"
                        strokeWidth={1.4}
                      />
                    </div>
                    <div className="model-access-info-divider" />
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">{t.settings.modelAccess.primary}</span>
                      <span className="model-access-info-value">
                        {DEFAULT_STABLE_MODEL}
                      </span>
                    </div>
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">{t.settings.modelAccess.backup}</span>
                      <span className="model-access-info-value">
                        {DEFAULT_BACKUP_MODEL}
                      </span>
                    </div>
                  </div>

                  <div className="model-access-section-divider">
                    <span>Proxy</span>
                  </div>
                  <p className="text-[11px] font-sans text-text-tertiary">
                    {t.settings.modelAccess.proxyDesc}
                  </p>
                  <div className="model-access-info-block">
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">{t.settings.modelAccess.proxyRoute}</span>
                      <span className="model-access-info-value">
                        {t.settings.modelAccess.proxyChat}
                      </span>
                    </div>
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">{t.settings.modelAccess.proxyBaseUrl}</span>
                      <span className="model-access-info-value">
                        {proxyConnectionBaseUrl}
                      </span>
                    </div>
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">{t.settings.modelAccess.proxyHeader}</span>
                      <span className="model-access-info-value">
                        Service token header:{" "}
                        {proxyServiceTokenAttached ? t.settings.modelAccess.serviceTokenAttached : t.settings.modelAccess.serviceTokenOmitted}
                      </span>
                    </div>
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">{t.settings.modelAccess.proxyBaseUrl}</label>
                    <input
                      type="text"
                      value={llmSettings.proxyBaseUrl ?? DEFAULT_PROXY_BASE_URL}
                      onChange={(event) =>
                        setLlmSettingsState((prev) =>
                          normalizeLlmSettings({
                            ...prev,
                            proxyBaseUrl: event.target.value
                          })
                        )
                      }
                      className="model-access-input"
                      placeholder="https://vesti-proxy.vercel.app"
                    />
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">
                      {t.settings.modelAccess.serviceTokenLabel}{" "}
                      <span className="model-access-label-optional">
                        - {t.settings.modelAccess.serviceTokenOptional}
                      </span>
                    </label>
                    <div className="model-access-input-wrap">
                      <input
                        type={showProxyToken ? "text" : "password"}
                        value={llmSettings.proxyServiceToken ?? ""}
                        onChange={(event) =>
                          setLlmSettingsState((prev) =>
                            normalizeLlmSettings({
                              ...prev,
                              proxyServiceToken: event.target.value
                            })
                          )
                        }
                        className="model-access-input model-access-input-with-icon"
                        placeholder="local-proxy-token"
                      />
                      <button
                        type="button"
                        onClick={() => setShowProxyToken((prev) => !prev)}
                        className="model-access-input-eye focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        aria-label="Toggle proxy token visibility">
                        {showProxyToken ? (
                          <EyeOff className="h-3.5 w-3.5" strokeWidth={1.4} />
                        ) : (
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.4} />
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="model-access-info-block">
                    <div className="model-access-info-head">
                      <span className="model-access-status-chip model-access-status-chip-byok">
                        <span className="model-access-status-dot" />
                        {t.settings.modelAccess.byokActive}
                      </span>
                      <CircleAlert
                        className="h-3.5 w-3.5 text-text-tertiary"
                        strokeWidth={1.4}
                      />
                    </div>
                    <div className="model-access-info-divider" />
                    <div className="model-access-info-row">
                      <span className="model-access-info-key">{t.settings.modelAccess.endpoint}</span>
                      <span className="model-access-info-value">
                        {byokEndpointHost}
                      </span>
                    </div>
                  </div>

                  <div className="model-access-section-divider">
                    <span>{t.settings.modelAccess.credentials}</span>
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">
                      {t.settings.modelAccess.apiKeyLabel}
                    </label>
                    <div className="model-access-input-wrap">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={llmSettings.apiKey}
                        onChange={(event) =>
                          setLlmSettingsState((prev) => ({
                            ...prev,
                            apiKey: event.target.value
                          }))
                        }
                        className="model-access-input model-access-input-with-icon"
                        placeholder={t.settings.modelAccess.apiKeyPlaceholder}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((prev) => !prev)}
                        className="model-access-input-eye focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                        aria-label="Toggle API key visibility">
                        {showApiKey ? (
                          <EyeOff className="h-3.5 w-3.5" strokeWidth={1.4} />
                        ) : (
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.4} />
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] font-sans text-text-tertiary">
                      This key is used for BYOK chat generation. Explore
                      embeddings continue to use proxy routing.
                    </p>
                  </div>

                  <div className="model-access-field-group">
                    <label className="model-access-input-label">
                      {t.settings.modelAccess.modelLabel}{" "}
                      <span className="model-access-label-optional">
                        - {t.settings.modelAccess.whitelistOnly}
                      </span>
                    </label>
                    <select
                      value={sanitizeByokModelId(
                        llmSettings.customModelId ?? llmSettings.modelId
                      )}
                      onChange={(event) =>
                        setLlmSettingsState((prev) =>
                          normalizeLlmSettings({
                            ...prev,
                            customModelId: event.target.value,
                            modelId: event.target.value
                          })
                        )
                      }
                      className="model-access-input">
                      {BYOK_MODEL_WHITELIST.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="model-access-actions">
                <button
                  type="button"
                  onClick={handleSave}
                  className="model-access-save-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                  {t.settings.modelAccess.save}
                </button>
                <button
                  type="button"
                  onClick={handleTest}
                  className="model-access-test-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                  {t.settings.modelAccess.test}
                </button>
              </div>

              {modelStatus === "loading" && (
                <div className="model-access-feedback text-text-tertiary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t.settings.modelAccess.testing}
                </div>
              )}

              {modelFeedback && modelStatus !== "loading" && (
                <div
                  className={`model-access-feedback-card ${
                    modelStatus === "error" ? "is-error" : ""
                  }`}>
                  <p className="model-access-feedback-title">
                    {modelFeedback.summary}
                  </p>
                  {modelFeedback.detail && (
                    <p className="model-access-feedback-detail">
                      {modelFeedback.detail}
                    </p>
                  )}
                  {modelFeedback.hint && (
                    <p className="model-access-feedback-hint">
                      {modelFeedback.hint}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section
          className="model-access-shell"
          data-open={notionOpen ? "true" : "false"}>
          <button
            type="button"
            onClick={handleToggleNotion}
            aria-expanded={notionOpen}
            aria-controls="settings-notion-panel"
            className="model-access-trigger">
            <span className="model-access-trigger-main">
              <span className="model-access-icon-tile">
                <BookOpen className="h-4 w-4" strokeWidth={1.4} />
              </span>
              <span className="min-w-0">
                <span className="model-access-title">{t.settings.notionExport.title}</span>
                <span className="model-access-description">
                  {t.settings.notionExport.description}
                </span>
              </span>
            </span>
            <ChevronDown
              className="model-access-chevron h-4 w-4"
              strokeWidth={1.8}
            />
          </button>

          {notionOpen ? (
            <div id="settings-notion-panel" className="model-access-body">
              <div className="model-access-info-block">
                <div className="model-access-info-head">
                  <span className="model-access-status-chip model-access-status-chip-demo">
                    <span className="model-access-status-dot" />
                    {notionConnected ? t.settings.notionExport.oauthConnected : t.settings.notionExport.officialOAuth}
                  </span>
                  <CircleAlert
                    className="h-3.5 w-3.5 text-text-tertiary"
                    strokeWidth={1.4}
                  />
                </div>
                <div className="model-access-info-divider" />
                <p className="text-[11px] font-sans leading-[1.5] text-text-tertiary">
                  {t.settings.notionExport.connectDesc}
                </p>
              </div>

              <div className="model-access-field-group">
                <label className="model-access-input-label">Connection</label>
                <div className="rounded-xl border border-border-subtle bg-bg-primary px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-sans font-medium text-text-primary">
                        {notionConnected
                          ? notionSettings.workspaceName ||
                            t.settings.notionExport.connected
                          : notionAvailable
                            ? t.settings.notionExport.connectBtn
                            : t.settings.notionExport.extensionOnly}
                      </div>
                      <p className="mt-1 text-[11px] font-sans leading-[1.5] text-text-tertiary">
                        {notionConnected
                          ? notionSettings.authMode === "legacy_manual"
                            ? t.settings.notionExport.legacyToken
                            : t.settings.notionExport.workspaceReady
                          : notionAvailable
                            ? t.settings.notionExport.oauthFlowDesc
                            : t.settings.notionExport.extensionOnly}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleConnectNotion()}
                        disabled={
                          !notionAvailable || notionStatus === "loading"
                        }
                        className="model-access-save-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-60">
                        {notionStatus === "loading"
                          ? t.settings.notionExport.connecting
                          : notionConnected
                            ? t.settings.notionExport.reconnect
                            : t.settings.notionExport.connectBtn}
                      </button>
                      {notionConnected ? (
                        <button
                          type="button"
                          onClick={() => void handleDisconnectNotion()}
                          disabled={notionStatus === "loading"}
                          className="model-access-test-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-60">
                          {t.settings.notionExport.disconnect}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {notionConnected ? (
                <>
                  <div className="model-access-field-group">
                    <label className="model-access-input-label">
                      {t.settings.notionExport.targetDatabase}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={notionDatabaseQuery}
                        onChange={(event) => {
                          setNotionDatabaseQuery(event.target.value)
                          setNotionDatabasesStatus("idle")
                          setNotionDatabasesMessage(null)
                        }}
                        className="model-access-input"
                        placeholder={t.settings.notionExport.databasePlaceholder}
                      />
                      <button
                        type="button"
                        onClick={() => void loadNotionDatabases()}
                        disabled={notionDatabasesStatus === "loading"}
                        className="model-access-test-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-60">
                        Refresh
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] font-sans leading-[1.5] text-text-tertiary">
                      If the database does not appear yet, share it with the
                      integration in Notion, then refresh.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border-subtle bg-bg-primary p-2">
                    {notionDatabases.length > 0 ? (
                      <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                        {notionDatabases.map((database) => {
                          const selected =
                            database.id === notionSettings.selectedDatabaseId
                          return (
                            <button
                              key={database.id}
                              type="button"
                              onClick={() =>
                                void handleSelectNotionDatabase(database)
                              }
                              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                                selected
                                  ? "border-accent-primary/40 bg-accent-primary-light/40"
                                  : "border-transparent hover:border-border-subtle hover:bg-bg-surface-card"
                              }`}>
                              <div className="text-[12px] font-sans font-medium text-text-primary">
                                {database.title}
                              </div>
                              <div className="mt-1 text-[11px] font-sans text-text-tertiary">
                                {database.id}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="px-2 py-3 text-[11px] font-sans leading-[1.5] text-text-tertiary">
                        {notionDatabasesStatus === "loading"
                          ? t.settings.notionExport.noDatabases
                          : "No databases loaded yet. Connect and refresh to fetch shared databases."}
                      </div>
                    )}
                  </div>

                  <div className="text-[11px] font-sans text-text-tertiary">
                    {notionExportReady
                      ? `Selected: ${
                          notionSettings.selectedDatabaseTitle ||
                          notionSettings.selectedDatabaseId
                        }`
                      : "Choose a database to enable annotation export."}
                  </div>
                </>
              ) : null}

              {notionStatus === "loading" && (
                <div className="model-access-feedback text-text-tertiary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t.settings.notionExport.connecting}
                </div>
              )}

              {notionMessage && notionStatus !== "loading" && (
                <p
                  className={`model-access-feedback ${
                    notionStatus === "error"
                      ? "text-danger"
                      : "text-text-secondary"
                  }`}>
                  {notionMessage}
                </p>
              )}

              {notionDatabasesMessage && notionDatabasesStatus !== "loading" ? (
                <p
                  className={`model-access-feedback ${
                    notionDatabasesStatus === "error"
                      ? "text-danger"
                      : "text-text-secondary"
                  }`}>
                  {notionDatabasesMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <DisclosureSection
          title={t.settings.captureEngine.title}
          description={t.settings.captureEngine.description}
          icon={
            <SettingsIconTile>
              <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
            </SettingsIconTile>
          }>
          <div className="card-shadow-warm rounded-card border border-border-subtle bg-bg-surface p-4">
            <div className="grid gap-3">
              <div
                className="grid gap-2"
                role="radiogroup"
                aria-label={t.settings.captureEngine.modeLabel}>
                {getCaptureModeOptions(t).map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-md border px-3 py-2 transition-colors duration-200 ${
                      captureSettings.mode === option.value
                        ? "border-text-primary bg-bg-primary/70"
                        : "border-border-subtle bg-bg-surface-hover hover:bg-bg-primary/65"
                    }`}>
                    <span className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="capture-mode"
                        value={option.value}
                        checked={captureSettings.mode === option.value}
                        onChange={() => setCaptureMode(option.value)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-text-primary">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-[1.45] text-text-secondary">
                          {option.description}
                        </span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {isSmartMode && (
                <div className="grid gap-2 rounded-md border border-border-subtle bg-bg-surface-hover p-3">
                  <div className="grid gap-1">
                    <label className="text-[11px] text-text-tertiary">
                      {t.settings.captureEngine.minTurnsLabel}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={minTurnsInput}
                      onChange={(event) => setMinTurnsInput(event.target.value)}
                      className="settings-input"
                    />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-[11px] text-text-tertiary">
                      {t.settings.captureEngine.blacklistLabel}
                    </label>
                    <input
                      type="text"
                      value={blacklistInput}
                      onChange={(event) =>
                        setBlacklistInput(event.target.value)
                      }
                      className="settings-input"
                      placeholder={t.settings.captureEngine.blacklistPlaceholder}
                    />
                  </div>
                </div>
              )}

              {isManualMode && (
                <p className="rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[12px] text-text-secondary">
                  {t.settings.captureEngine.manualModeHint}
                </p>
              )}

              <p className="text-[11px] text-text-tertiary">
                {t.settings.captureEngine.captureHint}
              </p>

              <div className="grid gap-1 rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[11px] text-text-secondary">
                <p>
                  {t.settings.captureEngine.activeThread}:{" "}
                  {formatCaptureStatusReason(activeCaptureStatus?.reason, t)}
                </p>
                <p>
                  {t.settings.captureEngine.snapshot}:{" "}
                  {activeCaptureStatus?.available
                    ? `${activeCaptureStatus.messageCount ?? 0} ${t.settings.captureEngine.messages} - ${
                        activeCaptureStatus.turnCount ?? 0
                      } ${t.settings.captureEngine.turns}`
                    : t.settings.captureEngine.unavailable}
                </p>
                <p>
                  {t.settings.captureEngine.lastUpdate}:{" "}
                  {formatStatusTimestamp(activeCaptureStatus?.updatedAt)}
                </p>
                {activeCaptureStatus?.lastDecision && (
                  <p>
                    {t.settings.captureEngine.lastDecision}: {activeCaptureStatus.lastDecision.reason} -{" "}
                    {activeCaptureStatus.lastDecision.messageCount} {t.settings.captureEngine.messages}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-surface-hover p-3">
                <div>
                  <p className="text-[12px] font-medium text-text-primary">
                    {t.settings.captureEngine.archiveActiveThread}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">
                    {t.settings.captureEngine.archiveHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleArchiveActiveThread}
                  disabled={!canArchiveNow}
                  aria-disabled={!canArchiveNow}
                  className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 ${
                    canArchiveNow
                      ? "border-border-default bg-transparent text-text-primary hover:bg-bg-surface"
                      : "border-border-default bg-transparent text-text-tertiary opacity-60"
                  }`}>
                  {archiveStatus === "loading" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                  {archiveStatus === "loading" ? t.settings.captureEngine.archiving : t.settings.captureEngine.archive}
                </button>
              </div>

              {(archiveMessage || archiveSummary) && (
                <div className="rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[11px] text-text-secondary">
                  {archiveMessage && (
                    <p
                      className={
                        archiveStatus === "error"
                          ? "text-danger"
                          : "text-text-secondary"
                      }>
                      {archiveMessage}
                    </p>
                  )}
                  {archiveSummary && (
                    <p className="mt-0.5 text-text-tertiary">
                      Saved at {formatStatusTimestamp(archiveSummary.time)} -{" "}
                      {archiveSummary.reason} - {archiveSummary.messageCount}{" "}
                      messages
                    </p>
                  )}
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleSaveCaptureSettings}
                  className="rounded-md border border-text-primary bg-text-primary px-4 py-2 text-[13px] font-medium text-text-inverse transition-colors duration-200 hover:bg-accent-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                  {t.settings.captureEngine.saveSettings}
                </button>
                {captureStatus === "loading" && (
                  <div className="flex items-center gap-1 text-[12px] text-text-tertiary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t.settings.modelAccess.testing}
                  </div>
                )}
                {captureMessage && captureStatus !== "loading" && (
                  <span
                    className={`text-[12px] ${
                      captureStatus === "error"
                        ? "text-danger"
                        : "text-text-secondary"
                    }`}>
                    {captureMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        </DisclosureSection>

        <DisclosureSection
          title={t.settings.dataManagement.title}
          description={t.settings.dataManagement.description}
          icon={
            <SettingsIconTile>
              <FolderGit2 className="h-4 w-4" strokeWidth={1.5} />
            </SettingsIconTile>
          }>
          <div className="card-shadow-warm rounded-card border border-border-subtle bg-bg-surface p-4">
            <div className="rounded-md border border-border-subtle bg-bg-surface-hover p-3">
              <p className="text-[13px] font-medium text-text-primary">
                {t.settings.dataManagement.dataToolsDesc}
              </p>
              <p className="mt-1 text-[12px] text-text-secondary">
                {t.settings.dataManagement.dataToolsHint}
              </p>
              <button
                type="button"
                onClick={onNavigateToData}
                disabled={!onNavigateToData}
                className={`mt-3 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                  onNavigateToData
                    ? "border-text-primary bg-text-primary text-text-inverse hover:bg-accent-primary-hover"
                    : "border-border-default bg-bg-surface text-text-tertiary"
                }`}>
                {t.settings.dataManagement.openDataTab}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </DisclosureSection>

        <SettingsGroupLabel label={t.settings.groups.support} />

        <section className="settings-support-shell">
          <div className="settings-support-item">
            <SupportRow
              label={t.settings.support.docsHelp}
              icon={<Github className="h-4 w-4" strokeWidth={1.5} />}
              onClick={() => openExternalUrl(DOCS_HELP_URL)}
            />
          </div>

          <div className="settings-support-item">
            <SupportRow
              label={t.settings.support.sendFeedback}
              icon={<Mail className="h-4 w-4" strokeWidth={1.5} />}
              onClick={handleToggleFeedback}
              expanded={feedbackExpanded}
            />

            {feedbackExpanded ? (
              <div className="settings-support-reveal">
                <p className="text-[11px] text-text-tertiary">
                  {t.settings.support.contactHint}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2">
                  <span className="text-[12px] font-mono text-text-secondary">
                    {FEEDBACK_EMAIL}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyFeedbackEmail}
                    className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-[11px] font-medium text-text-primary transition-colors duration-150 hover:bg-bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                    {feedbackCopyState === "copied" ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                    ) : (
                      <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                    )}
                    {feedbackCopyState === "copied"
                      ? t.settings.support.copied
                      : feedbackCopyState === "error"
                        ? t.settings.support.retry
                        : t.settings.support.copyEmail}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => openExternalUrl(FEEDBACK_ISSUE_URL)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary underline underline-offset-2 transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                  {t.settings.support.openIssue}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            ) : null}
          </div>

          <div className="settings-support-item">
            <SupportRow
              label={t.settings.support.whatsNew}
              icon={<Megaphone className="h-4 w-4" strokeWidth={1.5} />}
              onClick={() => openExternalUrl(WHATS_NEW_URL)}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
