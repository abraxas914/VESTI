// Content-script side of the relay handoff: listen for RELAY_INJECT from the
// background worker and fill this platform's composer (fill only, never send).
//
// Registered at module top level of every platform content script — outside
// the capture parser's detect() branch — so injection keeps working even on
// pages where conversation capture does not detect a conversation.

import { logger } from "../utils/logger"
import { injectRelayPrompt } from "./injectors"
import type { RelayPlatformKey } from "./injectors"

export function registerRelayInjection(platform: RelayPlatformKey): void {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (!message || typeof message !== "object") return
      const type = (message as { type?: string }).type
      if (type !== "RELAY_INJECT") return

      const prompt = (message as { payload?: { prompt?: unknown } }).payload
        ?.prompt
      if (typeof prompt !== "string" || prompt.length === 0) {
        sendResponse({ ok: false, error: "empty_prompt" })
        return
      }

      const result = injectRelayPrompt(platform, prompt)
      if (!result.ok) {
        logger.warn("content", "Relay injection failed", {
          platform,
          error: result.error,
        })
      }
      sendResponse(
        result.ok
          ? { ok: true }
          : { ok: false, error: result.error ?? "fill_failed" }
      )
    }
  )
}
