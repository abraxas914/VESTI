#!/usr/bin/env node
/**
 * Plain-JS sanity test for the upgraded AITI / Learn algorithms.
 *
 * This file intentionally mirrors the logic in
 *   frontend/src/lib/aiti/computeAiti.ts
 *   frontend/src/lib/learn/computeLearn.ts
 *   frontend/src/lib/reflective/shared.ts
 * without importing TypeScript, so it can run in any Node environment.
 *
 * It reads test_data/vesti-export-*.json, simulates sparse-data and full-data
 * inputs, and prints the resulting profiles. Human / agent reviewers then
 * judge whether the output is coherent.
 */

import fs from "node:fs";
import path from "node:path";

const DAYS_MS = 24 * 60 * 60 * 1000;

function loadFixture() {
  const root = path.resolve(import.meta.dirname, "..");
  const files = fs
    .readdirSync(path.join(root, "test_data"))
    .filter((f) => f.startsWith("vesti-export-") && f.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error("No test fixture found");
  const raw = fs.readFileSync(path.join(root, "test_data", files.at(-1)), "utf-8");
  return JSON.parse(raw).data;
}

function clamp(v, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, v));
}

function normalizeText(text) {
  return (text || "").toLowerCase().trim();
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

const DEPTH_CUES = {
  superficial: ["what is", "who is", "when", "where", "简单", "是什么", "谁", "什么时候"],
  moderate: ["how", "why", "compare", "difference", "怎么", "为什么", "区别", "对比"],
  deep: [
    "implications", "implication", "trade-offs", "tradeoff", "consequences", "consequence",
    "assumptions", "assumption", "underlying", "systemic", "底层", "假设", "权衡", "影响", "后果",
  ],
};

const SPIRITED_KW = [
  "excit", "curious", "enthusi", "passion", "frustrat", "anx", "eager", "worried",
  "兴奋", "好奇", "热情", "沮丧", "焦虑", "着急", "激动", "感兴趣",
];

const COOL_KW = [
  "calm", "neutral", "analy", "method", "object", "ration", "measured",
  "冷静", "中性", "理性", "客观", "平和", "沉稳",
];

const QUESTION_MARKERS = ["how", "what", "why", "能否", "怎么", "如何", "为什么"];

const BUILD_ACTION_KW = [
  "implement", "deploy", "build", "code", "integrate", "prototype", "ship", "test", "debug",
  "launch", "release", "实现", "部署", "搭建", "编码", "集成", "原型", "上线", "发布", "测试", "调试",
];

const THEORIST_KW = [
  "theory", "framework", "model", "concept", "principle", "pattern", "structure",
  "理论", "框架", "模型", "原理", "概念", "模式", "结构",
];

const TECH_STACK_KW = [
  "react", "vue", "angular", "svelte", "next.js", "nuxt", "node.js", "python", "typescript",
  "javascript", "rust", "go", "java", "c++", "sql", "docker", "kubernetes", "aws", "gcp", "azure",
  "vercel", "tailwind", "css", "html", "api", "llm", "openai", "claude", "kimi", "qwen", "deepseek",
];

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "this", "that",
  "these", "those", "i", "you", "he", "she", "it", "we", "they", "my", "your", "his", "her", "its",
  "our", "their", "and", "or", "but", "for", "with", "from", "to", "of", "in", "on", "at", "by",
  "about", "as", "into", "through", "during", "before", "after", "above", "below", "up", "down",
  "out", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just",
]);

function isQuestionText(text) {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?") || t.endsWith("？")) return true;
  const firstWord = t.split(/\s+/)[0].toLowerCase();
  return QUESTION_MARKERS.includes(firstWord);
}

function estimateDepthFromMessages(messages) {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => normalizeText(m.content_text));
  if (userTexts.length === 0) return null;
  let deep = 0, moderate = 0, superficial = 0;
  for (const text of userTexts) {
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

function estimateAffectFromMessages(messages) {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => normalizeText(m.content_text));
  if (userTexts.length === 0) return null;
  let spirited = 0, cool = 0;
  for (const text of userTexts) {
    if (SPIRITED_KW.some((k) => text.includes(k))) spirited += 1;
    if (COOL_KW.some((k) => text.includes(k))) cool += 1;
  }
  if (spirited === 0 && cool === 0) return null;
  return spirited >= cool ? 1 : -1;
}

