import type {
  WeeklyPushSettings,
  WeeklyRecapStyle,
} from "../types";

const STORAGE_KEY = "vesti_weekly_push_settings";

export const DEFAULT_WEEKLY_PUSH_SETTINGS: WeeklyPushSettings = {
  enabled: false,
  weekday: 1,
  hour: 9,
  minute: 0,
  style: "professional",
  updatedAt: 0,
};

function getStorage(): chrome.storage.StorageArea {
  return chrome.storage.local;
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function normalizeStyle(value: unknown): WeeklyRecapStyle {
  return value === "humorous" ||
    value === "motivational" ||
    value === "professional"
    ? value
    : DEFAULT_WEEKLY_PUSH_SETTINGS.style;
}

export function normalizeWeeklyPushSettings(
  value: unknown
): WeeklyPushSettings {
  const record =
    value && typeof value === "object"
      ? (value as Partial<WeeklyPushSettings>)
      : {};
  return {
    enabled: Boolean(record.enabled),
    weekday: clampInteger(record.weekday, 0, 6, 1),
    hour: clampInteger(record.hour, 0, 23, 9),
    minute: clampInteger(record.minute, 0, 59, 0),
    style: normalizeStyle(record.style),
    updatedAt:
      typeof record.updatedAt === "number" &&
      Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : 0,
  };
}

export async function getWeeklyPushSettings(): Promise<WeeklyPushSettings> {
  const storage = getStorage();
  return new Promise((resolve, reject) => {
    storage.get([STORAGE_KEY], (result: Record<string, unknown>) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(normalizeWeeklyPushSettings(result[STORAGE_KEY]));
    });
  });
}

export async function setWeeklyPushSettings(
  changes: Partial<WeeklyPushSettings>
): Promise<WeeklyPushSettings> {
  const current = await getWeeklyPushSettings();
  const next = normalizeWeeklyPushSettings({
    ...current,
    ...changes,
    updatedAt: Date.now(),
  });
  const storage = getStorage();
  return new Promise((resolve, reject) => {
    storage.set({ [STORAGE_KEY]: next }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(next);
    });
  });
}

export function computeNextWeeklyReminderAt(
  settings: WeeklyPushSettings,
  now = Date.now()
): number {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(settings.hour, settings.minute, 0, 0);

  const dayDelta = (settings.weekday - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + dayDelta);
  if (next.getTime() <= now) {
    next.setDate(next.getDate() + 7);
  }
  return next.getTime();
}
