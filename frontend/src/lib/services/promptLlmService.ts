// LLM-backed enrichment + completion for the Prompt Management feature.
//
// Every entry point degrades gracefully: when no usable LLM is configured the
// callers fall back to heuristics (extraction) or to the raw draft
// (completion). This keeps the prompt library fully functional offline.

import { z } from "zod";
import type { LlmConfig, Platform, Prompt, PromptCompletionResult } from "../types";
import { heuristicEnrichment } from "../promptlib";
import type { PromptCandidate, PromptEnrichment } from "../promptlib";
import { getLlmAccessMode, normalizeLlmSettings } from "./llmConfig";
import { getLlmSettings } from "./llmSettingsService";
import { callInference } from "./llmService";
import { logger } from "../utils/logger";

const MAX_LLM_CANDIDATES = 30;
const LLM_CHUNK_SIZE = 10;
const MAX_BODY_CHARS = 700;

/**
 * Resolve a usable LLM config without throwing. Mirrors offscreen
 * `requireSettings` validation but returns null when not configured so callers
 * can degrade gracefully.
 */
export async function resolveUsableLlmConfig(): Promise<LlmConfig | null> {
  const raw = await getLlmSettings();
  if (!raw) return null;

  const normalized = normalizeLlmSettings(raw);
  const mode = getLlmAccessMode(normalized);

  if (mode === "demo_proxy") {
    if ((!normalized.proxyBaseUrl && !normalized.proxyUrl) || !normalized.modelId) {
      return null;
    }
    return normalized;
  }

  if (!normalized.apiKey || !normalized.modelId || !normalized.baseUrl) {
    return null;
  }
  return normalized;
}

const enrichmentItemSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(280).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  category: z.string().trim().max(40).nullable().optional(),
  score: z.number().min(0).max(1).optional(),
});

const enrichmentArraySchema = z.array(enrichmentItemSchema);

const ENRICH_SYSTEM_PROMPT = `You curate a personal prompt library. For each input prompt, produce concise metadata.
Return ONLY a JSON array. Each element: {"index": <number>, "title": <short imperative title, <= 10 words>, "summary": <one sentence describing what the prompt does, or null>, "tags": <up to 5 lowercase keywords>, "category": <one of: Coding, Writing, Analysis, Translation, Summarize, Roleplay, Productivity, Other>, "score": <0..1 reusability/quality>}.
Match the language of each prompt for title/summary. Do not invent content beyond the prompt.`;

function buildEnrichUserPrompt(chunk: PromptCandidate[]): string {
  const lines = chunk.map((candidate, localIndex) => {
    const body = candidate.body.slice(0, MAX_BODY_CHARS);
    return `#${localIndex}\n${body}`;
  });
  return `Prompts:\n\n${lines.join("\n\n---\n\n")}`;
}

async function enrichChunk(
  config: LlmConfig,
  chunk: PromptCandidate[],
): Promise<PromptEnrichment[]> {
  const fallback = chunk.map((candidate) => heuristicEnrichment(candidate.body));

  try {
    const result = await callInference(config, buildEnrichUserPrompt(chunk), {
      responseFormat: "json_object",
      systemPrompt: ENRICH_SYSTEM_PROMPT,
    });

    const content = result.content.trim();
    // The model may wrap the array in an object or code fence; extract the array.
    const jsonText = extractJsonArray(content);
    const parsed = enrichmentArraySchema.safeParse(JSON.parse(jsonText));
    if (!parsed.success) {
      logger.debug("llm", "Prompt enrichment validation failed; using heuristics", {
        issues: parsed.error.issues.slice(0, 3),
      });
      return fallback;
    }

    const merged = [...fallback];
    for (const item of parsed.data) {
      if (item.index < 0 || item.index >= chunk.length) continue;
      const heuristic = fallback[item.index];
      merged[item.index] = {
        title: item.title || heuristic.title,
        summary: item.summary ?? heuristic.summary,
        tags: item.tags && item.tags.length > 0 ? item.tags : heuristic.tags,
        category: item.category ?? heuristic.category,
        score: typeof item.score === "number" ? item.score : heuristic.score,
      };
    }
    return merged;
  } catch (error) {
    logger.debug("llm", "Prompt enrichment chunk failed; using heuristics", {
      error: (error as Error)?.message ?? String(error),
    });
    return fallback;
  }
}

/** Extract a JSON array substring from a possibly-wrapped model response. */
function extractJsonArray(content: string): string {
  const fenced = content.replace(/```json|```/gi, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    return fenced.slice(start, end + 1);
  }
  return fenced;
}

/**
 * Enrich candidates with LLM metadata. Returns one enrichment per input
 * candidate (aligned by index); candidates beyond `MAX_LLM_CANDIDATES` and any
 * failures use heuristic metadata.
 */
