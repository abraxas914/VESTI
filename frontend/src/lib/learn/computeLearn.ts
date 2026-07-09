// "学习 Learn" — reframes the captured KB as a personal curriculum.
//
// Primary input is per-conversation structured summaries (when available).
// When summaries are sparse or missing, the module falls back to lightweight
// lexical signals extracted from conversation titles, snippets, and messages so
// that even users with only a few conversations see a useful learning map.

import type { Conversation, Message, SummaryRecord, Topic } from "../types";
import type {
  LearnDomain,
  LearnGlossaryEntry,
  LearnGoal,
  LearnOpenLoop,
  LearnPathStage,
  LearnProfile,
  LearnReviewItem,
} from "~vendor/vesti-ui";
import {
  buildTermIndexFromConversations,
  computeConfidence,
  depthOfSummary,
  estimateOpenLoopsFromMessages,
  groupMessagesByConversation,
  latestSummaryByConversation,
} from "../reflective/shared";

const MIN_LEARN_SAMPLE = 1;
const MAX_GLOSSARY = 24;
const MAX_OPEN_LOOPS = 14;
const DAYS_MS = 24 * 60 * 60 * 1000;

export interface ComputeLearnOptions {
  /** Raw messages used as a fallback when summaries are sparse or absent. */
  messages?: Message[];
}

type GlossaryAgg = LearnGlossaryEntry & { count: number; recencyAt: number };

function buildLearningPath(
  domains: LearnDomain[],
  glossary: GlossaryAgg[],
  openLoops: LearnOpenLoop[],
): LearnPathStage[] {
  if (domains.length === 0 && glossary.length === 0) return [];

  const sortedDomains = domains
    .slice()
    .sort((a, b) => b.count - a.count || b.deep - a.deep);
  const termsByDomain = new Map<number | null, GlossaryAgg[]>();
  for (const g of glossary) {
    // We don't have per-term domain mapping, so attach to top domain by recency
    // approximation: use the conversation's domain. For now, distribute by term
    // position in the sorted glossary.
    const key = sortedDomains.length > 0 ? sortedDomains[0].topicId : null;
    const list = termsByDomain.get(key) || [];
    list.push(g);
    termsByDomain.set(key, list);
  }

  const path: LearnPathStage[] = [];

  // Stage 1: Foundation in the dominant domain.
  const topDomain = sortedDomains[0];
  if (topDomain) {
    const topTerms = (termsByDomain.get(topDomain.topicId) || glossary)
      .slice(0, 5)
      .map((g) => g.term);
    path.push({
      stage: 1,
      title: `Establish ${topDomain.name || "your core topic"}`,
      description: "Lock in the key concepts that appear most often in your conversations.",
      concepts: topTerms.length > 0 ? topTerms : [topDomain.name || "Core concepts"],
      estimatedMinutes: 20,
    });
  }

  // Stage 2: Expand to adjacent domains.
  if (sortedDomains.length > 1) {
    const nextDomains = sortedDomains.slice(1, 3);
    const expandTerms = glossary
      .filter((g) => !path[0]?.concepts.includes(g.term))
      .slice(0, 5)
      .map((g) => g.term);
    path.push({
      stage: 2,
      title: `Connect ${nextDomains.map((d) => d.name || "new area").join(" & ")}`,
      description: "Bridge your core topic with neighboring domains to build a richer map.",
      concepts: expandTerms.length > 0 ? expandTerms : nextDomains.map((d) => d.name || "Adjacent area"),
      estimatedMinutes: 25,
    });
  }

  // Stage 3: Apply to open loops.
  if (openLoops.length > 0) {
    path.push({
      stage: 3,
      title: "Tackle open questions",
      description: "Use what you've learned to address the unresolved threads in your conversations.",
      concepts: openLoops.slice(0, 4).map((l) => l.text),
      estimatedMinutes: 30,
    });
  }

  // Stage 4: Synthesize.
  const synthesisTerms = glossary
    .filter((g) => !path.some((p) => p.concepts.includes(g.term)))
    .slice(0, 4)
    .map((g) => g.term);
  if (synthesisTerms.length > 0 || sortedDomains.length > 0) {
    path.push({
      stage: path.length + 1,
      title: "Synthesize your map",
      description: "Step back and connect the dots across domains and terms.",
      concepts: synthesisTerms.length > 0 ? synthesisTerms : sortedDomains.map((d) => d.name || "Domain"),
      estimatedMinutes: 20,
    });
  }

  return path.map((p, i) => ({ ...p, stage: i + 1 }));
}

