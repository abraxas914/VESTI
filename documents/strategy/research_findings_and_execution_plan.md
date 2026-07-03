# VESTI — Evidence-Driven Strategy & Execution Plan (2026-06)

> Mission: help people **efficiently manage their conversation records across all major AI platforms**.
> This doc turns a multi-agent web research pass (real needs + competitor/OSS landscape + honest
> self-assessment) into decisions and a prioritized build plan. Source research: market-research
> workflow, 2026-06-26 (Reddit/HN/ProductHunt/forums/GitHub, with URLs in-line below).

## 1. Validated real needs (ranked by recurrence)

| # | Need (user-phrased) | Freq | VESTI today |
|---|---|---|---|
| 1 | **Full-text search across the BODY of all past chats** — re-find the buried answer/snippet | very-high | **partial / weak impl** |
| 2 | **Folders/projects/tags + bulk actions** so 200–500+ chats stay manageable | very-high | partial |
| 3 | One place to search/manage across ChatGPT + Claude + Gemini **+ Chinese platforms** | very-high | **strong** |
| 4 | Reliable, high-fidelity capture that never silently truncates/breaks | must | partial |
| 5 | Export/back up to durable local files (MD/JSON/PDF/**docx**) — own your data | must | partial |
| 6 | Keep the archive **private & local-first** (no cloud that trains/locks-in) | must | **false today** (see §4) |
| 7 | Send chats into PKM (Obsidian/Notion) as clean Markdown | should | partial (one-way) |
| 8 | Save & reuse best prompts inside any tool | should | strong |

Key evidence: native ChatGPT/Claude search is title-only ("won't find the conversation where you
designed a schema unless you titled it 'Database Schema Design'" — llmnesia.com); pain peaks at
200–500 conversations (ai-toolbox.co); data-loss anxiety drives a whole exporter ecosystem; multi-tool
users "run the same mental search three or four times" across siloed histories.

## 2. Where VESTI genuinely wins (lean in)

- **Uncontested Chinese-platform coverage** (Doubao/Qwen/Kimi/Yuanbao + ChatGPT/Claude/Gemini/DeepSeek).
  No Western export tool or OSS project touches the Chinese AI ecosystem. Defensible wedge.
- **Structured AST capture** (code/tables/math/citations/attachments as typed nodes) — the foundation
  that makes high-fidelity Send-to actually work. Most exporters flatten to text.
- **Rich-HTML clipboard** that pastes formatted into Word/WPS/Notion — an Office/WPS audience OSS ignores.
- **Single owned multi-platform corpus** with capture + store + search + RAG + graph + prompts + reflection.
  Exporters dump files and stop; memory engines discard verbatim chats; PKM tools can't capture native history.
- **Inspectable agentic Explore** (planner → RAG → context → synthesis with editable context + traces).

## 3. Real gaps (the honest list)

- **Search is a naive substring scan** (`repository.ts` `.toLowerCase().includes()`): no index, no ranking,
  no fuzzy, **no CJK tokenization** — the #1 need is the weakest implementation.
- **Retrieval can't scale**: one coarse vector *per conversation*, brute-force linear cosine scan; degrades
  exactly at the 200–500-conversation power-user scale.
- **Capture is DOM-coupled & silently fragile**: a broken parser surfaces only as `no_messages` (silent loss);
  no health-check, no regression tests.
- **Privacy positioning is false by default** (see §4).
- Organization (folders/bulk-ops) not first-class; backfill only 2/8 platforms; summaries manual-only;
  streaming gated; zero automated tests; ~30 standing tsc errors.

## 4. The one decision that needs the founder (gated)

**Local-first / BYOK / on-device embeddings.** By default (`demo_proxy`) every intelligence feature —
embeddings, summaries, Explore, digests, prompt-optimize, Roundtable — sends conversation text to a
third-party proxy; **embeddings have no BYOK path at all**. This contradicts the local-first / 思维主权
positioning and is the single biggest credibility liability. The proxy was explicitly kept "as-is this
round" (「代理先保留目前的设置」), so this is **deferred to a founder decision**:

- **Recommended:** ship **on-device embeddings** (Transformers.js + WebGPU/WASM, e.g. EmbeddingGemma-300M /
  Nomic-v2, in a Web Worker, persisted to IndexedDB) → search/embeddings fully local, zero egress; plus
  provider-agnostic BYOK for chat. One change repairs honesty, resilience, and retrieval quality at once.
- **Interim (shippable without touching the proxy):** an in-UI **"what leaves your device" disclosure** +
  a **local-only mode** that disables cloud features. Honesty is non-negotiable until BYOK-everywhere lands.

→ **Awaiting founder go on the embeddings/BYOK overhaul.** Everything in §5 below is proxy-independent and
proceeds now.

## 5. Execution waves (proxy-independent; executing autonomously)

**Wave 1 — Perfect the #1 need: local search.** A real local **hybrid search engine** — BM25 inverted
index over message AST (text/code/citations/attachments) with relevance ranking, prefix/fuzzy matching,
and a **CJK-aware tokenizer** (character-bigram + Latin-word; the thing Western tools structurally can't do)
— replacing the substring scan. Fully local, instant, works with no model. Plus a cheap **capture-health
self-check** that warns "capture may be incomplete" instead of silently logging `no_messages`.

**Wave 2 — Organization at scale (#2 need).** First-class **folders/projects + tags + pinning + bulk
archive/delete/export/move** over the unified cross-platform corpus. Plus the §4 "what leaves your device"
disclosure.

**Wave 3 — Retrieval quality & scale.** Per-message/per-turn **chunking with stable IDs** + content-hash
incremental indexing; an **ANN index** (HNSW-WASM) replacing the linear scan; **hybrid retrieval** (fuse the
new BM25 with dense vectors via RRF) + a local rerank. (Embedding *routing* stays as-is pending §4.)

**Later (P2).** Auto-tagging/topic clustering (reuse embeddings); .docx export + idempotent incremental
PKM sync; Chinese-platform bulk backfill; automated parser-regression tests; true entity knowledge graph.

## 6. The thesis in one line

VESTI's moat = **the only reliable, structured, local, multi-platform (incl. Chinese) chat corpus** with
**best-in-class search over it**. Perfecting **capture reliability** and **search/retrieval quality** —
both compounded by the CJK edge — is what makes that moat real. That is where we optimize to the extreme.
