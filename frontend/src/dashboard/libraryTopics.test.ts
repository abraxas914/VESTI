import { describe, expect, it } from "vitest"

import {
  collectTopicBranchIds,
  filterConversationsByTopic,
  findTopicInTree
} from "../../../packages/vesti-ui/src/lib/libraryTopics"
import type { Conversation, Topic } from "../../../packages/vesti-ui/src/types"

const topic = (id: number, name: string, children: Topic[] = []): Topic => ({
  id,
  name,
  parent_id: null,
  created_at: id,
  updated_at: id,
  children
})

const conversation = (id: number, topicId: number | null): Conversation => ({
  id,
  title: `Conversation ${id}`,
  platform: "ChatGPT",
  snippet: "",
  tags: [],
  topic_id: topicId,
  created_at: id,
  updated_at: id,
  is_starred: false
})

const topics = [
  topic(1, "Engineering", [
    topic(2, "Frontend", [topic(3, "React")]),
    topic(4, "Backend")
  ]),
  topic(5, "Writing")
]

describe("Library Topic tree filtering", () => {
  it("includes conversations assigned to every descendant of a parent Topic", () => {
    const conversations = [
      conversation(1, 1),
      conversation(2, 2),
      conversation(3, 3),
      conversation(4, 4),
      conversation(5, 5),
      conversation(6, null)
    ]

    expect([...collectTopicBranchIds(topics, 1)]).toEqual([1, 2, 3, 4])
    expect(
      filterConversationsByTopic(conversations, topics, 1).map(
        (item) => item.id
      )
    ).toEqual([1, 2, 3, 4])
  })

  it("keeps leaf selection exact and treats unknown Topic ids as empty", () => {
    const conversations = [conversation(1, 2), conversation(2, 3)]

    expect(
      filterConversationsByTopic(conversations, topics, 3).map(
        (item) => item.id
      )
    ).toEqual([2])
    expect(filterConversationsByTopic(conversations, topics, 999)).toEqual([])
  })

  it("keeps all conversations when no Topic is selected and finds nested nodes", () => {
    const conversations = [conversation(1, null), conversation(2, 5)]

    expect(filterConversationsByTopic(conversations, topics, null)).toBe(
      conversations
    )
    expect(findTopicInTree(topics, 3)?.name).toBe("React")
  })
})
