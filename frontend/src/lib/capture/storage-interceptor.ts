import { deduplicateAndSave } from "../core/middleware/deduplicate";
import { notifyDataUpdated } from "../messaging/dataUpdated";
import type { ConversationDraft, ParsedMessage } from "../messaging/protocol";
import { getCaptureSettings } from "../services/captureSettingsService";
import { runGardener } from "../services/gardenerService";
import { requestVectorization } from "../services/vectorizationService";
import { countAiTurns } from "./turn-metrics";
import type {
  CaptureDecisionMeta,
  CaptureDecisionReason,
  CaptureSettings,
} from "../types";
import { logger } from "../utils/logger";

interface CapturePayload {
  conversation: ConversationDraft;
  messages: ParsedMessage[];
  forceFlag?: boolean;
}

export interface CaptureInterceptionResult {
  saved: boolean;
  newMessages: number;
  conversationId?: number;
  decision: CaptureDecisionMeta;
}

function buildCombinedText(payload: CapturePayload): string {
  const messageText = payload.messages.map((item) => item.textContent).join(" ");
  return `${payload.conversation.title} ${payload.conversation.snippet} ${messageText}`
    .toLowerCase()
    .trim();
}

function decideCapture(
  payload: CapturePayload,
  settings: CaptureSettings
): CaptureDecisionMeta {
  const messageCount = payload.messages.length;
  const turnCount = countAiTurns(payload.messages);
  const occurredAt = Date.now();
  const forceFlag = payload.forceFlag === true;

  if (messageCount === 0) {
    return {
      mode: settings.mode,
      decision: "rejected",
      reason: "empty_payload",
      messageCount,
      turnCount,
      blacklistHit: false,
      forceFlag,
      intercepted: true,
      occurredAt,
    };
  }

  if (!payload.conversation.uuid.trim()) {
    return {
      mode: settings.mode,
      decision: "held",
      reason: "missing_conversation_id",
      messageCount,
      turnCount,
      blacklistHit: false,
      forceFlag,
      intercepted: true,
      occurredAt,
    };
  }

  if (forceFlag) {
    return {
      mode: settings.mode,
      decision: "committed",
      reason: "force_archive",
      messageCount,
      turnCount,
      blacklistHit: false,
      forceFlag,
      intercepted: false,
      occurredAt,
    };
  }

  if (settings.mode === "mirror") {
    return {
      mode: settings.mode,
      decision: "committed",
      reason: "mode_mirror",
      messageCount,
      turnCount,
      blacklistHit: false,
      forceFlag,
      intercepted: false,
      occurredAt,
    };
  }

  if (settings.mode === "manual") {
    return {
      mode: settings.mode,
      decision: "held",
      reason: "mode_manual_hold",
      messageCount,
      turnCount,
      blacklistHit: false,
      forceFlag,
      intercepted: true,
      occurredAt,
    };
  }

  const normalizedKeywords = settings.smartConfig.blacklistKeywords
    .map((item) => item.toLowerCase().trim())
    .filter((item) => item.length > 0);
  const combinedText = buildCombinedText(payload);
  const blacklistHit = normalizedKeywords.some((keyword) =>
    combinedText.includes(keyword)
  );

  if (blacklistHit) {
    return {
      mode: settings.mode,
      decision: "held",
      reason: "smart_keyword_blocked",
      messageCount,
      turnCount,
      blacklistHit: true,
      forceFlag,
      intercepted: true,
      occurredAt,
    };
  }

  if (turnCount < settings.smartConfig.minTurns) {
    return {
      mode: settings.mode,
      decision: "held",
      reason: "smart_below_min_turns",
      messageCount,
      turnCount,
      blacklistHit: false,
      forceFlag,
      intercepted: true,
      occurredAt,
    };
  }

  return {
    mode: settings.mode,
    decision: "committed",
    reason: "smart_pass",
    messageCount,
    turnCount,
    blacklistHit: false,
    forceFlag,
    intercepted: false,
    occurredAt,
  };
}

function buildRejectedDecision(
  base: CaptureDecisionMeta,
  reason: CaptureDecisionReason
): CaptureDecisionMeta {
  return {
    ...base,
    decision: "rejected",
    reason,
    intercepted: true,
  };
}

export async function interceptAndPersistCapture(
  payload: CapturePayload
): Promise<CaptureInterceptionResult> {
  const settings = await getCaptureSettings();
  const decision = decideCapture(payload, settings);

  logger.info("capture", "Capture gate decision", {
    platform: payload.conversation.platform,
    sessionUUID: payload.conversation.uuid || null,
    mode: decision.mode,
    decision: decision.decision,
    reason: decision.reason,
    messageCount: decision.messageCount,
    turnCount: decision.turnCount,
    blacklistHit: decision.blacklistHit,
    forceFlag: decision.forceFlag,
    intercepted: decision.intercepted,
  });

  if (decision.decision !== "committed") {
    return {
      saved: false,
      newMessages: 0,
      decision,
    };
  }

  try {
    const persisted = await deduplicateAndSave(
      payload.conversation,
      payload.messages
    );
    if (persisted.saved && typeof persisted.conversationId === "number") {
      requestVectorization();
      void (async () => {
        try {
          const result = await runGardener(persisted.conversationId);
          if (result.updated) {
            notifyDataUpdated({
              kind: "conversation-upsert",
              conversationId: persisted.conversationId,
            });
          }
        } catch (error) {
          logger.warn("capture", "Auto Gardener failed", {
            conversationId: persisted.conversationId,
            error: (error as Error)?.message ?? String(error),
          });
        }
      })();
    }
    return {
      ...persisted,
      decision,
    };
  } catch (error) {
    const err = error as Error;
    const reason =
      err?.message === "STORAGE_HARD_LIMIT_REACHED"
        ? "storage_limit_blocked"
        : "persist_failed";

    logger.warn("capture", "Capture persistence rejected", {
      platform: payload.conversation.platform,
      sessionUUID: payload.conversation.uuid || null,
      reason,
      error: err?.message ?? String(error),
    });

    return {
      saved: false,
      newMessages: 0,
      decision: buildRejectedDecision(decision, reason),
    };
  }
}
