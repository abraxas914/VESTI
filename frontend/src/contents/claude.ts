import type { PlasmoCSConfig } from "plasmo"

import { registerCaptureRuntime } from "../lib/capture/registerCaptureRuntime"
import { createTransientCaptureStore } from "../lib/capture/transient-store"
import { ConversationObserver } from "../lib/core/observer/ConversationObserver"
import { ClaudeParser } from "../lib/core/parser/claude/ClaudeParser"
import { CapturePipeline } from "../lib/core/pipeline/capturePipeline"
import { CAPTURE_TIMEOUT_MS, sendRequest } from "../lib/messaging/runtime"
import { registerRelayInjection } from "../lib/relay/registerContentRelay"
import { logger } from "../lib/utils/logger"

export const config: PlasmoCSConfig = {
  matches: ["https://claude.ai/*"],
  run_at: "document_idle"
}

// Relay handoff injection works even on pages where capture detects no chat.
registerRelayInjection("claude")

const parser = new ClaudeParser()
if (!parser.detect()) {
  logger.info("content", "Claude parser not detected on this page")
} else {
  const transientStore = createTransientCaptureStore()
  const pipeline = new CapturePipeline(parser, async (payload) => {
    transientStore.setPayload(payload)
    const result = await sendRequest<"CAPTURE_CONVERSATION">({
      type: "CAPTURE_CONVERSATION",
      target: "offscreen",
      payload
    }, CAPTURE_TIMEOUT_MS)
    transientStore.setDecision(result.decision)
    return result
  })

  const observer = new ConversationObserver(parser, pipeline)
  observer.start()

  // Warm-start capture for cold-opened threads
  window.setTimeout(() => {
    void pipeline.capture()
  }, 1200)

  registerCaptureRuntime({ transientStore })

  logger.info("content", "Claude capture started")
}
