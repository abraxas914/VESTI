// "学习 Learn" — reframes the captured KB as a personal curriculum, computed 100%
// locally (no LLM, no new extraction) from data VESTI already stores: topics
// (domains), per-conversation summary signals (key_insights → glossary;
// unresolved_threads → open loops; depth_level → depth mix). Mirrors computeAiti:
// pure + locale-agnostic; the host applies localized labels.

import type { Conversation, SummaryRecord, Topic } from "../types";
import type {
  LearnProfile,
  LearnDomain,
  LearnGlossaryEntry,
  LearnOpenLoop,
} from "~vendor/vesti-ui";

const MIN_LEARN_SAMPLE = 3;
const MAX_GLOSSARY = 24;
const MAX_OPEN_LOOPS = 14;

type Depth = "superficial" | "moderate" | "deep";

function latestSummaryByConversation(summaries: SummaryRecord[]): Map<number, SummaryRecord> {
  const byConv = new Map<number, SummaryRecord>();
  for (const rec of summaries) {
    if (typeof rec.conversationId !== "number") continue;
    const prev = byConv.get(rec.conversationId);
    if (!prev || (rec.createdAt ?? 0) > (prev.createdAt ?? 0)) byConv.set(rec.conversationId, rec);
  }
  return byConv;
}

function depthOf(rec: SummaryRecord | undefined): Depth | null {
  const meta = rec && (rec.structured as unknown as Record<string, unknown> | null | undefined)?.["meta_observations"];
  const level = meta && typeof (meta as { depth_level?: unknown }).depth_level === "string"
    ? (meta as { depth_level: string }).depth_level
    : null;
  return level === "superficial" || level === "moderate" || level === "deep" ? level : null;
}

export function computeLearn(
  summaries: SummaryRecord[],
  topics: Topic[],
  conversations: Conversation[],
): LearnProfile {
  const summaryByConv = latestSummaryByConversation(summaries);
  const liveConvs = conversations.filter((c) => !c.is_archived && !c.is_trash);

  // ---- Domains: group conversations by topic, with a depth mix ----
  const topicName = new Map<number, string>();
  for (const t of topics) if (typeof t.id === "number") topicName.set(t.id, t.name);

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
    const d = depthOf(summaryByConv.get(conv.id));
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
  // Rank by how often a term recurs (then recency) so the most-studied terms
  // survive the MAX_GLOSSARY cap — taking the arbitrary first-N in storage order
  // would drop high-value terms.
  type GlossaryAgg = LearnGlossaryEntry & { count: number; recencyAt: number };
  const glossaryMap = new Map<string, GlossaryAgg>();
  for (const rec of summaryByConv.values()) {
    const s = rec.structured as unknown as Record<string, unknown> | null | undefined;
    const insights = s && Array.isArray(s.key_insights) ? (s.key_insights as unknown[]) : [];
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
  for (const rec of summaryByConv.values()) {
    const s = rec.structured as unknown as Record<string, unknown> | null | undefined;
    const threads = s && Array.isArray(s.unresolved_threads) ? (s.unresolved_threads as unknown[]) : [];
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

  const sampleSize = summaryByConv.size;
  const available = liveConvs.length >= MIN_LEARN_SAMPLE && (domains.length > 0 || glossary.length > 0);

  return { available, sampleSize, domains, glossary, openLoops };
}
