// VESTI Desktop bridge — Bridge Protocol v1.2 client (TOFU auto-connect).
//
// The companion desktop app (VESTI-APP) serves a tiny local HTTP API on
// http://127.0.0.1:28765 so the extension can push the captured library to it:
//   GET  /v1/status  → 200 {app:"vesti-desktop", version, protocol:1,
//                           capabilities?:["pair","import","outbox","associate"],
//                           pairing_window?:"open"|"closed"}          (v1.2)
//   POST /v1/pair    body {code, client:"vesti-extension", clientId}
//                    → 200 {token} | 401 (invalid/expired code)
//   POST /v1/associate body {client, clientId}                        (v1.2)
//                    → 200 {token} | 403 {error:"association_rejected"|"association_timeout"}
//                      | 409 {error:"pairing_window_closed"|"associate_busy"}
//                      | 429 {error:"rate_limited"}
//                      The request hangs up to 60s server-side while the user
//                      confirms in the desktop app.
//   POST /v1/import  Authorization: Bearer <token>
//                    body {format:"vesti_export.v1", since?: ISO, data: bundle}
//                    → 200 {conversations, messages, cursor} | 401 | 400
//   GET  /v1/outbox?after=<id>   Authorization: Bearer <token>
//                    → 200 {items:[{id, prompt, createdAt}]} | 401
//   POST /v1/outbox/ack          Authorization: Bearer <token>
//                    body {ids:[...]} → 200 {acked:n} | 401
//
// Auto-connect state machine (see autoConnectDesktop): when unpaired and the
// desktop reports the "associate" capability with an open pairing window, the
// extension associates silently and waits for the one-tap confirmation in the
// desktop app — no pairing code needed. A rejection starts a local cooldown
// so the app is never spammed; an explicit user disconnect suppresses
// auto-connect until the user reconnects from the settings card. A 401 from
// import/outbox drops the token and the next discovery tick re-associates
// automatically (no manual re-pairing). The 6-digit code flow stays as the
// fallback for desktops without the "associate" capability.
//
// Pairing state (token + clientId + sync cursor) lives in chrome.storage.local.
// The bearer token never leaves this module: the sidepanel only receives the
// sanitised DesktopBridgeStatus snapshot. Sync runs inside the background
// service worker (Dexie lives there); failures are recorded on the state and
// otherwise silent — an offline desktop must never interrupt the user.

import type { DesktopBridgeStatus } from "../types"
import { exportAllDataAsJson, exportIncrementalDataAsJson } from "../db/repository"
import { logger } from "../utils/logger"

const BRIDGE_BASE_URL = "http://127.0.0.1:28765"
const BRIDGE_PROTOCOL = 1
const BRIDGE_CLIENT = "vesti-extension"
const STORAGE_KEY = "vesti_desktop_bridge"

const STATUS_TIMEOUT_MS = 3000
const PAIR_TIMEOUT_MS = 8000
const IMPORT_TIMEOUT_MS = 120000
const OUTBOX_TIMEOUT_MS = 8000
/** Slightly above the server's 60s confirm hang so a timeout always comes back as 403. */
const ASSOCIATE_TIMEOUT_MS = 70000
/** Local silence period after the user declined the association in the app. */
const ASSOCIATION_REJECT_COOLDOWN_MS = 10 * 60 * 1000
/**
 * Bounded busy retries, inside the server's 3-attempts/minute rate limit:
 * 1 initial + up to 2 backoff retries.
 */
const ASSOCIATE_BUSY_MAX_ATTEMPTS = 3
const ASSOCIATE_BUSY_BACKOFF_MS = [2000, 5000]

export const DESKTOP_SYNC_ALARM = "vesti-desktop-sync"
/** Daily incremental sync cadence. */
export const DESKTOP_SYNC_PERIOD_MINUTES = 24 * 60

export const DESKTOP_DISCOVER_ALARM = "vesti-desktop-discover"
/** Desktop discovery / auto-associate cadence. */
export const DESKTOP_DISCOVER_PERIOD_MINUTES = 3

