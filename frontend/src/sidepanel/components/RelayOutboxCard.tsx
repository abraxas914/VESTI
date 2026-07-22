import { Inbox, Loader2, SendHorizontal, X } from "lucide-react"
import { useEffect, useState } from "react"

import { useI18n } from "~lib/i18n"
import {
  dismissRelayItem,
  injectRelayItem,
  listRelayOutbox
} from "~lib/services/storageService"
import type { RelayItem } from "~lib/types"

import { DisclosureSection } from "./DisclosureSection"

/** Substitute {placeholder} tokens in an i18n template. */
function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`
  )
}

function formatRelayTime(value: string | null, locale: string): string {
  if (!value) return "—"
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return "—"
  return new Date(ts).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function previewText(prompt: string, max = 80): string {
  const flat = prompt.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * Pending handoff packets pushed by the VESTI desktop app. Each packet can be
 * injected into the composer of the AI platform open in the active tab (fill
 * only — the user reviews and sends), or dismissed. Hidden entirely when the
 * paired desktop does not advertise the "outbox" capability.
 */
export function RelayOutboxCard() {
  const { locale, t } = useI18n()
  const r = t.settings.relay
  const [supported, setSupported] = useState(false)
  const [items, setItems] = useState<RelayItem[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{
    kind: "error" | "ok"
    text: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await listRelayOutbox()
        if (cancelled) return
        setSupported(res.outboxSupported)
        setItems(res.items)
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

  const handleInject = async (item: RelayItem) => {
    if (busyId !== null) return
    setBusyId(item.id)
    setFeedback(null)
    try {
      await injectRelayItem(item.id)
      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
      setFeedback({ kind: "ok", text: r.injected })
    } catch (error) {
      const message = (error as Error)?.message ?? ""
      const text = message.startsWith("RELAY_TAB_UNSUPPORTED")
        ? r.unsupportedTab
        : message.startsWith("RELAY_CONTENT_UNREACHABLE")
          ? r.contentUnreachable
          : r.fillFailed
      setFeedback({ kind: "error", text })
    } finally {
      setBusyId(null)
    }
  }

  const handleDismiss = async (item: RelayItem) => {
    if (busyId !== null) return
    setBusyId(item.id)
    setFeedback(null)
    try {
      await dismissRelayItem(item.id)
      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
    } catch {
      setFeedback({ kind: "error", text: r.fillFailed })
    } finally {
      setBusyId(null)
    }
  }

  if (!supported) return null

  return (
    <DisclosureSection
      title={r.title}
      description={
        items.length > 0 ? fmt(r.countLabel, { count: items.length }) : r.description
      }
      defaultOpen={items.length > 0}
      icon={
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-secondary text-text-secondary transition-colors duration-150 group-open:text-text-primary">
          <Inbox className="h-4 w-4" strokeWidth={1.5} />
        </span>
      }>
      <div className="card-shadow-warm rounded-card border border-border-subtle bg-bg-surface p-4">
        {items.length === 0 ? (
          <p className="text-[12px] text-text-tertiary">{r.empty}</p>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="grid gap-2 rounded-md border border-border-subtle bg-bg-surface-hover px-3 py-2">
                <div className="grid gap-0.5">
                  <p className="whitespace-pre-wrap break-words text-[12px] text-text-primary">
                    {previewText(item.prompt)}
                  </p>
                  <p className="text-[11px] text-text-tertiary">
                    {formatRelayTime(item.createdAt, locale)}
                    {item.failReason ? ` · ${r.failedHint}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleInject(item)}
                    disabled={busyId !== null}
                    className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 ${
                      busyId === null
                        ? "border-text-primary bg-text-primary text-text-inverse hover:bg-accent-primary-hover"
                        : "border-border-default bg-transparent text-text-tertiary opacity-60"
                    }`}>
                    {busyId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <SendHorizontal
                        className="h-3.5 w-3.5"
                        strokeWidth={1.5}
                      />
                    )}
                    {busyId === item.id ? r.injecting : r.inject}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDismiss(item)}
                    disabled={busyId !== null}
                    className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 ${
                      busyId === null
                        ? "border-border-default bg-transparent text-text-primary hover:bg-bg-surface"
                        : "border-border-default bg-transparent text-text-tertiary opacity-60"
                    }`}>
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {r.dismiss}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {feedback ? (
          <p
            className={`mt-2 text-[12px] ${
              feedback.kind === "error" ? "text-danger" : "text-text-secondary"
            }`}>
            {feedback.text}
          </p>
        ) : null}
      </div>
    </DisclosureSection>
  )
}
