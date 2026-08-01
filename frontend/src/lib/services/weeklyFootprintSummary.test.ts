import { describe, expect, it } from "vitest"

import type { Conversation, Message, Topic } from "../types"
import { buildWeeklyFootprintSummary } from "./weeklyFootprintSummary"

const RANGE_START = new Date(2026, 6, 20, 0, 0, 0).getTime()
const RANGE_END = new Date(2026, 6, 26, 23, 59, 59).getTime()

function conversation(
  changes: Partial<Conversation> &
    Pick<Conversation, "id" | "platform" | "title">
): Conversation {
  return {
    id: changes.id,
    uuid: `conversation-${changes.id}`,
    platform: changes.platform,
    title: changes.title,
    snippet: changes.snippet ?? "",
    url: "",
    source_created_at: changes.source_created_at ?? RANGE_START,
    first_captured_at: RANGE_START,
    last_captured_at: RANGE_START,
    created_at: RANGE_START,
    updated_at: RANGE_START,
    message_count: changes.message_count ?? 2,
    turn_count: changes.turn_count ?? 1,
    is_archived: false,
    is_trash: false,
    tags: changes.tags ?? [],
    topic_id: changes.topic_id ?? null,
    is_starred: false
  }
}

function message(
  id: number,
  conversationId: number,
  content: string,
  createdAt: number
): Message {
  return {
    id,
    conversation_id: conversationId,
    role: "user",
    content_text: content,
    created_at: createdAt
  }
}

describe("buildWeeklyFootprintSummary", () => {
  it("uses the dominant platform and direction plus the latest user question", () => {
    const conversations = [
      conversation({
        id: 1,
        platform: "ChatGPT",
        title: "React rendering",
        tags: ["前端工程"],
        topic_id: 10
      }),
      conversation({
        id: 2,
        platform: "ChatGPT",
        title: "Export debugging",
        tags: ["前端工程", "图片导出"],
        source_created_at: RANGE_START + 100
      }),
      conversation({
        id: 3,
        platform: "Claude",
        title: "Writing",
        tags: ["写作"],
        source_created_at: RANGE_START + 200
      })
    ]
    const latestAt = new Date(2026, 6, 26, 23, 42).getTime()
    const messages = new Map<number, Message[]>([
      [1, [message(11, 1, "怎么减少 React 重渲染？", RANGE_START + 1_000)]],
      [2, [message(22, 2, "为什么导出的周报图片底部有很大空白？", latestAt)]]
    ])
    const topics: Topic[] = [
      {
        id: 10,
        name: "前端工程",
        parent_id: null,
        created_at: RANGE_START,
        updated_at: RANGE_START
      }
    ]

    const result = buildWeeklyFootprintSummary(
      conversations,
      messages,
      topics,
      {
        activeDays: 4,
        topPlatforms: [
          { platform: "ChatGPT", count: 2 },
          { platform: "Claude", count: 1 }
        ],
        weekOverWeekDelta: 1
      },
      "zh",
      RANGE_START,
      RANGE_END
    )

    expect(result).toMatchObject({
      platform: "ChatGPT",
      topicCount: 3,
      topDirection: "前端工程",
      latestChatAt: latestAt,
      latestConversationId: 2,
      latestMessageId: 22,
      latestQuestion: "为什么导出的周报图片底部有很大空白？"
    })
    expect(result?.summary).toContain("主要在 ChatGPT 平台上聊了 3 个话题")
    expect(result?.summary).toContain("本周你最关心的话题为“前端工程”")
    expect(result?.summary).toContain("提问，提的问题为")
    expect(result?.encouragement).toContain("你好棒")
  })

  it("returns no summary for an empty week", () => {
    expect(
      buildWeeklyFootprintSummary(
        [],
        new Map(),
        [],
        { activeDays: 0, topPlatforms: [], weekOverWeekDelta: null },
        "zh",
        RANGE_START,
        RANGE_END
      )
    ).toBeUndefined()
  })

  it("does not invent a question time when no in-range user message exists", () => {
    expect(
      buildWeeklyFootprintSummary(
        [conversation({ id: 1, platform: "ChatGPT", title: "旧会话" })],
        new Map([
          [
            1,
            [message(11, 1, "范围之外的问题", RANGE_START - 1)]
          ]
        ]),
        [],
        {
          activeDays: 1,
          topPlatforms: [{ platform: "ChatGPT", count: 1 }],
          weekOverWeekDelta: 0
        },
        "zh",
        RANGE_START,
        RANGE_END
      )
    ).toBeUndefined()
  })
})