export type DesktopBridgeErrorCode =
  | "DESKTOP_OFFLINE"
  | "DESKTOP_INCOMPATIBLE"
  | "PAIR_CODE_INVALID"
  | "PAIR_FAILED"
  | "NOT_PAIRED"
  | "TOKEN_EXPIRED"
  | "IMPORT_REJECTED"
  | "IMPORT_FAILED"
  | "OUTBOX_UNSUPPORTED"

export class DesktopBridgeError extends Error {
  code: DesktopBridgeErrorCode

  constructor(code: DesktopBridgeErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
  }
}

/** Persisted record — the token field must never be sent to extension pages. */
interface DesktopBridgeRecord {
  clientId: string | null
  token: string | null
  pairedAt: number | null
  needsRepair: boolean
  syncing: boolean
  /** Server cursor (ISO string) from the last accepted /v1/import. */
  lastSyncCursor: string | null
  /** Cursor parsed to epoch ms; drives the incremental `since` filter. */
  lastSyncAt: number | null
  lastSyncConversations: number | null
  lastSyncMessages: number | null
  lastError: string | null
  online: boolean | null
  desktopVersion: string | null
  /** Capability flags from /v1/status (v1.1+); [] until probed. */
  capabilities: string[]
  /** Pairing window from /v1/status (v1.2+); null until probed / unsupported. */
  pairingWindow: "open" | "closed" | null
  /** An /v1/associate request is in flight, awaiting the in-app confirmation. */
  associating: boolean
  /** Local cooldown after a rejected association (epoch ms); null = none. */
  associationRejectedUntil: number | null
  /**
   * Set when an association timed out unanswered: auto-associate stays off
   * (no repeated app popups) until the user retries manually or the pairing
   * window is reopened (closed → open transition).
   */
  associationAutoRetryBlocked: boolean
  /**
   * Set when the user explicitly disconnects: auto-connect stays off until
   * they reconnect from the settings card (manual pair, associate retry, or
   * a successful association clears it).
   */
  autoConnectSuppressed: boolean
}

const DEFAULT_RECORD: DesktopBridgeRecord = {
  clientId: null,
  token: null,
  pairedAt: null,
  needsRepair: false,
  syncing: false,
  lastSyncCursor: null,
  lastSyncAt: null,
  lastSyncConversations: null,
  lastSyncMessages: null,
  lastError: null,
  online: null,
  desktopVersion: null,
  capabilities: [],
  pairingWindow: null,
  associating: false,
  associationRejectedUntil: null,
  associationAutoRetryBlocked: false,
  autoConnectSuppressed: false,
}

export interface DesktopSyncResult {
  synced: boolean
  /** Why nothing was pushed: not_paired | needs_repair | busy | offline */
  skipped?: string
  conversations?: number
  messages?: number
  full: boolean
}

function getStorage() {
  if (!chrome?.storage?.local) {
    throw new Error("STORAGE_UNAVAILABLE")
  }
  return chrome.storage.local
}

function normalizeRecord(input: unknown): DesktopBridgeRecord {
  if (!input || typeof input !== "object") return { ...DEFAULT_RECORD }
  const raw = input as Partial<DesktopBridgeRecord>
  return {
    clientId: typeof raw.clientId === "string" ? raw.clientId : null,
    token: typeof raw.token === "string" ? raw.token : null,
    pairedAt: typeof raw.pairedAt === "number" ? raw.pairedAt : null,
    needsRepair: raw.needsRepair === true,
    syncing: raw.syncing === true,
    lastSyncCursor:
      typeof raw.lastSyncCursor === "string" ? raw.lastSyncCursor : null,
    lastSyncAt: typeof raw.lastSyncAt === "number" ? raw.lastSyncAt : null,
    lastSyncConversations:
      typeof raw.lastSyncConversations === "number"
        ? raw.lastSyncConversations
        : null,
    lastSyncMessages:
      typeof raw.lastSyncMessages === "number" ? raw.lastSyncMessages : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    online:
      typeof raw.online === "boolean" ? raw.online : (null as boolean | null),
    desktopVersion:
      typeof raw.desktopVersion === "string" ? raw.desktopVersion : null,
    capabilities: Array.isArray(raw.capabilities)
      ? raw.capabilities.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : [],
    pairingWindow:
      raw.pairingWindow === "open" || raw.pairingWindow === "closed"
        ? raw.pairingWindow
        : null,
    associating: raw.associating === true,
    associationRejectedUntil:
      typeof raw.associationRejectedUntil === "number"
        ? raw.associationRejectedUntil
        : null,
    associationAutoRetryBlocked: raw.associationAutoRetryBlocked === true,
    autoConnectSuppressed: raw.autoConnectSuppressed === true,
  }
}

