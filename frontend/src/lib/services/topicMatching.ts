// Heuristic topic matching: score the overlap between a conversation's
// keyword set and each topic's name + the tags of conversations already
// archived under that topic. Pure functions, unit-testable without a DB.

import type { Topic } from "../types";
import { tokenizeForMatch } from "./keywordExtraction";

export interface FlattenedTopic {
  topic: Topic;
  depth: number;
  /** Human-readable hierarchy path, e.g. "编程 / 前端 / React". */
  path: string;
}

export interface TopicMatchCandidate {
  id: number;
  name: string;
  depth: number;
  /** Tags aggregated from conversations already archived under this topic. */
  tags: string[];
}

export interface TopicMatchResult {
  id: number;
  score: number;
}

/** Minimum blended score required before a conversation is auto-archived. */
export const TOPIC_MATCH_THRESHOLD = 0.3;

export const TOPIC_PATH_SEPARATOR = " / ";

export function flattenTopicTree(
  topics: Topic[],
  depth = 0,
  parentPath = ""
): FlattenedTopic[] {
  const output: FlattenedTopic[] = [];
  for (const topic of topics) {
    const path = parentPath
      ? `${parentPath}${TOPIC_PATH_SEPARATOR}${topic.name}`
      : topic.name;
    output.push({ topic, depth, path });
    if (topic.children && topic.children.length > 0) {
      output.push(...flattenTopicTree(topic.children, depth + 1, path));
    }
  }
  return output;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let size = 0;
  for (const item of a) {
    if (b.has(item)) size += 1;
  }
  return size;
}

/**
 * Score how well a conversation matches a topic in [0, 1].
 * Blend of:
 * - name coverage: fraction of the topic-name tokens present in the
 *   conversation keywords (or the full name appearing verbatim in the text);
 * - tag overlap: Jaccard-style overlap between conversation keywords and the
 *   tags of conversations already archived under the topic;
 * - embedding similarity (V2): cosine similarity between the conversation
 *   embedding and the topic's centroid embedding, when available. This
 *   catches cross-vocabulary matches (e.g. "容器编排" ↔ "Docker/K8s").
 */
export function scoreTopicCandidate(
  input: { keywordTokens: Set<string>; textLower: string },
  candidate: Pick<TopicMatchCandidate, "name" | "tags">,
  options?: { embeddingSimilarity?: number },
): number {
  const nameTokens = tokenizeForMatch(candidate.name);

  let nameScore = 0;
  const nameLower = candidate.name.trim().toLowerCase();
  if (nameLower.length >= 2 && input.textLower.includes(nameLower)) {
    nameScore = 1;
  } else if (nameTokens.size > 0) {
    nameScore = intersectionSize(nameTokens, input.keywordTokens) / nameTokens.size;
  }

  let tagScore = 0;
  if (candidate.tags.length > 0 && input.keywordTokens.size > 0) {
    const tagTokens = new Set<string>();
    for (const tag of candidate.tags) {
      for (const token of tokenizeForMatch(tag)) {
        tagTokens.add(token);
      }
    }
    if (tagTokens.size > 0) {
      const hits = intersectionSize(tagTokens, input.keywordTokens);
      const jaccard =
        hits / (tagTokens.size + input.keywordTokens.size - hits);
      const containment = hits / Math.min(tagTokens.size, input.keywordTokens.size);
      tagScore = 0.4 * jaccard + 0.6 * containment;
    }
  }

  // V2: blend embedding similarity when available.
  const hasEmbedding =
    options?.embeddingSimilarity !== undefined &&
    options.embeddingSimilarity >= 0 &&
    options.embeddingSimilarity <= 1;
  if (hasEmbedding) {
    // 50% name + 25% tags + 25% embedding — embedding catches
    // cross-vocabulary matches that keyword overlap misses.
    return 0.50 * nameScore + 0.25 * tagScore + 0.25 * (options!.embeddingSimilarity!);
  }
  return 0.65 * nameScore + 0.35 * tagScore;
}

/**
 * Pick the best-scoring topic above the threshold, or null when nothing is a
 * confident match (in which case the conversation must NOT be force-archived).
 * Ties prefer deeper (more specific) topics, then lexicographic name order.
 *
 * V2: `embeddingSimilarities` (optional) — a Map of topicId → cosine similarity
 * from the conversation embedding. When provided, the similarity is blended
 * into the scoring formula for each candidate.
 */
export function selectBestTopicMatch(
  input: { keywords: string[]; text: string },
  candidates: TopicMatchCandidate[],
  threshold = TOPIC_MATCH_THRESHOLD,
  embeddingSimilarities?: Map<number, number>,
): TopicMatchResult | null {
  const keywordTokens = new Set<string>();
  for (const keyword of input.keywords) {
    for (const token of tokenizeForMatch(keyword)) {
      keywordTokens.add(token);
    }
  }
  const scoreInput = {
    keywordTokens,
    textLower: input.text.toLowerCase(),
  };

  let best: (TopicMatchResult & { depth: number; name: string }) | null = null;
  for (const candidate of candidates) {
    const embeddingSimilarity = embeddingSimilarities?.get(candidate.id);
    const score = scoreTopicCandidate(scoreInput, candidate,
      embeddingSimilarity !== undefined ? { embeddingSimilarity } : undefined
    );
    if (score < threshold) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        (candidate.depth > best.depth ||
          (candidate.depth === best.depth &&
            candidate.name.localeCompare(best.name) < 0)))
    ) {
      best = { id: candidate.id, score, depth: candidate.depth, name: candidate.name };
    }
  }

  return best ? { id: best.id, score: best.score } : null;
}