export async function enrichPromptCandidates(
  candidates: PromptCandidate[],
  config: LlmConfig,
): Promise<PromptEnrichment[]> {
  const result: PromptEnrichment[] = candidates.map((candidate) =>
    heuristicEnrichment(candidate.body),
  );

  const llmCount = Math.min(candidates.length, MAX_LLM_CANDIDATES);
  for (let offset = 0; offset < llmCount; offset += LLM_CHUNK_SIZE) {
    const chunk = candidates.slice(offset, Math.min(llmCount, offset + LLM_CHUNK_SIZE));
    const enriched = await enrichChunk(config, chunk);
    for (let i = 0; i < enriched.length; i += 1) {
      result[offset + i] = enriched[i];
    }
  }

  return result;
}

// ---- prompt FRAGMENT distillation (常用提示词) -----------------------------
// Distill reusable, high-quality prompt FRAGMENTS (short composable building
// blocks) from the user's past prompts — not whole turns. Heavy LLM use is
// intentional here; callers gate on having a usable config.

export interface DistilledFragment {
  title: string;
  body: string;
  category: string | null;
}

const FRAGMENT_CHUNK_SIZE = 15;
const MAX_FRAGMENT_INPUT = 120;
const MAX_FRAGMENTS_OUT = 6;

const FRAGMENT_CONSOLIDATE_PROMPT = `You are finalizing a TINY, premium library of reusable PROMPT FRAGMENTS — think a curated top shelf, not a collection. From the candidates below, KEEP ONLY the few that are genuinely excellent AND broadly reusable across many tasks — at most {MAX}, and FEWER is strongly preferred (returning 1-3, or even 0 if none are truly reusable, is the right answer most of the time). Ruthlessly drop anything narrow, one-off, vague, or merely okay. Merge near-duplicates. Lightly polish wording. Keep each fragment's language.
Return ONLY a JSON array: [{"title": "<= 6 words", "body": "...", "category": "<Writing|Coding|Analysis|Learning|Productivity|Translation|Roleplay|Other>"}]. No prose.`;

const fragmentItemSchema = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(4).max(600),
  category: z.string().trim().max(40).nullable().optional(),
});
const fragmentArraySchema = z.array(fragmentItemSchema);

const FRAGMENT_SYSTEM_PROMPT = `You curate a personal library of reusable PROMPT FRAGMENTS — short, composable building blocks a user repeatedly relies on, NOT whole prompts. From the user's past prompts, extract the most reusable, high-quality FRAGMENTS: e.g. a crisp role/persona line, a strong instruction pattern, a useful constraint, an output-format spec, or a recurring task framing.
Rules:
- Each fragment is SHORT and self-contained (roughly one to three sentences, or a single directive).
- Generalize: replace specific nouns with {{variables}} where that makes the fragment reusable.
- Keep the user's language. Deduplicate aggressively; merge near-duplicates.
- Be HIGHLY selective — return FEWER, excellent fragments (often 0-2 per chunk; skip a chunk entirely if nothing is genuinely reusable). Do NOT pad to fill a quota. Only the highest-value, broadly-reusable building blocks belong in the library.
- Give each a concise trigger title (<= 6 words) the user would type to recall it.
Return ONLY a JSON array: [{"title": "...", "body": "...", "category": "<Writing|Coding|Analysis|Learning|Productivity|Translation|Roleplay|Other>"}]. No prose.`;

function buildFragmentUserPrompt(chunk: string[]): string {
  const lines = chunk.map((body, i) => `#${i}\n${body.slice(0, MAX_BODY_CHARS)}`);
  return `User prompts:\n\n${lines.join("\n\n---\n\n")}`;
}

/**
 * Distill reusable fragments from a list of past user prompts. Chunks the input,
 * calls the model per chunk, validates + dedupes. Returns [] on total failure so
 * callers can fall back to heuristics.
 */
