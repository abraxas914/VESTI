// Relay handoff packets — poll the desktop outbox and keep a local queue of
// prompts waiting to be injected into an AI platform tab.
//
// Flow: a short-period alarm (and browser startup / pairing) triggers
// pollRelayOutbox(), which pulls GET /v1/outbox?after=<maxSeenId> from the
// desktop bridge. New items land in a chrome.storage.local queue as "pending"
// and show up as an action-badge count and in the sidepanel's relay list. The
// actual DOM fill happens in the platform content script (lib/relay/injectors)
// routed by the background worker; only after the content script confirms the
// fill does completeRelayInjection() ack the item on the desktop.
//
// Dedupe: the desktop re-offers every un-acked item on each poll, so the
// `after` cursor (highest id ever seen) plus the in-queue id set guarantee an
// item is never queued twice. Polls stay silent when the desktop is offline,
// unpaired, needs re-pairing, or lacks the "outbox" capability.

import type { RelayItem } from "../types"
import { logger } from "../utils/logger"
import {
  DesktopBridgeError,
  ackOutboxItems,
  fetchOutboxItems,
  getDesktopBridgeStatus,
  probeDesktopInfo,
  recordDesktopReachability,
} from "./desktopBridgeService"

const STORAGE_KEY = "vesti_relay_outbox"

export const RELAY_POLL_ALARM = "vesti-relay-poll"
/** Handoff poll cadence; short so a packet feels "pushed" to the browser. */
export const RELAY_POLL_PERIOD_MINUTES = 2

/** Retire resolved items (injected/dismissed) after a week. */
const RESOLVED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** Hard cap so a runaway desktop cannot grow the queue without bound. */
const MAX_QUEUED_ITEMS = 200

const BADGE_COLOR = "#D97706"

export interface RelayPollResult {
  added: number
  /** not_paired | needs_repair | offline | unsupported */
  skipped?: string
}

interface RelayQueueRecord {
  /** Highest outbox id ever seen — the exclusive `after` cursor. */
  lastSeenId: number
  items: RelayItem[]
}

const DEFAULT_QUEUE: RelayQueueRecord = { lastSeenId: 0, items: [] }

function getStorage() {
  if (!chrome?.storage?.local) {
    throw new Error("STORAGE_UNAVAILABLE")
  }
  return chrome.storage.local
}

function normalizeItem(input: unknown): RelayItem | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Partial<RelayItem>
  if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) return null
  if (typeof raw.prompt !== "string") return null
  const status =
    raw.status === "injected" || raw.status === "dismissed"
      ? raw.status
      : "pending"
  return {
    id: raw.id,
    prompt: raw.prompt,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    status,
    failReason: typeof raw.failReason === "string" ? raw.failReason : null,
    ...(raw.acked === true ? { acked: true } : {}),
  }
}

function normalizeQueue(input: unknown): RelayQueueRecord {
  if (!input || typeof input !== "object") return { ...DEFAULT_QUEUE }
  const raw = input as Partial<RelayQueueRecord>
  const items = Array.isArray(raw.items)
    ? raw.items
        .map(normalizeItem)
        .filter((item): item is RelayItem => item !== null)
    : []
  return {
    lastSeenId:
      typeof raw.lastSeenId === "number" && Number.isFinite(raw.lastSeenId)
        ? raw.lastSeenId
        : 0,
    items,
  }
}

async function readQueue(): Promise<RelayQueueRecord> {
  const storage = getStorage()
  return new Promise((resolve, reject) => {
    storage.get([STORAGE_KEY], (result: Record<string, unknown>) => {
      const err = chrome.runtime?.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve(normalizeQueue(result[STORAGE_KEY]))
    })
  })
}

async function writeQueue(queue: RelayQueueRecord): Promise<void> {
  const storage = getStorage()
  return new Promise((resolve, reject) => {
    storage.set({ [STORAGE_KEY]: queue }, () => {
      const err = chrome.runtime?.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve()
    })
  })
}

async function patchQueue(
  mutate: (queue: RelayQueueRecord) => RelayQueueRecord
): Promise<RelayQueueRecord> {
  const next = mutate(await readQueue())
  await writeQueue(next)
  return next
}

function countPending(items: RelayItem[]): number {
  return items.filter((item) => item.status === "pending").length
}

/** Drop resolved items past the retention window and cap the queue size. */
function pruneQueue(items: RelayItem[]): RelayItem[] {
  const now = Date.now()
  const kept = items.filter((item) => {
    if (item.status === "pending") return true
    const ts = item.createdAt ? Date.parse(item.createdAt) : NaN
    // Unparseable timestamps stay — a lost dedupe entry would re-queue.
    if (!Number.isFinite(ts)) return true
    return now - ts < RESOLVED_RETENTION_MS
  })
  if (kept.length <= MAX_QUEUED_ITEMS) return kept
  const pending = kept.filter((item) => item.status === "pending")
  const resolved = kept
    .filter((item) => item.status !== "pending")
    .sort((a, b) => b.id - a.id)
  return [...pending, ...resolved.slice(0, MAX_QUEUED_ITEMS - pending.length)]
}

/** Reflect the pending count on the toolbar action badge. */
export async function refreshRelayBadge(): Promise<void> {
  try {
    const queue = await readQueue()
    const pending = countPending(queue.items)
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
    await chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : "" })
  } catch {
    // chrome.action or storage unavailable (unlikely in the worker) — the
    // badge is a nicety, never worth surfacing an error for.
  }
}

/** Items the panel should list: everything still waiting for the user. */
export async function listPendingRelayItems(): Promise<RelayItem[]> {
  const queue = await readQueue()
  return queue.items
    .filter((item) => item.status === "pending")
    .sort((a, b) => a.id - b.id)
}

