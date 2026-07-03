// 提示词广场 (Prompt Plaza) — a bundled, offline, curated repository of common
// high-quality prompts, recommended with source attribution. Each entry carries
// both English and Chinese so the plaza follows the app language. The frontend
// localizes + computes a date-seeded "daily" rotation, then passes the result to
// the Prompts tab (the vesti-ui package stays locale-agnostic).
//
// Attribution is honest: `source` names the well-known public collection the
// prompt pattern comes from, and `sourceUrl` is that collection's real page.
// Bodies are concise, representative prompts (not verbatim copies).

import { GENERATED_CATALOG } from "./catalog";

export interface CuratedPrompt {
  id: string;
  category: { en: string; zh: string };
  title: { en: string; zh: string };
  body: { en: string; zh: string };
  /** Attribution label, e.g. the collection that popularized this pattern. */
  source: string;
  sourceUrl?: string;
}

/** A plaza prompt resolved to a single locale, ready for the UI. */
export interface PlazaPromptResolved {
  id: string;
  category: string;
  title: string;
  body: string;
  source: string;
  sourceUrl?: string;
  featured?: boolean;
}

const AWESOME = "Awesome ChatGPT Prompts";
const AWESOME_URL = "https://github.com/f/awesome-chatgpt-prompts";
const ANTHROPIC = "Anthropic Prompt Library";
const ANTHROPIC_URL = "https://docs.anthropic.com/en/prompt-library/library";
const COOKBOOK = "OpenAI Cookbook";
const COOKBOOK_URL = "https://cookbook.openai.com/";
const LEARN = "Learn Prompting";
const LEARN_URL = "https://learnprompting.org/";

