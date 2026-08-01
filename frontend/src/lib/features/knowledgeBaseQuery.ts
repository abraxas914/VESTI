import {
  getConversations,
  getMessages,
  searchConversationMatchesByText
} from "../services/storageService"
import type { Platform } from "../types"

export interface KnowledgeContext {
  conversationId: number
  title: string
  platform: Platform
  excerpt: string
}

export interface KnowledgeQueryResult {
  query: string
  answer: string
  contexts: KnowledgeContext[]
}

export async function queryKnowledgeBase(
  query: string
): Promise<KnowledgeQueryResult> {
  const normalized = query.trim()
  if (!normalized) throw new Error("KNOWLEDGE_QUERY_REQUIRED")

  const matches = await searchConversationMatchesByText({ query: normalized })
  const conversations = await getConversations()
  const byId = new Map(
    conversations.map((conversation) => [conversation.id, conversation])
  )

  const contexts: KnowledgeContext[] = []
  for (const match of matches.slice(0, 5)) {
    const conversation = byId.get(match.conversationId)
    if (!conversation) continue
    const messages = await getMessages(conversation.id)
    const sourceMessage = messages.find(
      (message) => message.id === match.firstMatchedMessageId
    )
    contexts.push({
      conversationId: conversation.id,
      title: conversation.title,
      platform: conversation.platform,
      excerpt:
        sourceMessage?.content_text.trim() ||
        match.bestExcerpt.trim() ||
        conversation.snippet
    })
  }

  const answer =
    contexts.length > 0
      ? [
          `在知识库中找到 ${contexts.length} 段相关记忆：`,
          ...contexts.map(
            (context, index) =>
              `${index + 1}. ${context.title}（${context.platform}）：${context.excerpt}`
          )
        ].join("\n")
      : `没有找到与“${normalized}”直接匹配的历史对话。可以换一个更具体的关键词。`

  return { query: normalized, answer, contexts }
}
