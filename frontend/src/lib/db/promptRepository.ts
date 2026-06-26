// Persistence + orchestration for the Prompt Management store.
// Kept separate from the (large) repository.ts for isolation. Runs in the
// offscreen worker; reaches the LLM only through an injected `enrich` callback
// so this module stays usable with no model configured.

import { normalizePlatform } from "../platform";
import {
  canonicalizeForHash,
  computePromptHash,
  detectVariables,
  deriveTitle,
  extractCandidatesFromMessages,
  heuristicEnrichment,
  normalizeWhitespace,
  scorePrompt,
} from "../promptlib";
import type { PromptCandidate, PromptEnrichment } from "../promptlib";
import type {
  CreatePromptInput,
  Platform,
  Prompt,
  PromptExtractionResult,
  PromptListFilter,
  UpdatePromptChanges,
} from "../types";
import { logger } from "../utils/logger";
import { db } from "./schema";
import type { ConversationRecord, MessageRecord, PromptRecord } from "./schema";

function toPrompt(record: PromptRecord & { id: number }): Prompt {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    category: record.category,
    tags: Array.isArray(record.tags) ? record.tags : [],
    source: record.source,
    source_platform: record.source_platform,
    source_conversation_id: record.source_conversation_id,
    source_message_id: record.source_message_id,
    is_favorite: Boolean(record.is_favorite),
    is_archived: Boolean(record.is_archived),
    quality_score: typeof record.quality_score === "number" ? record.quality_score : 0,
    summary: record.summary ?? null,
    variables: Array.isArray(record.variables) ? record.variables : [],
    use_count: typeof record.use_count === "number" ? record.use_count : 0,
    last_used_at: record.last_used_at ?? null,
    body_hash: record.body_hash,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

async function getPromptById(id: number): Promise<Prompt | null> {
  const record = await db.prompts.get(id);
  if (!record || record.id === undefined) return null;
  return toPrompt(record as PromptRecord & { id: number });
}

function normalizePlatformValue(value: unknown): Platform | null {
  return normalizePlatform(value) ?? null;
}

export async function listPrompts(filter: PromptListFilter = {}): Promise<Prompt[]> {
  const records = await db.prompts.toArray();
  let prompts = records
    .filter((record): record is PromptRecord & { id: number } => record.id !== undefined)
    .map(toPrompt);

  if (!filter.includeArchived) {
    prompts = prompts.filter((prompt) => !prompt.is_archived);
  }
  if (filter.favoritesOnly) {
    prompts = prompts.filter((prompt) => prompt.is_favorite);
  }
  if (filter.source) {
    prompts = prompts.filter((prompt) => prompt.source === filter.source);
  }
  if (filter.category !== undefined) {
    prompts = prompts.filter((prompt) => prompt.category === filter.category);
  }
  if (filter.search?.trim()) {
    const needle = filter.search.trim().toLowerCase();
    prompts = prompts.filter(
      (prompt) =>
        prompt.title.toLowerCase().includes(needle) ||
        prompt.body.toLowerCase().includes(needle) ||
        prompt.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );
  }

  const sort = filter.sort ?? "recent";
  prompts.sort((a, b) => {
    if (sort === "score") return b.quality_score - a.quality_score || b.updated_at - a.updated_at;
    if (sort === "usage") return b.use_count - a.use_count || b.updated_at - a.updated_at;
    return b.updated_at - a.updated_at;
  });

  return prompts;
}

export async function searchPrompts(query: string, limit = 8): Promise<Prompt[]> {
  const all = await listPrompts({ search: query, sort: "usage" });
  return all.slice(0, Math.max(1, limit));
}

/**
 * Create a prompt. De-duplicates by canonical body hash: if a prompt with the
 * same body already exists it is returned untouched (no duplicate row).
 */
export async function createPrompt(
  input: CreatePromptInput,
): Promise<{ prompt: Prompt; created: boolean }> {
  const body = normalizeWhitespace(input.body ?? "");
  if (!body) {
    throw new Error("PROMPT_BODY_REQUIRED");
  }

  const bodyHash = await computePromptHash(body);
  const existing = await db.prompts.where("body_hash").equals(bodyHash).first();
  if (existing && existing.id !== undefined) {
    return { prompt: toPrompt(existing as PromptRecord & { id: number }), created: false };
  }

  const now = Date.now();
  const heuristic = heuristicEnrichment(body);
  const record: PromptRecord = {
    title: input.title?.trim() || heuristic.title || deriveTitle(body),
    body,
    category: input.category ?? heuristic.category,
    tags: input.tags ?? heuristic.tags,
    source: input.source ?? "manual",
    source_platform: normalizePlatformValue(input.source_platform),
    source_conversation_id: input.source_conversation_id ?? null,
    source_message_id: input.source_message_id ?? null,
    is_favorite: input.is_favorite ?? false,
    is_archived: false,
    quality_score:
      typeof input.quality_score === "number" ? input.quality_score : heuristic.score,
    summary: input.summary ?? heuristic.summary,
    variables: detectVariables(body),
    use_count: 0,
    last_used_at: null,
    body_hash: bodyHash,
    created_at: now,
    updated_at: now,
  };

  const id = await db.prompts.add(record);
  const saved = await getPromptById(id as number);
  if (!saved) throw new Error("PROMPT_CREATE_FAILED");
  return { prompt: saved, created: true };
}

export async function updatePrompt(
  id: number,
  changes: UpdatePromptChanges,
): Promise<Prompt> {
  const existing = await db.prompts.get(id);
  if (!existing || existing.id === undefined) {
    throw new Error("PROMPT_NOT_FOUND");
  }

  const patch: Partial<PromptRecord> = { updated_at: Date.now() };

  if (changes.body !== undefined) {
    const body = normalizeWhitespace(changes.body);
    if (!body) throw new Error("PROMPT_BODY_REQUIRED");
    patch.body = body;
    patch.body_hash = await computePromptHash(body);
    patch.variables = detectVariables(body);
    // Keep score fresh when the body changes and no explicit score is given.
    if (changes.quality_score === undefined) patch.quality_score = scorePrompt(body);
  }
  if (changes.title !== undefined) patch.title = changes.title.trim() || existing.title;
  if (changes.category !== undefined) patch.category = changes.category;
  if (changes.tags !== undefined) patch.tags = changes.tags;
  if (changes.is_favorite !== undefined) patch.is_favorite = changes.is_favorite;
  if (changes.is_archived !== undefined) patch.is_archived = changes.is_archived;
  if (changes.summary !== undefined) patch.summary = changes.summary;
  if (changes.quality_score !== undefined) patch.quality_score = changes.quality_score;
  if (changes.source !== undefined) patch.source = changes.source;

  await db.prompts.update(id, patch);
  const updated = await getPromptById(id);
  if (!updated) throw new Error("PROMPT_NOT_FOUND");
  return updated;
}

export async function deletePrompt(id: number): Promise<boolean> {
  const existing = await db.prompts.get(id);
  if (!existing) return false;
  await db.prompts.delete(id);
  return true;
}

export async function togglePromptFavorite(id: number, isFavorite: boolean): Promise<Prompt> {
  return updatePrompt(id, { is_favorite: isFavorite });
}

export async function incrementPromptUsage(id: number): Promise<Prompt> {
  const existing = await db.prompts.get(id);
  if (!existing || existing.id === undefined) {
    throw new Error("PROMPT_NOT_FOUND");
  }
  await db.prompts.update(id, {
    use_count: (existing.use_count ?? 0) + 1,
    last_used_at: Date.now(),
  });
  const updated = await getPromptById(id);
  if (!updated) throw new Error("PROMPT_NOT_FOUND");
  return updated;
}

/** Optional LLM enricher injected by the offscreen route (P3). */
export type PromptBatchEnricher = (
  candidates: PromptCandidate[],
) => Promise<PromptEnrichment[]>;

/** A reusable fragment distilled by the LLM (injected; keeps this module LLM-free). */
export interface ExtractedFragment {
  title: string;
  body: string;
  category?: string | null;
}

export interface ExtractPromptsOptions {
  scope?: "all" | "recent";
  limit?: number;
  /**
   * Optional LLM distiller: given candidate user prompts, returns reusable
   * FRAGMENTS (常用提示词 片段). When provided and it returns results, fragments
   * replace the heuristic frequency selection. Omitted → offline heuristic path.
   */
  distill?: (turns: string[]) => Promise<ExtractedFragment[]>;
}

const DISTILL_INPUT_CAP = 150;

/**
 * Scan captured conversations, extract prompt-worthy user turns, and archive
 * the new ones. De-dupes against the existing library by body hash. When an
 * `enrich` callback is supplied (LLM available) candidate metadata is refined;
 * otherwise heuristic metadata from the extractor is used.
 */
interface CandidateGroup {
  candidate: PromptCandidate;
  conversationIds: Set<number>;
}

// Selective curation: collect only FREQUENT + HIGH-QUALITY prompts ("常用提示词"),
// not everything. Frequency (recurs across conversations) is the primary signal;
// a quality gate keeps low-value chatter out; a hard cap keeps the library
// curated. A small quality-gated singleton top-up ensures a useful minimum on
// sparse/new libraries without hoarding.
// Curation is deliberately STRICT: only the genuinely most-used AND high-quality
// prompts earn a slot. Recurrence is required (no one-off top-up) and the bar is
// high, so the library stays tiny and trustworthy rather than a junk drawer.
const FREQUENT_MIN_CONVERSATIONS = 4; // must recur across >= 4 distinct conversations
const FREQUENT_QUALITY_GATE = 0.62; // and clear a high quality bar
const SINGLETON_QUALITY_GATE = 0.9; // one-offs effectively excluded (kept for safety only)
const MAX_RESULTS = 6; // hard cap — a handful, not a hoard
const MIN_FLOOR = 0; // NO singleton top-up: if nothing recurs enough, keep it empty
const MAX_SINGLETON_TOPUP = 0;

function combinedCurationScore(group: CandidateGroup): number {
  const quality = group.candidate.heuristicScore; // 0..1
  // Frequency weighted equally with quality, and normalized over a higher bar so
  // "most-used" genuinely dominates the ranking.
  const freqNorm = Math.min(1, group.conversationIds.size / 6); // 0..1
  return quality * 0.5 + freqNorm * 0.5;
}

/**
 * Snapshot the ids of the currently auto-extracted prompts. Extraction refreshes
 * the set by DIFFING against this snapshot (see pruneStaleExtracted) rather than
 * wiping up-front — so re-selected prompts and manual promotions are never lost,
 * and a mid-run failure can't half-wipe the library.
 */
async function getExtractedPromptIds(): Promise<number[]> {
  const all = await db.prompts.toArray();
  return all
    .filter((p) => p.source === "extracted" && typeof p.id === "number")
    .map((p) => p.id as number);
}

/**
 * Delete only the previously-extracted rows that the new run did NOT re-produce
 * (kept = ids createPrompt returned this run, whether newly created or matched an
 * existing prompt by body_hash). Never wipes to nothing on collision; safe to skip
 * if nothing changed.
 */
async function pruneStaleExtracted(
  oldExtractedIds: number[],
  keepIds: Set<number>,
): Promise<number> {
  const stale = oldExtractedIds.filter((id) => !keepIds.has(id));
  if (stale.length > 0) await db.prompts.bulkDelete(stale);
  return stale.length;
}

/**
 * Build the lightweight prompt library by surfacing FREQUENT + HIGH-QUALITY
 * prompts ("常用提示词") — user prompts that recur across captured conversations
 * and clear a quality bar. Selective (capped), offline, no LLM enrichment. New
 * prompts get a concise trigger (唤醒词) derived from the body; the user
 * curates/edits afterwards.
 */
export async function extractPromptsFromLibrary(
  options: ExtractPromptsOptions = {},
): Promise<PromptExtractionResult> {
  const scope = options.scope ?? "recent";
  const conversationLimit = options.limit ?? (scope === "all" ? 500 : 50);

  const conversations = await db.conversations
    .orderBy("updated_at")
    .reverse()
    .limit(conversationLimit)
    .toArray();

  // Group candidates by canonical body, counting how many DISTINCT conversations
  // each recurs in (= frequency).
  const groups = new Map<string, CandidateGroup>();
  for (const conversation of conversations) {
    const conversationId = conversation.id ?? null;
    if (conversationId === null) continue;

    const messages = (await db.messages
      .where("conversation_id")
      .equals(conversationId)
      .toArray()) as MessageRecord[];

    const candidates = extractCandidatesFromMessages(
      messages.map((message) => ({
        id: message.id ?? null,
        role: message.role,
        content_text: message.content_text ?? "",
      })),
      {
        conversationId,
        platform: normalizePlatformValue((conversation as ConversationRecord).platform),
      },
    );

    const localSeen = new Set<string>();
    for (const candidate of candidates) {
      const hash = canonicalizeForHash(candidate.body);
      if (localSeen.has(hash)) continue; // count each prompt once per conversation
      localSeen.add(hash);
      const existing = groups.get(hash);
      if (existing) {
        existing.conversationIds.add(conversationId);
      } else {
        groups.set(hash, { candidate, conversationIds: new Set([conversationId]) });
      }
    }
  }

  const allGroups = Array.from(groups.values());
  const byCurationScore = (a: CandidateGroup, b: CandidateGroup) =>
    combinedCurationScore(b) - combinedCurationScore(a);

  // LLM path: distill reusable FRAGMENTS from the best candidate prompts. When a
  // distiller is injected and yields fragments, they become the 常用提示词
  // library (片段-level), superseding the heuristic full-turn selection.
  if (options.distill) {
    const ranked = [...allGroups].sort(byCurationScore).slice(0, DISTILL_INPUT_CAP);
    const turns = ranked.map((group) => group.candidate.body);
    let fragments: ExtractedFragment[] = [];
    try {
      fragments = await options.distill(turns);
    } catch (error) {
      logger.warn("service", "Fragment distillation failed; falling back to heuristics", {
        error: (error as Error)?.message ?? String(error),
      });
    }
    if (fragments.length > 0) {
      // Refresh by DIFF, not up-front wipe: install the new set, then prune only
      // the old extracted rows the new set didn't reproduce (keepIds covers both
      // newly-created and existing-by-hash matches, so nothing is lost).
      const oldExtractedIds = await getExtractedPromptIds();
      const keepIds = new Set<number>();
      let created = 0;
      let skipped = 0;
      for (const fragment of fragments.slice(0, MAX_RESULTS)) {
        const body = fragment.body.trim();
        if (!body) {
          skipped += 1;
          continue;
        }
        const result = await createPrompt({
          title: (fragment.title || deriveTitle(body, 28)).trim(),
          body,
          category: fragment.category ?? null,
          source: "extracted",
          quality_score: scorePrompt(body),
        });
        if (result.prompt.id != null) keepIds.add(result.prompt.id);
        if (result.created) created += 1;
        else skipped += 1;
      }
      await pruneStaleExtracted(oldExtractedIds, keepIds);
      logger.info("service", "Prompt fragment distillation complete", {
        scope,
        candidates: allGroups.length,
        fragments: fragments.length,
        created,
        skipped,
      });
      return { created, skipped, candidates: allGroups.length, usedLlm: true };
    }
    // distiller produced nothing → fall through to the heuristic path below.
  }

  // Primary: frequent prompts that clear a (lenient) quality gate.
  const frequent = allGroups
    .filter(
      (group) =>
        group.conversationIds.size >= FREQUENT_MIN_CONVERSATIONS &&
        group.candidate.heuristicScore >= FREQUENT_QUALITY_GATE,
    )
    .sort(byCurationScore);

  let selected = frequent.slice(0, MAX_RESULTS);

  // Floor top-up: if too few recur, add only genuinely HIGH-QUALITY one-offs so
  // the library is useful without collecting everything.
  if (selected.length < MIN_FLOOR) {
    const selectedHashes = new Set(
      selected.map((group) => canonicalizeForHash(group.candidate.body)),
    );
    const topUp = allGroups
      .filter(
        (group) =>
          !selectedHashes.has(canonicalizeForHash(group.candidate.body)) &&
          group.candidate.heuristicScore >= SINGLETON_QUALITY_GATE,
      )
      .sort((a, b) => b.candidate.heuristicScore - a.candidate.heuristicScore)
      .slice(0, Math.min(MAX_SINGLETON_TOPUP, MIN_FLOOR - selected.length, MAX_RESULTS - selected.length));
    selected = [...selected, ...topUp];
  }

  // Refresh by DIFF (same safe strategy as the distill path): install, then prune
  // only the old extracted rows the new set didn't reproduce.
  const oldExtractedIds = await getExtractedPromptIds();
  const keepIds = new Set<number>();
  let created = 0;
  let skipped = 0;
  for (const group of selected) {
    const candidate = group.candidate;
    const result = await createPrompt({
      // Concise trigger (唤醒词); body is the original prompt. No enrichment.
      title: deriveTitle(candidate.body, 28),
      body: candidate.body,
      source: "extracted",
      source_platform: candidate.platform,
      source_conversation_id: candidate.conversationId,
      source_message_id: candidate.messageId,
      quality_score: candidate.heuristicScore,
    });
    if (result.prompt.id != null) keepIds.add(result.prompt.id);
    if (result.created) created += 1;
    else skipped += 1;
  }
  await pruneStaleExtracted(oldExtractedIds, keepIds);

  logger.info("service", "Prompt extraction complete", {
    scope,
    groups: allGroups.length,
    frequent: frequent.length,
    created,
    skipped,
  });

  return { created, skipped, candidates: allGroups.length, usedLlm: false };
}
