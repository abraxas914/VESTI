import {
  createExploreSession,
  getConversations,
  getMessages
} from "../services/storageService"
import type { Conversation, Message } from "../types"

export const CONTINUATION_DRAFT_KEY = "vesti_memory_continuation_draft"

export interface ContinuationDraft {
  sessionId: string
  summary: string
  systemPrompt: string
  createdAt: number
}

const SUMMARY_READ_BUDGET_MS = 1500
const CONTINUATION_STORAGE_BUDGET_MS = 2500

function resolveWithin<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(fallback), timeoutMs)
    promise.then(finish, () => finish(fallback))
  })
}

function compact(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1)}…`
}

export async function generateSummaryService(
  selectedIds: number[],
  conversationCandidates?: Conversation[]
): Promise<string> {
  const ids = Array.from(new Set(selectedIds))
  if (ids.length < 2) {
    throw new Error("SUMMARY_REQUIRES_TWO_CONVERSATIONS")
  }

  const conversations =
    conversationCandidates ??
    (await resolveWithin(
      getConversations(),
      [] as Conversation[],
      SUMMARY_READ_BUDGET_MS
    ))
  const selected = conversations.filter((conversation) =>
    ids.includes(conversation.id)
  )
  if (selected.length < 2) {
    throw new Error("SUMMARY_CONVERSATIONS_NOT_FOUND")
  }

  const sections = await Promise.all(
    selected.map(async (conversation) => {
      const messages = await resolveWithin(
        getMessages(conversation.id),
        [] as Message[],
        SUMMARY_READ_BUDGET_MS
      )
      const userQuestion = messages.find(
        (message) => message.role === "user" && message.content_text.trim()
      )
      const latestAnswer = [...messages]
        .reverse()
        .find((message) => message.role === "ai" && message.content_text.trim())
      return [
        `【${conversation.title} · ${conversation.platform}】`,
        compact(
          userQuestion?.content_text ||
            conversation.snippet ||
            conversation.title
        ),
        compact(
          latestAnswer?.content_text ||
            conversation.snippet ||
            conversation.title
        )
      ].join("\n")
    })
  )

  return [
    `已打包 ${selected.length} 段记忆，以下内容可直接作为后续对话上下文：`,
    "",
    ...sections.flatMap((section, index) =>
      index === sections.length - 1 ? [section] : [section, ""]
    ),
    "",
    "请在后续回答中综合这些记忆，优先延续已有结论，明确指出冲突，并把新的推断与原始事实区分开。"
  ].join("\n")
}

function storeContinuationDraft(draft: ContinuationDraft): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(
      () => finish(),
      CONTINUATION_STORAGE_BUDGET_MS
    )
    chrome.storage.local.set({ [CONTINUATION_DRAFT_KEY]: draft }, () => {
      const error = chrome.runtime.lastError
      if (error) {
        finish(new Error(error.message))
        return
      }
      finish()
    })
  })
}

export async function createSummaryContinuation(
  summary: string
): Promise<ContinuationDraft> {
  const trimmed = summary.trim()
  if (!trimmed) throw new Error("SUMMARY_REQUIRED")

  const systemPrompt = [
    "你正在延续一组由用户主动选择的历史对话。",
    "以下合并摘要是本次新会话的系统上下文；不要声称它来自当前聊天窗口。",
    "",
    trimmed
  ].join("\n")
  const sessionId = await createExploreSession(
    "基于合并记忆的新对话",
    systemPrompt
  )
  const draft: ContinuationDraft = {
    sessionId,
    summary: trimmed,
    systemPrompt,
    createdAt: Date.now()
  }
  await storeContinuationDraft(draft)
  return draft
}

export async function consumeContinuationDraft(): Promise<ContinuationDraft | null> {
  const result = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      chrome.storage.local.get([CONTINUATION_DRAFT_KEY], (stored) => {
        const error = chrome.runtime.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        resolve(stored)
      })
    }
  )
  await new Promise<void>((resolve) => {
    chrome.storage.local.remove([CONTINUATION_DRAFT_KEY], () => resolve())
  })

  const draft = result[
    CONTINUATION_DRAFT_KEY
  ] as Partial<ContinuationDraft> | null
  if (
    !draft ||
    typeof draft.sessionId !== "string" ||
    typeof draft.summary !== "string" ||
    typeof draft.systemPrompt !== "string" ||
    typeof draft.createdAt !== "number"
  ) {
    return null
  }
  return draft as ContinuationDraft
}
