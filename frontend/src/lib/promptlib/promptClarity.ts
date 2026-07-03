// Clarity engine for real-time, offline prompt assessment.
//
// Pure and DOM-free: every export is a synchronous function over a string,
// safe to run on every keystroke (no storage / network / LLM). Powers the
// in-page real-time assistant and is reused by the dashboard Prompts tab and
// extraction so the whole suite shares one definition of a "good prompt".
//
// IMPORTANT: getScoreBreakdown() must stay in exact lockstep with
// scorePrompt() in promptHeuristics.ts — the sum of earned weights, clamped to
// [0,1], equals scorePrompt(body). A unit test enforces this.

import {
  computeTextMetrics,
  hasInstructionVerb,
  normalizeWhitespace,
  detectVariables,
  type PromptTextMetrics,
} from "./promptNormalize";

export type ClaritySeverity = "info" | "warn" | "critical";

export type ClarityIssueId =
  | "tooShort"
  | "pureQuestion"
  | "noInstructionVerb"
  | "noRole"
  | "noFormat"
  | "noConstraints"
  | "noExample"
  | "noContext"
  | "vagueScope"
  | "noStructure"
  | "undefinedVariables";

export interface ClarityIssue {
  id: ClarityIssueId;
  severity: ClaritySeverity;
  /** Stable i18n key under `realTimeAssist.clarity.<id>` for the message. */
  messageKey: string;
  /** Stable i18n key under `realTimeAssist.suggestion.<id>` for the fix hint. */
  suggestionKey: string;
}

export interface ScoreFactor {
  /** Stable identifier, also an i18n key under `realTimeAssist.breakdown.<id>`. */
  id: string;
  /** Points this factor contributes to scorePrompt (can be negative). */
  weight: number;
  /** Whether this factor was satisfied by the current draft. */
  earned: boolean;
  /** Actual points added to the score (0 when not earned; weight when earned). */
  points: number;
}

export interface ScoreBreakdown {
  /** Final 0..1 score, identical to scorePrompt(body). */
  score: number;
  factors: ScoreFactor[];
}

export interface Suggestion {
  id: ClarityIssueId;
  severity: ClaritySeverity;
  suggestionKey: string;
}

// Keyword probes (EN + CJK) used only by clarity checks (NOT by the score).
const OUTPUT_FORMAT_RE =
  /\b(format|bullet|list|table|json|markdown|csv|xml|yaml|outline|step-by-step)\b|格式|列表|表格|清单|分点|步骤/i;
const EXAMPLE_RE =
  /\b(e\.?g\.?|for example|for instance|sample|example)\b|例如|比如|举例|示例|样例/i;

const SEVERITY_RANK: Record<ClaritySeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * Explainable additive breakdown of scorePrompt(). The factor list mirrors the
 * branches in scorePrompt() exactly; `score` is the clamped, rounded sum, equal
 * to scorePrompt(body).
 */
export function getScoreBreakdown(body: string): ScoreBreakdown {
  const text = normalizeWhitespace(body);

  // scorePrompt floor: drafts under 12 chars score 0 with no contributing factors.
  if (text.length < 12) {
    return { score: 0, factors: [] };
  }

  const metrics = computeTextMetrics(text);
  const factors: ScoreFactor[] = [];

  // Length band (mutually exclusive — mirror scorePrompt's if/else-if chain).
  let lengthEarned = false;
  let lengthWeight = 0.25; // the "ideal band" weight, shown as the target
  let lengthPoints = 0;
  if (metrics.charCount >= 60 && metrics.charCount <= 1200) {
    lengthEarned = true;
    lengthPoints = 0.25;
  } else if (metrics.charCount > 1200 && metrics.charCount <= 3000) {
    lengthPoints = 0.15;
  } else if (metrics.charCount >= 30) {
    lengthPoints = 0.08;
  }
  factors.push({
    id: "length",
    weight: lengthWeight,
    earned: lengthEarned,
    points: lengthPoints,
  });

  const push = (id: string, weight: number, earned: boolean) => {
    factors.push({ id, weight, earned, points: earned ? weight : 0 });
  };

  push("instruction", 0.2, hasInstructionVerb(text));
  push("role", 0.12, metrics.hasRoleFraming);
  push("constraints", 0.12, metrics.hasConstraints);
  push("structure", 0.12, metrics.hasNumberedSteps || metrics.hasBullets);
  push("variables", 0.12, metrics.hasVariables);
  push("codeFence", 0.05, metrics.hasCodeFence);

  // Penalty factor — bare short question.
  const questionPenalty = metrics.questionRatio > 0.8 && metrics.charCount < 80;
  factors.push({
    id: "questionPenalty",
    weight: -0.15,
    earned: questionPenalty,
    points: questionPenalty ? -0.15 : 0,
  });

  const rawSum = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = Math.max(0, Math.min(1, round3(rawSum)));
  return { score, factors };
}