function buildReviewQueue(glossary: GlossaryAgg[], now = Date.now()): LearnReviewItem[] {
  if (glossary.length === 0) return [];

  // Without persisted review history, we infer urgency from recency:
  // older terms are "due" sooner because they are at higher risk of fading.
  const withDue = glossary.map((g) => {
    const ageDays = Math.max(0, (now - g.recencyAt) / DAYS_MS);
    // First review interval grows with age: 1, 3, 7, 14 days.
    const intervalDays = ageDays < 1 ? 1 : ageDays < 3 ? 3 : ageDays < 7 ? 7 : 14;
    const dueAt = g.recencyAt + intervalDays * DAYS_MS;
    return { term: g.term, conversationId: g.conversationId, dueAt, intervalDays };
  });

  return withDue
    .filter((r) => r.dueAt <= now + 7 * DAYS_MS)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 12)
    .map(({ term, conversationId, dueAt, intervalDays }) => ({
      term,
      conversationId,
      dueAt,
      intervalDays,
    }));
}

function buildGoals(domains: LearnDomain[], glossary: GlossaryAgg[]): LearnGoal[] {
  if (domains.length === 0) return [];

  const sortedDomains = domains
    .slice()
    .sort((a, b) => b.count - a.count || b.deep - a.deep)
    .slice(0, 3);

  return sortedDomains.map((d, i) => {
    const total = Math.max(1, d.deep + d.moderate + d.superficial);
    const deepRatio = d.deep / total;
    // Progress: depth signals mastery; cap at 80% without explicit user tracking.
    const progress = Math.min(80, Math.round(20 + deepRatio * 60 + d.count * 2));
    const matchedTerms = glossary
      .slice(i * 3, i * 3 + 3)
      .map((g) => g.term)
      .filter(Boolean);
    return {
      id: `goal-${d.topicId ?? "uncategorized"}`,
      text: `Deepen ${d.name || "general knowledge"}`,
      progress,
      matchedTerms,
    };
  });
}