export async function distillFragments(
  config: LlmConfig | null,
  turns: string[],
): Promise<DistilledFragment[]> {
  if (!config) return [];
  const input = turns
    .map((t) => t.trim())
    .filter((t) => t.length >= 12)
    .slice(0, MAX_FRAGMENT_INPUT);
  if (input.length === 0) return [];

  // Pass 1: per-chunk candidate fragments (collect a few extra, then rank down).
  const CANDIDATE_CAP = MAX_FRAGMENTS_OUT * 3;
  const out: DistilledFragment[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < input.length; offset += FRAGMENT_CHUNK_SIZE) {
    if (out.length >= CANDIDATE_CAP) break;
    const chunk = input.slice(offset, offset + FRAGMENT_CHUNK_SIZE);
    try {
      const result = await callInference(config, buildFragmentUserPrompt(chunk), {
        responseFormat: "json_object",
        systemPrompt: FRAGMENT_SYSTEM_PROMPT,
      });
      const parsed = fragmentArraySchema.safeParse(
        JSON.parse(extractJsonArray(result.content.trim())),
      );
      if (!parsed.success) continue;
      for (const item of parsed.data) {
        const key = item.body.trim().toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          title: item.title.trim(),
          body: item.body.trim(),
          category: item.category ?? null,
        });
      }
    } catch (error) {
      logger.debug("llm", "Fragment distillation chunk failed", {
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  if (out.length <= MAX_FRAGMENTS_OUT) return out;

  // Pass 2: consolidate/rank down to the best MAX_FRAGMENTS_OUT (cross-chunk
  // dedup + quality selection). Falls back to the top slice if the call fails.
  try {
    const listing = out
      .map((f, i) => `#${i}\n${f.title}\n${f.body.slice(0, MAX_BODY_CHARS)}`)
      .join("\n\n---\n\n");
    const result = await callInference(config, `Candidate fragments:\n\n${listing}`, {
      responseFormat: "json_object",
      systemPrompt: FRAGMENT_CONSOLIDATE_PROMPT.replace("{MAX}", String(MAX_FRAGMENTS_OUT)),
    });
    const parsed = fragmentArraySchema.safeParse(
      JSON.parse(extractJsonArray(result.content.trim())),
    );
    if (parsed.success && parsed.data.length > 0) {
      const consolidated: DistilledFragment[] = [];
      const seen2 = new Set<string>();
      for (const item of parsed.data) {
        const key = item.body.trim().toLowerCase().replace(/\s+/g, " ");
        if (seen2.has(key)) continue;
        seen2.add(key);
        consolidated.push({
          title: item.title.trim(),
          body: item.body.trim(),
          category: item.category ?? null,
        });
        if (consolidated.length >= MAX_FRAGMENTS_OUT) break;
      }
      if (consolidated.length > 0) return consolidated;
    }
  } catch (error) {
    logger.debug("llm", "Fragment consolidation failed; using top slice", {
      error: (error as Error)?.message ?? String(error),
    });
  }
  return out.slice(0, MAX_FRAGMENTS_OUT);
}

export type PromptCompletionMode = "optimize" | "continue";

const OPTIMIZE_SYSTEM_PROMPT = `You are a prompt-engineering assistant. The user gives you a DRAFT prompt they intend to send to an AI assistant.
Rewrite it into a clearer, more effective prompt: add helpful role framing, explicit task, relevant constraints and a desired output format when useful. Preserve the user's intent and language. Keep any {{variables}} intact.
Return ONLY the improved prompt text, with no preamble, explanation, or surrounding quotes. Do NOT answer the prompt.`;

const CONTINUE_SYSTEM_PROMPT = `You are a prompt-writing assistant. The user has started writing a prompt but stopped partway. CONTINUE and complete it in the same language, voice, and intent — flesh out the unfinished thought, add the missing specifics (task, constraints, desired output) that the draft was clearly heading toward. Keep any {{variables}} intact.
Return ONLY the full completed prompt text (the user's draft continued to a natural, complete prompt), with no preamble, explanation, or surrounding quotes. Do NOT answer the prompt.`;

/**
 * Improve ("optimize") or continue ("续写") a draft prompt. Returns the
 * rewritten/continued prompt, or the original draft when no LLM is configured.
 */
export async function completePromptDraft(
  config: LlmConfig | null,
  payload: {
    draft: string;
    platform?: Platform;
    relatedPrompts?: Prompt[];
    mode?: PromptCompletionMode;
  },
): Promise<PromptCompletionResult> {
  const draft = payload.draft.trim();
  if (!draft) return { completion: "", usedLlm: false };
  if (!config) return { completion: draft, usedLlm: false };

  const mode: PromptCompletionMode = payload.mode === "continue" ? "continue" : "optimize";
  const references = (payload.relatedPrompts ?? [])
    .slice(0, 3)
    .map((prompt, index) => `Reference ${index + 1} (${prompt.title}):\n${prompt.body.slice(0, 400)}`)
    .join("\n\n");

  const draftLabel = mode === "continue" ? "Draft prompt to continue" : "Draft prompt to improve";
  const userPrompt = [
    payload.platform ? `Target platform: ${payload.platform}` : null,
    references ? `Style references from the user's library:\n${references}` : null,
    `${draftLabel}:\n${draft}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await callInference(config, userPrompt, {
      systemPrompt: mode === "continue" ? CONTINUE_SYSTEM_PROMPT : OPTIMIZE_SYSTEM_PROMPT,
    });
    const completion = result.content.trim();
    if (!completion) return { completion: draft, usedLlm: false };
    return { completion, usedLlm: true };
  } catch (error) {
    logger.debug("llm", "Prompt completion failed; returning draft", {
      error: (error as Error)?.message ?? String(error),
    });
    return { completion: draft, usedLlm: false };
  }
}