const BASE_PROMPTS: CuratedPrompt[] = [
  {
    id: "expert-explainer",
    category: { en: "Learning", zh: "学习" },
    title: { en: "Explain like an expert tutor", zh: "像专家导师一样讲解" },
    body: {
      en: "You are an expert tutor. Explain {{topic}} to me from first principles. Start with a one-sentence intuition, then build up the key ideas step by step with a concrete example, and end with 3 common misconceptions to avoid. Keep it concise.",
      zh: "你是一位专家导师。请从第一性原理给我讲解 {{主题}}。先用一句话给出直觉，再用一个具体例子逐步搭建关键概念，最后列出 3 个需要避免的常见误区。保持简洁。",
    },
    source: LEARN,
    sourceUrl: LEARN_URL,
  },
  {
    id: "rewrite-clearer",
    category: { en: "Writing", zh: "写作" },
    title: { en: "Tighten and clarify writing", zh: "精简并理顺文字" },
    body: {
      en: "Rewrite the text below to be clearer and more concise without losing meaning or changing the tone. Fix grammar, cut filler, and prefer active voice. Return only the rewritten text.\n\n---\n{{text}}",
      zh: "请把下面的文字改写得更清晰、更精炼，但不改变原意和语气。修正语法、删去冗余、尽量使用主动语态。只返回改写后的文字。\n\n---\n{{文本}}",
    },
    source: ANTHROPIC,
    sourceUrl: ANTHROPIC_URL,
  },
  {
    id: "code-reviewer",
    category: { en: "Coding", zh: "编程" },
    title: { en: "Senior code reviewer", zh: "资深代码审查" },
    body: {
      en: "Act as a senior software engineer reviewing the code below. Identify correctness bugs first (with severity), then point out readability and performance issues. For each finding give the file/line, why it matters, and a concrete fix. Be specific; skip praise.\n\n```\n{{code}}\n```",
      zh: "请以资深软件工程师的身份审查下面的代码。先找出正确性 bug（标注严重程度），再指出可读性与性能问题。每条给出位置、为什么重要、以及具体修法。务必具体，不要客套。\n\n```\n{{代码}}\n```",
    },
    source: COOKBOOK,
    sourceUrl: COOKBOOK_URL,
  },
  {
    id: "debug-helper",
    category: { en: "Coding", zh: "编程" },
    title: { en: "Debug with hypotheses", zh: "用假设法调试" },
    body: {
      en: "I'm hitting this bug: {{symptom}}. Here is the relevant code and the error.\n\n```\n{{code_and_error}}\n```\n\nList the 3 most likely root causes ranked by probability, the quickest way to confirm each, and the fix for the most likely one. Ask me for anything you need.",
      zh: "我遇到这个 bug：{{现象}}。下面是相关代码和报错。\n\n```\n{{代码与报错}}\n```\n\n请按可能性排序列出 3 个最可能的根因、各自最快的验证方法，以及最可能根因的修复方案。需要更多信息就向我提问。",
    },
    source: LEARN,
    sourceUrl: LEARN_URL,
  },
  {
    id: "summarize-structured",
    category: { en: "Analysis", zh: "分析" },
    title: { en: "Structured summary", zh: "结构化摘要" },
    body: {
      en: "Summarize the content below as: (1) a one-line TL;DR, (2) 3–5 key points as bullets, (3) any action items or open questions. Keep names and numbers accurate; do not invent details.\n\n---\n{{content}}",
      zh: "请把下面的内容总结为：(1) 一句话 TL;DR；(2) 3–5 个要点（列表）；(3) 待办事项或未解问题。保证人名和数字准确，不要杜撰。\n\n---\n{{内容}}",
    },
    source: ANTHROPIC,
    sourceUrl: ANTHROPIC_URL,
  },
  {
    id: "step-by-step-reasoning",
    category: { en: "Analysis", zh: "分析" },
    title: { en: "Reason step by step", zh: "逐步推理" },
    body: {
      en: "Solve the problem below. Think step by step, state your assumptions explicitly, show the key intermediate steps, then give the final answer on its own line prefixed with 'Answer:'. If the problem is ambiguous, ask one clarifying question first.\n\n{{problem}}",
      zh: "请解决下面的问题。一步步思考，明确写出你的假设，展示关键的中间步骤，最后用单独一行以“答案：”开头给出结论。若问题有歧义，请先提出一个澄清问题。\n\n{{问题}}",
    },
    source: LEARN,
    sourceUrl: LEARN_URL,
  },
  {
    id: "translate-natural",
    category: { en: "Translation", zh: "翻译" },
    title: { en: "Natural, faithful translation", zh: "自然且忠实的翻译" },
    body: {
      en: "Translate the text below into {{target_language}}. Keep the meaning faithful and the wording natural for a native speaker; preserve formatting, names, and code. Return only the translation.\n\n---\n{{text}}",
      zh: "请把下面的文字翻译成 {{目标语言}}。忠实表达原意，措辞要符合母语者习惯；保留格式、专有名词和代码。只返回译文。\n\n---\n{{文本}}",
    },
    source: ANTHROPIC,
    sourceUrl: ANTHROPIC_URL,
  },
  {
    id: "brainstorm-options",
    category: { en: "Productivity", zh: "效率" },
    title: { en: "Brainstorm distinct options", zh: "头脑风暴多个方案" },
    body: {
      en: "Generate {{n}} genuinely distinct approaches to: {{goal}}. For each, give a one-line description, the main upside, the main risk, and who it's best for. Avoid near-duplicates. End with your single recommendation and why.",
      zh: "请就以下目标给出 {{数量}} 个真正不同的方案：{{目标}}。每个方案写明一句话描述、主要优点、主要风险、最适合谁。避免雷同。最后给出你唯一推荐的方案及理由。",
    },
    source: AWESOME,
    sourceUrl: AWESOME_URL,
  },
  {
    id: "meeting-to-actions",
    category: { en: "Productivity", zh: "效率" },
    title: { en: "Notes → action items", zh: "笔记转待办" },
    body: {
      en: "From the notes below, extract a clean list of action items. For each: owner (if mentioned), the task as an imperative, and any due date. Then list decisions made and open questions separately. Keep it faithful to the notes.\n\n---\n{{notes}}",
      zh: "请从下面的笔记中提炼出清晰的待办清单。每条包含：负责人（若提到）、以祈使句表述的任务、以及截止日期（若有）。然后分别列出已做出的决定与未解问题。务必忠实于笔记。\n\n---\n{{笔记}}",
    },
    source: COOKBOOK,
    sourceUrl: COOKBOOK_URL,
  },
  {
    id: "socratic-coach",
    category: { en: "Learning", zh: "学习" },
    title: { en: "Socratic study coach", zh: "苏格拉底式学习教练" },
    body: {
      en: "Be my Socratic coach for {{topic}}. Don't give answers directly — ask me one focused question at a time to help me reason toward understanding, and correct misconceptions gently as they appear. Start by gauging what I already know.",
      zh: "请做我的苏格拉底式教练，主题是 {{主题}}。不要直接给答案——每次只问我一个有针对性的问题，引导我自己推理出理解，并在出现误区时温和纠正。先了解我已经掌握了什么。",
    },
    source: LEARN,
    sourceUrl: LEARN_URL,
  },
  {
    id: "persona-expert",
    category: { en: "Expert", zh: "专家" },
    title: { en: "Act as a domain expert", zh: "扮演领域专家" },
    body: {
      en: "I want you to act as a {{role}} with deep, current expertise. Use precise domain vocabulary, flag tradeoffs and uncertainty honestly, and tailor depth to my level. My first request is: {{request}}",
      zh: "请你扮演一位 {{角色}}，具备深入且与时俱进的专业能力。使用准确的领域术语，诚实地指出取舍与不确定性，并根据我的水平调整深度。我的第一个请求是：{{请求}}",
    },
    source: AWESOME,
    sourceUrl: AWESOME_URL,
  },
  {
    id: "critique-my-argument",
    category: { en: "Analysis", zh: "分析" },
    title: { en: "Steelman then critique", zh: "先完善再反驳" },
    body: {
      en: "Here is my argument: {{argument}}. First restate it in its strongest form (steelman). Then give the most serious objections, each with a concrete counterexample or evidence. Finally tell me what would change your mind.",
      zh: "这是我的论点：{{论点}}。请先用最有力的方式复述它（steelman），再给出最严肃的反驳，每条配一个具体反例或证据，最后告诉我什么样的证据会改变你的判断。",
    },
    source: ANTHROPIC,
    sourceUrl: ANTHROPIC_URL,
  },
  {
    id: "email-polish",
    category: { en: "Writing", zh: "写作" },
    title: { en: "Draft a clear email", zh: "起草清晰的邮件" },
    body: {
      en: "Write a {{tone}} email to {{recipient}} about {{purpose}}. Keep it short and skimmable: a clear subject line, one-line context, the ask, and a specific next step. Return subject and body.",
      zh: "请写一封 {{语气}} 的邮件，发给 {{收件人}}，主题是 {{目的}}。要简短、易扫读：清晰的主题行、一句话背景、明确的请求、以及具体的下一步。返回主题与正文。",
    },
    source: AWESOME,
    sourceUrl: AWESOME_URL,
  },
  {
    id: "plan-breakdown",
    category: { en: "Productivity", zh: "效率" },
    title: { en: "Break a goal into a plan", zh: "把目标拆成计划" },
    body: {
      en: "Help me plan: {{goal}}. Break it into phases, then concrete tasks under each with rough effort estimates and dependencies. Flag the riskiest unknowns and what to do first. Ask me for missing context before planning if needed.",
      zh: "帮我规划：{{目标}}。先拆成几个阶段，再在每个阶段下列出具体任务，附粗略工作量估计与依赖关系。标出风险最高的未知项以及应先做什么。如缺少背景，请先向我询问再规划。",
    },
    source: COOKBOOK,
    sourceUrl: COOKBOOK_URL,
  },
];