async function readRecord(): Promise<DesktopBridgeRecord> {
  const storage = getStorage()
  return new Promise((resolve, reject) => {
    storage.get([STORAGE_KEY], (result: Record<string, unknown>) => {
      const err = chrome.runtime?.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve(normalizeRecord(result[STORAGE_KEY]))
    })
  })
}

async function writeRecord(record: DesktopBridgeRecord): Promise<void> {
  const storage = getStorage()
  return new Promise((resolve, reject) => {
    storage.set({ [STORAGE_KEY]: record }, () => {
      const err = chrome.runtime?.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve()
    })
  })
}

async function patchRecord(
  patch: Partial<DesktopBridgeRecord>
): Promise<DesktopBridgeRecord> {
  const next = { ...(await readRecord()), ...patch }
  await writeRecord(next)
  return next
}

/** Sanitised snapshot for extension pages (never includes the token). */
export function toDesktopBridgeStatus(
  record: DesktopBridgeRecord
): DesktopBridgeStatus {
  return {
    paired: !!record.token,
    clientId: record.clientId,
    pairedAt: record.pairedAt,
    online: record.online,
    desktopVersion: record.desktopVersion,
    needsRepair: record.needsRepair,
    syncing: record.syncing,
    lastSyncAt: record.lastSyncAt,
    lastSyncConversations: record.lastSyncConversations,
    lastSyncMessages: record.lastSyncMessages,
    lastError: record.lastError,
    capabilities: [...record.capabilities],
    pairingWindow: record.pairingWindow,
    associating: record.associating,
    associationRejectedUntil: record.associationRejectedUntil,
    autoConnectSuppressed: record.autoConnectSuppressed,
  }
}

export async function getDesktopBridgeStatus(): Promise<DesktopBridgeStatus> {
  return toDesktopBridgeStatus(await readRecord())
}

/** Record the outcome of a /v1/status probe so the UI can show offline state. */
export async function recordDesktopReachability(
  online: boolean,
  version: string | null,
  capabilities?: string[] | null,
  pairingWindow?: "open" | "closed" | null
): Promise<DesktopBridgeStatus> {
  return toDesktopBridgeStatus(
    await patchRecord({
      online,
      desktopVersion: version,
      ...(capabilities ? { capabilities } : {}),
      ...(pairingWindow !== undefined ? { pairingWindow } : {}),
    })
  )
}

/**
 * Clear leftover `syncing` / `associating` flags at worker start: the MV3
 * service worker can be killed mid-sync or mid-associate, and the persisted
 * flags would otherwise stick forever (the UI would show "syncing"/"waiting
 * for confirmation" with nothing actually running).
 */
export async function clearStaleDesktopSyncFlag(): Promise<void> {
  const record = await readRecord()
  if (record.syncing || record.associating) {
    await patchRecord({ syncing: false, associating: false })
  }
}

