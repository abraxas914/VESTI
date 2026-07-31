import { countAiTurns } from "../../capture/turn-metrics"
import type { ConversationDraft } from "../../messaging/protocol"
import type { CaptureDecisionMeta } from "../../types"
import { logger } from "../../utils/logger"
import type { IParser, ParsedMessage } from "../parser/IParser"

export interface CaptureResult {
  saved: boolean
  newMessages: number
  conversationId?: number
  decision: CaptureDecisionMeta
}

export interface CaptureOptions {
  forceFlag?: boolean
}

export type CaptureSender = (payload: {
  conversation: ConversationDraft
  messages: ParsedMessage[]
  forceFlag?: boolean
}) => Promise<CaptureResult>

export class CapturePipeline {
  private parser: IParser
  private sender: CaptureSender

  constructor(parser: IParser, sender: CaptureSender) {
    this.parser = parser
    this.sender = sender
  }

  async capture(options: CaptureOptions = {}): Promise<CaptureResult | null> {
    try {
      const platform = this.parser.detect()
      if (!platform) return null

      const sessionUUID = this.parser.getSessionUUID()
      if (!sessionUUID?.trim()) {
        logger.info("capture", "Capture skipped", {
          platform,
          sessionUUID: null,
          reason: "missing_conversation_id"
        })
        return null
      }

      if (this.parser.isGenerating()) {
        logger.info("capture", "Capture skipped", {
          platform,
          sessionUUID,
          reason: "still_generating"
        })
        return null
      }

      const messages = this.parser.getMessages()
      if (messages.length === 0) {
        // Surfaced at info-level so "cannot capture" reports show a decisive
        // signal: the page passed detect/session/generating gates but the
        // parser extracted nothing (typically stale DOM selectors).
        logger.info("capture", "Capture skipped", {
          platform,
          sessionUUID,
          reason: "no_messages"
        })
        return null
      }

      const turnCount = countAiTurns(messages)
      const now = Date.now()
      const conversation: ConversationDraft = {
        uuid: sessionUUID,
        platform,
        title: this.parser.getConversationTitle(),
        snippet: messages[0]?.textContent.slice(0, 100) || "",
        url: window.location.href,
        source_created_at: this.parser.getSourceCreatedAt(),
        first_captured_at: now,
        last_captured_at: now,
        created_at: now,
        updated_at: now,
        message_count: messages.length,
        turn_count: turnCount,
        is_archived: false,
        is_trash: false,
        tags: [],
        topic_id: null,
        is_starred: false,
        isMock: false
      }

      const result = await this.sender({
        conversation,
        messages,
        forceFlag: options.forceFlag
      })
      window.dispatchEvent(
        new CustomEvent("vesti:capture", {
          detail: result
        })
      )

      if (result.saved && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "VESTI_DATA_UPDATED" }, () => {
          void chrome.runtime.lastError
        })
      }

      const logMethod = result.saved ? logger.success : logger.info
      logMethod("capture", "Capture processed", {
        platform,
        sessionUUID: conversation.uuid || null,
        mode: result.decision.mode,
        decision: result.decision.decision,
        saved: result.saved,
        reason: result.decision.reason,
        messageCount: result.decision.messageCount,
        turnCount: result.decision.turnCount
      })
      return result
    } catch (error) {
      logger.error("capture", "Capture failed", error as Error)
      return null
    }
  }
}
