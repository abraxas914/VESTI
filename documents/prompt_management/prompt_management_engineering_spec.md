# Prompt Management System — Engineering Spec

Status: Draft for implementation (v1.x feature branch `feat/debug-and-enhancement`)
Owner: capture/prompts working stream
Audience: maintainers implementing and reviewing the Prompt Management feature

> Note on terminology: the user request says "promote" — this is a typo for
> **prompt**. Throughout this document and the code, the canonical term is
> `prompt`.

## 1. Goal & scope

Add a **Prompt Management system** to Vesti with three coordinated surfaces:

1. **Intelligent archive (Dashboard).** A new **Prompts** tab in the existing
   dashboard shell (`packages/vesti-ui`) that *intelligently archives and
   summarizes high-value prompts* extracted from the user's already-captured
   conversations (their `role: "user"` messages), with LLM-assisted scoring,
   titling, tag/category suggestion, and de-duplication.
2. **Personal prompt library.** A user-owned, curated CRUD library of
   frequently-used prompts (manual add / edit / star / categorize / delete),
   seeded by the archive but fully editable and independent.
3. **In-page assist (content script).** On the major AI platform web pages,
   provide *prompt补写 (completion/assist)* in two complementary modes:
   - **Slash/quick template insert** — type a trigger (default `/v`) in the
     chat input to search the library and insert a saved prompt (no LLM).
   - **LLM smart completion** — a small Vesti control near the input that takes
     the current draft + relevant library prompts and produces an optimized /
     completed prompt, previewed before insertion.

### Non-goals (this iteration)

- No cloud sync / sharing of prompt libraries (local-only, IndexedDB).
- No standalone `vesti-web` (Next.js) surface — the user confirmed the Dashboard
  tab is the target "web端". `vesti-web` is out of scope.
- No automatic mutation of platform chat state beyond writing into the input
  box on explicit user action.

## 2. Design principles (per `CLAUDE.md`)

- **Isolation, no pollution.** All new code lives under clearly-scoped new
  paths: `frontend/src/lib/promptlib/` (engine), a new offscreen route group,
  `packages/vesti-ui/src/tabs/prompts-tab.tsx` (UI), and
  `frontend/src/contents/prompt-assist.ts` (in-page). Existing files receive
  only additive, minimal edits (schema version bump, protocol union entries,
  offscreen switch cases, storage adapter wiring, dashboard tab registration).
- **LLM is optional.** Every "intelligent" path degrades gracefully to a
  deterministic heuristic when no LLM is configured (`requireSettings` would
  throw). The library and slash-insert work fully offline.
- **Respect the UI boundary.** `frontend/src/lib/{prompts,services,utils}` must
  not import `@vesti/ui` (enforced by `scripts/check-frontend-ui-boundary.mjs`).
  The new engine lives in `frontend/src/lib/promptlib/` and is referenced by
  offscreen + services only. The `StorageApi` contract lives in vesti-ui; the
  frontend supplies implementations.
- **Reuse existing infra.** Dexie (`db`), the offscreen request/response
  protocol, `storageService` client wrappers, `callInference` for LLM, the
  capsule content-script patterns, and `logger` (with the new `debug` level).

## 3. Data model

### 3.1 New Dexie store `prompts` (schema **version 17**)

```ts
// frontend/src/lib/db/schema.ts
export type PromptSource = "manual" | "extracted";

export interface PromptRecord {
  id?: number;
  title: string;                 // short label (LLM- or heuristic-derived)
  body: string;                  // the prompt text (canonical, editable)
  category: string | null;       // user-facing folder/category
  tags: string[];                // freeform tags
  source: PromptSource;          // manual vs auto-extracted
  source_platform: Platform | null;       // where it was first seen
  source_conversation_id: number | null;  // provenance (extracted)
  source_message_id: number | null;        // provenance (extracted)
  is_favorite: boolean;          // user-pinned / "常用"
  is_archived: boolean;          // soft-hide from main list
  quality_score: number;         // 0..1 "高配" score (heuristic or LLM)
  summary: string | null;        // one-line "what this prompt does"
  variables: string[];           // detected {{placeholders}}
  use_count: number;             // incremented on insert via assist
  last_used_at: number | null;
  body_hash: string;             // sha-256 of normalized body, for dedupe
  created_at: number;
  updated_at: number;
}
```

Indexes (v17 `stores`):
```
prompts: "++id, source, category, is_favorite, is_archived, quality_score,
          updated_at, last_used_at, use_count, body_hash,
          source_conversation_id, [source+updated_at], [is_favorite+updated_at]"
```

All prior stores are carried forward unchanged in the v17 block (Dexie requires
re-declaring the full schema per version). `.upgrade(() => undefined)` — new
empty store, no migration of existing data needed.

