/**
 * Payload convention for the VESTI_DATA_UPDATED broadcast.
 *
 * Every sender tags its change so listeners can avoid a full reload:
 * - "conversation-upsert": a single conversation was created/updated (capture
 *   save, rename, star, topic assignment, gardener). Listeners patch that row.
 * - "structural": anything else (imports, deletes, bulk edits, topic tree
 *   changes, clears). Listeners do a full reload.
 *
 * Legacy senders emitted no payload; listeners must treat a missing or
 * malformed payload as "structural" (full reload) for backward compatibility.
 */
export type VestiDataUpdatedPayload =
  | { kind: "conversation-upsert"; conversationId: number }
  | { kind: "structural" }

export function notifyDataUpdated(payload: VestiDataUpdatedPayload): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return
  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED", payload }, () => {
    void chrome.runtime.lastError
  })
}

/**
 * Extract the payload from an incoming VESTI_DATA_UPDATED message.
 * Returns null for legacy (payload-less) or malformed messages — callers
 * should fall back to a full reload in that case.
 */
export function parseDataUpdatedPayload(
  message: unknown
): VestiDataUpdatedPayload | null {
  if (!message || typeof message !== "object") return null
  const payload = (message as { payload?: unknown }).payload
  if (!payload || typeof payload !== "object") return null

  const kind = (payload as { kind?: unknown }).kind
  if (kind === "structural") {
    return { kind: "structural" }
  }
  if (kind === "conversation-upsert") {
    const conversationId = (payload as { conversationId?: unknown })
      .conversationId
    if (typeof conversationId === "number") {
      return { kind: "conversation-upsert", conversationId }
    }
  }
  return null
}
