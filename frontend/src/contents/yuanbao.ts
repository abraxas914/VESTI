import type { PlasmoCSConfig } from "plasmo"

import { registerCaptureRuntime } from "../lib/capture/registerCaptureRuntime"
import { createTransientCaptureStore } from "../lib/capture/transient-store"
import { ConversationObserver } from "../lib/core/observer/ConversationObserver"
import { YuanbaoParser } from "../lib/core/parser/yuanbao/YuanbaoParser"
import { CapturePipeline } from "../lib/core/pipeline/capturePipeline"
import { CAPTURE_TIMEOUT_MS, sendRequest } from "../lib/messaging/runtime"
import { registerRelayInjection } from "../lib/relay/registerContentRelay"
import { logger } from "../lib/utils/logger"

export const config: PlasmoCSConfig = {
  matches: ["https://yuanbao.tencent.com/*"],
  run_at: "document_idle"
}

// Relay handoff injection works even on pages where capture detects no chat.
registerRelayInjection("yuanbao")

const parser = new YuanbaoParser()
if (!parser.detect()) {
  logger.info("content", "Yuanbao parser not detected on this page")
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

  // Yuanbao hydrates its conversation lazily after `document_idle`, and an
  // already-rendered conversation often emits no further mutations for the
  // MutationObserver to react to. Without an explicit kick-off (which
  // chatgpt.ts already has) the pipeline can stay idle forever on load, which
  // surfaces to users as "Yuanbao cannot capture". Fire staggered initial
  // captures; `capture()` is safe to call repeatedly (offscreen dedupes).
  const INITIAL_CAPTURE_DELAYS_MS = [1500, 4000]
  for (const delay of INITIAL_CAPTURE_DELAYS_MS) {
    window.setTimeout(() => {
      void pipeline.capture()
    }, delay)
  }

  // One-time capture-path diagnostic. When a user reports "cannot capture",
  // the [Vesti] console output here pinpoints which precondition failed
  // (missing session id, stuck `isGenerating`, or stale DOM selectors).
  window.setTimeout(() => {
    logger.info("content", "Yuanbao capture diagnostic", {
      url: window.location.href,
      sessionUUID: parser.getSessionUUID(),
      isGenerating: parser.isGenerating(),
      messageRoots: document.querySelectorAll(".agent-chat__bubble").length,
      humanRoots: document.querySelectorAll(".agent-chat__bubble--human")
        .length,
      aiRoots: document.querySelectorAll(".agent-chat__bubble--ai").length
    })
  }, 1700)

  registerCaptureRuntime({ transientStore })

  logger.info("content", "Yuanbao capture started")
}
