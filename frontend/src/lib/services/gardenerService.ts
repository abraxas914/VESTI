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
import { db } from "../db/schema";
import { buildAdaptiveTags, dedupeTags } from "./tagging";
import { extractKeywords, tokenizeForMatch } from "./keywordExtraction";
import {
  flattenTopicTree,
  selectBestTopicMatch,
  TOPIC_MATCH_THRESHOLD,
  TOPIC_PATH_SEPARATOR,
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
const MAX_TOPIC_OPTIONS_FOR_LLM = 60;

const GENERAL_TAG = "General";

function buildConversationText(conversation: Conversation, messageTexts: string[]): string {
  const metadata = [conversation.title, conversation.snippet].filter(Boolean).join("\n");
  const availableForMessages = Math.max(
    0,
    MAX_TEXT_LENGTH - metadata.length - (metadata ? 1 : 0),
  );
  const perMessageLimit = messageTexts.length > 0
    ? Math.max(120, Math.floor(availableForMessages / messageTexts.length))
    : 0;
  const excerpts = messageTexts.map((text) => text.slice(0, perMessageLimit));
  return [metadata, ...excerpts]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_LENGTH);
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

interface ClassificationContext {
  tagsByTopic: Map<number, string[]>;
  tagVocabulary: string[];
  topicByConversationId: Map<number, number>;
}

async function collectClassificationContext(): Promise<ClassificationContext> {
  const tagsByTopic = new Map<number, Set<string>>();
  const tagFrequency = new Map<string, { label: string; count: number }>();
  const topicByConversationId = new Map<number, number>();
  try {
    const conversations = await listConversations();
    for (const conversation of conversations.slice(
      0,
      MAX_TOPIC_TAG_SOURCE_CONVERSATIONS
    )) {
      if (conversation.is_trash) continue;
      if (conversation.topic_id !== null) {
        topicByConversationId.set(conversation.id, conversation.topic_id);
      }
      if (!Array.isArray(conversation.tags) || conversation.tags.length === 0) continue;
      for (const rawTag of conversation.tags) {
        const tag = rawTag.trim();
        if (!tag || tag.toLowerCase() === GENERAL_TAG.toLowerCase()) continue;
        const key = tag.toLowerCase();
        const observed = tagFrequency.get(key);
        if (observed) observed.count += 1;
        else tagFrequency.set(key, { label: tag, count: 1 });

        if (conversation.topic_id !== null) {
          let bucket = tagsByTopic.get(conversation.topic_id);
          if (!bucket) {
            bucket = new Set<string>();
            tagsByTopic.set(conversation.topic_id, bucket);
          }
          bucket.add(tag);
        }
      }
    }
  } catch (error) {
    logger.warn("service", "Gardener topic tag aggregation failed", {
      error: (error as Error)?.message ?? String(error),
    });
  }
  const normalizedTagsByTopic = new Map<number, string[]>();
  for (const [topicId, tags] of tagsByTopic) {
    normalizedTagsByTopic.set(topicId, [...tags]);
  }
  const tagVocabulary = [...tagFrequency.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .map((item) => item.label);
  return { tagsByTopic: normalizedTagsByTopic, tagVocabulary, topicByConversationId };
}

function sampleInConversationOrder<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const headCount = Math.max(2, Math.floor(limit / 3));
  const tailCount = Math.max(3, Math.ceil(limit / 2));
  const middleCount = Math.max(0, limit - headCount - tailCount);
  const middleStart = Math.max(
    headCount,
    Math.floor((items.length - middleCount) / 2),
  );
  return [
    ...items.slice(0, headCount),
    ...items.slice(middleStart, middleStart + middleCount),
    ...items.slice(-tailCount),
  ];
}

function selectTopicOptionsForPrompt(
  flattened: FlattenedTopic[],
  conversationText: string,
): FlattenedTopic[] {
  if (flattened.length <= MAX_TOPIC_OPTIONS_FOR_LLM) return flattened;
  const textLower = conversationText.toLowerCase();
  const textTokens = tokenizeForMatch(conversationText);
  return flattened
    .map((item, order) => {
      const pathTokens = tokenizeForMatch(item.path);
      let overlap = 0;
      for (const token of pathTokens) {
        if (textTokens.has(token)) overlap += 1;
      }
      const exact = textLower.includes(item.topic.name.trim().toLowerCase());
      return {
        item,
        order,
        score: (exact ? 10 : 0) + overlap / Math.max(1, pathTokens.size),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.topic.updated_at - left.item.topic.updated_at ||
        left.order - right.order,
    )
    .slice(0, MAX_TOPIC_OPTIONS_FOR_LLM)
    .sort((left, right) => left.order - right.order)
    .map(({ item }) => item);
}

async function classifyWithLlm(
  conversation: Conversation,
  messageTexts: string[],
  flattened: FlattenedTopic[],
  existingTags: string[],
  conversationText: string,
): Promise<ConversationClassification | null> {
  const config = await resolveUsableLlmConfig();
  if (!config) return null;

  const topicOptions = selectTopicOptionsForPrompt(flattened, conversationText);
  const prompt = buildClassificationPrompt({
    title: conversation.title,
    snippet: conversation.snippet,
    messages: messageTexts,
    topicPaths: topicOptions.map((item) => ({ id: item.topic.id, path: item.path })),
    existingTags,
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
      let existing = flattened.find(
        (item) =>
          item.topic.name.trim().toLowerCase() === normalized &&
          item.topic.parent_id === parentId
      );
      if (!existing) {
        const refreshed = flattenTopicTree(await getTopics());
        flattened.splice(0, flattened.length, ...refreshed);
        existing = flattened.find(
          (item) =>
            item.topic.name.trim().toLowerCase() === normalized &&
            item.topic.parent_id === parentId,
        );
      }
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

async function createTopicHierarchySafely(
  segments: string[],
  parentId: number | null,
  flattened: FlattenedTopic[],
): Promise<Topic | null> {
  let currentParentId = parentId;
  let leaf: Topic | null = null;

  for (const segment of segments) {
    const normalized = segment.trim().toLowerCase();
    const existing = flattened.find(
      (item) =>
        item.topic.parent_id === currentParentId &&
        item.topic.name.trim().toLowerCase() === normalized,
    );
    const topic = existing?.topic
      ?? await createTopicSafely(segment, currentParentId, flattened);
    if (!topic) return null;

    if (!existing) {
      const parent = currentParentId === null
        ? undefined
        : flattened.find((item) => item.topic.id === currentParentId);
      flattened.push({
        topic,
        depth: parent ? parent.depth + 1 : 0,
        path: parent
          ? `${parent.path}${TOPIC_PATH_SEPARATOR}${topic.name}`
          : topic.name,
      });
    }
    leaf = topic;
    currentParentId = topic.id;
  }

  return leaf;
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
  if (!classification.isNewTopic) {
    return { detail: `Unknown topic without new-topic approval (${confidenceLabel})` };
  }
  if (confidence < NEW_TOPIC_CONFIDENCE_THRESHOLD) {
    return { detail: `New topic suggestion below threshold (${confidenceLabel})` };
  }
  const created = await createTopicHierarchySafely(
    resolved.segments,
    resolved.parentId,
    flattened,
  );
  if (created) {
    return {
      matchedTopic: created,
      createdTopic: created,
      detail: `${created.name} (LLM, new topic, ${confidenceLabel})`,
    };
  }
  return { detail: `Topic creation failed (${confidenceLabel})` };
}

async function collectTopicEmbeddingSimilarities(
  conversationId: number,
  context: ClassificationContext,
): Promise<Map<number, number> | undefined> {
  if (context.topicByConversationId.size === 0) return undefined;

  // Classification must never trigger a network embedding request. Reuse the
  // newest cached vector for the current conversation and compare it only with
  // vectors produced by the exact same embedding index version.
  const targetRecords = await db.vectors
    .where("conversation_id")
    .equals(conversationId)
    .toArray();
  const target = targetRecords
    .filter((record) => record.index_version && record.embedding?.length > 0)
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0];
  if (!target) return undefined;

  const targetEmbedding = toFloat32Array(
    target.embedding as Float32Array | number[],
  );
  if (targetEmbedding.length === 0) return undefined;

  const archivedConversationIds = [...context.topicByConversationId.keys()]
    .filter((id) => id !== conversationId);
  if (archivedConversationIds.length === 0) return undefined;

  const vectors = await db.vectors
    .where("conversation_id")
    .anyOf(archivedConversationIds)
    .toArray();
  const bestByTopic = new Map<number, number>();
  for (const vector of vectors) {
    if (vector.index_version !== target.index_version) continue;
    const embedding = toFloat32Array(vector.embedding as Float32Array | number[]);
    if (embedding.length !== targetEmbedding.length) continue;
    const topicId = context.topicByConversationId.get(vector.conversation_id);
    if (topicId === undefined) continue;
    const similarity = Math.max(
      0,
      Math.min(1, cosineSimilarity(targetEmbedding, embedding)),
    );
    const previous = bestByTopic.get(topicId);
    if (previous === undefined || similarity > previous) {
      bestByTopic.set(topicId, similarity);
    }
  }
  return bestByTopic.size > 0 ? bestByTopic : undefined;
}

function toFloat32Array(value: Float32Array | number[]): Float32Array {
  return value instanceof Float32Array ? value : new Float32Array(value);
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    normLeft += left[index] * left[index];
    normRight += right[index] * right[index];
  }
  if (normLeft === 0 || normRight === 0) return 0;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

function decideTopicHeuristically(
  text: string,
  keywords: string[],
  flattened: FlattenedTopic[],
  topicTagSets: Map<number, string[]>,
  embeddingSimilarities?: Map<number, number>,
): TopicDecision {
  const candidates: TopicMatchCandidate[] = flattened.map((item) => ({
    id: item.topic.id,
    name: item.topic.name,
    depth: item.depth,
    tags: topicTagSets.get(item.topic.id) ?? [],
  }));

  const best = selectBestTopicMatch(
    { keywords, text },
    candidates,
    TOPIC_MATCH_THRESHOLD,
    embeddingSimilarities,
  );
  if (!best) {
    return { detail: "No match above threshold (heuristic)" };
  }
  const matched = flattened.find((item) => item.topic.id === best.id)?.topic;
  if (!matched) {
    return { detail: "No match above threshold (heuristic)" };
  }
  return {
    matchedTopic: matched,
    detail: `${matched.name} (${embeddingSimilarities ? "hybrid" : "heuristic"}, score ${best.score.toFixed(2)})`,
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
  const allMessageTexts = messages
    .map((message) => buildMessageSearchIndexText(message))
    .filter(Boolean);
  const messageTexts = sampleInConversationOrder(allMessageTexts, MAX_MESSAGE_COUNT);

  const text = buildConversationText(conversation, messageTexts);

  const topicsTree = await getTopics();
  const flattened = flattenTopicTree(topicsTree);
  const classificationContext = await collectClassificationContext();
  const heuristicTags = buildAdaptiveTags(
    text,
    classificationContext.tagVocabulary,
  );

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
      classification = await classifyWithLlm(
        conversation,
        messageTexts,
        flattened,
        classificationContext.tagVocabulary,
        text,
      );
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
      let embeddingSimilarities: Map<number, number> | undefined;
      try {
        embeddingSimilarities = await collectTopicEmbeddingSimilarities(
          conversationId,
          classificationContext,
        );
      } catch (error) {
        logger.warn("service", "Gardener cached-vector matching failed", {
          conversationId,
          error: (error as Error)?.message ?? String(error),
        });
      }
      const decision = decideTopicHeuristically(
        text,
        dedupeTags([...keywords, ...heuristicTags]),
        flattened,
        classificationContext.tagsByTopic,
        embeddingSimilarities,
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
