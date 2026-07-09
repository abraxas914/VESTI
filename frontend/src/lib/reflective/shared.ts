// Shared, pure helpers for VESTI's reflective modules (AITI + Learn).
// All functions are deterministic and side-effect free; they may run in the
// extension UI, offscreen document, or Node-based test harnesses.

import type { Conversation, Message, SummaryRecord } from "./types";

export type ReflectiveConfidence = "low" | "medium" | "high";
export type DepthLevel = "superficial" | "moderate" | "deep";

const MINUTES = 60 * 1000;
const DAYS = 24 * 60 * MINUTES;

/** Compute a confidence label from sample size and whether summaries exist. */
export function computeConfidence(
  sampleSize: number,
  hasSummaries: boolean,
): ReflectiveConfidence {
  if (sampleSize <= 1 || !hasSummaries) return "low";
  if (sampleSize <= 4) return "medium";
  return "high";
}

/** Partition items into those inside the last `windowDays` and the rest. */
export function partitionByWindow<T extends { createdAt?: number }>(
  items: T[],
  windowDays: number,
  now = Date.now(),
): { recent: T[]; older: T[] } {
  const cutoff = now - windowDays * DAYS;
  const recent: T[] = [];
  const older: T[] = [];
  for (const item of items) {
    const t = item.createdAt ?? 0;
    if (t >= cutoff) recent.push(item);
    else older.push(item);
  }
  return { recent, older };
}

/** Stable sort helper: higher score first, then more recent. */
export function byScoreThenRecency<T extends { score: number; recencyAt: number }>(
  a: T,
  b: T,
): number {
  if (b.score !== a.score) return b.score - a.score;
  return b.recencyAt - a.recencyAt;
}

/** Count distinct conversations represented by a list of records. */
export function countDistinctConversations(
  records: { conversationId?: number }[],
): number {
  const seen = new Set<number>();
  for (const r of records) {
    if (typeof r.conversationId === "number") seen.add(r.conversationId);
  }
  return seen.size;
}

// ---------------------------------------------------------------------------
// Lightweight lexical signals used when structured summaries are missing.
// These are intentionally conservative: they give *some* signal for sparse
// data without pretending to understand semantics.
// ---------------------------------------------------------------------------

const DEPTH_CUES: Record<DepthLevel, string[]> = {
  superficial: ["what is", "who is", "when", "where", "简单", "是什么", "谁", "什么时候"],
  moderate: ["how", "why", "compare", "difference", "怎么", "为什么", "区别", "对比"],
  deep: [
    "implications",
    "trade-offs",
    "consequences",
    "assumptions",
    "underlying",
    "systemic",
    "底层",
    "假设",
    "权衡",
    " implication",
    " tradeoff",
  ],
};

const SPIRITED_KW = [
  "excit",
  "curious",
  "enthusi",
  "passion",
  "frustrat",
  "anx",
  "eager",
  "worried",
  "兴奋",
  "好奇",
  "热",
  "焦",
  "沮",
  "急",
  "激动",
  "兴趣",
  "迫不及待",
];

const COOL_KW = [
  "calm",
  "neutral",
  "analy",
  "method",
  "object",
  "ration",
  "measured",
  "冷静",
  "中性",
  "理性",
  "客观",
  "平和",
  "沉稳",
];

const QUESTION_MARKERS = ["?", "？", "how", "what", "why", "能否", "怎么", "如何"];

const TECH_STACK_KW = [
  "react",
  "vue",
  "angular",
  "svelte",
  "next.js",
  "nuxt",
  "node.js",
  "python",
  "typescript",
  "javascript",
  "rust",
  "go",
  "java",
  "c++",
  "sql",
  "docker",
  "kubernetes",
  "aws",
  "gcp",
  "azure",
  "vercel",
  "tailwind",
  "css",
  "html",
  "api",
  "llm",
  "openai",
  "claude",
  "kimi",
  "qwen",
  "deepseek",
];

function normalizeText(text: string | undefined | null): string {
  return (text || "").toLowerCase();
}

