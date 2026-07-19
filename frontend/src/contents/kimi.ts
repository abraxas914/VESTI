import type { PlasmoCSConfig } from "plasmo";
import { createTransientCaptureStore } from "../lib/capture/transient-store";
import { ConversationObserver } from "../lib/core/observer/ConversationObserver";
import { KimiParser } from "../lib/core/parser/kimi/KimiParser";
import { CapturePipeline } from "../lib/core/pipeline/capturePipeline";
import { sendRequest } from "../lib/messaging/runtime";
import { registerRelayInjection } from "../lib/relay/registerContentRelay";
import { logger } from "../lib/utils/logger";

export const config: PlasmoCSConfig = {
  matches: ["https://www.kimi.com/*", "https://kimi.com/*", "https://kimi.moonshot.cn/*"],
  run_at: "document_idle",
};

// Relay handoff injection works even on pages where capture detects no chat.
registerRelayInjection("kimi");

const parser = new KimiParser();
if (!parser.detect()) {
  logger.info("content", "Kimi parser not detected on this page");
} else {
  const transientStore = createTransientCaptureStore();
  const pipeline = new CapturePipeline(parser, async (payload) => {
    transientStore.setPayload(payload);
    const result = await sendRequest<"CAPTURE_CONVERSATION">({
      type: "CAPTURE_CONVERSATION",
      target: "offscreen",
      payload,
    });
    transientStore.setDecision(result.decision);
    return result;
  });

  const observer = new ConversationObserver(parser, pipeline);
  observer.start();

  // Ensure manual mode has an initial transient snapshot even without fresh mutations.
  window.setTimeout(() => {
    void pipeline.capture();
  }, 1200);

  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (!message || typeof message !== "object") return;
      const type = (message as { type?: string }).type;

      if (type === "GET_TRANSIENT_CAPTURE_STATUS") {
        sendResponse({ ok: true, status: transientStore.getStatus() });
        return;
      }

      if (type === "FORCE_ARCHIVE_TRANSIENT") {
        void (async () => {
          const latestPayload = transientStore.getPayload();
          if (!latestPayload) {
            sendResponse({ ok: false, error: "TRANSIENT_NOT_FOUND" });
            return;
          }

          try {
            const result = await sendRequest<"CAPTURE_CONVERSATION">({
              type: "CAPTURE_CONVERSATION",
              target: "offscreen",
              payload: { ...latestPayload, forceFlag: true },
            });

            transientStore.setDecision(result.decision);

            if (result.saved && chrome?.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
                void chrome.runtime.lastError;
              });
            }

            sendResponse({ ok: true, result });
          } catch (error) {
            sendResponse({
              ok: false,
              error: (error as Error)?.message || "FORCE_ARCHIVE_FAILED",
            });
          }
        })();

        return true;
      }
    },
  );

  logger.info("content", "Kimi capture started");
}
