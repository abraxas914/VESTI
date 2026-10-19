import type { CaptureMode, CaptureSettings } from "../types";

const STORAGE_KEY = "vesti_capture_settings";
const DEFAULT_MIN_TURNS = 3;
const MIN_TURNS_LIMIT = 1;
const MAX_TURNS_LIMIT = 20;

const LEGACY_MODE_MAP: Record<string, CaptureMode> = {
  full_mirror: "mirror",
  smart_denoise: "smart",
  curator: "manual",
  mirror: "mirror",
  smart: "smart",
  manual: "manual",
};

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  mode: "mirror",
  automaticAi: { enabled: false, consentVersion: 1 },
  smartConfig: {
    minTurns: DEFAULT_MIN_TURNS,
    blacklistKeywords: [],
  },
};

function getStorage() {
  if (!chrome?.storage?.local) {
    throw new Error("STORAGE_UNAVAILABLE");
  }
  return chrome.storage.local;
}

function normalizeMode(value: unknown): CaptureMode {
  if (typeof value !== "string") {
    return DEFAULT_CAPTURE_SETTINGS.mode;
  }
  return LEGACY_MODE_MAP[value.trim().toLowerCase()] ?? DEFAULT_CAPTURE_SETTINGS.mode;
}

function normalizeMinTurns(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return DEFAULT_MIN_TURNS;
  }
  return Math.min(MAX_TURNS_LIMIT, Math.max(MIN_TURNS_LIMIT, Math.round(num)));
}

function normalizeBlacklistKeywords(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems) {
    const keyword = String(raw).trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
  }

  return result;
}

export function normalizeCaptureSettings(input: unknown): CaptureSettings {
  if (!input || typeof input !== "object") {
    return DEFAULT_CAPTURE_SETTINGS;
  }

  const raw = input as {
    mode?: unknown;
    automaticAi?: { enabled?: unknown; consentVersion?: unknown };
    smartConfig?: { minTurns?: unknown; blacklistKeywords?: unknown };
  };

  return {
    mode: normalizeMode(raw.mode),
    automaticAi: {
      enabled: raw.automaticAi?.enabled === true && raw.automaticAi?.consentVersion === 1,
      consentVersion: 1,
    },
    smartConfig: {
      minTurns: normalizeMinTurns(raw.smartConfig?.minTurns),
      blacklistKeywords: normalizeBlacklistKeywords(raw.smartConfig?.blacklistKeywords),
    },
  };
}

export async function getCaptureSettings(): Promise<CaptureSettings> {
  const storage = getStorage();
  return new Promise((resolve, reject) => {
    storage.get([STORAGE_KEY], (result: Record<string, unknown>) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(normalizeCaptureSettings(result[STORAGE_KEY]));
    });
  });
}

export async function setCaptureSettings(settings: CaptureSettings): Promise<void> {
  const storage = getStorage();
  const normalized = normalizeCaptureSettings(settings);
  return new Promise((resolve, reject) => {
    storage.set({ [STORAGE_KEY]: normalized }, () => {
      const err = chrome.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

// Fail closed if preferences cannot be read. Capturing locally remains allowed.
export async function isAutomaticAiEnabled(): Promise<boolean> {
  try {
    return (await getCaptureSettings()).automaticAi?.enabled === true;
  } catch {
    return false;
  }
}
