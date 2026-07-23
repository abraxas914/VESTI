// Gardener: automatic conversation tagging + topic archiving.
//
// Two-layer strategy:
// 1. LLM layer (when a usable LLM config exists): one structured call that
//    sees the topic tree and returns { topic_path, tags, confidence }.
//    Low-confidence topic picks are ignored (tags still apply) and ANY LLM
//    error degrades silently to layer 2 — archiving never fails because of
//    the LLM.
// 2. Heuristic layer: TF keyword extraction (bilingual) + layered domain
//    dictionary for tags; topic matching scores keyword overlap against
//    topic names and the tags of conversations already archived under each
//    topic. Below-threshold matches are NOT force-archived.
//
// Already-archived conversations (topic_id set) are never re-classified;
// they only get supplemental tags.

import type { Conversation, GardenerResult, GardenerStep, Topic } from "../types";
import {
  applyGardenerResult,
  createTopic,
  getConversationById,
  getTopics,
  listConversations,
  listMessages,
} from "../db/repository";
import { buildHeuristicTags, dedupeTags } from "./tagging";
import { extractKeywords } from "./keywordExtraction";
import {
  flattenTopicTree,
  selectBestTopicMatch,
  type FlattenedTopic,
  type TopicMatchCandidate,
} from "./topicMatching";
import {
  buildClassificationPrompt,
  CLASSIFICATION_CONFIDENCE_THRESHOLD,
  CLASSIFICATION_SYSTEM_PROMPT,
  NEW_TOPIC_CONFIDENCE_THRESHOLD,
  parseClassificationOutput,
  resolveTopicPathAgainstExisting,
  type ConversationClassification,
} from "./gardenerClassification";
import { resolveUsableLlmConfig } from "./promptLlmService";
import { callInference } from "./llmService";
import { buildMessageSearchIndexText } from "../utils/messageContentPackage";
import { logger } from "../utils/logger";

const MAX_MESSAGE_COUNT = 12;
const MAX_TEXT_LENGTH = 4000;
const MAX_TAG_COUNT = 6;
const MIN_TAG_COUNT = 3;
const MAX_TOPIC_TAG_SOURCE_CONVERSATIONS = 300;

const GENERAL_TAG = "General";

function buildConversationText(conversation: Conversation, messageTexts: string[]): string {
  const chunks = [conversation.title, conversation.snippet, ...messageTexts];
  const combined = chunks.filter(Boolean).join("\n");
  if (combined.length <= MAX_TEXT_LENGTH) return combined;
  return combined.slice(0, MAX_TEXT_LENGTH);
}

/** Merge tag lists in priority order, dropping the "General" placeholder
 * whenever any real tag exists. */
function mergeTags(...tagLists: string[][]): string[] {
  const merged = dedupeTags(tagLists.flat());
  const real = merged.filter((tag) => tag.toLowerCase() !== GENERAL_TAG.toLowerCase());
  const output = real.length > 0 ? real : merged;
  return output.slice(0, MAX_TAG_COUNT);
}

/** Fill LLM tags up to the minimum count with heuristic tags. */
function resolveFinalTags(llmTags: string[], heuristicTags: string[]): string[] {
  const primary = dedupeTags(llmTags);
  if (primary.length >= MIN_TAG_COUNT) {
    return primary.slice(0, MAX_TAG_COUNT);
  }
  return mergeTags(primary, heuristicTags);
}

async function collectTopicTagSets(): Promise<Map<number, string[]>> {
  const tagsByTopic = new Map<number, Set<string>>();
  try {
    const conversations = await listConversations();
    for (const conversation of conversations.slice(
      0,
      MAX_TOPIC_TAG_SOURCE_CONVERSATIONS
    )) {
      if (conversation.is_trash) continue;
      if (conversation.topic_id === null) continue;
      if (!Array.isArray(conversation.tags) || conversation.tags.length === 0) continue;
      let bucket = tagsByTopic.get(conversation.topic_id);
      if (!bucket) {
        bucket = new Set<string>();
        tagsByTopic.set(conversation.topic_id, bucket);
      }
      for (const tag of conversation.tags) {
        if (tag && tag.toLowerCase() !== GENERAL_TAG.toLowerCase()) {
          bucket.add(tag);
        }
      }
    }
  } catch (error) {
    logger.warn("service", "Gardener topic tag aggregation failed", {
      error: (error as Error)?.message ?? String(error),
    });
  }
  const output = new Map<number, string[]>();
  for (const [topicId, tags] of tagsByTopic) {
    output.set(topicId, [...tags]);
  }
  return output;
}

