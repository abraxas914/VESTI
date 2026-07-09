// Shared, pure helpers for VESTI's reflective modules (AITI + Learn).
// All functions are deterministic and side-effect free for a given `now`;
// they may run in the extension UI, offscreen document, or Node-based test
// harnesses.

import type { Conversation, Message, SummaryRecord } from "../types";

export type ReflectiveConfidence = "low" | "medium" | "high";
export type DepthLevel = "superficial" | "moderate" | "deep";

const MINUTES = 60 * 1000;
const DAYS = 24 * 60 * MINUTES;

const DEPTH_SCORE_MAP: Record<DepthLevel, number> = {
  superficial: 15,
  moderate: 55,
  deep: 90,
};

/** Compute a confidence label from sample size and whether summaries exist. */
export function computeConfidence(
  sampleSize: number,
  hasSummaries: boolean,
): ReflectiveConfidence {
  const n = Math.max(0, sampleSize);
  // Without structured summaries the signal is lexical only, so confidence is
  // intentionally capped at "low" regardless of conversation count.
  if (n <= 1 || !hasSummaries) return "low";
  if (n <= 4) return "medium";
  return "high";
}

/** Partition items into those inside the last `windowDays` and the rest. */
export function partitionByWindow<T extends { createdAt?: number }>(
  items: T[],
  windowDays: number,
  now = Date.now(),
): { recent: T[]; older: T[] } {
  if (windowDays <= 0) throw new RangeError("windowDays must be positive");
  const cutoff = now - windowDays * DAYS;
  const recent: T[] = [];
  const older: T[] = [];
  for (const item of items) {
    const t = item.createdAt;
    if (t == null) {
      older.push(item);
      continue;
    }
    if (t >= cutoff) recent.push(item);
    else older.push(item);
  }
  return { recent, older };
}

/** Comparator: higher score first, then more recent. */
export function byScoreThenRecency<T extends { score: number; recencyAt: number }>(
  a: T,
  b: T,
): number {
  const aScore = Number.isNaN(a.score) ? 0 : a.score;
  const bScore = Number.isNaN(b.score) ? 0 : b.score;
  if (bScore !== aScore) return bScore - aScore;
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

export const DEPTH_CUES: Record<DepthLevel, string[]> = {
  superficial: ["what is", "who is", "when", "where", "简单", "是什么", "谁", "什么时候"],
  moderate: ["how", "why", "compare", "difference", "怎么", "为什么", "区别", "对比"],
  deep: [
    "implications",
    "implication",
    "trade-offs",
    "tradeoff",
    "consequences",
    "consequence",
    "assumptions",
    "assumption",
    "underlying",
    "systemic",
    "底层",
    "假设",
    "权衡",
    "影响",
    "后果",
  ],
};

export const SPIRITED_KW = [
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
  "热情",
  "沮丧",
  "焦虑",
  "着急",
  "激动",
  "感兴趣",
];

export const COOL_KW = [
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

/** Question words used to detect curiosity and open loops. */
export const QUESTION_MARKERS = ["how", "what", "why", "能否", "怎么", "如何", "为什么"];

/** Build-oriented action cues (maker signal). */
export const BUILD_ACTION_KW = [
  "implement",
  "deploy",
  "build",
  "code",
  "integrate",
  "prototype",
  "ship",
  "test",
  "debug",
  "launch",
  "release",
  "实现",
  "部署",
  "搭建",
  "编码",
  "集成",
  "原型",
  "上线",
  "发布",
  "测试",
  "调试",
];

/** Theorist / abstraction cues. */
export const THEORIST_KW = [
  "theory",
  "framework",
  "model",
  "concept",
  "principle",
  "pattern",
  "structure",
  "理论",
  "框架",
  "模型",
  "原理",
  "概念",
  "模式",
  "结构",
];

export const TECH_STACK_KW = [
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

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "and",
  "or",
  "but",
  "for",
  "with",
  "from",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "about",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "up",
  "down",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
]);

function normalizeText(text: string | undefined | null): string {
  return (text || "").toLowerCase().trim();
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isQuestionText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?") || t.endsWith("？")) return true;
  const firstWord = t.split(/\s+/)[0].toLowerCase();
  return QUESTION_MARKERS.includes(firstWord);
}

/** Estimate depth from user messages when no summary is available.
 *  Returns `null` when no lexical signal is found. */
export function estimateDepthFromMessages(messages: Message[]): DepthLevel | null {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => normalizeText(m.content_text));
  if (userTexts.length === 0) return null;

  let deep = 0;
  let moderate = 0;
  let superficial = 0;
  for (const text of userTexts) {
    // Cap contribution at one per cue category per message so a single long
    // message does not outweigh several shorter ones.
    if (DEPTH_CUES.deep.some((kw) => text.includes(kw))) deep += 1;
    if (DEPTH_CUES.moderate.some((kw) => text.includes(kw))) moderate += 1;
    if (DEPTH_CUES.superficial.some((kw) => text.includes(kw))) superficial += 1;
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
    if (COOL_KW.some((k) => text.includes(k))) cool += 1;
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
  if (userTexts.length === 0) return { maker: false, theorist: false };

  const hasActionCue = userTexts.some((t) =>
    BUILD_ACTION_KW.some((kw) => t.includes(kw)),
  );

  // Only user mentions of tech count; assistant mentions of a stack in a mostly
  // theoretical conversation should not flip the maker flag.
  const hasTech = userTexts.some((t) =>
    TECH_STACK_KW.some((kw) => t.includes(kw)),
  );

  const questionTexts = userTexts.filter((t) => isQuestionText(t));
  const hasMultipleQuestions = questionTexts.length >= 2;
  const hasTheoristCue = userTexts.some((t) =>
    THEORIST_KW.some((kw) => t.includes(kw)),
  );

  return {
    maker: hasActionCue || hasTech,
    theorist: hasMultipleQuestions || hasTheoristCue,
  };
}

/** Extract likely unresolved/open questions from user messages. */
export function estimateOpenLoopsFromMessages(messages: Message[]): string[] {
  const loops: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = collapseWhitespace(normalizeText(m.content_text));
    if (text.length < 8) continue;
    if (!isQuestionText(text)) continue;
    // Keep the first sentence to avoid capturing rambling context.
    const firstSentence = text.split(/[.!?。？！]|\n/)[0].trim();
    const kept = firstSentence.length > 0 && firstSentence.length <= 160
      ? firstSentence
      : text.length <= 160
        ? text
        : text.slice(0, 160).trim();
    if (kept.length >= 8) loops.push(kept);
  }
  return loops;
}

