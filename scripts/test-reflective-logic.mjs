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

// ---- Shared heuristics (mirrored) ----

function estimateDepthFromMessages(messages) {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => (m.content_text || "").toLowerCase());
  if (userTexts.length === 0) return null;
  const cues = {
    superficial: ["what is", "who is", "when", "where", "简单", "是什么", "谁", "什么时候"],
    moderate: ["how", "why", "compare", "difference", "怎么", "为什么", "区别", "对比"],
    deep: [
      "implications", "trade-offs", "consequences", "assumptions", "underlying", "systemic",
      "底层", "假设", "权衡",
    ],
  };
  let deep = 0, moderate = 0, superficial = 0;
  for (const text of userTexts) {
    for (const kw of cues.deep) if (text.includes(kw)) deep += 1;
    for (const kw of cues.moderate) if (text.includes(kw)) moderate += 1;
    for (const kw of cues.superficial) if (text.includes(kw)) superficial += 1;
  }
  const total = deep + moderate + superficial;
  if (total === 0) return null;
  if (deep >= moderate && deep >= superficial) return "deep";
  if (moderate >= superficial) return "moderate";
  return "superficial";
}

function estimateAffectFromMessages(messages) {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => (m.content_text || "").toLowerCase());
  if (userTexts.length === 0) return null;
  const spirited = ["excit", "curious", "enthusi", "passion", "frustrat", "anx", "eager", "worried", "兴奋", "好奇", "热", "焦", "沮", "急", "激动", "兴趣"];
  const cool = ["calm", "neutral", "analy", "method", "object", "ration", "measured", "冷静", "中性", "理性", "客观", "平和", "沉稳"];
  let s = 0, c = 0;
  for (const text of userTexts) {
    if (spirited.some((k) => text.includes(k))) s += 1;
    else if (cool.some((k) => text.includes(k))) c += 1;
  }
  if (s === 0 && c === 0) return null;
  return s >= c ? 1 : -1;
}

function estimateMakerTheoristFromMessages(messages) {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => (m.content_text || "").toLowerCase());
  const aiTexts = messages.filter((m) => m.role === "ai").map((m) => (m.content_text || "").toLowerCase());
  const hasActionCue = userTexts.some((t) =>
    ["implement", "deploy", "build", "write", "create", "实现", "部署", "搭建", "编写"].some((kw) => t.includes(kw)),
  );
  const techStack = ["react", "vue", "python", "typescript", "javascript", "rust", "go", "java", "docker", "kubernetes", "aws", "api", "llm", "openai", "claude", "kimi", "qwen", "deepseek"];
  const hasTech = [...userTexts, ...aiTexts].some((t) => techStack.some((kw) => t.includes(kw)));
  const hasMultipleQuestions = userTexts.filter((t) => /\?|？|how|what|why|能否|怎么|如何/.test(t)).length >= 2;
  return { maker: hasActionCue || hasTech, theorist: hasMultipleQuestions || userTexts.some((t) => t.length > 80) };
}

function estimateCuriosityFromMessages(messages) {
  const userMsgs = messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return 50;
  const questionCount = userMsgs.filter((m) => /\?|？|how|what|why|能否|怎么|如何/.test(m.content_text.toLowerCase())).length;
  let followUps = 0;
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].role === "user" && messages[i - 1].role === "ai") followUps += 1;
  }
  const score = 30 + (questionCount / userMsgs.length) * 50 + (followUps / Math.max(1, userMsgs.length)) * 30;
  return Math.min(100, Math.round(score));
}

function estimateInterdisciplinaryFromConversations(conversations) {
  if (conversations.length === 0) return 50;
  const distinctTopics = new Set(conversations.map((c) => c.topic_id ?? `platform:${c.platform}`));
  const distinctPlatforms = new Set(conversations.map((c) => c.platform));
  const bucketCount = distinctTopics.size + distinctPlatforms.size * 0.5;
  return Math.min(100, Math.round(20 + Math.min(80, Math.max(0, (bucketCount - 1) * 12))));
}

function computeConfidence(sampleSize, hasSummaries) {
  if (sampleSize <= 1 || !hasSummaries) return "low";
  if (sampleSize <= 4) return "medium";
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
    feats.push({
      conversationId: conv.id,
      depth,
      maker,
      theorist,
      affect,
      curiosity,
      unresolved: msgs.filter((m) => m.role === "user" && /\?|？/.test(m.content_text)).length,
    });
  }

  if (feats.length < 2) {
    return { available: false, sampleSize: feats.length, confidence: computeConfidence(feats.length, false), axes: [], obsessions: [] };
  }

  const sampleSize = feats.length;
  const depthVals = feats.map((f) => f.depth).filter((d) => d !== null);
  const depthScore = depthVals.length ? clamp(depthVals.reduce((a, b) => a + b, 0) / depthVals.length) : 50;
  const makerScore = clamp(50 + 50 * (feats.filter((f) => f.maker).length / sampleSize - feats.filter((f) => f.theorist).length / sampleSize));
  const focusScore = clamp(20 + (feats.reduce((a, f) => a + f.unresolved, 0) / sampleSize) * 22);
  const affectFeats = feats.filter((f) => f.affect !== null);
  const affectScore = affectFeats.length ? clamp(50 + 50 * (affectFeats.filter((f) => f.affect === 1).length / affectFeats.length - affectFeats.filter((f) => f.affect === -1).length / affectFeats.length)) : 50;
  const curiosityScore = clamp(feats.reduce((a, f) => a + f.curiosity, 0) / sampleSize);
  const interdisciplinaryScore = estimateInterdisciplinaryFromConversations(conversations);

  return {
    available: true,
    sampleSize,
    confidence: computeConfidence(sampleSize, false),
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

  // Simple glossary from message words.
  const messagesByConv = new Map();
  for (const m of messages) {
    const list = messagesByConv.get(m.conversation_id) || [];
    list.push(m);
    messagesByConv.set(m.conversation_id, list);
  }
  const termCounts = new Map();
  for (const conv of liveConvs) {
    const msgs = messagesByConv.get(conv.id) || [];
    const seen = new Set();
    for (const m of msgs) {
      const words = (m.content_text || "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && w.length <= 40);
      for (const w of words) {
        const key = w.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const e = termCounts.get(key) || { display: w, count: 0 };
        e.count += 1;
        termCounts.set(key, e);
      }
    }
  }
  const glossary = Array.from(termCounts.values())
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((e) => e.display);

  const openLoops = [];
  for (const conv of liveConvs) {
    const msgs = messagesByConv.get(conv.id) || [];
    for (const m of msgs) {
      if (m.role === "user" && /\?|？/.test(m.content_text)) {
        openLoops.push(m.content_text.trim());
        if (openLoops.length >= 10) break;
      }
    }
    if (openLoops.length >= 10) break;
  }

  return { available: liveConvs.length >= 1, sampleSize: liveConvs.length, domains, glossary, openLoops };
}

// ---- Run ----

const data = loadFixture();
const allConversations = data.conversations;
const allMessages = data.messages;
const topics = data.topics || [];

console.log("\n=== AITI sanity checks ===");
for (const n of [1, 2, 5, 10, allConversations.length]) {
  const subset = allConversations.slice(0, n);
  const ids = new Set(subset.map((c) => c.id));
  const msgs = allMessages.filter((m) => ids.has(m.conversation_id));
  const profile = computeAitiFixture([], subset, msgs);
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