async function classifyWithLlm(
  conversation: Conversation,
  messageTexts: string[],
  flattened: FlattenedTopic[]
): Promise<ConversationClassification | null> {
  const config = await resolveUsableLlmConfig();
  if (!config) return null;

  const prompt = buildClassificationPrompt({
    title: conversation.title,
    snippet: conversation.snippet,
    messages: messageTexts,
    topicPaths: flattened.map((item) => ({ id: item.topic.id, path: item.path })),
  });

  const result = await callInference(config, prompt, {
    responseFormat: "json_object",
    systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
  });

  return parseClassificationOutput(result.content);
}

async function createTopicSafely(
  name: string,
  parentId: number | null,
  flattened: FlattenedTopic[]
): Promise<Topic | null> {
  try {
    return await createTopic({ name, parent_id: parentId });
  } catch (error) {
    if ((error as Error)?.message === "TOPIC_ALREADY_EXISTS") {
      const normalized = name.trim().toLowerCase();
      const existing = flattened.find(
        (item) =>
          item.topic.name.trim().toLowerCase() === normalized &&
          item.topic.parent_id === parentId
      );
      return existing?.topic ?? null;
    }
    logger.warn("service", "Gardener topic creation failed", {
      name,
      parentId,
      error: (error as Error)?.message ?? String(error),
    });
    return null;
  }
}

interface TopicDecision {
  matchedTopic?: Topic;
  createdTopic?: Topic;
  detail: string;
}

async function decideTopicFromLlm(
  classification: ConversationClassification,
  flattened: FlattenedTopic[]
): Promise<TopicDecision> {
  const confidence = classification.confidence;
  const confidenceLabel = `confidence ${confidence.toFixed(2)}`;

  if (confidence < CLASSIFICATION_CONFIDENCE_THRESHOLD) {
    return { detail: `Low ${confidenceLabel}, tags only` };
  }
  if (classification.topicPath.length === 0) {
    return { detail: `No suitable topic (${confidenceLabel})` };
  }

  const resolved = resolveTopicPathAgainstExisting(
    classification.topicPath,
    flattened.map((item) => ({ id: item.topic.id, path: item.path }))
  );
  if (!resolved) {
    return { detail: `No suitable topic (${confidenceLabel})` };
  }

  if (resolved.kind === "existing") {
    const matched = flattened.find((item) => item.topic.id === resolved.id)?.topic;
    if (matched) {
      return { matchedTopic: matched, detail: `${matched.name} (LLM, ${confidenceLabel})` };
    }
    return { detail: `Topic disappeared (${confidenceLabel})` };
  }

  // New-topic suggestions require both an explicit model signal and stronger
  // confidence — the model is told to prefer existing topics.
  if (confidence < NEW_TOPIC_CONFIDENCE_THRESHOLD) {
    return { detail: `New topic suggestion below threshold (${confidenceLabel})` };
  }
  const created = await createTopicSafely(resolved.name, resolved.parentId, flattened);
  if (created) {
    return {
      matchedTopic: created,
      createdTopic: created,
      detail: `${created.name} (LLM, new topic, ${confidenceLabel})`,
    };
  }
  return { detail: `Topic creation failed (${confidenceLabel})` };
}

