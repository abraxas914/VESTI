// Historical-conversation import — content script.
//
// Runs on platforms with a history provider. The import MUST execute in the
// page context so platform API calls inherit the user's session cookies. The
// UI (sidepanel) asks the background to forward IMPORT_HISTORY_RUN to the active
// platform tab; this script runs the import and streams progress back to all
// extension pages via chrome.runtime.sendMessage. Read-only — never submits.

import type { PlasmoCSConfig } from "plasmo";
import { getHistoryProvider } from "../lib/contents/history/registry";
import { runHistoryImport, type ImportProgress } from "../lib/contents/history/importRunner";
import { logger } from "../lib/utils/logger";

export const config: PlasmoCSConfig = {
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
  ],
  run_at: "document_idle",
  all_frames: false,
};

if (window.top === window.self) {
  const provider = getHistoryProvider(window.location.hostname);
  let abortController: AbortController | null = null;

  const broadcastProgress = (progress: ImportProgress) => {
    if (!chrome?.runtime?.sendMessage) return;
    chrome.runtime.sendMessage(
      {
        type: "IMPORT_HISTORY_PROGRESS",
        platform: provider?.platform ?? null,
        progress,
      },
      () => {
        // Swallow "no receiver" when no UI page is open.
        void chrome.runtime.lastError;
      },
    );
  };

  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (!message || typeof message !== "object") return;
      const type = (message as { type?: string }).type;

      if (type === "IMPORT_HISTORY_PROBE") {
        if (!provider) {
          sendResponse({ ok: true, supported: false });
          return;
        }
        void (async () => {
          let available = false;
          try {
            available = await provider.isAvailable();
          } catch {
            available = false;
          }
          sendResponse({
            ok: true,
            supported: true,
            platform: provider.platform,
            available,
          });
        })();
        return true; // async response
      }

      if (type === "IMPORT_HISTORY_RUN") {
        if (!provider) {
          sendResponse({ ok: false, reason: "unsupported" });
          return;
        }
        if (abortController) {
          sendResponse({ ok: false, reason: "already_running" });
          return;
        }
        abortController = new AbortController();
        sendResponse({ ok: true, started: true, platform: provider.platform });
        void (async () => {
          try {
            await runHistoryImport(provider, {
              signal: abortController.signal,
              onProgress: broadcastProgress,
            });
          } catch (error) {
            logger.warn("content", "History import crashed", {
              error: (error as Error)?.message ?? String(error),
            });
          } finally {
            abortController = null;
            if (chrome?.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
                void chrome.runtime.lastError;
              });
            }
          }
        })();
        return; // response already sent synchronously
      }

      if (type === "IMPORT_HISTORY_CANCEL") {
        if (abortController) abortController.abort();
        sendResponse({ ok: true });
        return;
      }
    },
  );

  logger.info("content", "History import listener ready", {
    host: window.location.hostname,
    supported: !!provider,
  });
}