async function ensureClientId(record: DesktopBridgeRecord): Promise<string> {
  if (record.clientId) return record.clientId
  const clientId = crypto.randomUUID()
  await writeRecord({ ...record, clientId })
  return clientId
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

interface BridgeStatusResponse {
  app?: string
  version?: string
  protocol?: number
  capabilities?: string[]
  /** Bridge Protocol v1.2+: whether the app accepts /v1/associate right now. */
  pairing_window?: string
}

export interface DesktopProbeInfo {
  version: string
  capabilities: string[]
  /** v1.2+; null when the desktop predates the field. */
  pairingWindow: "open" | "closed" | null
}

/**
 * GET /v1/status — resolves with version + capability flags (v1.1) and the
 * pairing window (v1.2), throws when the desktop is offline or speaks an
 * incompatible protocol.
 */
export async function probeDesktopInfo(): Promise<DesktopProbeInfo> {
  let res: Response
  try {
    res = await fetchWithTimeout(
      `${BRIDGE_BASE_URL}/v1/status`,
      { headers: { Accept: "application/json" } },
      STATUS_TIMEOUT_MS
    )
  } catch {
    throw new DesktopBridgeError("DESKTOP_OFFLINE")
  }
  if (!res.ok) throw new DesktopBridgeError("DESKTOP_OFFLINE", `status ${res.status}`)
  const data = (await res.json().catch(() => null)) as BridgeStatusResponse | null
  if (data?.app !== "vesti-desktop" || data?.protocol !== BRIDGE_PROTOCOL) {
    throw new DesktopBridgeError("DESKTOP_INCOMPATIBLE")
  }
  return {
    version: typeof data.version === "string" ? data.version : "unknown",
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : [],
    pairingWindow:
      data.pairing_window === "open" || data.pairing_window === "closed"
        ? data.pairing_window
        : null,
  }
}

/** GET /v1/status — resolves with the desktop version, throws when offline. */
export async function probeDesktop(): Promise<string> {
  return (await probeDesktopInfo()).version
}

/**
 * Full pairing flow: probe → POST /v1/pair → persist token. Throws
 * DesktopBridgeError with a UI-mappable code on any failure.
 */
export async function pairWithDesktop(code: string): Promise<DesktopBridgeStatus> {
  const trimmed = String(code ?? "").trim()
  if (!trimmed) throw new DesktopBridgeError("PAIR_CODE_INVALID")

  const probe = await probeDesktopInfo()
  const record = await readRecord()
  const clientId = await ensureClientId(record)

  let res: Response
  try {
    res = await fetchWithTimeout(
      `${BRIDGE_BASE_URL}/v1/pair`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ code: trimmed, client: BRIDGE_CLIENT, clientId }),
      },
      PAIR_TIMEOUT_MS
    )
  } catch {
    throw new DesktopBridgeError("DESKTOP_OFFLINE")
  }
  if (res.status === 401) throw new DesktopBridgeError("PAIR_CODE_INVALID")
  if (!res.ok) throw new DesktopBridgeError("PAIR_FAILED", `status ${res.status}`)

  const data = (await res.json().catch(() => null)) as { token?: string } | null
  if (!data?.token) throw new DesktopBridgeError("PAIR_FAILED", "no_token")

  const next = await patchRecord({
    token: data.token,
    pairedAt: Date.now(),
    needsRepair: false,
    online: true,
    desktopVersion: probe.version,
    capabilities: probe.capabilities,
    pairingWindow: probe.pairingWindow,
    associating: false,
    associationRejectedUntil: null,
    associationAutoRetryBlocked: false,
    autoConnectSuppressed: false,
    lastError: null,
  })
  logger.info("service", "Paired with VESTI desktop", {
    clientId,
    version: probe.version,
    capabilities: probe.capabilities,
  })
  return toDesktopBridgeStatus(next)
}

export async function disconnectDesktop(): Promise<DesktopBridgeStatus> {
  const record = await readRecord()
  const next: DesktopBridgeRecord = {
    ...DEFAULT_RECORD,
    clientId: record.clientId,
    online: record.online,
    desktopVersion: record.desktopVersion,
    pairingWindow: record.pairingWindow,
    capabilities: record.capabilities,
    // An explicit disconnect is a user decision: do not let the next
    // discovery tick silently re-associate (and re-pop the app dialog).
    autoConnectSuppressed: true,
  }
  await writeRecord(next)
  logger.info("service", "Disconnected from VESTI desktop")
  return toDesktopBridgeStatus(next)
}

