// ──────────────────────────────────────────────────────────────────────────
// Thinking Map — pure data layer for the Network "思维图谱" view.
//
// Turns cached conversation summaries into a focused concept graph:
//   - concept nodes  = key thoughts (key_insights terms), merged across talks
//   - conversation nodes = the talks that discussed them
//   - edges         = concept↔conversation (mentions) + concept↔concept (relates)
//   - clusters      = topic-based "lines of thinking" (colored)
//   - gaps          = prominent concept pairs that NEVER co-occurred (InfraNodus-
//                     style "you discussed X and Y but never connected them")
//
// No LLM, no embeddings — all derived in code from data already on disk.
// Design intent: seeded/focused + temporal + insight-first, NOT a global hairball.
// ──────────────────────────────────────────────────────────────────────────

import type { ChatSummaryData, Conversation, Platform } from "../../types";
import { getConversationOriginAt } from "./temporal-graph-utils";

export interface ThinkingConceptNode {
  id: string; // "concept:<key>"
  term: string; // display term (original casing)
  definition: string; // representative definition
  conversationIds: number[];
  count: number; // number of conversations that touched this concept
  firstSeenAt: number;
  lastSeenAt: number;
  clusterId: string;
}

export interface ThinkingConversationNode {
  id: string; // "conv:<id>"
  conversationId: number;
  title: string;
  platform: Platform;
  originAt: number;
  topicId: number | null;
}

export type ThinkingEdgeType = "mentions" | "relates";

export interface ThinkingEdge {
  source: string;
  target: string;
  type: ThinkingEdgeType;
  weight: number;
}

export interface ThinkingCluster {
  id: string;
  label: string;
  color: string;
  conceptIds: string[];
}

export interface ThinkingGap {
  a: ThinkingConceptNode;
  b: ThinkingConceptNode;
}

export interface ThinkingMap {
  concepts: ThinkingConceptNode[];
  conversationNodes: ThinkingConversationNode[];
  edges: ThinkingEdge[];
  clusters: ThinkingCluster[];
  gaps: ThinkingGap[];
  timeRange: { start: number; end: number };
}

export interface BuildThinkingMapOptions {
  /** Cap on concept nodes to keep the map focused (avoid the hairball). */
  maxConcepts?: number;
  /** Cap on surfaced "unconnected pair" insights. */
  maxGaps?: number;
  /** Concepts touching fewer than this many conversations are dropped from gaps. */
  minGapProminence?: number;
}

const DEFAULT_MAX_CONCEPTS = 40;
const DEFAULT_MAX_GAPS = 3;
const DEFAULT_MIN_GAP_PROMINENCE = 2;

// Distinct, theme-neutral cluster palette (works in light/dark — mid-ramp hues).
const CLUSTER_PALETTE = [
  "#7F77DD",
  "#1D9E75",
  "#D85A30",
  "#378ADD",
  "#D4537E",
  "#BA7517",
  "#639922",
  "#5DCAA5",
];

const NONE_CLUSTER_ID = "topic:none";

function normalizeTerm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function conceptKey(term: string): string {
  return normalizeTerm(term).toLowerCase();
}

interface ConceptAccumulator {
  key: string;
  term: string;
  definition: string;
  conversationIds: Set<number>;
  firstSeenAt: number;
  lastSeenAt: number;
}

/**
 * Build the Thinking Map from conversations + their cached summaries.
 * `summariesById` only needs entries for conversations that have a summary;
 * conversations without one simply contribute no concepts.
 */
