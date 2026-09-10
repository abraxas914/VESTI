import type { PlasmoCSConfig } from "plasmo"

import { registerCaptureRuntime } from "../lib/capture/registerCaptureRuntime"
import { createTransientCaptureStore } from "../lib/capture/transient-store"
import { ConversationObserver } from "../lib/core/observer/ConversationObserver"
import { DeepSeekParser } from "../lib/core/parser/deepseek/DeepSeekParser"
import { CapturePipeline } from "../lib/core/pipeline/capturePipeline"
import { CAPTURE_TIMEOUT_MS, sendRequest } from "../lib/messaging/runtime"
import { registerRelayInjection } from "../lib/relay/registerContentRelay"
import { logger } from "../lib/utils/logger"

export const config: PlasmoCSConfig = {
  matches: ["https://chat.deepseek.com/*"],
  run_at: "document_idle"
}

// Relay handoff injection works even on pages where capture detects no chat.
registerRelayInjection("deepseek")

const parser = new DeepSeekParser()
if (!parser.detect()) {
  logger.info("content", "DeepSeek parser not detected on this page")
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

  registerCaptureRuntime({ transientStore })

  logger.info("content", "DeepSeek capture started")
}