// Full catalog = hand-curated essentials + the generated by-category catalog
// (deduped by id). Order: essentials first, then the supermarket categories.
export const CURATED_PROMPTS: CuratedPrompt[] = (() => {
  const seen = new Set<string>();
  const merged: CuratedPrompt[] = [];
  for (const p of [...BASE_PROMPTS, ...GENERATED_CATALOG]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
  }
  return merged;
})();

/** Ordered list of big-categories present in the catalog (for the 超市). */
export function getCuratedCategories(locale: "en" | "zh"): string[] {
  const lang: "en" | "zh" = locale === "zh" ? "zh" : "en";
  const order: string[] = [];
  const seen = new Set<string>();
  for (const p of CURATED_PROMPTS) {
    const label = p.category[lang];
    if (!seen.has(label)) {
      seen.add(label);
      order.push(label);
    }
  }
  return order;
}

/** Resolve the whole catalog to a single locale (no daily rotation). */
export function resolveCuratedPrompts(locale: "en" | "zh"): PlazaPromptResolved[] {
  const lang: "en" | "zh" = locale === "zh" ? "zh" : "en";
  return CURATED_PROMPTS.map((p) => ({
    id: p.id,
    category: p.category[lang],
    title: p.title[lang],
    body: p.body[lang],
    source: p.source,
    sourceUrl: p.sourceUrl,
  }));
}

/**
 * Search the curated catalog by trigger/keyword (title, body, or category).
 * Used by the in-dock 提示词助手 so its search also surfaces 优质提示词.
 */
export function searchCuratedPrompts(
  query: string,
  locale: "en" | "zh",
  limit = 6,
): PlazaPromptResolved[] {
  const all = resolveCuratedPrompts(locale);
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  return all
    .filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    )
    .slice(0, limit);
}

/**
 * Resolve to a locale and mark a date-seeded "daily" rotation as featured. Pure
 * (callers pass `nowMs`) so it is deterministic for a given day.
 */
export function buildPlazaPrompts(
  locale: "en" | "zh",
  nowMs: number,
  featuredCount = 3,
): PlazaPromptResolved[] {
  const lang: "en" | "zh" = locale === "zh" ? "zh" : "en";
  const resolved: PlazaPromptResolved[] = CURATED_PROMPTS.map((p) => ({
    id: p.id,
    category: p.category[lang],
    title: p.title[lang],
    body: p.body[lang],
    source: p.source,
    sourceUrl: p.sourceUrl,
  }));

  const total = resolved.length;
  if (total === 0) return resolved;
  const dayIndex = Math.floor(nowMs / 86_400_000);
  const count = Math.min(featuredCount, total);
  const start = ((dayIndex * count) % total + total) % total;
  const featured = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    featured.add(resolved[(start + i) % total].id);
  }
  return resolved.map((p) => ({ ...p, featured: featured.has(p.id) }));
}
