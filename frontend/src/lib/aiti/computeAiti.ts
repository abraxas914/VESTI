// AITI (个人内向探索) — a "thinking fingerprint" computed 100% locally from the
// per-conversation summaries VESTI already stores. No LLM, no new extraction, no
// raw chat text: it only aggregates the structured signals in
// ConversationSummary (meta_observations.depth_level/emotional_tone,
// key_insights, unresolved_threads, actionable_next_steps, tech_stack, sentiment)
// into four evidence-linked axes + the user's top recurring "obsessions".
//
// Output is locale-agnostic (scores + keys + evidence ids); the UI applies the
// localized axis labels and assembles the type code.

import type { SummaryRecord } from "../types";
import type { AitiProfile, AitiAxisScore, AitiObsession } from "~vendor/vesti-ui";

const MIN_AITI_SAMPLE = 5;
const DEPTH_SCORE: Record<string, number> = {
  superficial: 15,
  moderate: 55,
  deep: 90,
};
const MAX_OBSESSIONS = 10;

const SPIRITED_KW = [
  "excit", "curious", "enthusi", "passion", "frustrat", "anx", "eager", "worried",
  "兴奋", "好奇", "热", "焦", "沮", "急", "激动", "兴趣",
];
const COOL_KW = [
  "calm", "neutral", "analy", "method", "object", "ration", "measured",
  "冷静", "中性", "理性", "客观", "平和", "沉稳",
];

interface Feat {
  conversationId: number;
  createdAt: number;
  depth: number | null;
  maker: boolean;
  theorist: boolean;
  unresolved: number;
  affect: 1 | -1 | null; // 1 = spirited, -1 = cool
  terms: string[];
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

function extract(rec: SummaryRecord): Feat | null {
  const s = rec.structured as unknown as Record<string, unknown> | null | undefined;
  if (!s || typeof s !== "object") return null;
  if (typeof rec.conversationId !== "number") return null;

  const meta = s.meta_observations as Record<string, unknown> | undefined;
  const depthLevel = meta && typeof meta.depth_level === "string" ? meta.depth_level : null;
  const depth = depthLevel && depthLevel in DEPTH_SCORE ? DEPTH_SCORE[depthLevel] : null;

  const actionable = Array.isArray(s.actionable_next_steps) ? s.actionable_next_steps.length : 0;
  const techStackArr = Array.isArray(s.tech_stack_detected) ? (s.tech_stack_detected as unknown[]) : [];
  const insights = Array.isArray(s.key_insights) ? (s.key_insights as unknown[]) : [];

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
  const unresolved = Array.isArray(s.unresolved_threads) ? s.unresolved_threads.length : 0;

  const tone = meta && typeof meta.emotional_tone === "string" ? meta.emotional_tone.toLowerCase() : "";
  const sentiment = typeof s.sentiment === "string" ? s.sentiment : null;
  let affect: 1 | -1 | null = null;
  if (tone) {
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

/** Keep the latest summary per conversation. */
function dedupeLatest(records: SummaryRecord[]): SummaryRecord[] {
  const byConv = new Map<number, SummaryRecord>();
  for (const rec of records) {
    if (typeof rec.conversationId !== "number") continue;
    const prev = byConv.get(rec.conversationId);
    if (!prev || (rec.createdAt ?? 0) > (prev.createdAt ?? 0)) byConv.set(rec.conversationId, rec);
  }
  return Array.from(byConv.values());
}

function evidence(feats: Feat[], rank: (f: Feat) => number, n = 3): number[] {
  return [...feats]
    .filter((f) => rank(f) > 0)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, n)
    .map((f) => f.conversationId);
}

export function computeAiti(records: SummaryRecord[]): AitiProfile {
  const feats = dedupeLatest(records)
    .map(extract)
    .filter((f): f is Feat => f !== null);

  const sampleSize = feats.length;
  if (sampleSize < MIN_AITI_SAMPLE) {
    return { available: false, sampleSize, axes: [], obsessions: [] };
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

  // Evidence per axis. An empty list means the score is a neutral default with
  // nothing behind it (e.g. no conversation carried a depth_level / affect cue),
  // so hasSignal=false and the UI renders that axis muted instead of confidently
  // assigning a flattering pole.
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

  return { available: true, sampleSize, axes, obsessions };
}
