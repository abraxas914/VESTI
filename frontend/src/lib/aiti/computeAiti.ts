// AITI (个人内向探索) — a "thinking fingerprint" computed locally from the
// per-conversation summaries VESTI already stores, with a lightweight fallback
// that uses raw messages when summaries are sparse or missing. No LLM is
// invoked during computation; any narrative generation is optional and
// user-triggered outside this file.

import type { Conversation, Message, SummaryRecord } from "../types";
import type { AitiAxisScore, AitiObsession, AitiProfile } from "~vendor/vesti-ui";
import {
  computeConfidence,
  depthOfSummary,
  depthScoreOf,
  estimateAffectFromMessages,
  estimateDepthFromMessages,
  estimateMakerTheoristFromMessages,
  estimateOpenLoopsFromMessages,
  groupMessagesByConversation,
  latestSummaryByConversation,
} from "../reflective/shared";

const MIN_AITI_SAMPLE = 2;
const MAX_OBSESSIONS = 10;

interface Feat {
  conversationId: number;
  createdAt: number;
  depth: number | null;
  maker: boolean;
  theorist: boolean;
  unresolved: number;
  affect: 1 | -1 | null;
  terms: string[];
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

function extractFromSummary(rec: SummaryRecord): Feat | null {
  if (typeof rec.conversationId !== "number") return null;

  const s = rec.structured as unknown as Record<string, unknown> | null | undefined;
  if (!s || typeof s !== "object") return null;

  const meta = s["meta_observations"] as Record<string, unknown> | undefined;
  const depth = depthScoreOf(depthOfSummary(rec));

  const actionable = Array.isArray(s["actionable_next_steps"])
    ? (s["actionable_next_steps"] as unknown[]).length
    : 0;
  const techStackArr = Array.isArray(s["tech_stack_detected"])
    ? (s["tech_stack_detected"] as unknown[])
    : [];
  const insights = Array.isArray(s["key_insights"]) ? (s["key_insights"] as unknown[]) : [];

  const terms: string[] = [];
  for (const ki of insights) {
    if (typeof ki === "string") terms.push(ki);
    else if (ki && typeof ki === "object" && typeof (ki as { term?: unknown }).term === "string") {
      terms.push((ki as { term: string }).term);
    }
  }
  for (const t of techStackArr) if (typeof t === "string") terms.push(t);

  const maker = actionable >= 1 || techStackArr.length >= 1;
  const theorist = insights.length >= 2;
  const unresolved = Array.isArray(s["unresolved_threads"])
    ? (s["unresolved_threads"] as unknown[]).length
    : 0;

  const tone = meta && typeof meta["emotional_tone"] === "string" ? meta["emotional_tone"].toLowerCase() : "";
  const sentiment = typeof s["sentiment"] === "string" ? s["sentiment"] : null;
  let affect: 1 | -1 | null = null;
  if (tone) {
    const SPIRITED_KW = [
      "excit", "curious", "enthusi", "passion", "frustrat", "anx", "eager", "worried",
      "兴奋", "好奇", "热", "焦", "沮", "急", "激动", "兴趣",
    ];
    const COOL_KW = [
      "calm", "neutral", "analy", "method", "object", "ration", "measured",
      "冷静", "中性", "理性", "客观", "平和", "沉稳",
    ];
    if (SPIRITED_KW.some((k) => tone.includes(k))) affect = 1;
    else if (COOL_KW.some((k) => tone.includes(k))) affect = -1;
  }
  if (affect === null && sentiment) {
    if (sentiment === "positive" || sentiment === "negative") affect = 1;
    else if (sentiment === "neutral") affect = -1;
  }

  return {
    conversationId: rec.conversationId,
    createdAt: typeof rec.createdAt === "number" ? rec.createdAt : 0,
    depth,
    maker,
    theorist,
    unresolved,
    affect,
    terms,
  };
}

function extractFromMessages(
  conversationId: number,
  messages: Message[],
): Feat | null {
  if (messages.length === 0) return null;

  const depthLevel = estimateDepthFromMessages(messages);
  const depth = depthScoreOf(depthLevel);
  const { maker, theorist } = estimateMakerTheoristFromMessages(messages);
  const affect = estimateAffectFromMessages(messages);
  const unresolved = estimateOpenLoopsFromMessages(messages).length;

  // Terms: collect from message text (simple frequency fallback).
  const termCounts = new Map<string, string>();
  for (const m of messages) {
    const text = (m.content_text || "").trim();
    if (!text) continue;
    const words = text
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && w.length <= 40);
    for (const w of words) {
      const key = w.toLowerCase();
      if (!termCounts.has(key) || w.length > (termCounts.get(key)?.length ?? 0)) {
        termCounts.set(key, w);
      }
    }
  }

  const terms = Array.from(termCounts.values()).slice(0, 12);

  return {
    conversationId,
    createdAt: messages[messages.length - 1]?.created_at || 0,
    depth,
    maker,
    theorist,
    unresolved,
    affect,
    terms,
  };
}