export function buildThinkingMap(
  conversations: Conversation[],
  summariesById: Map<number, ChatSummaryData>,
  topicNameById: Map<number, string>,
  options: BuildThinkingMapOptions = {}
): ThinkingMap {
  const maxConcepts = options.maxConcepts ?? DEFAULT_MAX_CONCEPTS;
  const maxGaps = options.maxGaps ?? DEFAULT_MAX_GAPS;
  const minGapProminence = options.minGapProminence ?? DEFAULT_MIN_GAP_PROMINENCE;

  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation])
  );

  // 1) Extract + merge concepts from key_insights across all summarized talks.
  const accumulators = new Map<string, ConceptAccumulator>();
  for (const conversation of conversations) {
    if (conversation.is_trash) continue;
    const summary = summariesById.get(conversation.id);
    if (!summary) continue;
    const originAt = getConversationOriginAt(conversation);

    for (const insight of summary.key_insights ?? []) {
      const term = normalizeTerm(insight.term);
      if (!term) continue;
      const key = conceptKey(term);
      const definition = normalizeTerm(insight.definition);

      const existing = accumulators.get(key);
      if (existing) {
        existing.conversationIds.add(conversation.id);
        existing.firstSeenAt = Math.min(existing.firstSeenAt, originAt);
        existing.lastSeenAt = Math.max(existing.lastSeenAt, originAt);
        if (definition.length > existing.definition.length) {
          existing.definition = definition;
        }
      } else {
        accumulators.set(key, {
          key,
          term,
          definition,
          conversationIds: new Set([conversation.id]),
          firstSeenAt: originAt,
          lastSeenAt: originAt,
        });
      }
    }
  }

  // 2) Rank by prominence (# conversations), keep the top N to stay focused.
  const ranked = [...accumulators.values()].sort((a, b) => {
    const countDelta = b.conversationIds.size - a.conversationIds.size;
    if (countDelta !== 0) return countDelta;
    return a.firstSeenAt - b.firstSeenAt;
  });
  const kept = ranked.slice(0, maxConcepts);

  // 3) Assign each concept to a topic cluster (majority topic of its talks).
  const conceptCluster = new Map<string, string>();
  for (const acc of kept) {
    const topicCounts = new Map<number, number>();
    for (const conversationId of acc.conversationIds) {
      const topicId = conversationById.get(conversationId)?.topic_id ?? null;
      if (topicId === null) continue;
      topicCounts.set(topicId, (topicCounts.get(topicId) ?? 0) + 1);
    }
    let bestTopic: number | null = null;
    let bestCount = 0;
    for (const [topicId, count] of topicCounts) {
      if (count > bestCount) {
        bestTopic = topicId;
        bestCount = count;
      }
    }
    conceptCluster.set(
      acc.key,
      bestTopic === null ? NONE_CLUSTER_ID : `topic:${bestTopic}`
    );
  }

  // Stable cluster ordering: by total prominence, so colors are deterministic.
  const clusterProminence = new Map<string, number>();
  for (const acc of kept) {
    const clusterId = conceptCluster.get(acc.key) ?? NONE_CLUSTER_ID;
    clusterProminence.set(
      clusterId,
      (clusterProminence.get(clusterId) ?? 0) + acc.conversationIds.size
    );
  }
  const orderedClusterIds = [...clusterProminence.keys()].sort(
    (a, b) => (clusterProminence.get(b) ?? 0) - (clusterProminence.get(a) ?? 0)
  );
  const clusterColor = new Map<string, string>();
  orderedClusterIds.forEach((clusterId, index) => {
    clusterColor.set(clusterId, CLUSTER_PALETTE[index % CLUSTER_PALETTE.length]);
  });

  // 4) Materialize concept nodes.
  const concepts: ThinkingConceptNode[] = kept.map((acc) => ({
    id: `concept:${acc.key}`,
    term: acc.term,
    definition: acc.definition,
    conversationIds: [...acc.conversationIds].sort(
      (a, b) =>
        getConversationOriginAt(
          conversationById.get(a) ?? ({} as Conversation)
        ) -
        getConversationOriginAt(conversationById.get(b) ?? ({} as Conversation))
    ),
    count: acc.conversationIds.size,
    firstSeenAt: acc.firstSeenAt,
    lastSeenAt: acc.lastSeenAt,
    clusterId: conceptCluster.get(acc.key) ?? NONE_CLUSTER_ID,
  }));
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));

  // 5) Conversation nodes = the talks referenced by kept concepts.
  const referencedConversationIds = new Set<number>();
  for (const concept of concepts) {
    for (const conversationId of concept.conversationIds) {
      referencedConversationIds.add(conversationId);
    }
  }
  const conversationNodes: ThinkingConversationNode[] = [];
  for (const conversationId of referencedConversationIds) {
    const conversation = conversationById.get(conversationId);
    if (!conversation) continue;
    conversationNodes.push({
      id: `conv:${conversation.id}`,
      conversationId: conversation.id,
      title: conversation.title || "(untitled)",
      platform: conversation.platform,
      originAt: getConversationOriginAt(conversation),
      topicId: conversation.topic_id ?? null,
    });
  }

  // 6) Edges: mentions (concept↔conversation) + relates (concept↔concept共现).
  const edges: ThinkingEdge[] = [];
  const conversationToConcepts = new Map<number, string[]>();
  for (const concept of concepts) {
    for (const conversationId of concept.conversationIds) {
      edges.push({
        source: concept.id,
        target: `conv:${conversationId}`,
        type: "mentions",
        weight: 1,
      });
      const list = conversationToConcepts.get(conversationId) ?? [];
      list.push(concept.id);
      conversationToConcepts.set(conversationId, list);
    }
  }

  // relates = how many conversations two concepts share.
  const relatesWeight = new Map<string, number>();
  for (const conceptIds of conversationToConcepts.values()) {
    for (let i = 0; i < conceptIds.length; i += 1) {
      for (let j = i + 1; j < conceptIds.length; j += 1) {
        const [a, b] = [conceptIds[i], conceptIds[j]].sort();
        const pairKey = `${a}|${b}`;
        relatesWeight.set(pairKey, (relatesWeight.get(pairKey) ?? 0) + 1);
      }
    }
  }
  const relatedPairs = new Set<string>();
  for (const [pairKey, weight] of relatesWeight) {
    const [source, target] = pairKey.split("|");
    relatedPairs.add(pairKey);
    edges.push({ source, target, type: "relates", weight });
  }

  // 7) Clusters (with member concepts).
  const clusters: ThinkingCluster[] = orderedClusterIds.map((clusterId) => {
    const topicId =
      clusterId === NONE_CLUSTER_ID ? null : Number(clusterId.slice("topic:".length));
    const label =
      topicId !== null ? topicNameById.get(topicId) ?? clusterId : "";
    return {
      id: clusterId,
      label,
      color: clusterColor.get(clusterId) ?? CLUSTER_PALETTE[0],
      conceptIds: concepts
        .filter((concept) => concept.clusterId === clusterId)
        .map((concept) => concept.id),
    };
  });

  // 8) Gaps: prominent concepts in DIFFERENT clusters that never co-occurred.
  //    These are the "you explored both but never bridged them" prompts.
  const gapCandidates = concepts.filter(
    (concept) => concept.count >= minGapProminence
  );
  const gaps: ThinkingGap[] = [];
  for (let i = 0; i < gapCandidates.length && gaps.length < maxGaps; i += 1) {
    for (let j = i + 1; j < gapCandidates.length && gaps.length < maxGaps; j += 1) {
      const a = gapCandidates[i];
      const b = gapCandidates[j];
      if (a.clusterId === b.clusterId) continue; // same line of thinking already
      const [s, t] = [a.id, b.id].sort();
      if (relatedPairs.has(`${s}|${t}`)) continue; // already connected
      gaps.push({ a, b });
    }
  }

  // 9) Temporal range (for the x = time layout).
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const node of conversationNodes) {
    start = Math.min(start, node.originAt);
    end = Math.max(end, node.originAt);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    start = 0;
    end = 0;
  }

  return {
    concepts,
    conversationNodes,
    edges,
    clusters,
    gaps,
    timeRange: { start, end },
  };
}
