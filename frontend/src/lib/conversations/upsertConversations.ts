import type { Conversation } from "../types"

/**
 * Merge patched conversations into the master list: update in place when the
 * id already exists, append otherwise, then re-sort by the active timestamp.
 * Used both by card-initiated edits and by incremental VESTI_DATA_UPDATED
 * refreshes, so the list never needs a full reload for single-row changes.
 */
export function upsertConversations(
  prev: Conversation[],
  patches: Conversation[],
  timeOf: (conversation: Conversation) => number
): Conversation[] {
  if (patches.length === 0) return prev
  const patchById = new Map(patches.map((patch) => [patch.id, patch]))
  const appliedIds = new Set<number>()
  const next = prev.map((item) => {
    const patch = patchById.get(item.id)
    if (!patch) return item
    appliedIds.add(item.id)
    return { ...item, ...patch }
  })
  for (const patch of patches) {
    if (!appliedIds.has(patch.id)) next.push(patch)
  }
  return next.sort((a, b) => timeOf(b) - timeOf(a))
}