interface IssueRule {
  id: ClarityIssueId;
  severity: ClaritySeverity;
  /** Returns true when the issue is present for the given draft. */
  test: (text: string, metrics: PromptTextMetrics) => boolean;
}

// Ordered roughly by importance; generateSuggestions re-sorts by severity.
const ISSUE_RULES: IssueRule[] = [
  {
    id: "tooShort",
    severity: "critical",
    test: (text) => text.length < 40,
  },
  {
    id: "pureQuestion",
    severity: "warn",
    test: (_text, m) => m.questionRatio > 0.8 && m.charCount < 80,
  },
  {
    id: "noInstructionVerb",
    severity: "warn",
    test: (text) => !hasInstructionVerb(text),
  },
  {
    id: "noRole",
    severity: "info",
    test: (_text, m) => !m.hasRoleFraming,
  },
  {
    id: "noFormat",
    severity: "info",
    test: (text, m) => !m.hasConstraints && !OUTPUT_FORMAT_RE.test(text),
  },
  {
    id: "noConstraints",
    severity: "info",
    test: (_text, m) => !m.hasConstraints,
  },
  {
    id: "noExample",
    severity: "info",
    test: (text, m) => m.charCount >= 60 && !m.hasCodeFence && !EXAMPLE_RE.test(text),
  },
  {
    id: "vagueScope",
    severity: "info",
    test: (text, m) =>
      hasInstructionVerb(text) &&
      !m.hasNumberedSteps &&
      !m.hasBullets &&
      !m.hasConstraints &&
      m.charCount >= 40 &&
      m.charCount < 160,
  },
  {
    id: "noStructure",
    severity: "warn",
    test: (_text, m) => m.charCount > 400 && !m.hasNumberedSteps && !m.hasBullets,
  },
  {
    id: "undefinedVariables",
    severity: "info",
    test: (text) => {
      const vars = detectVariables(text);
      if (vars.length === 0) return false;
      // Flag when variables exist but nothing in the text explains/fills them.
      return !/\bdefine|means|represents|fill|replace|where\b|表示|填入|替换|代表/i.test(text);
    },
  },
];

/**
 * Detect concrete clarity / specificity issues in a draft prompt. Returns an
 * empty list for a well-formed prompt. Each issue carries stable i18n keys.
 */
export function detectClarityIssues(
  body: string,
  metrics?: PromptTextMetrics,
): ClarityIssue[] {
  const text = normalizeWhitespace(body);
  if (!text) return [];

  const m = metrics ?? computeTextMetrics(text);
  const issues: ClarityIssue[] = [];

  for (const rule of ISSUE_RULES) {
    if (rule.test(text, m)) {
      issues.push({
        id: rule.id,
        severity: rule.severity,
        messageKey: `realTimeAssist.clarity.${rule.id}`,
        suggestionKey: `realTimeAssist.suggestion.${rule.id}`,
      });
    }
  }

  // When the draft is too short, the downstream "missing X" checks are noise —
  // collapse to the single actionable signal.
  if (issues.some((issue) => issue.id === "tooShort")) {
    return issues.filter((issue) => issue.id === "tooShort");
  }

  return issues;
}

/**
 * Turn detected issues into a de-duplicated, severity-sorted, capped list of
 * actionable suggestions (default cap 3) for compact UI surfaces.
 */
export function generateSuggestions(
  issues: ClarityIssue[],
  limit = 3,
): Suggestion[] {
  const seen = new Set<ClarityIssueId>();
  const suggestions: Suggestion[] = [];

  for (const issue of issues) {
    if (seen.has(issue.id)) continue;
    seen.add(issue.id);
    suggestions.push({
      id: issue.id,
      severity: issue.severity,
      suggestionKey: issue.suggestionKey,
    });
  }

  suggestions.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return suggestions.slice(0, Math.max(1, limit));
}

export type ScoreLevel = "poor" | "fair" | "good" | "excellent";

/** Map a 0..1 score to a coarse level (i18n key `realTimeAssist.score.<level>`). */
export function scoreLevel(score: number): ScoreLevel {
  if (score >= 0.75) return "excellent";
  if (score >= 0.5) return "good";
  if (score >= 0.3) return "fair";
  return "poor";
}
