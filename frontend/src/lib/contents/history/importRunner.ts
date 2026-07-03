// Historical-import orchestrator (runs inside the platform content script).
//
// Lists the user's conversations via the provider, then fetches + persists each
// through the existing CAPTURE_CONVERSATION path. Dedup by [platform+uuid] makes
// re-runs idempotent. Detail fetches are throttled to stay polite to the
// platform API; an AbortSignal cancels mid-run. Progress is reported via the
// callback so the content script can stream it to the UI.

import { sendRequest } from "../../messaging/runtime";
import { logger } from "../../utils/logger";
import type { HistoryProvider } from "./types";

export interface ImportProgress {
  phase: "listing" | "importing" | "done" | "error" | "cancelled";
  discovered: number;
  processed: number;
  saved: number;
  newMessages: number;
  skipped: number;
  failed: number;
  error?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  /** Delay between detail fetches (ms) — politeness / rate-limit guard. */
  throttleMs?: number;
  /** Optional cap on conversations to import. */
  max?: number;
}

const DEFAULT_THROTTLE_MS = 400;

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export async function runHistoryImport(
  provider: HistoryProvider,
  options: RunOptions = {},
): Promise<ImportProgress> {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const progress: ImportProgress = {
    phase: "listing",
    discovered: 0,
    processed: 0,
    saved: 0,
    newMessages: 0,
    skipped: 0,
    failed: 0,
  };
  const emit = () => options.onProgress?.({ ...progress });
  emit();

  try {
    const refs = await provider.listConversations({
      signal: options.signal,
      max: options.max,
      onDiscover: (total) => {
        progress.discovered = total;
        emit();
      },
    });
    progress.discovered = refs.length;
    progress.phase = "importing";
    emit();

    for (const ref of refs) {
      if (options.signal?.aborted) {
        progress.phase = "cancelled";
        emit();
        return { ...progress };
      }
      try {
        const built = await provider.fetchConversation(ref, options.signal);
        if (!built) {
          progress.skipped += 1;
        } else {
          const result = await sendRequest<"CAPTURE_CONVERSATION">({
            type: "CAPTURE_CONVERSATION",
            target: "offscreen",
            payload: {
              conversation: built.conversation,
              messages: built.messages,
              forceFlag: true,
            },
          });
          if (result.saved) {
            progress.saved += 1;
            progress.newMessages += result.newMessages ?? 0;
          } else {
            progress.skipped += 1;
          }
        }
      } catch (error) {
        progress.failed += 1;
        logger.debug("content", "History import: conversation failed", {
          platform: provider.platform,
          id: ref.id,
          error: (error as Error)?.message ?? String(error),
        });
      }
      progress.processed += 1;
      emit();
      await delay(throttleMs, options.signal);
    }

    progress.phase = options.signal?.aborted ? "cancelled" : "done";
    emit();
    logger.info("content", "History import finished", {
      platform: provider.platform,
      ...progress,
    });
    return { ...progress };
  } catch (error) {
    progress.phase = "error";
    progress.error = (error as Error)?.message ?? String(error);
    emit();
    logger.warn("content", "History import failed", {
      platform: provider.platform,
      error: progress.error,
    });
    return { ...progress };
  }
}