export function computeLearn(
  summaries: SummaryRecord[],
  topics: Topic[],
  conversations: Conversation[],
  options: ComputeLearnOptions = {},
): LearnProfile {
  const { messages = [] } = options;
  const summaryByConv = latestSummaryByConversation(summaries);
  const messagesByConv = groupMessagesByConversation(messages);
  const liveConvs = conversations.filter((c) => !c.is_archived && !c.is_trash);

  const topicName = new Map<number, string>();
  for (const t of topics) if (typeof t.id === "number") topicName.set(t.id, t.name);

  // ---- Domains: group conversations by topic, with a depth mix ----
  const domainAgg = new Map<
    string,
    { topicId: number | null; name: string; count: number; deep: number; moderate: number; superficial: number }
  >();
  for (const conv of liveConvs) {
    const topicId = typeof conv.topic_id === "number" ? conv.topic_id : null;
    const key = topicId === null ? "null" : String(topicId);
    let entry = domainAgg.get(key);
    if (!entry) {
      entry = {
        topicId,
        name: topicId !== null ? topicName.get(topicId) ?? "" : "",
        count: 0,
        deep: 0,
        moderate: 0,
        superficial: 0,
      };
      domainAgg.set(key, entry);
    }
    entry.count += 1;
    const d = depthOfSummary(summaryByConv.get(conv.id));
    if (d) entry[d] += 1;
  }
  const domains: LearnDomain[] = Array.from(domainAgg.values())
    .sort((a, b) => b.count - a.count)
    .map((e) => ({
      topicId: e.topicId,
      name: e.name,
      count: e.count,
      deep: e.deep,
      moderate: e.moderate,
      superficial: e.superficial,
    }));

  // ---- Glossary: key_insights terms across summaries (deduped + ranked) ----
  const glossaryMap = new Map<string, GlossaryAgg>();
  for (const rec of summaryByConv.values()) {
    const s = rec.structured as unknown as Record<string, unknown> | null | undefined;
    const insights = s && Array.isArray(s["key_insights"]) ? (s["key_insights"] as unknown[]) : [];
    const recencyAt = rec.createdAt ?? 0;
    for (const ki of insights) {
      let term = "";
      let def = "";
      if (typeof ki === "string") term = ki;
      else if (ki && typeof ki === "object") {
        term = typeof (ki as { term?: unknown }).term === "string" ? (ki as { term: string }).term : "";
        def = typeof (ki as { definition?: unknown }).definition === "string" ? (ki as { definition: string }).definition : "";
      }
      term = term.trim();
      if (term.length < 2 || term.length > 60) continue;
      const key = term.toLowerCase();
      const existing = glossaryMap.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.definition && def.trim()) existing.definition = def.trim();
        if (recencyAt > existing.recencyAt) existing.recencyAt = recencyAt;
      } else {
        glossaryMap.set(key, {
          term,
          definition: def.trim(),
          conversationId: rec.conversationId,
          count: 1,
          recencyAt,
        });
      }
    }
  }

  // Fallback glossary from raw messages when summaries are missing.
  if (summaryByConv.size === 0) {
    const termIndex = buildTermIndexFromConversations(liveConvs, messagesByConv);
    for (const [, entry] of termIndex) {
      if (entry.count < 2) continue;
      const key = entry.display.toLowerCase();
      if (!glossaryMap.has(key)) {
        glossaryMap.set(key, {
          term: entry.display,
          definition: "",
          conversationId: entry.conversationId,
          count: entry.count,
          recencyAt: entry.recencyAt,
        });
      }
    }
  }

  const glossaryAgg = Array.from(glossaryMap.values())
    .sort((a, b) => b.count - a.count || b.recencyAt - a.recencyAt)
    .slice(0, MAX_GLOSSARY);

  const glossary: LearnGlossaryEntry[] = glossaryAgg.map((entry) => ({
    term: entry.term,
    definition: entry.definition,
    conversationId: entry.conversationId,
  }));

  // ---- Open loops: unresolved_threads with their source conversation ----
  const openLoops: LearnOpenLoop[] = [];
  const seenLoops = new Set<string>();

  // Primary: structured unresolved_threads.
  for (const rec of summaryByConv.values()) {
    const s = rec.structured as unknown as Record<string, unknown> | null | undefined;
    const threads = s && Array.isArray(s["unresolved_threads"]) ? (s["unresolved_threads"] as unknown[]) : [];
    for (const t of threads) {
      if (typeof t !== "string") continue;
      const text = t.trim();
      if (text.length < 4) continue;
      const key = text.toLowerCase();
      if (seenLoops.has(key)) continue;
      seenLoops.add(key);
      openLoops.push({ text, conversationId: rec.conversationId });
      if (openLoops.length >= MAX_OPEN_LOOPS) break;
    }
    if (openLoops.length >= MAX_OPEN_LOOPS) break;
  }

  // Fallback: user questions from raw messages.
  if (openLoops.length === 0) {
    for (const conv of liveConvs) {
      const msgs = messagesByConv.get(conv.id) || [];
      const loops = estimateOpenLoopsFromMessages(msgs);
      for (const text of loops) {
        const key = text.toLowerCase();
        if (seenLoops.has(key)) continue;
        seenLoops.add(key);
        openLoops.push({ text, conversationId: conv.id });
        if (openLoops.length >= MAX_OPEN_LOOPS) break;
      }
      if (openLoops.length >= MAX_OPEN_LOOPS) break;
    }
  }

  const sampleSize = liveConvs.length;
  const hasSummaries = summaryByConv.size > 0;
  const confidence = computeConfidence(sampleSize, hasSummaries);
  const available = sampleSize >= MIN_LEARN_SAMPLE && (domains.length > 0 || glossary.length > 0);

  // When no topics exist, synthesize domain names from conversation titles.
  const finalDomains = domains.map((d) => ({
    ...d,
    name:
      d.name ||
      (d.topicId === null
        ? liveConvs.find((c) => c.topic_id === null)?.platform || "Uncategorized"
        : ""),
  }));

  // Enriched outputs.
  const learningPath = buildLearningPath(finalDomains, glossaryAgg, openLoops);
  const reviewQueue = buildReviewQueue(glossaryAgg);
  const goals = buildGoals(finalDomains, glossaryAgg);

  return {
    available,
    sampleSize,
    confidence,
    domains: finalDomains,
    glossary,
    openLoops,
    learningPath: learningPath.length > 0 ? learningPath : undefined,
    reviewQueue: reviewQueue.length > 0 ? reviewQueue : undefined,
    goals: goals.length > 0 ? goals : undefined,
    generatedAt: Date.now(),
  };
}