### 3.2 Public type (`frontend/src/lib/types/index.ts`)

`Prompt = PromptRecord & { id: number }` exported for protocol + UI. Mirror the
type into `packages/vesti-ui/src/types.ts` (the UI package keeps its own copy of
shared shapes, as it already does for `Conversation`, `Note`, etc.).

### 3.3 Dedupe key

`body_hash = sha256(normalize(body))` where `normalize` lowercases, collapses
whitespace, strips trailing punctuation. Used to avoid re-archiving the same
prompt and to merge `use_count` on manual re-add.

## 4. Engine: `frontend/src/lib/promptlib/`

| File | Responsibility |
|------|----------------|
| `promptTypes.ts` | shared engine types (extraction candidate, score breakdown) |
| `promptNormalize.ts` | normalize text, hash, detect `{{variables}}`, length/complexity metrics |
| `promptHeuristics.ts` | **LLM-free** scoring + title + category guess (always available) |
| `promptExtractor.ts` | pull candidate prompts from captured `user` messages |
| `promptSummarizer.ts` | **LLM** enrichment (title/summary/tags/score) via `callInference`, with heuristic fallback |
| `promptCompletion.ts` | in-page补写: compose system+user prompt for `callInference`, parse result |
| `index.ts` | barrel exports |

### 4.1 Extraction (`promptExtractor`)

Input: a set of conversations (or "all since last run"). For each conversation,
take `role: "user"` messages, filter out trivial turns (length thresholds,
non-instructional one-liners like "ok", "继续", "thanks"), normalize, and emit
`PromptCandidate { body, platform, conversationId, messageId, heuristicScore }`.
De-dup by `body_hash` against existing `prompts`.

### 4.2 Heuristic scoring (`promptHeuristics`) — always on

`quality_score ∈ [0,1]` from signals such as: length band, presence of explicit
instruction verbs, structure (numbered steps / role-setting / constraints),
presence of `{{variables}}` or delimiters, and reuse (same hash seen across
multiple conversations → higher). Title = first sentence / imperative clause,
trimmed. Category guess from keyword map (coding, writing, analysis, …). This
guarantees the archive works with **no LLM**.

### 4.3 LLM enrichment (`promptSummarizer`) — optional

When LLM is configured, batch top-N candidates through `callInference` with a
strict JSON-returning system prompt: `{ title, summary, tags[], category,
score }`. Validate with `zod` (already a dep). On any error / missing config,
**fall back to heuristic** output and log at `debug`. Never block archiving on
the LLM.

### 4.4 In-page completion (`promptCompletion`) — optional

Given `{ draft, platform, relatedPrompts[] }`, build a system prompt that asks
the model to *improve / complete* the user's draft prompt (not answer it),
optionally borrowing structure from library prompts. Return the rewritten
prompt text. Used only on explicit user action (button click).

## 5. Messaging protocol additions

Add to the `RequestMessage` union (`frontend/src/lib/messaging/protocol.ts`) and
handle in `offscreen/index.ts`:

| Type | Payload | Returns |
|------|---------|---------|
| `LIST_PROMPTS` | `{ filter?: PromptListFilter }` | `Prompt[]` |
| `CREATE_PROMPT` | `{ input: CreatePromptInput }` | `{ prompt: Prompt }` |
| `UPDATE_PROMPT` | `{ id, changes: UpdatePromptChanges }` | `{ prompt: Prompt }` |
| `DELETE_PROMPT` | `{ id }` | `{ deleted: boolean }` |
| `TOGGLE_PROMPT_FAVORITE` | `{ id, isFavorite }` | `{ prompt: Prompt }` |
| `INCREMENT_PROMPT_USAGE` | `{ id }` | `{ prompt: Prompt }` |
| `EXTRACT_PROMPTS_FROM_LIBRARY` | `{ scope?: "all" \| "recent", limit? }` | `{ created, skipped, candidates }` |
| `SEARCH_PROMPTS` | `{ query, limit? }` | `Prompt[]` (for in-page slash) |
| `COMPLETE_PROMPT` | `{ draft, platform, useLibrary? }` | `{ completion, usedLlm }` |

`EXTRACT_PROMPTS_FROM_LIBRARY` and `COMPLETE_PROMPT` use the LLM with graceful
degradation. All routes funnel through repository functions in
`frontend/src/lib/db/repository.ts` (new `prompts` section) and the engine.

Content scripts already use `sendRequest` to reach offscreen; the in-page assist
reuses `SEARCH_PROMPTS`, `INCREMENT_PROMPT_USAGE`, `COMPLETE_PROMPT`,
`CREATE_PROMPT`.

## 6. Client wrappers + StorageApi

