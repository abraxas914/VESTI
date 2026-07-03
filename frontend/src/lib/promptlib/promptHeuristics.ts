// LLM-free heuristics: quality scoring, category guessing and tag suggestion.
// These guarantee the prompt archive is fully functional with no LLM configured.

import {
  computeTextMetrics,
  deriveTitle,
  detectVariables,
  hasInstructionVerb,
  normalizeWhitespace,
} from "./promptNormalize";
import type { PromptEnrichment } from "./promptTypes";

interface CategoryRule {
  category: string;
  pattern: RegExp;
  tag: string;
}

const CATEGORY_RULES: CategoryRule[] = [
  { category: "Coding", tag: "coding", pattern: /\b(code|function|bug|refactor|api|typescript|python|sql|regex|stack trace|编程|代码|函数|报错|重构)\b/i },
  { category: "Writing", tag: "writing", pattern: /\b(write|essay|article|blog|email|copy|story|poem|润色|写作|文章|邮件|文案|改写)\b/i },
  { category: "Analysis", tag: "analysis", pattern: /\b(analyze|compare|evaluate|pros and cons|tradeoffs?|分析|对比|评估|优缺点)\b/i },
  { category: "Translation", tag: "translation", pattern: /\b(translate|translation|翻译|译成|中译英|英译中)\b/i },
  { category: "Summarize", tag: "summary", pattern: /\b(summari[sz]e|tl;dr|key points|总结|概括|要点)\b/i },
  { category: "Roleplay", tag: "roleplay", pattern: /\b(act as|you are a|role ?play|扮演|角色|你是一名?)\b/i },
  { category: "Productivity", tag: "productivity", pattern: /\b(plan|schedule|checklist|brainstorm|计划|清单|头脑风暴|安排)\b/i },
];

/** Best-guess category from body content, or null when nothing matches. */
export function guessCategory(body: string): string | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(body)) return rule.category;
  }
  return null;
}

/** Suggested freeform tags (deterministic, de-duplicated, max 5). */
export function suggestTags(body: string): string[] {
  const tags = new Set<string>();
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(body)) tags.add(rule.tag);
  }
  if (detectVariables(body).length > 0) tags.add("template");
  if (/```/.test(body)) tags.add("code");
  return Array.from(tags).slice(0, 5);
}

/**
 * Heuristic quality ("高配") score in [0,1]. Rewards length within a useful
 * band, explicit instructions, structure, role framing, constraints and
 * reusable templates; penalizes trivially short or pure-question turns.
 */
export function scorePrompt(body: string): number {
  const text = normalizeWhitespace(body);
  if (text.length < 12) return 0;

  const metrics = computeTextMetrics(text);
  let score = 0;

  // Length band: 60–1200 chars is the sweet spot for a reusable prompt.
  if (metrics.charCount >= 60 && metrics.charCount <= 1200) score += 0.25;
  else if (metrics.charCount > 1200 && metrics.charCount <= 3000) score += 0.15;
  else if (metrics.charCount >= 30) score += 0.08;

  if (hasInstructionVerb(text)) score += 0.2;
  if (metrics.hasRoleFraming) score += 0.12;
  if (metrics.hasConstraints) score += 0.12;
  if (metrics.hasNumberedSteps || metrics.hasBullets) score += 0.12;
  if (metrics.hasVariables) score += 0.12;
  if (metrics.hasCodeFence) score += 0.05;

  // A turn that is *only* a short question is usually not a reusable prompt.
  if (metrics.questionRatio > 0.8 && metrics.charCount < 80) score -= 0.15;

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

/** Full heuristic enrichment used as the always-available fallback. */
export function heuristicEnrichment(body: string): PromptEnrichment {
  return {
    title: deriveTitle(body),
    summary: null,
    tags: suggestTags(body),
    category: guessCategory(body),
    score: scorePrompt(body),
  };
}