function estimateMakerTheoristFromMessages(messages) {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => normalizeText(m.content_text));
  if (userTexts.length === 0) return { maker: false, theorist: false };
  const hasActionCue = userTexts.some((t) => BUILD_ACTION_KW.some((kw) => t.includes(kw)));
  const hasTech = userTexts.some((t) => TECH_STACK_KW.some((kw) => t.includes(kw)));
  const questionTexts = userTexts.filter((t) => isQuestionText(t));
  const hasMultipleQuestions = questionTexts.length >= 2;
  const hasTheoristCue = userTexts.some((t) => THEORIST_KW.some((kw) => t.includes(kw)));
  return { maker: hasActionCue || hasTech, theorist: hasMultipleQuestions || hasTheoristCue };
}

function estimateCuriosityFromMessages(messages) {
  const userMsgs = messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return null;
  const questionCount = userMsgs.filter((m) => isQuestionText(normalizeText(m.content_text))).length;
  let followUps = 0;
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].role === "user" && messages[i - 1].role === "ai") followUps += 1;
  }
  const score = 30 + (questionCount / userMsgs.length) * 50 + (followUps / Math.max(1, messages.length)) * 30;
  return Math.min(100, Math.round(score));
}

function estimateInterdisciplinaryFromConversations(conversations) {
  if (conversations.length === 0) return 0;
  const buckets = new Set();
  const platforms = new Set();
  for (const c of conversations) {
    platforms.add(c.platform);
    if (typeof c.topic_id === "number") buckets.add(`topic:${c.topic_id}`);
    else buckets.add("uncategorized");
  }
  const bucketCount = buckets.size + platforms.size * 0.5;
  const score = 20 + Math.min(80, Math.max(0, (bucketCount - 1) * 16));
  return Math.min(100, Math.round(score));
}

