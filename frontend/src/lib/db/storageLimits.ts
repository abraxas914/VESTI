import type { StorageUsageSnapshot, StorageUsageStatus } from "../types";
import { logger } from "../utils/logger";

export const SOFT_LIMIT_BYTES = 900 * 1024 * 1024;
export const HARD_LIMIT_BYTES = 1024 * 1024 * 1024;

function resolveStatus(
  bytes: number,
  unlimited: boolean,
  quota: number | null,
): StorageUsageStatus {
  // With the unlimitedStorage permission granted, IndexedDB is bounded by the
  // browser's per-origin quota, not our static 1 GiB ceiling — gating on
  // HARD_LIMIT_BYTES would silently stop captures far below the real limit.
  if (unlimited) {
    if (quota && quota > 0) {
      if (bytes >= quota * 0.95) return "blocked";
      if (bytes >= quota * 0.85) return "warning";
    }
    return "ok";
  }
  if (bytes >= HARD_LIMIT_BYTES) return "blocked";
  if (bytes >= SOFT_LIMIT_BYTES) return "warning";
  return "ok";
}

function hasUnlimitedStorageEnabled(): boolean {
  try {
    const permissions = chrome?.runtime?.getManifest?.().permissions ?? [];
    return permissions.includes("unlimitedStorage");
  } catch {
    return false;
  }
}

async function getOriginEstimate(): Promise<{ usage: number; quota: number | null }> {
  try {
    if (!navigator?.storage?.estimate) {
      return { usage: 0, quota: null };
    }
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: typeof estimate.quota === "number" ? estimate.quota : null,
    };
  } catch {
    return { usage: 0, quota: null };
  }
}

async function getLocalUsage(): Promise<number> {
  if (!chrome?.storage?.local) return 0;
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        resolve(0);
        return;
      }
      resolve(bytes ?? 0);
    });
  });
}

export async function getStorageUsageSnapshot(): Promise<StorageUsageSnapshot> {
  const [origin, localUsed] = await Promise.all([getOriginEstimate(), getLocalUsage()]);
  const unlimited = hasUnlimitedStorageEnabled();
  return {
    originUsed: origin.usage,
    originQuota: origin.quota,
    localUsed,
    unlimitedStorageEnabled: unlimited,
    softLimit: SOFT_LIMIT_BYTES,
    hardLimit: HARD_LIMIT_BYTES,
    status: resolveStatus(origin.usage, unlimited, origin.quota),
  };
}

export async function enforceStorageWriteGuard(): Promise<StorageUsageStatus> {
  const snapshot = await getStorageUsageSnapshot();
  if (snapshot.status === "blocked") {
    throw new Error("STORAGE_HARD_LIMIT_REACHED");
  }
  if (snapshot.status === "warning") {
    logger.warn("db", "Storage is above soft limit", {
      used: snapshot.originUsed,
      softLimit: snapshot.softLimit,
    });
  }
  return snapshot.status;
}

