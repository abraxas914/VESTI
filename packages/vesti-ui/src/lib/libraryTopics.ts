import type { Conversation, Topic } from "../types";

/** Return the selected topic and every descendant topic in display-tree order. */
export function collectTopicBranchIds(
  topics: Topic[],
  selectedTopicId: number | null,
): Set<number> {
  if (selectedTopicId === null) return new Set<number>();

  const collect = (topic: Topic, result: Set<number>) => {
    result.add(topic.id);
    for (const child of topic.children ?? []) collect(child, result);
  };

  const find = (nodes: Topic[]): Topic | null => {
    for (const node of nodes) {
      if (node.id === selectedTopicId) return node;
      const match = find(node.children ?? []);
      if (match) return match;
    }
    return null;
  };

  const selected = find(topics);
  const result = new Set<number>();
  if (selected) collect(selected, result);
  return result;
}

/** Filter by a real Topic branch. A null selection keeps the original list. */
export function filterConversationsByTopic(
  conversations: Conversation[],
  topics: Topic[],
  selectedTopicId: number | null,
): Conversation[] {
  if (selectedTopicId === null) return conversations;
  const branchIds = collectTopicBranchIds(topics, selectedTopicId);
  if (branchIds.size === 0) return [];
  return conversations.filter(
    (conversation) =>
      conversation.topic_id !== null && branchIds.has(conversation.topic_id),
  );
}

export function findTopicInTree(
  topics: Topic[],
  topicId: number,
): Topic | null {
  for (const topic of topics) {
    if (topic.id === topicId) return topic;
    const match = findTopicInTree(topic.children ?? [], topicId);
    if (match) return match;
  }
  return null;
}

/** Topic nodes that can be expanded in the Library navigation tree. */
export function collectTopicBranchNodeIds(topics: Topic[]): Set<number> {
  const result = new Set<number>();
  const visit = (nodes: Topic[]) => {
    for (const topic of nodes) {
      if ((topic.children?.length ?? 0) > 0) {
        result.add(topic.id);
        visit(topic.children ?? []);
      }
    }
  };
  visit(topics);
  return result;
}