function decideTopicHeuristically(
  text: string,
  keywords: string[],
  flattened: FlattenedTopic[],
  topicTagSets: Map<number, string[]>
): TopicDecision {
  const candidates: TopicMatchCandidate[] = flattened.map((item) => ({
    id: item.topic.id,
    name: item.topic.name,
    depth: item.depth,
    tags: topicTagSets.get(item.topic.id) ?? [],
  }));

  const best = selectBestTopicMatch({ keywords, text }, candidates);
  if (!best) {
    return { detail: "No match above threshold (heuristic)" };
  }
  const matched = flattened.find((item) => item.topic.id === best.id)?.topic;
  if (!matched) {
    return { detail: "No match above threshold (heuristic)" };
  }
  return {
    matchedTopic: matched,
    detail: `${matched.name} (heuristic, score ${best.score.toFixed(2)})`,
  };
}

export async function runGardener(conversationId: number): Promise<{
  updated: boolean;
  conversation: Conversation;
  result: GardenerResult;
}> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const messages = await listMessages(conversationId);
  const messageTexts = messages
    .slice(0, MAX_MESSAGE_COUNT)
    .map((message) => buildMessageSearchIndexText(message))
    .filter(Boolean);

  const text = buildConversationText(conversation, messageTexts);
  const heuristicTags = buildHeuristicTags(text);

  const topicsTree = await getTopics();
  const flattened = flattenTopicTree(topicsTree);

  let matchedTopic: Topic | undefined;
  let createdTopic: Topic | undefined;
  let finalTags: string[];
  let tagDetailSource = "heuristic keywords";
  let topicDetail: string;

  if (conversation.topic_id !== null) {
    // Idempotency: never re-classify an archived conversation, but do
    // supplement its tags with fresh heuristic keywords.
    matchedTopic = flattened.find(
      (item) => item.topic.id === conversation.topic_id
    )?.topic;
    finalTags = mergeTags(conversation.tags ?? [], heuristicTags);
    topicDetail = matchedTopic
      ? `${matchedTopic.name} (already archived)`
      : "Already archived";
  } else {
    let classification: ConversationClassification | null = null;
    try {
      classification = await classifyWithLlm(conversation, messageTexts, flattened);
    } catch (error) {
      // Deliberate: any LLM failure (network, auth, malformed output...)
      // must degrade to heuristics instead of failing the archive flow.
      logger.warn("service", "Gardener LLM classification failed, using heuristics", {
        conversationId,
        error: (error as Error)?.message ?? String(error),
      });
    }

    if (classification) {
      tagDetailSource = "LLM";
      finalTags = resolveFinalTags(classification.tags, heuristicTags);
      const decision = await decideTopicFromLlm(classification, flattened);
      matchedTopic = decision.matchedTopic;
      createdTopic = decision.createdTopic;
      topicDetail = decision.detail;
    } else {
      finalTags = heuristicTags;
      const keywords = extractKeywords(text, { maxKeywords: 16 }).map(
        (keyword) => keyword.term
      );
      const topicTagSets = await collectTopicTagSets();
      const decision = decideTopicHeuristically(
        text,
        dedupeTags([...keywords, ...heuristicTags]),
        flattened,
        topicTagSets
      );
      matchedTopic = decision.matchedTopic;
      topicDetail = decision.detail;
    }
  }

  const applyResult = await applyGardenerResult(conversationId, {
    topic_id: matchedTopic?.id ?? conversation.topic_id ?? null,
    tags: finalTags,
  });

  const steps: GardenerStep[] = [
    {
      step: "Reading Conversation",
      status: "completed",
      details: `${messages.length} messages`,
    },
    {
      step: "Extracting Tags",
      status: "completed",
      details: applyResult.conversation.tags.length > 0
        ? `${applyResult.conversation.tags.join(", ")} (${tagDetailSource})`
        : GENERAL_TAG,
    },
    {
      step: "Matching Topic",
      status: "completed",
      details: topicDetail,
    },
    {
      step: "Writing Results",
      status: "completed",
      details: applyResult.updated ? "Conversation updated" : "No changes",
    },
  ];

  return {
    updated: applyResult.updated,
    conversation: applyResult.conversation,
    result: {
      tags: applyResult.conversation.tags,
      matchedTopic,
      createdTopic,
      steps,
    },
  };
}
