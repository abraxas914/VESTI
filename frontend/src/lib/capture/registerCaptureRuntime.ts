import type { CaptureResult } from "../core/pipeline/capturePipeline"
import { sendRequest } from "../messaging/runtime"
import type { createTransientCaptureStore } from "./transient-store"

type TransientCaptureStore = ReturnType<typeof createTransientCaptureStore>

interface CaptureRuntimeOptions {
  transientStore: TransientCaptureStore
}

type CaptureCommandResponse =
  | { ok: true; result: CaptureResult }
  | { ok: false; error: string }

function notifyDataUpdated(result: CaptureResult): void {
  if (!result.saved || !chrome?.runtime?.sendMessage) return
  chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
    void chrome.runtime.lastError
  })
}

export function registerCaptureRuntime({
  transientStore
}: CaptureRuntimeOptions): () => void {
  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    if (!message || typeof message !== "object") return
    const type = (message as { type?: string }).type

    if (type === "GET_TRANSIENT_CAPTURE_STATUS") {
      sendResponse({ ok: true, status: transientStore.getStatus() })
      return
    }

    if (type !== "FORCE_ARCHIVE_TRANSIENT") return

    void (async () => {
      const latestPayload = transientStore.getPayload()
      if (!latestPayload) {
        const response: CaptureCommandResponse = {
          ok: false,
          error: "TRANSIENT_NOT_FOUND"
        }
        sendResponse(response)
        return
      }

      try {
        const result = await sendRequest<"CAPTURE_CONVERSATION">({
          type: "CAPTURE_CONVERSATION",
          target: "offscreen",
          payload: { ...latestPayload, forceFlag: true }
        })
        transientStore.setDecision(result.decision)
        notifyDataUpdated(result)

        const response: CaptureCommandResponse = { ok: true, result }
        sendResponse(response)
      } catch (error) {
        const response: CaptureCommandResponse = {
          ok: false,
          error: (error as Error)?.message || "FORCE_ARCHIVE_FAILED"
        }
        sendResponse(response)
      }
    })()

    return true
  }

  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
