// Prompt text normalization, hashing and structural metrics.
//
// Pure, dependency-free helpers shared by the extractor, heuristics and
// repository. No DOM and no @vesti/ui imports (keeps the engine portable and
// usable from the offscreen worker).

/** Collapse whitespace and trim; preserves intra-line single spaces. */
export function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Canonical form used purely for de-duplication: lowercased, whitespace
 * collapsed to single spaces, trailing punctuation removed. Two prompts that
 * differ only in casing/spacing/trailing punctuation hash to the same value.
 */
export function canonicalizeForHash(body: string): string {
  return normalizeWhitespace(body)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?，。；：！？、]+$/u, "")
    .trim();
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of the canonical body. Async (uses Web Crypto, available in worker). */
export async function computePromptHash(body: string): Promise<string> {
  const data = new TextEncoder().encode(canonicalizeForHash(body));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

/**
 * Detect template variables. Supports `{{name}}`, `{name}` and `[NAME]` styles.
 * Returns a de-duplicated, order-preserving list of variable names.
 */
export function detectVariables(body: string): string[] {
  const found = new Set<string>();
  const ordered: string[] = [];
  const patterns = [/\{\{\s*([\w一-龥 .-]{1,40})\s*\}\}/g, /\[\s*([A-Z][A-Z0-9_ ]{1,40})\s*\]/g];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const name = match[1].trim();
      if (name && !found.has(name)) {
        found.add(name);
        ordered.push(name);
      }
    }
  }

  return ordered;
}

export interface PromptTextMetrics {
  charCount: number;
  wordCount: number;
  lineCount: number;
  hasNumberedSteps: boolean;
  hasBullets: boolean;
  hasRoleFraming: boolean;
  hasConstraints: boolean;
  hasVariables: boolean;
  hasCodeFence: boolean;
  questionRatio: number;
}

const ROLE_FRAMING = /\b(you are|act as|as an?|imagine you|你是|扮演|作为一名?|请你作为)\b/i;
const CONSTRAINTS = /\b(must|should|do not|don't|avoid|ensure|requirement|constraints?|format|步骤|要求|限制|不要|必须|确保|输出格式)\b/i;
const INSTRUCTION_VERBS = /\b(write|create|generate|explain|summari[sz]e|translate|analy[sz]e|design|implement|review|refactor|rewrite|rephrase|edit|revise|fix|improve|build|make|describe|outline|plan|brainstorm|evaluate|assess|recommend|suggest|calculate|convert|extract|classify|categori[sz]e|debug|document|draft|compare|list|optimi[sz]e|help me)\b|帮我|生成|写一|编写|重写|改写|润色|修改|总结|概括|翻译|分析|设计|实现|解释|说明|列出|对比|比较|优化|评估|推荐|建议|制定|计划|提取|转换|分类|描述|检查|调试/i;

/** Cheap structural metrics used by the heuristic scorer. */
export function computeTextMetrics(body: string): PromptTextMetrics {
  const normalized = normalizeWhitespace(body);
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  const words = normalized.split(/\s+/).filter(Boolean);
  const questionMarks = (normalized.match(/[?？]/g) ?? []).length;

  return {
    charCount: normalized.length,
    wordCount: words.length,
    lineCount: lines.length,
    hasNumberedSteps: /(^|\n)\s*\d+[.)、]/.test(normalized),
    hasBullets: /(^|\n)\s*[-*•]\s+/.test(normalized),
    hasRoleFraming: ROLE_FRAMING.test(normalized),
    hasConstraints: CONSTRAINTS.test(normalized),
    hasVariables: detectVariables(body).length > 0,
    hasCodeFence: /```/.test(body),
    questionRatio: words.length === 0 ? 0 : questionMarks / Math.max(1, lines.length),
  };
}

export function hasInstructionVerb(body: string): boolean {
  return INSTRUCTION_VERBS.test(body);
}

/** Derive a short title from a prompt body (heuristic fallback). */
export function deriveTitle(body: string, maxLength = 60): string {
  const normalized = normalizeWhitespace(body);
  if (!normalized) return "Untitled prompt";

  // Prefer the first sentence / line.
  const firstLine = normalized.split("\n")[0] ?? normalized;
  const firstSentence = firstLine.split(/(?<=[.!?。！？])\s/)[0] ?? firstLine;
  const candidate = (firstSentence || firstLine).trim();

  if (candidate.length <= maxLength) return candidate;
  return `${candidate.slice(0, maxLength - 1).trimEnd()}…`;
}