export async function getRelayItem(id: number): Promise<RelayItem | null> {
  const queue = await readQueue()
  return queue.items.find((item) => item.id === id) ?? null
}

/** User chose "ignore" — keep the entry for dedupe, hide it from the list. */
export async function dismissRelayItem(id: number): Promise<void> {
  await patchQueue((queue) => ({
    ...queue,
    items: queue.items.map((item) =>
      item.id === id && item.status === "pending"
        ? { ...item, status: "dismissed" as const, failReason: null }
        : item
    ),
  }))
  await refreshRelayBadge()
}

/**
 * An injection attempt failed (tab unreachable, composer not found, …). The
 * item stays pending with the reason recorded so the user can retry.
 */
export async function markRelayItemFailed(
  id: number,
  reason: string
): Promise<void> {
  await patchQueue((queue) => ({
    ...queue,
    items: queue.items.map((item) =>
      item.id === id && item.status === "pending"
        ? { ...item, failReason: reason }
        : item
    ),
  }))
}

/**
 * The content script confirmed the composer fill. Mark injected, then ack on
 * the desktop; when the ack fails (offline desktop) the item keeps acked=false
 * and the next successful poll retries it.
 */
export async function completeRelayInjection(id: number): Promise<RelayItem> {
  const queue = await patchQueue((current) => ({
    ...current,
    items: current.items.map((item) =>
      item.id === id
        ? { ...item, status: "injected" as const, failReason: null }
        : item
    ),
  }))
  await refreshRelayBadge()
  const updated = queue.items.find((item) => item.id === id)
  if (!updated) throw new Error("RELAY_ITEM_NOT_FOUND")
  await retryPendingAcks([id])
  return (await getRelayItem(id)) ?? updated
}

/** Best-effort ack for injected-but-unacked items; silent on any failure. */
async function retryPendingAcks(restrictToIds?: number[]): Promise<void> {
  try {
    const queue = await readQueue()
    const ids = queue.items
      .filter(
        (item) =>
          item.status === "injected" &&
          item.acked !== true &&
          (!restrictToIds || restrictToIds.includes(item.id))
      )
      .map((item) => item.id)
    if (ids.length === 0) return
    await ackOutboxItems(ids)
    await patchQueue((current) => ({
      ...current,
      items: current.items.map((item) =>
        ids.includes(item.id) ? { ...item, acked: true } : item
      ),
    }))
  } catch (error) {
    if (!(error instanceof DesktopBridgeError)) {
      logger.warn("service", "Relay ack retry failed", {
        error: (error as Error)?.message ?? String(error),
      })
    }
    // Desktop offline / token expired: stays acked=false, retried next poll.
  }
}

let pollInFlight = false

/**
 * Pull new handoff packets from the desktop. Never throws and never surfaces
 * UI state — every expected failure (offline, unpaired, no outbox capability)
 * is reported as a `skipped` reason instead.
 */
export async function pollRelayOutbox(reason: string): Promise<RelayPollResult> {
  if (pollInFlight) return { added: 0, skipped: "busy" }
  pollInFlight = true

  try {
    const bridge = await getDesktopBridgeStatus()
    if (!bridge.paired) return { added: 0, skipped: "not_paired" }
    if (bridge.needsRepair) return { added: 0, skipped: "needs_repair" }

    // Live-probe so a freshly upgraded desktop (or one that just went away)
    // is reflected in the recorded capabilities before we touch the outbox.
    let capabilities: string[]
    try {
      const info = await probeDesktopInfo()
      capabilities = info.capabilities
      await recordDesktopReachability(true, info.version, info.capabilities)
    } catch {
      return { added: 0, skipped: "offline" }
    }
    if (!capabilities.includes("outbox")) {
      return { added: 0, skipped: "unsupported" }
    }

    const queue = await readQueue()
    let fresh: Awaited<ReturnType<typeof fetchOutboxItems>>
    try {
      fresh = await fetchOutboxItems(queue.lastSeenId)
    } catch (error) {
      const code =
        error instanceof DesktopBridgeError ? error.code : "DESKTOP_OFFLINE"
      if (code === "TOKEN_EXPIRED") return { added: 0, skipped: "needs_repair" }
      if (code === "OUTBOX_UNSUPPORTED") return { added: 0, skipped: "unsupported" }
      return { added: 0, skipped: "offline" }
    }

    const knownIds = new Set(queue.items.map((item) => item.id))
    const additions: RelayItem[] = fresh
      .filter((item) => !knownIds.has(item.id))
      .map((item) => ({
        id: item.id,
        prompt: item.prompt,
        createdAt: item.createdAt,
        status: "pending" as const,
        failReason: null,
      }))
    const maxSeenId = fresh.reduce(
      (max, item) => Math.max(max, item.id),
      queue.lastSeenId
    )

    await writeQueue({
      lastSeenId: maxSeenId,
      items: pruneQueue([...queue.items, ...additions]),
    })
    if (additions.length > 0) {
      logger.info("service", "Relay handoff packets queued", {
        reason,
        added: additions.length,
      })
    }
    await refreshRelayBadge()
    // Piggyback: confirm any earlier injections the desktop never acked.
    await retryPendingAcks()
    return { added: additions.length }
  } catch (error) {
    logger.warn("service", "Relay outbox poll failed", {
      reason,
      error: (error as Error)?.message ?? String(error),
    })
    return { added: 0, skipped: "offline" }
  } finally {
    pollInFlight = false
  }
}

/** Drop the whole queue (e.g. the user disconnected the desktop). */
export async function clearRelayQueue(): Promise<void> {
  await writeQueue({ ...DEFAULT_QUEUE })
  await refreshRelayBadge()
}