// ---- Auto-connect (Bridge Protocol v1.2: one-tap TOFU associate) ----------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Error code from a non-2xx bridge response body ({error:"<code>"}). */
async function readBridgeErrorCode(res: Response): Promise<string | null> {
  const data = (await res
    .json()
    .catch(() => null)) as { error?: unknown } | null
  return typeof data?.error === "string" && data.error ? data.error : null
}

export interface DesktopAutoConnectResult {
  state: DesktopBridgeStatus
  /** True only when this run completed an association (caller kicks off the initial sync). */
  associated: boolean
  /** Why nothing happened: busy | offline | paired | suppressed |
   *  associate_unsupported | rejected_cooldown | window_closed |
   *  associate_rejected | associate_timeout | associate_busy | rate_limited | failed */
  skipped?: string
}

let autoConnectInFlight = false

/**
 * Discovery + auto-associate tick (alarm / startup / install / UI poll).
 *
 *   probe status ── offline → record online:false, stay silent
 *      │
 *      ├─ paired (valid token) → refresh reachability, done
 *      ├─ token + legacy needsRepair → drop token, fall through to re-associate
 *      ├─ autoConnectSuppressed (user disconnected) → wait for manual action
 *      ├─ no "associate" capability → manual pairing-code flow only
 *      ├─ reject cooldown running → stay silent until it expires
 *      ├─ pairing_window ≠ open → show "open the window in the app" state
 *      └─ POST /v1/associate (hangs ≤60s server-side for the in-app confirm)
 *           200 → persist token, caller starts the initial full sync
 *           403 association_rejected → 10-minute local cooldown
 *           403 association_timeout → back to "waiting", manual retry only
 *           409 pairing_window_closed → keep polling status, no auto retry
 *           409 associate_busy → bounded exponential backoff (≤3 attempts)
 *           429 rate_limited → back off; the next tick retries minutes later
 *
 * Never throws: every outcome lands on the record so the UI can render it.
 */