/** Estimate depth from user messages when no summary is available. */
export function estimateDepthFromMessages(messages: Message[]): DepthLevel | null {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => normalizeText(m.content_text));
  if (userTexts.length === 0) return null;

  let deep = 0;
  let moderate = 0;
  let superficial = 0;
  for (const text of userTexts) {
    for (const kw of DEPTH_CUES.deep) if (text.includes(kw)) deep += 1;
    for (const kw of DEPTH_CUES.moderate) if (text.includes(kw)) moderate += 1;
    for (const kw of DEPTH_CUES.superficial) if (text.includes(kw)) superficial += 1;
  }

  const total = deep + moderate + superficial;
  if (total === 0) return null;
  if (deep >= moderate && deep >= superficial) return "deep";
  if (moderate >= superficial) return "moderate";
  return "superficial";
}

/** Estimate affect (spirited vs cool) from user messages. */
export function estimateAffectFromMessages(messages: Message[]): 1 | -1 | null {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => normalizeText(m.content_text));
  if (userTexts.length === 0) return null;

  let spirited = 0;
  let cool = 0;
  for (const text of userTexts) {
    if (SPIRITED_KW.some((k) => text.includes(k))) spirited += 1;
    else if (COOL_KW.some((k) => text.includes(k))) cool += 1;
  }

  if (spirited === 0 && cool === 0) return null;
  return spirited >= cool ? 1 : -1;
}

/** Estimate maker vs theorist from raw messages. */
export function estimateMakerTheoristFromMessages(messages: Message[]): {
  maker: boolean;
  theorist: boolean;
} {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => normalizeText(m.content_text));
  const aiTexts = messages
    .filter((m) => m.role === "ai")
    .map((m) => normalizeText(m.content_text));

  const hasActionCue = userTexts.some(
    (t) =>
      t.includes("implement") ||
      t.includes("deploy") ||
      t.includes("build") ||
      t.includes("write") ||
      t.includes("create") ||
      t.includes("实现") ||
      t.includes("部署") ||
      t.includes("搭建") ||
      t.includes("编写"),
  );

  const hasTech = [...userTexts, ...aiTexts].some((t) =>
    TECH_STACK_KW.some((kw) => t.includes(kw)),
  );

  const hasMultipleQuestions = userTexts.filter((t) =>
    QUESTION_MARKERS.some((q) => t.includes(q)),
  ).length >= 2;

  return {
    maker: hasActionCue || hasTech,
    theorist: hasMultipleQuestions || userTexts.some((t) => t.length > 80),
  };
}

/** Count likely unresolved/open questions in user messages. */
export function estimateOpenLoopsFromMessages(messages: Message[]): string[] {
  const loops: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = m.content_text.trim();
    if (text.length < 8) continue;
    const isQuestion =
      text.endsWith("?") ||
      text.endsWith("？") ||
      QUESTION_MARKERS.some((q) => text.toLowerCase().includes(q));
    if (isQuestion && text.length <= 160) {
      loops.push(text);
    }
  }
  return loops;
}

