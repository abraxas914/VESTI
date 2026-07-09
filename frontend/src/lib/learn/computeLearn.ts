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
  LearnOpenLoop,
  LearnProfile,
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

export interface ComputeLearnOptions {
  /** Raw messages used as a fallback when summaries are sparse or absent. */
  messages?: Message[];
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
  type GlossaryAgg = LearnGlossaryEntry & { count: number; recencyAt: number };
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
      if (entry.count < 2) continue; // require recurrence to reduce noise
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

  const glossary: LearnGlossaryEntry[] = Array.from(glossaryMap.values())
    .sort((a, b) => b.count - a.count || b.recencyAt - a.recencyAt)
    .slice(0, MAX_GLOSSARY)
    .map((entry) => ({
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

  return {
    available,
    sampleSize,
    confidence,
    domains: finalDomains,
    glossary,
    openLoops,
    generatedAt: Date.now(),
  };
}
