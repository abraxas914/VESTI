import type { PlasmoCSConfig } from "plasmo";
import { createTransientCaptureStore } from "../lib/capture/transient-store";
import { ConversationObserver } from "../lib/core/observer/ConversationObserver";
import { YuanbaoParser } from "../lib/core/parser/yuanbao/YuanbaoParser";
import { CapturePipeline } from "../lib/core/pipeline/capturePipeline";
import { sendRequest } from "../lib/messaging/runtime";
import { logger } from "../lib/utils/logger";

export const config: PlasmoCSConfig = {
  matches: ["https://yuanbao.tencent.com/*"],
  run_at: "document_idle",
};

const parser = new YuanbaoParser();
if (!parser.detect()) {
  logger.info("content", "Yuanbao parser not detected on this page");
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

  // Yuanbao hydrates its conversation lazily after `document_idle`, and an
  // already-rendered conversation often emits no further mutations for the
  // MutationObserver to react to. Without an explicit kick-off (which
  // chatgpt.ts already has) the pipeline can stay idle forever on load, which
  // surfaces to users as "Yuanbao cannot capture". Fire staggered initial
  // captures; `capture()` is safe to call repeatedly (offscreen dedupes).
  const INITIAL_CAPTURE_DELAYS_MS = [1500, 4000];
  for (const delay of INITIAL_CAPTURE_DELAYS_MS) {
    window.setTimeout(() => {
      void pipeline.capture();
    }, delay);
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
      humanRoots: document.querySelectorAll(".agent-chat__bubble--human").length,
      aiRoots: document.querySelectorAll(".agent-chat__bubble--ai").length,
    });
  }, 1700);

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

logger.info("content", "Yuanbao capture started");
}
