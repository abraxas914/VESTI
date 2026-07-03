import type { Platform } from "../types";

/** A prompt-shaped candidate pulled from a captured conversation. */
export interface PromptCandidate {
  body: string;
  platform: Platform | null;
  conversationId: number | null;
  messageId: number | null;
  /** Heuristic 0..1 quality estimate (LLM may later refine). */
  heuristicScore: number;
  title: string;
  category: string | null;
  tags: string[];
  variables: string[];
}

/** Output of LLM (or heuristic) enrichment for a single prompt. */
export interface PromptEnrichment {
  title: string;
  summary: string | null;
  tags: string[];
  category: string | null;
  score: number;
}