export async function autoConnectDesktop(
  reason: string
): Promise<DesktopAutoConnectResult> {
  if (autoConnectInFlight) {
    return {
      state: toDesktopBridgeStatus(await readRecord()),
      associated: false,
      skipped: "busy",
    }
  }
  autoConnectInFlight = true

  try {
    let record = await readRecord()

    let probe: DesktopProbeInfo
    try {
      probe = await probeDesktopInfo()
    } catch {
      if (record.online !== false || record.pairingWindow !== null) {
        record = await patchRecord({
          online: false,
          pairingWindow: null,
          associating: false,
        })
      }
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "offline",
      }
    }

    // A freshly (re)opened pairing window re-arms auto-association after a
    // previous attempt timed out unanswered.
    const windowReopened =
      probe.pairingWindow === "open" &&
      record.pairingWindow !== null &&
      record.pairingWindow !== "open" &&
      record.associationAutoRetryBlocked

    record = await patchRecord({
      online: true,
      desktopVersion: probe.version,
      capabilities: probe.capabilities,
      pairingWindow: probe.pairingWindow,
      ...(windowReopened ? { associationAutoRetryBlocked: false } : {}),
    })

    // v1.1 leftover: a token the desktop once rejected (401 → needsRepair).
    // Repair is automatic now — drop the dead token and re-associate below.
    if (record.token && record.needsRepair) {
      logger.warn("service", "Dropping rejected desktop token; will re-associate", {
        reason,
      })
      record = await patchRecord({
        token: null,
        needsRepair: false,
        lastError: "TOKEN_EXPIRED",
      })
    }
    if (record.token) {
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "paired",
      }
    }

    // Unpaired from here on.
    if (record.autoConnectSuppressed) {
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "suppressed",
      }
    }
    if (!probe.capabilities.includes("associate")) {
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "associate_unsupported",
      }
    }
    if (
      record.associationRejectedUntil !== null &&
      record.associationRejectedUntil > Date.now()
    ) {
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "rejected_cooldown",
      }
    }
    if (probe.pairingWindow !== "open") {
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "window_closed",
      }
    }
    if (record.associationAutoRetryBlocked) {
      // The last attempt timed out unanswered: re-popping the app dialog on
      // every poll would be harassment — wait for a manual retry or a
      // reopened pairing window instead.
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "associate_timeout",
      }
    }

    const clientId = await ensureClientId(record)
    record = await patchRecord({ associating: true })

    for (let attempt = 1; ; attempt++) {
      let res: Response
      try {
        res = await fetchWithTimeout(
          `${BRIDGE_BASE_URL}/v1/associate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ client: BRIDGE_CLIENT, clientId }),
          },
          ASSOCIATE_TIMEOUT_MS
        )
      } catch {
        // Our 70s abort or the desktop went away mid-confirm: stay silent,
        // the next tick retries (a still-pending server request answers the
        // retry with associate_busy, handled below).
        record = await patchRecord({ associating: false })
        return {
          state: toDesktopBridgeStatus(record),
          associated: false,
          skipped: "offline",
        }
      }

      if (res.ok) {
        const data = (await res
          .json()
          .catch(() => null)) as { token?: string } | null
        if (!data?.token) {
          record = await patchRecord({ associating: false })
          return {
            state: toDesktopBridgeStatus(record),
            associated: false,
            skipped: "failed",
          }
        }
        record = await patchRecord({
          token: data.token,
          pairedAt: Date.now(),
          needsRepair: false,
          associating: false,
          associationRejectedUntil: null,
          associationAutoRetryBlocked: false,
          autoConnectSuppressed: false,
          lastError: null,
        })
        logger.info("service", "Associated with VESTI desktop (one-tap TOFU)", {
          reason,
          clientId,
        })
        return { state: toDesktopBridgeStatus(record), associated: true }
      }

      if (res.status === 403) {
        const code = await readBridgeErrorCode(res)
        if (code === "association_rejected") {
          record = await patchRecord({
            associating: false,
            associationRejectedUntil:
              Date.now() + ASSOCIATION_REJECT_COOLDOWN_MS,
          })
          logger.info("service", "Association declined in the desktop app", {
            reason,
          })
          return {
            state: toDesktopBridgeStatus(record),
            associated: false,
            skipped: "associate_rejected",
          }
        }
        // association_timeout (or an unrecognised 403): the user simply did
        // not respond — return to "waiting for confirmation" and let them
        // retry manually instead of re-popping the app dialog.
        record = await patchRecord({
          associating: false,
          associationAutoRetryBlocked: true,
        })
        return {
          state: toDesktopBridgeStatus(record),
          associated: false,
          skipped: "associate_timeout",
        }
      }

      if (res.status === 409) {
        const code = await readBridgeErrorCode(res)
        if (code === "associate_busy" && attempt < ASSOCIATE_BUSY_MAX_ATTEMPTS) {
          await delay(
            ASSOCIATE_BUSY_BACKOFF_MS[attempt - 1] ??
              ASSOCIATE_BUSY_BACKOFF_MS[ASSOCIATE_BUSY_BACKOFF_MS.length - 1]
          )
          continue
        }
        record = await patchRecord({
          associating: false,
          ...(code === "pairing_window_closed"
            ? { pairingWindow: "closed" as const }
            : {}),
        })
        return {
          state: toDesktopBridgeStatus(record),
          associated: false,
          skipped: code === "pairing_window_closed" ? "window_closed" : "associate_busy",
        }
      }

      if (res.status === 429) {
        // Server rate limit (3 attempts/minute per clientId): stop now, the
        // next discovery tick (minutes later) is well outside the window.
        record = await patchRecord({ associating: false })
        logger.warn("service", "Association rate-limited by the desktop", {
          reason,
        })
        return {
          state: toDesktopBridgeStatus(record),
          associated: false,
          skipped: "rate_limited",
        }
      }

      record = await patchRecord({ associating: false })
      logger.warn("service", "Association failed", {
        reason,
        status: res.status,
      })
      return {
        state: toDesktopBridgeStatus(record),
        associated: false,
        skipped: "failed",
      }
    }
  } finally {
    autoConnectInFlight = false
  }
}

/**
 * Manual re-entry into auto-connect after the user explicitly disconnected
 * (or wants to retry a declined/timed-out association): clears the local
 * suppression + cooldown, then runs a discovery tick right away.
 */
export async function resumeDesktopAutoConnect(
  reason: string
): Promise<DesktopAutoConnectResult> {
  await patchRecord({
    autoConnectSuppressed: false,
    associationRejectedUntil: null,
    associationAutoRetryBlocked: false,
  })
  return autoConnectDesktop(reason)
}

interface ImportResponse {
  conversations?: number
  messages?: number
  cursor?: string
}

let syncInFlight = false

/**
 * Push the library to the desktop. `full` forces a complete export; otherwise
 * only conversations captured after the stored cursor are sent. Failures keep
 * the cursor untouched so the next run retries the same slice; a 401 drops
 * the token so the next discovery tick re-associates automatically.
 */
export async function syncWithDesktop(options: {
  full?: boolean
  reason: string
}): Promise<DesktopSyncResult> {
  if (syncInFlight) return { synced: false, skipped: "busy", full: false }
  syncInFlight = true

  try {
    const record = await readRecord()
    if (!record.token) return { synced: false, skipped: "not_paired", full: false }
    if (record.needsRepair && !options.full) {
      return { synced: false, skipped: "needs_repair", full: false }
    }

    const full = options.full === true || record.lastSyncAt === null
    const sinceMs = full ? null : record.lastSyncAt
    await patchRecord({ syncing: true })

    let bundle: string
    try {
      bundle = full
        ? await exportAllDataAsJson()
        : await exportIncrementalDataAsJson(sinceMs as number)
    } catch (error) {
      await patchRecord({ syncing: false, lastError: "IMPORT_FAILED" })
      throw new DesktopBridgeError(
        "IMPORT_FAILED",
        (error as Error)?.message ?? "export_failed"
      )
    }

    let res: Response
    try {
      res = await fetchWithTimeout(
        `${BRIDGE_BASE_URL}/v1/import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${record.token}`,
          },
          body: JSON.stringify({
            format: "vesti_export.v1",
            ...(sinceMs !== null ? { since: new Date(sinceMs).toISOString() } : {}),
            data: JSON.parse(bundle),
          }),
        },
        IMPORT_TIMEOUT_MS
      )
    } catch {
      // Desktop went away mid-sync (or never came up): stay silent, keep the
      // cursor so the same slice is retried next time.
      await patchRecord({ syncing: false, online: false, lastError: "DESKTOP_OFFLINE" })
      return { synced: false, skipped: "offline", full }
    }

    if (res.status === 401) {
      // Token rejected (rotated/revoked app-side): drop it and let the next
      // discovery tick re-associate automatically — no manual re-pairing.
      await patchRecord({
        syncing: false,
        token: null,
        needsRepair: false,
        lastError: "TOKEN_EXPIRED",
      })
      logger.warn(
        "service",
        "Desktop rejected the token; auto re-association will recover"
      )
      return { synced: false, skipped: "needs_repair", full }
    }
    if (res.status === 400) {
      await patchRecord({ syncing: false, lastError: "IMPORT_REJECTED" })
      logger.warn("service", "Desktop rejected the import payload (400)")
      return { synced: false, skipped: "rejected", full }
    }
    if (!res.ok) {
      await patchRecord({ syncing: false, lastError: "IMPORT_FAILED" })
      logger.warn("service", "Desktop import failed", { status: res.status })
      return { synced: false, skipped: "failed", full }
    }

    const data = (await res.json().catch(() => null)) as ImportResponse | null
    const cursor = typeof data?.cursor === "string" ? data.cursor : null
    const cursorMs = cursor ? Date.parse(cursor) : NaN
    const syncedAt = Number.isFinite(cursorMs) ? cursorMs : Date.now()

    await patchRecord({
      syncing: false,
      online: true,
      needsRepair: false,
      lastSyncCursor: cursor,
      lastSyncAt: syncedAt,
      lastSyncConversations:
        typeof data?.conversations === "number" ? data.conversations : null,
      lastSyncMessages: typeof data?.messages === "number" ? data.messages : null,
      lastError: null,
    })
    logger.info("service", "Desktop sync completed", {
      reason: options.reason,
      full,
      conversations: data?.conversations ?? 0,
      messages: data?.messages ?? 0,
    })
    return {
      synced: true,
      full,
      conversations: data?.conversations ?? 0,
      messages: data?.messages ?? 0,
    }
  } finally {
    syncInFlight = false
  }
}

// ---- Outbox (Bridge Protocol v1.1: desktop → extension handoff packets) ----

export interface DesktopOutboxItem {
  id: number
  prompt: string
  createdAt: string | null
}

interface OutboxResponse {
  items?: Array<{ id?: unknown; prompt?: unknown; createdAt?: unknown }>
}

function normalizeOutboxItems(data: OutboxResponse | null): DesktopOutboxItem[] {
  if (!Array.isArray(data?.items)) return []
  const items: DesktopOutboxItem[] = []
  for (const raw of data.items) {
    if (typeof raw?.id !== "number" || !Number.isFinite(raw.id)) continue
    if (typeof raw.prompt !== "string" || raw.prompt.length === 0) continue
    items.push({
      id: raw.id,
      prompt: raw.prompt,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    })
  }
  return items
}

/**
 * GET /v1/outbox?after=<id> — `after` is an exclusive cursor; null fetches
 * everything. A 401 drops the token for automatic re-association (same
 * contract as /v1/import); a 404 means the desktop predates the outbox
 * capability.
 */
export async function fetchOutboxItems(
  after: number | null
): Promise<DesktopOutboxItem[]> {
  const record = await readRecord()
  if (!record.token) throw new DesktopBridgeError("NOT_PAIRED")

  const url =
    after !== null && after > 0
      ? `${BRIDGE_BASE_URL}/v1/outbox?after=${after}`
      : `${BRIDGE_BASE_URL}/v1/outbox`

  let res: Response
  try {
    res = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${record.token}`,
        },
      },
      OUTBOX_TIMEOUT_MS
    )
  } catch {
    throw new DesktopBridgeError("DESKTOP_OFFLINE")
  }
  if (res.status === 401) {
    await patchRecord({
      token: null,
      needsRepair: false,
      lastError: "TOKEN_EXPIRED",
    })
    throw new DesktopBridgeError("TOKEN_EXPIRED")
  }
  if (res.status === 404) throw new DesktopBridgeError("OUTBOX_UNSUPPORTED")
  if (!res.ok) {
    throw new DesktopBridgeError("DESKTOP_OFFLINE", `status ${res.status}`)
  }
  const data = (await res.json().catch(() => null)) as OutboxResponse | null
  return normalizeOutboxItems(data)
}