/** Extract candidate glossary terms from a title/snippet/text. */
export function extractTermsFromText(text: string): string[] {
  const normalized = text
    .replace(/[，。！？、；：""''（）【】\[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  for (const word of words) {
    const w = word.trim();
    if (w.length < 2 || w.length > 40) continue;
    // Skip common stop words (English + Chinese particles are short anyway)
    if (/^(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|can|this|that|these|those|i|you|he|she|it|we|they)$/i.test(w)) continue;
    terms.push(w);
  }
  return terms;
}

/** Build a map of term → { display, count, recencyAt, conversationId } from
 *  messages and conversations. Used as a Learn fallback when summaries are missing. */
export function buildTermIndexFromConversations(
  conversations: Conversation[],
  messagesByConversation: Map<number, Message[]>,
): Map<string, { display: string; count: number; recencyAt: number; conversationId: number }> {
  const index = new Map<string, { display: string; count: number; recencyAt: number; conversationId: number }>();

  for (const conv of conversations) {
    if (conv.is_trash) continue;
    const msgs = messagesByConversation.get(conv.id) || [];
    const recencyAt = Math.max(conv.updated_at || 0, ...msgs.map((m) => m.created_at || 0));
    const seenInConv = new Set<string>();
    const sources = [
      conv.title,
      conv.snippet,
      ...msgs.map((m) => m.content_text),
    ];
    for (const source of sources) {
      for (const term of extractTermsFromText(source || "")) {
        const key = term.toLowerCase();
        if (seenInConv.has(key)) continue;
        seenInConv.add(key);
        const existing = index.get(key);
        if (existing) {
          existing.count += 1;
          if (recencyAt > existing.recencyAt) {
            existing.recencyAt = recencyAt;
            existing.conversationId = conv.id;
          }
          // Keep the most frequently-cased display form.
          if (term.length > existing.display.length) existing.display = term;
        } else {
          index.set(key, { display: term, count: 1, recencyAt, conversationId: conv.id });
        }
      }
    }
  }

  return index;
}

/** Group messages by conversation_id. */
export function groupMessagesByConversation(messages: Message[]): Map<number, Message[]> {
  const map = new Map<number, Message[]>();
  for (const m of messages) {
    const list = map.get(m.conversation_id);
    if (list) list.push(m);
    else map.set(m.conversation_id, [m]);
  }
  return map;
}

/** Keep the latest summary per conversation. */
export function latestSummaryByConversation(
  summaries: SummaryRecord[],
): Map<number, SummaryRecord> {
  const byConv = new Map<number, SummaryRecord>();
  for (const rec of summaries) {
    if (typeof rec.conversationId !== "number") continue;
    const prev = byConv.get(rec.conversationId);
    if (!prev || (rec.createdAt ?? 0) > (prev.createdAt ?? 0)) {
      byConv.set(rec.conversationId, rec);
    }
  }
  return byConv;
}

/** Read depth_level from a summary record, normalizing to the canonical enum. */
export function depthOfSummary(rec: SummaryRecord | undefined): DepthLevel | null {
  const s = rec?.structured as unknown as Record<string, unknown> | null | undefined;
  const meta = s?.["meta_observations"] as Record<string, unknown> | undefined;
  const level = meta && typeof meta["depth_level"] === "string" ? meta["depth_level"] : null;
  return level === "superficial" || level === "moderate" || level === "deep" ? level : null;
}

/** Map depth level to a 0..100 score for AITI axes. */
export function depthScoreOf(level: DepthLevel | null): number | null {
  if (!level) return null;
  return { superficial: 15, moderate: 55, deep: 90 }[level];
}

// ---------------------------------------------------------------------------
// Extended AITI axes: curiosity and interdisciplinary spread.
// ---------------------------------------------------------------------------

/** Estimate curiosity score (0..100) from a conversation's user messages.
 *  More genuine questions and longer follow-up chains → higher score. */
export function estimateCuriosityFromMessages(messages: Message[]): number {
  const userMsgs = messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return 50;

  const questionCount = userMsgs.filter((m) =>
    QUESTION_MARKERS.some((q) => m.content_text.toLowerCase().includes(q)),
  ).length;

  // Follow-up chains: user messages after AI responses suggest engagement.
  let followUps = 0;
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].role === "user" && messages[i - 1].role === "ai") followUps += 1;
  }

  const questionRatio = questionCount / userMsgs.length;
  const followUpRatio = followUps / Math.max(1, userMsgs.length);
  const score = 30 + questionRatio * 50 + followUpRatio * 30;
  return Math.min(100, Math.round(score));
}

/** Estimate interdisciplinary score (0..100) from conversation diversity.
 *  More distinct topics and platforms → higher score. */
export function estimateInterdisciplinaryFromConversations(
  conversations: Conversation[],
): number {
  if (conversations.length === 0) return 50;

  const distinctTopics = new Set(conversations.map((c) => c.topic_id ?? `platform:${c.platform}`));
  const distinctPlatforms = new Set(conversations.map((c) => c.platform));

  // Scale gently: 2 buckets → ~32, 6 buckets → ~80, 8+ → 100.
  const bucketCount = distinctTopics.size + distinctPlatforms.size * 0.5;
  const score = 20 + Math.min(80, Math.max(0, (bucketCount - 1) * 12));
  return Math.min(100, Math.round(score));
}