- Add thin wrappers in `frontend/src/lib/services/storageService.ts`
  (`listPrompts`, `createPrompt`, …) mirroring existing patterns.
- Extend `StorageApi` (`packages/vesti-ui/src/types.ts`) with the matching
  **optional** methods (optional keeps backward-compat with any other host).
- Wire the wrappers into the `storage={{…}}` object in
  `frontend/src/dashboard.tsx`.

## 7. Dashboard "Prompts" tab

- New file `packages/vesti-ui/src/tabs/prompts-tab.tsx`, exported from
  `packages/vesti-ui/src/index.ts`.
- Register in `packages/vesti-ui/src/dashboard.tsx`: extend `Tab` union to
  include `"prompts"`, add nav button, mount panel (lazy-mount like others),
  honor `?tab=prompts` deep-link.
- Layout: left = category/favorites filter rail + "Extract from conversations"
  action; center = prompt list (search, sort by score/recency/use); right/modal
  = prompt detail+editor (title, body with `{{variables}}` highlighting,
  category, tags, favorite, provenance link to source conversation, copy,
  quality score, LLM summary).
- States: empty (no prompts → CTA to extract or add), loading, extracting
  (progress), error. Mirror existing tab visual language (Tailwind tokens,
  platform tone).

## 8. In-page assist content script

- New file `frontend/src/contents/prompt-assist.ts`, `PlasmoCSConfig.matches`
  = the same AI-platform hosts as the capsule. Shadow-DOM isolated UI (reuse
  the capsule's shadow + style approach).
- **Input resolution**: per-platform selector map for the composer textarea /
  contenteditable (ChatGPT `#prompt-textarea`, Claude `[contenteditable]`
  composer, Gemini/DeepSeek/Doubao/Qwen/Kimi/Yuanbao equivalents). A shared
  `resolveComposer()` with fallbacks; degrade silently if not found.
- **Slash mode**: listen for the trigger token at input start; open a small
  popup listing `SEARCH_PROMPTS` results; Enter/click inserts body (fills
  `{{variables}}` via inline prompts or leaves placeholders) and fires
  `INCREMENT_PROMPT_USAGE`.
- **Smart completion**: a floating "✨ 补写" button near the composer; on click,
  read the draft, call `COMPLETE_PROMPT`, show a preview card with
  Insert/Replace/Cancel; on insert, write into composer (dispatch proper
  `input` events so the host React app registers the change).
- **Save-as-prompt**: optional affordance to save the current draft to the
  library (`CREATE_PROMPT`).
- Gated by a settings flag (default on for primary rollout hosts), reusing the
  capsule settings pattern so users can disable per host.

## 9. Privacy & safety

- All prompt data stays in local IndexedDB. Extraction reads only
  already-captured local messages.
- LLM calls reuse the user's configured provider/proxy; the in-page completion
  sends only the current draft + selected library prompts (never the whole
  conversation) and only on explicit action.
- The in-page script writes to the composer **only** on explicit user action;
  it never auto-submits.

## 10. Phasing (implementation order)

1. **P1 — Data + engine + protocol (offline core).** schema v17, types,
   `promptlib` (normalize/heuristics/extractor), repository CRUD + extract,
   protocol + offscreen routes, storageService wrappers, StorageApi. Heuristic
   scoring only. Typecheck.
2. **P2 — Dashboard Prompts tab.** UI for library CRUD + "extract from
   conversations" + detail editor. Typecheck.
3. **P3 — LLM enrichment.** `promptSummarizer` + `COMPLETE_PROMPT`; wire into
   extract + completion with graceful degradation.
4. **P4 — In-page assist content script.** slash insert + smart completion +
   save-as-prompt.
5. **P5 — Docs + manual sampling checklist + changelog.**

Each phase is independently shippable and leaves `main` behavior unchanged when
the tab/script are not used.

## 11. Acceptance criteria

- With **no LLM** configured: Prompts tab loads; manual CRUD works; "extract
  from conversations" populates candidates with heuristic titles/scores; slash
  insert works on at least ChatGPT + one domestic platform.
- With LLM configured: extracted prompts gain LLM titles/summaries/tags;
  "补写" returns an improved prompt and inserts on confirm.
- No regression: existing Library/Explore/Network tabs and capture flow
  unchanged; `tsc` introduces no new errors in touched files;
  `check:ui-boundaries` passes.
- The in-page script never auto-submits and is disable-able per host.

## 12. Open questions / future

- Cross-device sync (export/import already exists for other stores — extend
  `exportAllData`/`importAllData` to include `prompts` in a follow-up).
- Sharing/templates marketplace (out of scope).
- Per-platform composer selectors will need maintenance like the parsers; track
  in the capture-engine playbook.
