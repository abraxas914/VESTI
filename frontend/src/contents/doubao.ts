import type { PlasmoCSConfig } from "plasmo"

import { registerCaptureRuntime } from "../lib/capture/registerCaptureRuntime"
import { createTransientCaptureStore } from "../lib/capture/transient-store"
import { ConversationObserver } from "../lib/core/observer/ConversationObserver"
import { DoubaoParser } from "../lib/core/parser/doubao/DoubaoParser"
import { CapturePipeline } from "../lib/core/pipeline/capturePipeline"
import { CAPTURE_TIMEOUT_MS, sendRequest } from "../lib/messaging/runtime"
import { registerRelayInjection } from "../lib/relay/registerContentRelay"
import { logger } from "../lib/utils/logger"

export const config: PlasmoCSConfig = {
  matches: ["https://www.doubao.com/*"],
  run_at: "document_idle"
}

// Relay handoff injection works even on pages where capture detects no chat.
registerRelayInjection("doubao")

const parser = new DoubaoParser()
if (!parser.detect()) {
  logger.info("content", "Doubao parser not detected on this page")
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

  // Doubao hydrates an already-open conversation lazily after document_idle and
  // may emit no further mutations for the observer to react to — without an
  // explicit kick-off (parity with chatgpt.ts/yuanbao.ts) capture can stay idle
  // forever ("Doubao cannot capture"). Fire staggered initial captures.
  const INITIAL_CAPTURE_DELAYS_MS = [1500, 4000]
  for (const delay of INITIAL_CAPTURE_DELAYS_MS) {
    window.setTimeout(() => {
      void pipeline.capture()
    }, delay)
  }

  // One-time capture-path diagnostic to self-diagnose "cannot capture" reports.
  window.setTimeout(() => {
    logger.info("content", "Doubao capture diagnostic", {
      url: window.location.href,
      sessionUUID: parser.getSessionUUID(),
      isGenerating: parser.isGenerating(),
      messageRoots: document.querySelectorAll("[data-message-id]").length
    })
  }, 1700)

  registerCaptureRuntime({ transientStore })

  logger.info("content", "Doubao capture started")
}