function estimateOpenLoopsFromMessages(messages) {
  const loops = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = collapseWhitespace(normalizeText(m.content_text));
    if (text.length < 8) continue;
    if (!isQuestionText(text)) continue;
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

function extractTermsFromText(text) {
  const raw = (text || "").trim();
  if (!raw) return [];
  const normalized = raw
    .replace(/[，。！？、；：""''（）【】\[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const terms = [];
  for (const w of words) {
    if (w.length < 2 || w.length > 40) continue;
    if (/^\d+$/.test(w)) continue;
    const key = w.toLowerCase();
    if (STOP_WORDS.has(key)) continue;
    terms.push(w);
  }
  return terms;
}

function computeConfidence(sampleSize, hasSummaries) {
  const n = Math.max(0, sampleSize);
  if (n <= 1 || !hasSummaries) return "low";
  if (n <= 4) return "medium";
  return "high";
}

// ---- AITI ----

function computeAitiFixture(summaries, conversations, messages) {
  const messagesByConv = new Map();
  for (const m of messages) {
    const list = messagesByConv.get(m.conversation_id) || [];
    list.push(m);
    messagesByConv.set(m.conversation_id, list);
  }

  const feats = [];
  for (const conv of conversations) {
    if (conv.is_trash) continue;
    const msgs = messagesByConv.get(conv.id) || [];
    const depthRaw = estimateDepthFromMessages(msgs);
    const depth = depthRaw ? { superficial: 15, moderate: 55, deep: 90 }[depthRaw] : null;
    const { maker, theorist } = estimateMakerTheoristFromMessages(msgs);
    const affect = estimateAffectFromMessages(msgs);
    const curiosity = estimateCuriosityFromMessages(msgs);
    const unresolved = estimateOpenLoopsFromMessages(msgs).length;
    feats.push({
      conversationId: conv.id,
      depth,
      maker,
      theorist,
      affect,
      curiosity,
      unresolved,
    });
  }

  if (feats.length < 2) {
    return {
      available: false,
      sampleSize: feats.length,
      confidence: computeConfidence(feats.length, summaries.length > 0),
      axes: [],
      obsessions: [],
    };
  }

  const sampleSize = feats.length;
  const depthVals = feats.map((f) => f.depth).filter((d) => d !== null);
  const depthScore = depthVals.length ? clamp(depthVals.reduce((a, b) => a + b, 0) / depthVals.length) : 50;
  const makerScore = clamp(50 + 50 * (feats.filter((f) => f.maker).length / sampleSize - feats.filter((f) => f.theorist).length / sampleSize));
  const focusScore = clamp(20 + (feats.reduce((a, f) => a + f.unresolved, 0) / sampleSize) * 22);
  const affectFeats = feats.filter((f) => f.affect !== null);
  const affectScore = affectFeats.length
    ? clamp(50 + 50 * (affectFeats.filter((f) => f.affect === 1).length / affectFeats.length - affectFeats.filter((f) => f.affect === -1).length / affectFeats.length))
    : 50;
  const curiosityVals = feats.map((f) => f.curiosity).filter((c) => c !== null);
  const curiosityScore = curiosityVals.length ? clamp(curiosityVals.reduce((a, b) => a + b, 0) / curiosityVals.length) : 50;
  const interdisciplinaryScore = estimateInterdisciplinaryFromConversations(conversations);

  return {
    available: true,
    sampleSize,
    confidence: computeConfidence(sampleSize, summaries.length > 0),
    axes: [
      { key: "depth", score: Math.round(depthScore) },
      { key: "maker", score: Math.round(makerScore) },
      { key: "focus", score: Math.round(focusScore) },
      { key: "affect", score: Math.round(affectScore) },
      { key: "curiosity", score: Math.round(curiosityScore) },
      { key: "interdisciplinary", score: interdisciplinaryScore },
    ],
  };
}

// ---- Learn ----

function buildTermIndex(liveConvs, messagesByConv) {
  const index = new Map();
  for (const conv of liveConvs) {
    const msgs = messagesByConv.get(conv.id) || [];
    const recencyAt = msgs.reduce((max, m) => Math.max(max, m.created_at || 0), conv.updated_at || 0);
    const seenInConv = new Set();
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
          if (term.length > existing.display.length) existing.display = term;
        } else {
          index.set(key, { display: term, count: 1, recencyAt, conversationId: conv.id });
        }
      }
    }
  }
  return index;
}

function computeLearnFixture(conversations, messages, topics) {
  const liveConvs = conversations.filter((c) => !c.is_archived && !c.is_trash);
  const topicName = new Map(topics.map((t) => [t.id, t.name]));

  const domainsAgg = new Map();
  for (const conv of liveConvs) {
    const key = conv.topic_id ?? "null";
    const entry = domainsAgg.get(key) || { topicId: conv.topic_id, name: topicName.get(conv.topic_id) || "", count: 0 };
    entry.count += 1;
    domainsAgg.set(key, entry);
  }
  const domains = Array.from(domainsAgg.values()).sort((a, b) => b.count - a.count);

  const messagesByConv = new Map();
  for (const m of messages) {
    const list = messagesByConv.get(m.conversation_id) || [];
    list.push(m);
    messagesByConv.set(m.conversation_id, list);
  }

  const termIndex = buildTermIndex(liveConvs, messagesByConv);
  const glossary = Array.from(termIndex.values())
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count || b.recencyAt - a.recencyAt)
    .slice(0, 24)
    .map((e) => e.display);

  const openLoops = [];
  for (const conv of liveConvs) {
    const msgs = messagesByConv.get(conv.id) || [];
    for (const text of estimateOpenLoopsFromMessages(msgs)) {
      openLoops.push(text);
      if (openLoops.length >= 14) break;
    }
    if (openLoops.length >= 14) break;
  }

  return {
    available: liveConvs.length >= 1 && (domains.length > 0 || glossary.length > 0),
    sampleSize: liveConvs.length,
    domains,
    glossary,
    openLoops,
  };
}

// ---- Run ----

const data = loadFixture();
const allConversations = data.conversations;
const allMessages = data.messages;
const summaries = data.summaries || [];
const topics = data.topics || [];

console.log("\n=== AITI sanity checks ===");
for (const n of [1, 2, 5, 10, allConversations.length]) {
  const subset = allConversations.slice(0, n);
  const ids = new Set(subset.map((c) => c.id));
  const msgs = allMessages.filter((m) => ids.has(m.conversation_id));
  const profile = computeAitiFixture(summaries, subset, msgs);
  console.log(
    `first ${String(n).padStart(2)} convs → available=${profile.available}, ` +
      `confidence=${profile.confidence}, axes=[${profile.axes.map((a) => `${a.key}:${a.score}`).join(", ")}]`,
  );
}

console.log("\n=== Learn sanity checks ===");
for (const n of [1, 2, 5, 10, allConversations.length]) {
  const subset = allConversations.slice(0, n);
  const ids = new Set(subset.map((c) => c.id));
  const msgs = allMessages.filter((m) => ids.has(m.conversation_id));
  const profile = computeLearnFixture(subset, msgs, topics);
  console.log(
    `first ${String(n).padStart(2)} convs → available=${profile.available}, ` +
      `domains=${profile.domains.length}, glossary=${profile.glossary.length}, loops=${profile.openLoops.length}`,
  );
}
