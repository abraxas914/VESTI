// Settings for the in-page real-time prompt assistant.
//
// Structural clone of capsuleSettingsService: a {global, hosts} store in
// chrome.storage.local with per-host-wins resolution, plus a live subscription
// so the content script can rebuild/tear-down when the user toggles it.
//
// Independent of the capsule's own enable flag: the capsule per-host gate still
// silences everything when Vesti is disabled on a host; this only governs the
// real-time scoring surface.

export interface PromptAssistSettings {
  /** Master switch for the real-time scoring/clarity/suggestion surface. */
  realtimeEnabled: boolean;
  /** Debounce before re-scoring the draft (ms). */
  debounceMs: number;
  /** Show the clarity issue badge/popover (vs. score chip only). */
  showClarityBadge: boolean;
  /** Allow the on-demand "Optimize with AI" (LLM) action. */
  optimizeWithLlm: boolean;
}

interface PromptAssistSettingsStore {
  global: PromptAssistSettings;
  hosts: Record<string, PromptAssistSettings>;
}

/** Sentinel scope for the global (all-hosts) settings. */
export const GLOBAL_SCOPE = "global";

const STORAGE_KEY = "vesti_prompt_assist_settings";
const DEFAULT_DEBOUNCE_MS = 350;
const MIN_DEBOUNCE_MS = 200;
const MAX_DEBOUNCE_MS = 800;

export const DEFAULT_PROMPT_ASSIST_SETTINGS: PromptAssistSettings = {
  realtimeEnabled: true,
  debounceMs: DEFAULT_DEBOUNCE_MS,
  showClarityBadge: true,
  optimizeWithLlm: true,
};

function resolveStorageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  return chrome.storage.local;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDebounceMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_DEBOUNCE_MS, Math.max(MIN_DEBOUNCE_MS, Math.round(parsed)));
}

function normalizeHost(hostname: string): string {
  return String(hostname ?? "")
    .trim()
    .toLowerCase();
}

function mergeSettings(
  base: PromptAssistSettings,
  draft: unknown,
): PromptAssistSettings {
  const value =
    draft && typeof draft === "object"
      ? (draft as Partial<PromptAssistSettings>)
      : undefined;

  return {
    realtimeEnabled: normalizeBoolean(value?.realtimeEnabled, base.realtimeEnabled),
    debounceMs: normalizeDebounceMs(value?.debounceMs, base.debounceMs),
    showClarityBadge: normalizeBoolean(value?.showClarityBadge, base.showClarityBadge),
    optimizeWithLlm: normalizeBoolean(value?.optimizeWithLlm, base.optimizeWithLlm),
  };
}

function normalizeStore(value: unknown): PromptAssistSettingsStore {
  const raw =
    value && typeof value === "object"
      ? (value as { global?: unknown; hosts?: Record<string, unknown> })
      : undefined;

  const globalCandidate = raw && "global" in raw ? raw.global : raw;
  const global = mergeSettings(DEFAULT_PROMPT_ASSIST_SETTINGS, globalCandidate);

  const hosts: Record<string, PromptAssistSettings> = {};
  const rawHosts = raw?.hosts && typeof raw.hosts === "object" ? raw.hosts : {};
  for (const [hostKey, hostValue] of Object.entries(rawHosts)) {
    const normalized = normalizeHost(hostKey);
    if (!normalized) continue;
    hosts[normalized] = mergeSettings(global, hostValue);
  }

  return { global, hosts };
}

async function readStore(): Promise<PromptAssistSettingsStore> {
  const storage = resolveStorageArea();
  if (!storage) return { global: DEFAULT_PROMPT_ASSIST_SETTINGS, hosts: {} };

  return new Promise((resolve) => {
    storage.get([STORAGE_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        resolve({ global: DEFAULT_PROMPT_ASSIST_SETTINGS, hosts: {} });
        return;
      }
      resolve(normalizeStore(result?.[STORAGE_KEY]));
    });
  });
}

async function writeStore(store: PromptAssistSettingsStore): Promise<void> {
  const storage = resolveStorageArea();
  if (!storage) return;

  return new Promise((resolve, reject) => {
    storage.set({ [STORAGE_KEY]: store }, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

/** Resolve effective settings for a host (per-host override wins over global). */
export async function getPromptAssistSettingsForHost(
  hostname: string,
): Promise<PromptAssistSettings> {
  const normalized = normalizeHost(hostname);
  const store = await readStore();
  const hostSettings = normalized ? store.hosts[normalized] : undefined;
  return mergeSettings(store.global, hostSettings);
}

/**
 * Update settings for a scope. Pass GLOBAL_SCOPE (or "") to update the global
 * defaults; pass a hostname to set a per-host override (e.g. "turn off here").
 */
export async function updatePromptAssistSettings(
  scope: string,
  patch: Partial<PromptAssistSettings>,
): Promise<PromptAssistSettings> {
  const store = await readStore();
  const isGlobal = !scope || scope === GLOBAL_SCOPE;

  if (isGlobal) {
    store.global = mergeSettings(store.global, patch);
    await writeStore(store);
    return store.global;
  }

  const normalized = normalizeHost(scope);
  const current = mergeSettings(store.global, store.hosts[normalized]);
  const next = mergeSettings(current, patch);
  store.hosts[normalized] = next;
  await writeStore(store);
  return next;
}

/**
 * Subscribe to settings changes. The callback receives the freshly resolved
 * settings for `hostname` whenever the store changes. Returns an unsubscribe.
 */
export function subscribePromptAssistSettings(
  hostname: string,
  listener: (settings: PromptAssistSettings) => void,
): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
    return () => {};
  }
  const normalized = normalizeHost(hostname);
  const handle: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    changes,
    areaName,
  ) => {
    if (areaName !== "local") return;
    if (!changes[STORAGE_KEY]) return;
    const store = normalizeStore(changes[STORAGE_KEY].newValue);
    const hostSettings = normalized ? store.hosts[normalized] : undefined;
    listener(mergeSettings(store.global, hostSettings));
  };
  chrome.storage.onChanged.addListener(handle);
  return () => chrome.storage.onChanged.removeListener(handle);
}
