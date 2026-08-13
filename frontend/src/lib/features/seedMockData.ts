import type { IParser, ParsedMessage } from "../core/parser/IParser"
import {
  CapturePipeline,
  type CaptureResult
} from "../core/pipeline/capturePipeline"
import { notifyDataUpdated } from "../messaging/dataUpdated"
import { CAPTURE_TIMEOUT_MS, sendRequest } from "../messaging/runtime"
import {
  createSeedConversations,
  type SeedConversation
} from "../mocks/seedData"
import type { Platform } from "../types"

export interface SeedMockDataResult {
  requested: number
  created: number
  available: number
  conversationIds: number[]
}

class SeedConversationParser implements IParser {
  constructor(private readonly seed: SeedConversation) {}

  detect(): Platform {
    return this.seed.platform
  }

  getConversationTitle(): string {
    return this.seed.title
  }

  getMessages(): ParsedMessage[] {
    return this.seed.messages.map((message) => ({
      role: message.role,
      textContent: message.content,
      timestamp: message.createdAt
    }))
  }

  isGenerating(): boolean {
    return false
  }

  getSessionUUID(): string {
    return this.seed.id
  }

  getSourceCreatedAt(): number {
    return this.seed.createdAt
  }
}

async function seedConversation(
  seed: SeedConversation
): Promise<CaptureResult | null> {
  const parser = new SeedConversationParser(seed)
  const pipeline = new CapturePipeline(parser, (payload) =>
    sendRequest<"CAPTURE_CONVERSATION">({
      type: "CAPTURE_CONVERSATION",
      target: "offscreen",
      payload: {
        ...payload,
        conversation: {
          ...payload.conversation,
          snippet: seed.summary,
          isMock: true
        }
      }
    }, CAPTURE_TIMEOUT_MS)
  )
  return pipeline.capture({ forceFlag: true })
}

export async function seedMockData(): Promise<SeedMockDataResult> {
  const seeds = createSeedConversations()
  const results = await Promise.all(seeds.map(seedConversation))
  const available = results.filter(
    (result): result is CaptureResult =>
      typeof result?.conversationId === "number"
  )

  if (available.length !== seeds.length) {
    throw new Error("SEED_DATA_INCOMPLETE")
  }

  notifyDataUpdated({ kind: "structural" })

  return {
    requested: seeds.length,
    created: available.filter((result) => result.saved).length,
    available: available.length,
    conversationIds: available.map((result) => result.conversationId as number)
  }
}
