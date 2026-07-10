// AITI (个人内向探索) — a "thinking fingerprint" computed locally from the
// per-conversation summaries VESTI already stores, with a lightweight fallback
// that uses raw messages when summaries are sparse or missing. No LLM is
// invoked during computation; any narrative generation is optional and
// user-triggered outside this file.

import type { Conversation, Message, SummaryRecord } from "../types";
import type { AitiAxisScore, AitiObsession, AitiProfile, AitiTrend } from "~vendor/vesti-ui";
import {
  COOL_KW,
  SPIRITED_KW,
  computeConfidence,
  depthOfSummary,
  depthScoreOf,
  estimateAffectFromMessages,
  estimateCuriosityFromMessages,
  estimateDepthFromMessages,
  estimateInterdisciplinaryFromConversations,
  estimateMakerTheoristFromMessages,
  estimateOpenLoopsFromMessages,
  extractTermsFromText,
  groupMessagesByConversation,
  latestSummaryByConversation,
  partitionByWindow,
} from "../reflective/shared";

const MIN_AITI_SAMPLE = 2;
const MAX_OBSESSIONS = 10;
const TREND_WINDOW_DAYS = 30;

interface Feat {
  conversationId: number;
  createdAt: number;
  depth: number | null;
  maker: boolean;
  theorist: boolean;
  unresolved: number;
  affect: 1 | -1 | null;
  curiosity: number | null;
  terms: string[];
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

// Normalize V1/V2/V2Legacy summary fields into a common shape for AITI.
function normalizeSummaryFields(s: Record<string, unknown>) {
  const insightsRaw: unknown[] =
    Array.isArray(s["key_insights"])
      ? (s["key_insights"] as unknown[])
      : Array.isArray(s["key_takeaways"])
        ? (s["key_takeaways"] as unknown[])
        : [];

  const actionableRaw: unknown[] =
    Array.isArray(s["actionable_next_steps"])
      ? (s["actionable_next_steps"] as unknown[])
      : Array.isArray(s["action_items"])
        ? (s["action_items"] as unknown[])
        : [];

  const techStackRaw: unknown[] = Array.isArray(s["tech_stack_detected"])
    ? (s["tech_stack_detected"] as unknown[])
    : [];

  const unresolvedRaw: unknown[] = Array.isArray(s["unresolved_threads"])
    ? (s["unresolved_threads"] as unknown[])
    : [];

  const terms: string[] = [];
  for (const ki of insightsRaw) {
    if (typeof ki === "string") terms.push(ki);
    else if (ki && typeof ki === "object" && typeof (ki as Record<string, unknown>).term === "string") {
      terms.push((ki as { term: string }).term);
    }
  }
  for (const t of techStackRaw) if (typeof t === "string") terms.push(t);

  const meta = s["meta_observations"] && typeof s["meta_observations"] === "object"
    ? (s["meta_observations"] as Record<string, unknown>)
    : undefined;

  return {
    insights: insightsRaw,
    actionable: actionableRaw,
    techStack: techStackRaw,
    unresolved: unresolvedRaw,
    terms,
    meta,
    sentiment: typeof s["sentiment"] === "string" ? s["sentiment"] : undefined,
  };
}

function extractFromSummary(
  rec: SummaryRecord,
  messagesByConv?: Map<number, Message[]>,
): Feat | null {
  if (typeof rec.conversationId !== "number") return null;

  const s = rec.structured as unknown as Record<string, unknown> | null | undefined;
  if (!s || typeof s !== "object") return null;

  const fields = normalizeSummaryFields(s);
  const depth = depthScoreOf(depthOfSummary(rec));

  const maker = fields.actionable.length >= 1 || fields.techStack.length >= 1;
  const theorist = fields.insights.length >= 2;
  const unresolved = fields.unresolved.length;

  // Curiosity proxy from structured summary: lots of insights + open threads.
  const curiosityFromSummary =
    fields.insights.length + fields.unresolved.length > 0
      ? clamp(30 + fields.insights.length * 8 + fields.unresolved.length * 6)
      : null;

  // Fallback curiosity from messages if available.
  const msgs = messagesByConv?.get(rec.conversationId);
  const curiosity =
    curiosityFromSummary ?? (msgs && msgs.length > 0 ? estimateCuriosityFromMessages(msgs) : null);

  const tone = fields.meta && typeof fields.meta["emotional_tone"] === "string"
    ? fields.meta["emotional_tone"].toLowerCase()
    : "";
  const sentiment = fields.sentiment ?? null;
  let affect: 1 | -1 | null = null;

  // Structured emotional tone takes priority.
  if (tone) {
    if (SPIRITED_KW.some((k) => tone.includes(k))) affect = 1;
    else if (COOL_KW.some((k) => tone.includes(k))) affect = -1;
  }

  // Fallback to message-level affect when the summary has no tone signal.
  if (affect === null) {
    const msgs = messagesByConv?.get(rec.conversationId);
    if (msgs && msgs.length > 0) {
      affect = estimateAffectFromMessages(msgs);
    }
  }

  // Sentiment is a last resort: any strong valence reads as "spirited",
  // neutral reads as "cool-headed".
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
    curiosity,
    terms: fields.terms,
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
  const curiosity = estimateCuriosityFromMessages(messages);

  // Terms: collect from message text using the shared extractor, ranked by
  // frequency across the conversation and then by recency (last message wins).
  const termCounts = new Map<string, { display: string; count: number; lastAt: number }>();
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const text = (m.content_text || "").trim();
    if (!text) continue;
    for (const term of extractTermsFromText(text)) {
      const key = term.toLowerCase();
      const existing = termCounts.get(key);
      if (existing) {
        existing.count += 1;
        existing.lastAt = i;
      } else {
        termCounts.set(key, { display: term, count: 1, lastAt: i });
      }
    }
  }

