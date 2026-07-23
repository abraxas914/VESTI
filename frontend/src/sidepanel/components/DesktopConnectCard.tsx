import {
  Laptop,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Unplug
} from "lucide-react"
import { useEffect, useState } from "react"

import { useI18n } from "~lib/i18n"
import {
  disconnectDesktopBridge,
  getDesktopBridgeState,
  pairDesktopBridge,
  retryDesktopBridgeAutoConnect,
  syncDesktopBridgeNow
} from "~lib/services/storageService"
import type { DesktopBridgeStatus } from "~lib/types"

import { DisclosureSection } from "./DisclosureSection"

/** Substitute {placeholder} tokens in an i18n template. */
function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`
  )
}

function formatBridgeTime(value: number | null, locale: string): string {
  if (!value || !Number.isFinite(value)) return "—"
  return new Date(value).toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}

/** Map a DesktopBridgeError code (message prefix) to a translated string. */
function bridgeErrorText(
  error: unknown,
  desktop: {
    desktopOffline: string
    desktopIncompatible: string
    codeInvalid: string
    pairFailed: string
  }
): string {
  const message = (error as Error)?.message ?? String(error)
  if (message.startsWith("DESKTOP_OFFLINE")) return desktop.desktopOffline
  if (message.startsWith("DESKTOP_INCOMPATIBLE")) return desktop.desktopIncompatible
  if (message.startsWith("PAIR_CODE_INVALID")) return desktop.codeInvalid
  return desktop.pairFailed
}

/** The unpaired sub-state, driven by the auto-connect state machine. */
type UnpairedView =
  | "offline"
  | "waiting"
  | "window_closed"
  | "rejected"
  | "suppressed"
  | "legacy_desktop"
  | "idle"

function resolveUnpairedView(status: DesktopBridgeStatus): UnpairedView {
  if (status.online !== true) return "offline"
  if (status.associating) return "waiting"
  if (
    status.associationRejectedUntil !== null &&
    status.associationRejectedUntil > Date.now()
  ) {
    return "rejected"
  }
  if (!status.capabilities.includes("associate")) return "legacy_desktop"
  if (status.autoConnectSuppressed) return "suppressed"
  if (status.pairingWindow === "closed") return "window_closed"
  // Pairing window open (or not reported yet) but nothing in flight — e.g.
  // the in-app confirmation timed out. The next tick retries; the user can
  // also retry manually.
  return "idle"
}

/**
 * Settings card: connect to the VESTI desktop app over the local bridge
 * (127.0.0.1:28765). Bridge Protocol v1.2 associates automatically once the
 * app's pairing window is open (one tap in the app, no code); the 6-digit
 * pairing code stays available as a collapsed fallback. The bearer token
 * never reaches the panel — all bridge traffic goes through the background
 * worker.
 */
export function DesktopConnectCard() {
  const { locale, t } = useI18n()
  const d = t.settings.desktop
  const [status, setStatus] = useState<DesktopBridgeStatus | null>(null)
  const [code, setCode] = useState("")
  const [codeFormOpen, setCodeFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{
    kind: "error" | "ok"
    text: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await getDesktopBridgeState()
        if (!cancelled) setStatus(res.state)
      } catch {
        // Background unreachable (worker restarting) — keep the last state.
      }
    }
    void poll()
    const id = window.setInterval(() => {
      void poll()
    }, 4000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const handlePair = async () => {
    if (busy || !code.trim()) return
    setBusy(true)
    setFeedback(null)
    try {
      const res = await pairDesktopBridge(code.trim())
      setStatus(res.state)
      setCode("")
    } catch (error) {
      setFeedback({ kind: "error", text: bridgeErrorText(error, d) })
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    if (busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const res = await disconnectDesktopBridge()
      setStatus(res.state)
      setFeedback({ kind: "ok", text: d.disconnected })
    } catch {
      setFeedback({ kind: "error", text: d.pairFailed })
    } finally {
      setBusy(false)
    }
  }

  const handleSyncNow = async () => {
    if (busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const res = await syncDesktopBridgeNow()
      setStatus(res.state)
      if (res.synced) {
        setFeedback({
          kind: "ok",
          text: fmt(d.syncResult, {
            conversations: res.conversations ?? 0,
            messages: res.messages ?? 0
          })
        })
      } else if (res.skipped === "offline") {
        setFeedback({ kind: "error", text: d.desktopOffline })
      } else {
        setFeedback({ kind: "ok", text: d.syncSkipped })
      }
    } catch (error) {
      setFeedback({ kind: "error", text: bridgeErrorText(error, d) })
    } finally {
      setBusy(false)
    }
  }

  const handleRetryAutoConnect = async () => {
    if (busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const res = await retryDesktopBridgeAutoConnect()
      setStatus(res.state)
    } catch {
      setFeedback({ kind: "error", text: d.pairFailed })
    } finally {
      setBusy(false)
    }
  }

  // needsRepair is a pre-v1.2 leftover: the next discovery tick drops the
  // dead token and re-associates, so render it as "unpaired, recovering".
  const paired = status?.paired === true && !status.needsRepair
  const view: UnpairedView | "paired" | "loading" = !status
    ? "loading"
    : paired
      ? "paired"
      : resolveUnpairedView(status)

  const rejectedMinutesLeft =
    view === "rejected" && status?.associationRejectedUntil
      ? Math.max(
          1,
          Math.ceil((status.associationRejectedUntil - Date.now()) / 60000)
        )
      : 0

  const statusText = (() => {
    switch (view) {
      case "loading":
        return "…"
      case "paired":
        return status?.online === true ? d.statusOnline : d.statusOffline
      case "offline":
        return d.statusOffline
      case "waiting":
        return d.statusWaitingConfirm
      case "window_closed":
        return d.statusWindowClosed
      case "rejected":
        return d.statusRejected
      default:
        return d.statusNotPaired
    }
  })()

  const statusTone =
    view === "paired"
      ? status?.online === true
        ? "text-text-primary"
        : "text-danger"
      : view === "rejected"
        ? "text-danger"
        : view === "waiting"
          ? "text-text-primary"
          : "text-text-tertiary"

  const hintText = (() => {
    switch (view) {
      case "offline":
        return d.offlineHint
      case "waiting":
        return d.waitingConfirmHint
      case "window_closed":
        return d.windowClosedHint
      case "rejected":
        return fmt(d.rejectedCooldown, { minutes: rejectedMinutesLeft })
      case "suppressed":
        return d.disconnectedHint
      case "idle":
        return d.waitingRetryHint
      default:
        return null
    }
  })()

  const showRetryButton =
    view === "window_closed" || view === "rejected" || view === "idle"
  const showReconnectButton = view === "suppressed"
  // On a pre-v1.2 desktop the code form IS the only flow — keep it expanded.
  const showCodeForm = codeFormOpen || view === "legacy_desktop"

  const actionButtonClass = (enabled: boolean) =>
    `inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 ${
      enabled
        ? "border-border-default bg-transparent text-text-primary hover:bg-bg-surface"
        : "border-border-default bg-transparent text-text-tertiary opacity-60"
    }`

  return (
    <DisclosureSection
      title={d.title}
      description={d.description}
      icon={
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary transition-colors duration-150 group-open:text-text-primary">
          <MonitorSmartphone className="h-4 w-4" strokeWidth={1.5} />
        </span>
      }>
      <div className="card-shadow-warm rounded-card border border-border-subtle bg-bg-surface p-4">
        <div className="grid gap-3">
          <div className="grid gap-1 rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[11px] text-text-secondary">
            <p>
              {d.statusLabel}:{" "}
              <span className={statusTone}>{statusText}</span>
              {status?.desktopVersion ? ` · v${status.desktopVersion}` : ""}
            </p>
            {paired ? (
              <p>
                {d.lastSync}:{" "}
                {status?.syncing
                  ? d.syncing
                  : status?.lastSyncAt
                    ? formatBridgeTime(status.lastSyncAt, locale)
                    : d.neverSynced}
              </p>
            ) : null}
          </div>

          {hintText ? (
            <p className="flex items-start gap-2 rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2 text-[12px] text-text-secondary">
              {view === "waiting" ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : null}
              <span>{hintText}</span>
            </p>
          ) : null}

          {view === "paired" ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={busy || status?.syncing === true}
                className={actionButtonClass(!busy && status?.syncing !== true)}>
                {busy || status?.syncing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
                {status?.syncing ? d.syncing : d.syncNow}
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={busy}
                className={actionButtonClass(!busy)}>
                <Unplug className="h-3.5 w-3.5" strokeWidth={1.5} />
                {d.disconnect}
              </button>
            </div>
          ) : null}

          {showRetryButton || showReconnectButton ? (
            <div>
              <button
                type="button"
                onClick={handleRetryAutoConnect}
                disabled={busy || view === "rejected"}
                className={actionButtonClass(!busy && view !== "rejected")}>
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
                {busy
                  ? d.connecting
                  : showReconnectButton
                    ? d.reconnect
                    : d.retryConnect}
              </button>
            </div>
          ) : null}

          {view !== "paired" && view !== "loading" ? (
            showCodeForm ? (
              <div className="grid gap-2">
                <label className="text-[11px] text-text-tertiary">
                  {d.codeLabel}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="settings-input"
                  placeholder={d.codePlaceholder}
                  maxLength={12}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePair}
                    disabled={busy || !code.trim()}
                    className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 ${
                      !busy && code.trim()
                        ? "border-text-primary bg-text-primary text-text-inverse hover:bg-accent-primary-hover"
                        : "border-border-default bg-transparent text-text-tertiary opacity-60"
                    }`}>
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Laptop className="h-3.5 w-3.5" strokeWidth={1.5} />
                    )}
                    {busy ? d.connecting : d.connect}
                  </button>
                  <span className="text-[11px] text-text-tertiary">
                    {d.firstSyncHint}
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setCodeFormOpen(true)}
                  className="text-[11px] text-text-tertiary underline decoration-dotted underline-offset-2 transition-colors duration-200 hover:text-text-secondary">
                  {d.usePairCode}
                </button>
              </div>
            )
          ) : null}

          {feedback ? (
            <p
              className={`text-[12px] ${
                feedback.kind === "error" ? "text-danger" : "text-text-secondary"
              }`}>
              {feedback.text}
            </p>
          ) : null}
        </div>
      </div>
    </DisclosureSection>
  )
}
