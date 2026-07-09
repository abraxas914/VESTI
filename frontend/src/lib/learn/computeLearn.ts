// "学习 Learn" — reframes the captured KB as a personal curriculum.
//
// Primary input is per-conversation structured summaries (when available).
// When summaries are sparse or missing, the module falls back to lightweight
// lexical signals extracted from conversation titles, snippets, and messages so
// that even users with only a few conversations see a useful learning map.

import type { Conversation, Message, SummaryRecord, Topic } from "../types";
import type {
  DashboardLabels,
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
const MAX_REVIEW_QUEUE = 12;
const MAX_PATH_TERMS = 5;
const MAX_PATH_OPEN_LOOPS = 4;
const MAX_GOAL_TERMS = 3;
const DAYS_MS = 24 * 60 * 60 * 1000;

type GlossaryAgg = LearnGlossaryEntry & {
  count: number;
  recencyAt: number;
  /** topic_id of the conversation that most recently contributed this term. */
  topicId: number | null;
};

// Default English copy used when localized labels are not supplied (e.g. in
// test harnesses or early bootstrapping).
const DEFAULT_LEARN_LABELS: DashboardLabels["learn"] = {
  modeLearn: "Learn",
  title: "What you've been learning",
  subtitle: "Your conversations, organized as a personal curriculum. Computed locally.",
  insufficient: "Not enough conversations yet — keep chatting and your learning map will fill in.",
  insufficientHint: "Start 1–2 conversations and Learn will surface domains, terms, and open questions.",
  sample: "From {n} analyzed conversations",
  confidenceLabel: "Confidence",
  confidenceLow: "Preliminary",
  confidenceMedium: "Growing",
  confidenceHigh: "Solid",
  domainsTitle: "Knowledge domains",
  uncategorized: "Uncategorized",
  domainConversations: "{n} conversations",
  glossaryTitle: "Things you've learned",
  openLoopsTitle: "Open loops",
  openLoopsEmpty: "No unresolved threads — nicely closed out.",
  learningPathTitle: "Suggested learning path",
  learningPathStage: "Stage {n}",
  learningPathEstimatedMinutes: "~{n} min",
  reviewQueueTitle: "Due for review",
  reviewQueueEmpty: "Nothing due for review right now.",
  reviewDueNow: "Due now",
  reviewDueSoon: "Due soon",
  goalsTitle: "Learning goals",
  goalsEmpty: "No goals inferred yet — keep chatting and goals will appear.",
  learningPathFoundationTitle: "Establish {domain}",
  learningPathExpandTitle: "Connect {domains}",
  learningPathApplyTitle: "Tackle open questions",
  learningPathSynthesizeTitle: "Synthesize your map",
  learningPathFoundationDesc:
    "Lock in the key concepts that appear most often in your conversations.",
  learningPathExpandDesc: "Bridge your core topic with neighboring domains to build a richer map.",
  learningPathApplyDesc:
    "Use what you've learned to address the unresolved threads in your conversations.",
  learningPathSynthesizeDesc: "Step back and connect the dots across domains and terms.",
  learningGoalDeepen: "Deepen {domain}",
};

export interface ComputeLearnOptions {
  /** Raw messages used as a fallback when summaries are sparse or absent. */
  messages?: Message[];
  /** Optional timestamp for deterministic testing. Defaults to Date.now(). */
  now?: number;
  /** Localized labels for generated learning-path copy. */
  labels?: DashboardLabels["learn"];
}

function safeRecencyAt(raw: number | undefined | null, now: number): number {
  return typeof raw === "number" && raw > 0 ? raw : now;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function buildLearningPath(
  domains: LearnDomain[],
  glossary: GlossaryAgg[],
  openLoops: LearnOpenLoop[],
  labels: DashboardLabels["learn"],
): LearnPathStage[] {
  if (domains.length === 0 && glossary.length === 0) return [];

  const sortedDomains = domains.slice().sort((a, b) => b.count - a.count || b.deep - a.deep);
  const domainByTopicId = new Map<number | null, LearnDomain>();
  for (const d of sortedDomains) domainByTopicId.set(d.topicId, d);

  // Attach terms to their most-recent conversation's domain.
  const termsByDomain = new Map<number | null, GlossaryAgg[]>();
  for (const g of glossary) {
    const key = g.topicId;
    const list = termsByDomain.get(key) || [];
    list.push(g);
    termsByDomain.set(key, list);
  }

  const path: LearnPathStage[] = [];
  const usedTerms = new Set<string>();

  // Stage 1: Foundation in the dominant domain.
  const topDomain = sortedDomains[0];
  if (topDomain) {
    const topTerms = (termsByDomain.get(topDomain.topicId) || [])
      .slice(0, MAX_PATH_TERMS)
      .map((g) => g.term);
    for (const t of topTerms) usedTerms.add(t.toLowerCase());
    path.push({
      stage: 1,
      title: fillTemplate(labels.learningPathFoundationTitle, {
        domain: topDomain.name || labels.uncategorized,
      }),
      description: labels.learningPathFoundationDesc,
      concepts: topTerms.length > 0 ? topTerms : [topDomain.name || labels.uncategorized],
      estimatedMinutes: 20,
    });
  }

  // Stage 2: Expand to adjacent domains.
  if (sortedDomains.length > 1) {
    const nextDomains = sortedDomains.slice(1, 3);
    const expandTerms: string[] = [];
    for (const d of nextDomains) {
      const terms = (termsByDomain.get(d.topicId) || [])
        .filter((g) => !usedTerms.has(g.term.toLowerCase()))
        .slice(0, 3)
        .map((g) => g.term);
      for (const t of terms) usedTerms.add(t.toLowerCase());
      expandTerms.push(...terms);
    }
    path.push({
      stage: 2,
      title: fillTemplate(labels.learningPathExpandTitle, {
        domains: nextDomains.map((d) => d.name || labels.uncategorized).join(" & "),
      }),
      description: labels.learningPathExpandDesc,
      concepts: expandTerms.length > 0 ? expandTerms : nextDomains.map((d) => d.name || labels.uncategorized),
      estimatedMinutes: 25,
    });
  }

  // Stage 3: Apply to open loops.
  if (openLoops.length > 0) {
    path.push({
      stage: 3,
      title: labels.learningPathApplyTitle,
      description: labels.learningPathApplyDesc,
      concepts: openLoops.slice(0, MAX_PATH_OPEN_LOOPS).map((l) => l.text),
      estimatedMinutes: 30,
    });
  }

  // Stage 4: Synthesize remaining terms across domains.
  const synthesisTerms = glossary
    .filter((g) => !usedTerms.has(g.term.toLowerCase()))
    .slice(0, 4)
    .map((g) => g.term);
  if (synthesisTerms.length > 0) {
    path.push({
      stage: path.length + 1,
      title: labels.learningPathSynthesizeTitle,
      description: labels.learningPathSynthesizeDesc,
      concepts: synthesisTerms,
      estimatedMinutes: 20,
    });
  }

  return path.map((p, i) => ({ ...p, stage: i + 1 }));
}

function buildReviewQueue(glossary: GlossaryAgg[], now: number): LearnReviewItem[] {
  if (glossary.length === 0) return [];

  // Without persisted review history, infer urgency from recency:
  // older terms are suggested for review sooner because they are at higher risk
  // of fading. Intervals start short and lengthen as the term ages.
  const withDue = glossary.map((g) => {
    const recencyAt = safeRecencyAt(g.recencyAt, now);
    const ageDays = Math.max(0, (now - recencyAt) / DAYS_MS);
    const intervalDays = ageDays < 1 ? 1 : ageDays < 3 ? 3 : ageDays < 7 ? 7 : 14;
    const dueAt = recencyAt + intervalDays * DAYS_MS;
    return { term: g.term, conversationId: g.conversationId, dueAt, intervalDays };
  });

  return withDue
    .filter((r) => r.dueAt <= now + 7 * DAYS_MS)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, MAX_REVIEW_QUEUE)
    .map(({ term, conversationId, dueAt, intervalDays }) => ({
      term,
      conversationId,
      dueAt,
      intervalDays,
    }));
}

function buildGoals(
  domains: LearnDomain[],
  glossary: GlossaryAgg[],
  labels: DashboardLabels["learn"],
): LearnGoal[] {
  if (domains.length === 0) return [];

  const sortedDomains = domains
    .slice()
    .sort((a, b) => b.count - a.count || b.deep - a.deep)
    .slice(0, 3);

  return sortedDomains.map((d) => {
    const total = Math.max(1, d.deep + d.moderate + d.superficial);
    const deepRatio = d.deep / total;
    // Progress is primarily depth-based; conversation count only nudges it.
    // Cap at 80% because true mastery requires explicit user tracking.
    const progress = Math.min(80, Math.round(15 + deepRatio * 65 + Math.min(10, d.count * 0.5)));

    // Match terms that belong to this domain (by topicId).
    const matchedTerms = glossary
      .filter((g) => g.topicId === d.topicId)
      .slice(0, MAX_GOAL_TERMS)
      .map((g) => g.term);

    return {
      id: `goal-${d.topicId ?? "uncategorized"}`,
      text: fillTemplate(labels.learningGoalDeepen, {
        domain: d.name || labels.uncategorized,
      }),
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
  const { messages = [], now = Date.now(), labels: labelsInput } = options;
  const labels = labelsInput ?? DEFAULT_LEARN_LABELS;
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
    const recencyAt = safeRecencyAt(rec.createdAt, now);
    const topicId =
      typeof rec.conversationId === "number"
        ? liveConvs.find((c) => c.id === rec.conversationId)?.topic_id ?? null
        : null;
    for (const ki of insights) {
      let term = "";
      let def = "";
      if (typeof ki === "string") term = ki;
      else if (ki && typeof ki === "object") {
        term = typeof (ki as Record<string, unknown>).term === "string" ? (ki as { term: string }).term : "";
        def = typeof (ki as Record<string, unknown>).definition === "string" ? (ki as { definition: string }).definition : "";
      }
      term = term.trim();
      if (term.length < 2 || term.length > 60) continue;
      const key = term.toLowerCase();
      const existing = glossaryMap.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.definition && def.trim()) existing.definition = def.trim();
        if (recencyAt > existing.recencyAt) {
          existing.recencyAt = recencyAt;
          existing.conversationId = rec.conversationId;
          existing.topicId = topicId;
        }
      } else {
        glossaryMap.set(key, {
          term,
          definition: def.trim(),
          conversationId: rec.conversationId,
          topicId,
          count: 1,
          recencyAt,
        });
      }
    }
  }

  // Fallback glossary from raw messages when summaries are missing or empty.
  if (glossaryMap.size === 0) {
    const termIndex = buildTermIndexFromConversations(liveConvs, messagesByConv);
    for (const [, entry] of termIndex) {
      if (entry.count < 2) continue;
      const key = entry.display.toLowerCase();
      if (!glossaryMap.has(key)) {
        const conv = liveConvs.find((c) => c.id === entry.conversationId);
        glossaryMap.set(key, {
          term: entry.display,
          definition: "",
          conversationId: entry.conversationId,
          topicId: conv?.topic_id ?? null,
          count: entry.count,
          recencyAt: safeRecencyAt(entry.recencyAt, now),
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
  const hasSummaries = liveConvs.some((c) => summaryByConv.has(c.id));
  const confidence = computeConfidence(sampleSize, hasSummaries);
  const available = sampleSize >= MIN_LEARN_SAMPLE && (domains.length > 0 || glossary.length > 0);

  // When no topic name exists, synthesize domain names from conversation titles or platform.
  const finalDomains = domains.map((d) => ({
    ...d,
    name:
      d.name ||
      (d.topicId === null
        ? liveConvs.find((c) => c.topic_id === null)?.platform || labels.uncategorized
        : ""),
  }));

  // Enriched outputs.
  const learningPath = buildLearningPath(finalDomains, glossaryAgg, openLoops, labels);
  const reviewQueue = buildReviewQueue(glossaryAgg, now);
  const goals = buildGoals(finalDomains, glossaryAgg, labels);

  return {
    available,
    sampleSize,
    confidence,
    domains: finalDomains,
    glossary,
    openLoops,
    learningPath: learningPath.length > 0 ? learningPath : undefined,
    // Show the review queue section whenever we have glossary terms, even if
    // nothing is currently due, so the UI can render a friendly empty state.
    reviewQueue: glossaryAgg.length > 0 ? reviewQueue : undefined,
    // Show goals whenever we have identified domains.
    goals: finalDomains.length > 0 ? goals : undefined,
    generatedAt: now,
  };
}