/** Extract candidate glossary terms from a title/snippet/text. */
export function extractTermsFromText(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];

  const normalized = raw
    .replace(/[，。！？、；：""''（）【】\[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  for (const word of words) {
    const w = word.trim();
    if (w.length < 2 || w.length > 40) continue;
    if (/^\d+$/.test(w)) continue;
    const key = w.toLowerCase();
    if (STOP_WORDS.has(key)) continue;
    terms.push(w);
  }
  return terms;
}

const TERM_INDEX_CAP = 500;

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
    const recencyAt = msgs.reduce(
      (max, m) => Math.max(max, m.created_at || 0),
      conv.updated_at || 0,
    );
    const seenInConv = new Set<string>();
    const sources = [conv.title, conv.snippet, ...msgs.map((m) => m.content_text)];
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
          // Keep the most frequently-cased display form by length as a simple
          // proxy for "most complete spelling".
          if (term.length > existing.display.length) existing.display = term;
        } else {
          index.set(key, { display: term, count: 1, recencyAt, conversationId: conv.id });
        }
      }
    }
    if (index.size >= TERM_INDEX_CAP) break;
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

function hasMetaObservations(
  s: unknown,
): s is { meta_observations: { depth_level: unknown } } {
  return (
    typeof s === "object" &&
    s !== null &&
    "meta_observations" in s &&
    typeof (s as Record<string, unknown>).meta_observations === "object" &&
    (s as Record<string, unknown>).meta_observations !== null &&
    "depth_level" in ((s as Record<string, unknown>).meta_observations as Record<string, unknown>)
  );
}

/** Read depth_level from a summary record, normalizing to the canonical enum. */
export function depthOfSummary(rec: SummaryRecord | undefined): DepthLevel | null {
  const s = rec?.structured;
  if (!s || typeof s !== "object") return null;
  if (!hasMetaObservations(s)) return null;
  const level = s.meta_observations.depth_level;
  return level === "superficial" || level === "moderate" || level === "deep" ? level : null;
}

/** Map depth level to a 0..100 score for AITI axes. */
export function depthScoreOf(level: DepthLevel | null): number | null {
  if (!level) return null;
  return DEPTH_SCORE_MAP[level];
}

// ---------------------------------------------------------------------------
// Extended AITI axes: curiosity and interdisciplinary spread.
// ---------------------------------------------------------------------------

/** Estimate curiosity score (0..100) from a conversation's user messages.
 *  More genuine questions and longer follow-up chains → higher score.
 *  Returns `null` when there are no user messages. */
export function estimateCuriosityFromMessages(messages: Message[]): number | null {
  const userMsgs = messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return null;

  const questionCount = userMsgs.filter((m) =>
    isQuestionText(normalizeText(m.content_text)),
  ).length;

  // Follow-up chains: user messages after AI responses suggest engagement.
  let followUps = 0;
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].role === "user" && messages[i - 1].role === "ai") followUps += 1;
  }

  const questionRatio = questionCount / userMsgs.length;
  const followUpRatio = followUps / Math.max(1, messages.length);
  // Formula intentionally overshoots (max 110) so a genuinely curious thread
  // can reach the high end after clamping.
  const score = 30 + questionRatio * 50 + followUpRatio * 30;
  return Math.min(100, Math.round(score));
}

/** Estimate interdisciplinary score (0..100) from conversation diversity.
 *  More distinct topics and platforms → higher score.
 *  Uncategorized conversations (topic_id === null) count as a single bucket,
 *  not one per platform. */
export function estimateInterdisciplinaryFromConversations(
  conversations: Conversation[],
): number {
  if (conversations.length === 0) return 0;

  const buckets = new Set<string>();
  const platforms = new Set<string>();
  for (const c of conversations) {
    platforms.add(c.platform);
    if (typeof c.topic_id === "number") {
      buckets.add(`topic:${c.topic_id}`);
    } else {
      buckets.add("uncategorized");
    }
  }

  const bucketCount = buckets.size + platforms.size * 0.5;
  // Curve: 1 bucket → 20, 2 → 36, 3 → 52, 4 → 68, 5 → 84, 6+ → 100.
  const score = 20 + Math.min(80, Math.max(0, (bucketCount - 1) * 16));
  return Math.min(100, Math.round(score));
}
