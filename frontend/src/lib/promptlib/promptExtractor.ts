// Extract reusable prompt candidates from captured conversation messages.
//
// Pure logic: callers (repository) supply the messages; this module decides
// which user turns are prompt-worthy and produces scored candidates. No DB or
// DOM access here.

import type { Platform } from "../types";
import { guessCategory, scorePrompt, suggestTags } from "./promptHeuristics";
import {
  canonicalizeForHash,
  deriveTitle,
  detectVariables,
  normalizeWhitespace,
} from "./promptNormalize";
import type { PromptCandidate } from "./promptTypes";

export interface ExtractableMessage {
  id: number | null;
  role: "user" | "ai";
  content_text: string;
}

export interface ExtractOptions {
  /** Minimum heuristic score to keep a candidate. */
  minScore?: number;
  /** Minimum normalized body length. */
  minLength?: number;
}

// Relaxed so the auto-built library actually populates: aggressive thresholds
// previously dropped nearly every user turn, making extraction return 0.
const DEFAULT_MIN_SCORE = 0.15;
const DEFAULT_MIN_LENGTH = 16;

// Trivial turns that are never reusable prompts even if long enough.
const TRIVIAL_PATTERNS = [
  /^(ok(ay)?|thanks?|thank you|yes|no|sure|继续|好的|谢谢|嗯+|收到|可以|行|对)$/i,
  /^(go on|continue|next|more|再来|接着|然后呢)$/i,
];

function isTrivial(text: string): boolean {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return TRIVIAL_PATTERNS.some((pattern) => pattern.test(collapsed));
}

/**
 * Produce scored, de-duplicated prompt candidates from a single conversation's
 * messages. Only `user` turns are considered.
 */
export function extractCandidatesFromMessages(
  messages: ExtractableMessage[],
  context: { conversationId: number | null; platform: Platform | null },
  options: ExtractOptions = {},
): PromptCandidate[] {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;

  const seen = new Set<string>();
  const candidates: PromptCandidate[] = [];

  for (const message of messages) {
    if (message.role !== "user") continue;

    const body = normalizeWhitespace(message.content_text ?? "");
    if (body.length < minLength || isTrivial(body)) continue;

    const hash = canonicalizeForHash(body);
    if (seen.has(hash)) continue;
    seen.add(hash);

    const score = scorePrompt(body);
    if (score < minScore) continue;

    candidates.push({
      body,
      platform: context.platform,
      conversationId: context.conversationId,
      messageId: message.id,
      heuristicScore: score,
      title: deriveTitle(body),
      category: guessCategory(body),
      tags: suggestTags(body),
      variables: detectVariables(body),
    });
  }

  return candidates;
}
