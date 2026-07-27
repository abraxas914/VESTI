export type CapsuleAnchor = "bottom_right" | "bottom_left"
export type CapsuleViewMode = "collapsed" | "expanded"

export interface CapsuleSettings {
  enabled: boolean
  defaultView: CapsuleViewMode
  autoCollapseMs: number
  anchor: CapsuleAnchor
  offsetX: number
  offsetY: number
  draggable: boolean
  hiddenHosts: string[]
}

interface CapsuleSettingsStore {
  global: CapsuleSettings
  hosts: Record<string, CapsuleSettings>
}

const STORAGE_KEY = "vesti_capsule_settings"
const DEFAULT_AUTO_COLLAPSE_MS = 2000
const MAX_AUTO_COLLAPSE_MS = 10000
const MAX_OFFSET = 100000

export const DEFAULT_CAPSULE_SETTINGS: CapsuleSettings = {
  enabled: true,
  defaultView: "collapsed",
  autoCollapseMs: DEFAULT_AUTO_COLLAPSE_MS,
  anchor: "bottom_right",
  offsetX: 24,
  offsetY: 100,
  draggable: true,
  hiddenHosts: []
}

function resolveStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null
  return chrome.storage.local
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function normalizeViewMode(
  value: unknown,
  fallback: CapsuleViewMode
): CapsuleViewMode {
  return value === "expanded" ? "expanded" : fallback
}

function normalizeAnchor(
  value: unknown,
  fallback: CapsuleAnchor
): CapsuleAnchor {
  return value === "bottom_left" ? "bottom_left" : fallback
}

function normalizeOffset(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_OFFSET, Math.max(0, Math.round(parsed)))
}

function normalizeAutoCollapseMs(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_AUTO_COLLAPSE_MS, Math.max(0, Math.round(parsed)))
}

function normalizeHiddenHosts(value: unknown): string[] {
  const source = Array.isArray(value) ? value : []
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const item of source) {
    const normalized = String(item ?? "")
      .trim()
      .toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(normalized)
  }
  return deduped
}

function normalizeHost(hostname: string): string {
  return String(hostname ?? "")
    .trim()
    .toLowerCase()
}

function mergeSettings(base: CapsuleSettings, draft: unknown): CapsuleSettings {
  const value =
    draft && typeof draft === "object"
      ? (draft as Partial<CapsuleSettings>)
      : undefined

  return {
    enabled: normalizeBoolean(value?.enabled, base.enabled),
    defaultView: normalizeViewMode(value?.defaultView, base.defaultView),
    autoCollapseMs: normalizeAutoCollapseMs(
      value?.autoCollapseMs,
      base.autoCollapseMs
    ),
    anchor: normalizeAnchor(value?.anchor, base.anchor),
    offsetX: normalizeOffset(value?.offsetX, base.offsetX),
    offsetY: normalizeOffset(value?.offsetY, base.offsetY),
    draggable: normalizeBoolean(value?.draggable, base.draggable),
    hiddenHosts: normalizeHiddenHosts(value?.hiddenHosts ?? base.hiddenHosts)
  }
}

function normalizeStore(value: unknown): CapsuleSettingsStore {
  const raw =
    value && typeof value === "object"
      ? (value as {
          global?: unknown
          hosts?: Record<string, unknown>
        })
      : undefined

  const globalCandidate = raw && "global" in raw ? raw.global : raw
  const global = mergeSettings(DEFAULT_CAPSULE_SETTINGS, globalCandidate)

  const hosts: Record<string, CapsuleSettings> = {}
  const rawHosts = raw?.hosts && typeof raw.hosts === "object" ? raw.hosts : {}

  for (const [hostKey, hostValue] of Object.entries(rawHosts)) {
    const normalizedHost = normalizeHost(hostKey)
    if (!normalizedHost) continue
    hosts[normalizedHost] = mergeSettings(global, hostValue)
  }

  return { global, hosts }
}

async function readStore(): Promise<CapsuleSettingsStore> {
  const storage = resolveStorageArea()
  if (!storage) return { global: DEFAULT_CAPSULE_SETTINGS, hosts: {} }

  return new Promise((resolve, reject) => {
    storage.get([STORAGE_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(normalizeStore(result?.[STORAGE_KEY]))
    })
  })
}

async function writeStore(store: CapsuleSettingsStore): Promise<void> {
  const storage = resolveStorageArea()
  if (!storage) return

  return new Promise((resolve, reject) => {
    storage.set({ [STORAGE_KEY]: store }, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve()
    })
  })
}

export async function getGlobalCapsuleSettings(): Promise<CapsuleSettings> {
  const store = await readStore()
  return mergeSettings(DEFAULT_CAPSULE_SETTINGS, store.global)
}

export async function updateGlobalCapsuleSettings(
  patch: Partial<CapsuleSettings>
): Promise<CapsuleSettings> {
  const store = await readStore()
  const next = mergeSettings(store.global, patch)
  await writeStore({ ...store, global: next })
  return next
}

export async function getCapsuleSettingsForHost(
  hostname: string
): Promise<CapsuleSettings> {
  const normalizedHost = normalizeHost(hostname)
  const store = await readStore()
  const hostSettings = normalizedHost ? store.hosts[normalizedHost] : undefined
  return mergeSettings(store.global, hostSettings)
}

export async function updateCapsuleSettingsForHost(
  hostname: string,
  patch: Partial<CapsuleSettings>
): Promise<CapsuleSettings> {
  const normalizedHost = normalizeHost(hostname)
  const store = await readStore()
  const current = mergeSettings(
    store.global,
    normalizedHost ? store.hosts[normalizedHost] : undefined
  )
  const next = mergeSettings(current, patch)

  if (normalizedHost) {
    store.hosts[normalizedHost] = next
    await writeStore(store)
  }

  return next
}