function evidence(feats: Feat[], rank: (f: Feat) => number, n = 3): number[] {
  return [...feats]
    .filter((f) => rank(f) > 0)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, n)
    .map((f) => f.conversationId);
}

export interface ComputeAitiOptions {
  /** Raw messages used as a fallback when summaries are sparse or absent. */
  messages?: Message[];
  /** Conversations used to map messages and enrich metadata. */
  conversations?: Conversation[];
}

export function computeAiti(
  records: SummaryRecord[],
  options: ComputeAitiOptions = {},
): AitiProfile {
  const { messages = [], conversations = [] } = options;
  const summaryByConv = latestSummaryByConversation(records);
  const messagesByConv = groupMessagesByConversation(messages);
  const liveConversations = conversations.filter((c) => !c.is_trash);

  // Build features from summaries when available; otherwise fall back to messages.
  const feats: Feat[] = [];
  const convIds = new Set<number>();

  for (const conv of liveConversations) {
    convIds.add(conv.id);
    const summary = summaryByConv.get(conv.id);
    const msgs = messagesByConv.get(conv.id) || [];
    const feat = summary
      ? extractFromSummary(summary)
      : extractFromMessages(conv.id, msgs);
    if (feat) feats.push(feat);
  }

  // Also include conversations that only have messages but were not in the live list.
  for (const [convId, msgs] of messagesByConv.entries()) {
    if (convIds.has(convId) || msgs.length === 0) continue;
    const feat = extractFromMessages(convId, msgs);
    if (feat) feats.push(feat);
  }

  const sampleSize = feats.length;
  const hasSummaries = summaryByConv.size > 0;
  const confidence = computeConfidence(sampleSize, hasSummaries);

  if (sampleSize < MIN_AITI_SAMPLE) {
    return {
      available: false,
      sampleSize,
      confidence,
      axes: [],
      obsessions: [],
      generatedAt: Date.now(),
    };
  }

  // depth
  const depthVals = feats.map((f) => f.depth).filter((d): d is number => d !== null);
  const depthScore = depthVals.length
    ? clamp(depthVals.reduce((a, b) => a + b, 0) / depthVals.length)
    : 50;

  // maker vs theorist
  const makerFrac = feats.filter((f) => f.maker).length / sampleSize;
  const theoristFrac = feats.filter((f) => f.theorist).length / sampleSize;
  const makerScore = clamp(50 + 50 * (makerFrac - theoristFrac));

  // focus: more unresolved threads → more "wanderer"
  const avgUnresolved = feats.reduce((a, f) => a + f.unresolved, 0) / sampleSize;
  const focusScore = clamp(20 + avgUnresolved * 22);

  // affect
  const affectFeats = feats.filter((f) => f.affect !== null);
  const spiritedFrac = affectFeats.length
    ? affectFeats.filter((f) => f.affect === 1).length / affectFeats.length
    : 0;
  const coolFrac = affectFeats.length
    ? affectFeats.filter((f) => f.affect === -1).length / affectFeats.length
    : 0;
  const affectScore = affectFeats.length ? clamp(50 + 50 * (spiritedFrac - coolFrac)) : 50;

  const depthEvidence = evidence(feats, (f) => f.depth ?? 0);
  const makerEvidence = evidence(feats, (f) =>
    makerScore >= 50 ? (f.maker ? 1 : 0) : f.theorist ? 1 : 0,
  );
  const focusEvidence = evidence(feats, (f) => f.unresolved);
  const affectEvidence = evidence(feats, (f) =>
    affectScore >= 50 ? (f.affect === 1 ? 1 : 0) : f.affect === -1 ? 1 : 0,
  );

  const axes: AitiAxisScore[] = [
    {
      key: "depth",
      score: Math.round(depthScore),
      evidenceConversationIds: depthEvidence,
      hasSignal: depthEvidence.length > 0,
    },
    {
      key: "maker",
      score: Math.round(makerScore),
      evidenceConversationIds: makerEvidence,
      hasSignal: makerEvidence.length > 0,
    },
    {
      key: "focus",
      score: Math.round(focusScore),
      evidenceConversationIds: focusEvidence,
      hasSignal: focusEvidence.length > 0,
    },
    {
      key: "affect",
      score: Math.round(affectScore),
      evidenceConversationIds: affectEvidence,
      hasSignal: affectEvidence.length > 0,
    },
  ];

  // obsessions: most frequent insight terms / tech across conversations
  const counts = new Map<string, { display: string; count: number }>();
  for (const f of feats) {
    const seenInConv = new Set<string>();
    for (const raw of f.terms) {
      const term = raw.trim();
      if (term.length < 2 || term.length > 40) continue;
      const key = term.toLowerCase();
      if (seenInConv.has(key)) continue;
      seenInConv.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { display: term, count: 1 });
    }
  }
  const obsessions: AitiObsession[] = Array.from(counts.values())
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_OBSESSIONS)
    .map((e) => ({ term: e.display, count: e.count }));

  return {
    available: true,
    sampleSize,
    confidence,
    axes,
    obsessions,
    generatedAt: Date.now(),
  };
}

// Re-export for consumers that want to build fallback-aware pipelines.
export type { Feat };