  const terms = Array.from(termCounts.values())
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 12)
    .map((e) => e.display);

  return {
    conversationId,
    createdAt: messages[messages.length - 1]?.created_at ?? 0,
    depth,
    maker,
    theorist,
    unresolved,
    affect,
    curiosity,
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

function buildAxis(
  key: string,
  score: number,
  feats: Feat[],
  rank: (f: Feat) => number,
): AitiAxisScore {
  const ev = evidence(feats, rank);
  return {
    key,
    score: Math.round(score),
    evidenceConversationIds: ev,
    hasSignal: ev.length > 0,
  };
}

/** Compute the four core axes plus extended axes from a feature set. */
function computeAxes(feats: Feat[]): AitiAxisScore[] {
  const sampleSize = feats.length;

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

  // curiosity
  const curiosityVals = feats.map((f) => f.curiosity).filter((c): c is number => c !== null);
  const curiosityScore = curiosityVals.length
    ? clamp(curiosityVals.reduce((a, b) => a + b, 0) / curiosityVals.length)
    : 50;

  return [
    buildAxis("depth", depthScore, feats, (f) => f.depth ?? 0),
    buildAxis("maker", makerScore, feats, (f) =>
      makerScore > 50 ? (f.maker ? 1 : 0) : f.theorist ? 1 : 0,
    ),
    buildAxis("focus", focusScore, feats, (f) => f.unresolved),
    buildAxis("affect", affectScore, feats, (f) =>
      affectScore > 50 ? (f.affect === 1 ? 1 : 0) : f.affect === -1 ? 1 : 0,
    ),
    buildAxis("curiosity", curiosityScore, feats, (f) => f.curiosity ?? 0),
  ];
}

function computeObsessions(feats: Feat[]): AitiObsession[] {
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
  return Array.from(counts.values())
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_OBSESSIONS)
    .map((e) => ({ term: e.display, count: e.count }));
}

function computeTrends(allFeats: Feat[], recentFeats: Feat[]): AitiTrend[] | undefined {
  if (recentFeats.length < 2 || allFeats.length < 3) return undefined;

  const allAxes = computeAxes(allFeats);
  const recentAxes = computeAxes(recentFeats);
  const recentMap = new Map(recentAxes.map((a) => [a.key, a.score]));

  const trends: AitiTrend[] = [];
  for (const axis of allAxes) {
    const recentScore = recentMap.get(axis.key);
    if (recentScore === undefined) continue;
    const delta = recentScore - axis.score;
    if (Math.abs(delta) < 5) {
      trends.push({ key: axis.key, direction: "stable", delta: Math.round(Math.abs(delta)), windowLabel: "Last 30 days" });
    } else if (delta > 0) {
      trends.push({ key: axis.key, direction: "rising", delta: Math.round(delta), windowLabel: "Last 30 days" });
    } else {
      trends.push({ key: axis.key, direction: "falling", delta: Math.round(Math.abs(delta)), windowLabel: "Last 30 days" });
    }
  }
  return trends.length > 0 ? trends : undefined;
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

  // Build one feature per live conversation. Prefer the latest structured
  // summary; fall back to raw messages when no summary exists.
  const feats: Feat[] = [];
  for (const conv of liveConversations) {
    const summary = summaryByConv.get(conv.id);
    const msgs = messagesByConv.get(conv.id) || [];
    const feat = summary
      ? extractFromSummary(summary, messagesByConv)
      : extractFromMessages(conv.id, msgs);
    if (feat) feats.push(feat);
  }

  const sampleSize = feats.length;
  const hasSummaries = liveConversations.some((c) => summaryByConv.has(c.id));
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

  const axes = computeAxes(feats);

  // Interdisciplinary axis depends on conversation-level metadata.
  const interdisciplinaryScore = estimateInterdisciplinaryFromConversations(liveConversations);
  axes.push({
    key: "interdisciplinary",
    score: interdisciplinaryScore,
    evidenceConversationIds: liveConversations.slice(0, 3).map((c) => c.id),
    hasSignal: liveConversations.length >= 2 && interdisciplinaryScore >= 35,
  });

  const obsessions = computeObsessions(feats);

  // Trends: compare recent window to all-time.
  const { recent } = partitionByWindow(feats, TREND_WINDOW_DAYS);
  const trends = computeTrends(feats, recent);

  return {
    available: true,
    sampleSize,
    confidence,
    axes,
    obsessions,
    trends,
    generatedAt: Date.now(),
  };
}