/**
 * POST /v1/outbox/ack — confirm handoff packets the user has injected. The
 * desktop keeps re-offering un-acked items, so this is what retires them.
 */
export async function ackOutboxItems(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0
  const record = await readRecord()
  if (!record.token) throw new DesktopBridgeError("NOT_PAIRED")

  let res: Response
  try {
    res = await fetchWithTimeout(
      `${BRIDGE_BASE_URL}/v1/outbox/ack`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${record.token}`,
        },
        body: JSON.stringify({ ids }),
      },
      OUTBOX_TIMEOUT_MS
    )
  } catch {
    throw new DesktopBridgeError("DESKTOP_OFFLINE")
  }
  if (res.status === 401) {
    await patchRecord({
      token: null,
      needsRepair: false,
      lastError: "TOKEN_EXPIRED",
    })
    throw new DesktopBridgeError("TOKEN_EXPIRED")
  }
  if (res.status === 404) throw new DesktopBridgeError("OUTBOX_UNSUPPORTED")
  if (!res.ok) {
    throw new DesktopBridgeError("DESKTOP_OFFLINE", `status ${res.status}`)
  }
  const data = (await res.json().catch(() => null)) as { acked?: unknown } | null
  return typeof data?.acked === "number" ? data.acked : ids.length
}
