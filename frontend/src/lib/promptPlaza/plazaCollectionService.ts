// The user's personal 提示词广场: a lightweight set of catalog ids they've
// "加入"d from the 提示词超市. Stored in chrome.storage.local as plain ids that
// reference the bundled catalog (no prompt duplication). Kept separate from the
// auto-extracted 常用提示词 (DB) so the two shelves stay distinct.

const STORAGE_KEY = "vesti_plaza_adopted";

function area(): chrome.storage.StorageArea | null {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  return chrome.storage.local;
}

function normalize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export async function getAdoptedPlazaIds(): Promise<string[]> {
  const storage = area();
  if (!storage) return [];
  return new Promise((resolve) => {
    storage.get([STORAGE_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        resolve([]);
        return;
      }
      resolve(normalize(result?.[STORAGE_KEY]));
    });
  });
}

/** Add or remove a catalog id; returns the updated set. */
export async function setPlazaAdopted(id: string, adopt: boolean): Promise<string[]> {
  const storage = area();
  if (!storage) return [];
  const current = await getAdoptedPlazaIds();
  const set = new Set(current);
  if (adopt) set.add(id);
  else set.delete(id);
  const next = Array.from(set);
  await new Promise<void>((resolve) => {
    storage.set({ [STORAGE_KEY]: next }, () => {
      void chrome.runtime?.lastError;
      resolve();
    });
  });
  return next;
}

/**
 * Add or remove MANY catalog ids in a single read-modify-write; returns the
 * updated set. Bulk operations must not call setPlazaAdopted in a loop — each
 * call reads the same starting set and the writes clobber each other, so only
 * one change would survive.
 */
export async function setPlazaAdoptedMany(ids: string[], adopt: boolean): Promise<string[]> {
  const storage = area();
  if (!storage) return [];
  const current = await getAdoptedPlazaIds();
  const set = new Set(current);
  for (const id of ids) {
    if (adopt) set.add(id);
    else set.delete(id);
  }
  const next = Array.from(set);
  await new Promise<void>((resolve) => {
    storage.set({ [STORAGE_KEY]: next }, () => {
      void chrome.runtime?.lastError;
      resolve();
    });
  });
  return next;
}

/** Subscribe to changes (e.g. adoption from another view). Returns unsubscribe. */
export function subscribeAdoptedPlazaIds(listener: (ids: string[]) => void): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return () => {};
  const handle: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    listener(normalize(changes[STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handle);
  return () => chrome.storage.onChanged.removeListener(handle);
}
