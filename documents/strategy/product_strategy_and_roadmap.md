# VESTI — Product Strategy & Roadmap (iteration 1)

Status: **draft for founder decision.** Synthesized from a 9-agent research+design
workflow (internal code audit + web research on open-source/competitors/real
user needs + architecture-grounded designs for 4 new directions + positioning).
Mission: help people efficiently manage their conversations across all major AI
platforms.

> This doc is the "确定方案" artifact. Implementation waits on the founder's
> greenlight of priorities (see **Decisions needed** at the end).

---

## 1. Positioning

VESTI is the only **local-first "second brain for your AI conversations"** — not a
stateless exporter, not a cloud SaaS dashboard. OSS tools one-shot dump a single
transcript (losing code/tables/attachments); viewers just browse an official
export. VESTI continuously captures across **8 platforms** (ChatGPT, Claude,
Gemini, DeepSeek, Doubao, Qwen, Kimi, Yuanbao) into a **faithful structured AST**,
stores it in a disciplined local Dexie KB, then **reasons over it**: agentic RAG
(Explore), a temporal knowledge graph, AI summaries/weekly digests, prompt
management, and "promote to your real tools" export. The wedge: **VESTI doesn't
just save your chats — it turns them into a searchable, self-reflective,
exportable knowledge asset you fully own.**

The sharpest top-of-funnel hook (from user-needs research): **"one searchable
brain across ChatGPT + Claude + Gemini + … that you own"** — native per-platform
search is widely panned, per-vendor, and non-portable.

---

## 2. Where we already beat the field (current moats)

- **Structured AST capture** — faithful code/tables/math survive (every OSS
  exporter falls back to plain text / breaks on attachments). Single clearest
  technical moat.
- **Agentic, inspectable Explore (RAG over your own chats)** — intent planner,
  traceable tool steps, editable context, local fallback. Far beyond any "save
  your chats" tool.
- **8-platform live capture** — incl. the 4 major Chinese platforms
  (Doubao/Qwen/Kimi/Yuanbao); essentially uncontested coverage.
- **Production-grade local data layer** — Dexie v17 with disciplined migrations,
  idempotent dedup, graceful offline degradation → real privacy/ownership.
- **Depth of synthesis** — summaries + weekly digests + temporal knowledge graph
  over a private multi-platform corpus exists in no single competitor.
- **Bilingual (en/zh) + curated 提示词超市** — credible in Western *and* Chinese
  markets at once.

**Market reality (research):** capture/export/search is **commoditized** (a dozen
extensions do it). Privacy/local-first is **nearly vacant** (Rewind absorbed by
Meta; "local" rivals leak server-side metadata). The integrated
capture+KB+RAG+graph+prompts vision is **genuinely uncontested** — but it's a bet
ahead of proven mass demand; the *validated* demand is export + better search.

---

## 3. Core competitiveness — what to perfect to the extreme

These decide whether the positioning is real. Ordered by leverage.

1. **Retrieval / RAG quality (the weakest pillar vs its own ambition).**
   Today: one coarse vector per conversation, JS linear / O(n²) scans,
   dot-product-as-cosine assuming normalized embeddings. Long/multi-topic threads
   collapse to a point; quality degrades at scale. If the headline feature feels
   untrustworthy, the whole positioning falls apart.
   - Chunk per-message/segment (store chunk vectors with a conversation backref).
   - Normalize embeddings on write; use true cosine (fix `cosineSimilarity`).
   - Add an ANN/index or clustering pre-filter so retrieval + `findAllEdges` stop
     being brute-force; recompute graph edges incrementally.
   - Hybrid retrieval: combine existing full-text (`searchConversationMatchesByText`)
     with vector scores; surface retrieval confidence in the trace.
2. **Capture reliability & coverage.** Foundation — nothing downstream works on an
   incomplete/stale corpus.
   - Incremental parse instead of full-subtree re-parse on the 1s debounce.
   - Close the **history-import gap** (only 2/8 platforms) or guarantee live-capture
     coverage; add version guards + breakage telemetry.
   - Selector-health self-check that flags silent parser breakage; per-conversation
     "capture completeness" indicator.
3. **Privacy / local-first integrity (de-proxy).** Embeddings are **proxy-only** and
   the LLM is **ModelScope-locked** → every semantic feature dies if the proxy is
   down, and it contradicts the privacy promise.
   - BYOK embeddings (and optionally a local/WASM model).
   - Provider-agnostic LLM routing (OpenAI/Anthropic-direct), behind the existing
     `llmService` abstraction.
   - Make the proxy an optional demo path; explicit in-UI "what leaves your device".
4. **Export / "Send to your real tools" (= Direction 1).** Converts the AST moat
   into a sticky, daily, monetizable outcome; no OSS tool touches Office/WPS.
   (Details in §4.1.)

**Cheap insurance to do early:** fix the **dedup delete-and-reinsert-on-any-change**
footgun (it churns message ids, breaking durable annotation/citation anchors).

---

## 4. Designs for the 4 new directions (MVP→Deep, architecture-grounded)

### 4.1 主流工作流衔接 — "Send to…" (Notion / Obsidian / Office / WPS)
**Concept:** one unified "Send to…" picker over a single canonical Markdown payload
(`buildExportMdV1` + the e1/e2/e3 AI-handoff pipeline) fanning out to pluggable
target adapters. Widen the **source** (any object — esp. whole conversation or its
AI summary) and the **targets**.
- **MVP (M):** generalize the two *working* integrations — Notion (reusable
  markdown→blocks renderer; export a conversation/summary as a page, idempotent via
  a `vesti` page-id) and Obsidian (export conversations/summaries with frontmatter)
  — behind one picker in the reader + batch bar. One-way, manual.
- **V1 (L):** rich-HTML **clipboard** (`ClipboardItem text/html`) so paste into
  Word/WPS/OneNote keeps formatting (today is plain-text only); client-side
  **.docx**; route AI summaries/handoffs/weekly reports through the picker.
- **Deep (L):** auto-export on archive (opt-in), Obsidian round-trip awareness,
  incremental Notion update, user templates.
- **Differentiation:** not "dump a transcript" — **promote a curated, summarized,
  formatted artifact** (AST keeps code/tables/math) into the tool you live in, as a
  *living* doc (idempotent re-export). Office/WPS audience is untouched by OSS.
- **Key open Q:** which is the #1 job — team wiki (Notion), second brain (Obsidian),
  or the doc I'm writing (Office/WPS, esp. China)? And is the canonical unit the
  full transcript or the **summary** (likely highest value)? Privacy: Notion export
  leaves the device — label it.

### 4.2 个人内向探索 — "AITI" (a thinking-fingerprint card)
**Concept:** a fun, MBTI-style **"mirror, not a verdict"** computed locally by a
*second aggregation route* over already-stored `summaries`
(`ConversationSummaryV2.meta_observations` = thinking_style/emotional_tone/
depth_level, plus key_insights/themes/tech_stack/sentiment). **The hard part is
already mined and stored.**
- **MVP (S):** 4 evidence-linked axes (Breadth↔Depth, Maker↔Theorist,
  Converger↔Wanderer, Cool↔Spirited) + "top obsessions", computed **100% locally,
  no LLM**, with an insufficient-data gate. Instant, offline, near-free.
- **V1 (M):** LLM-written portrait (over the anonymized feature digest, not raw
  chats) + shareable privacy-stripped card + evolution sparkline; reuses the weekly-
  digest pipeline wholesale.
- **Deep (L):** per-segment signals (after the retrieval fix), per-platform persona
  contrast ("Maker on Claude, Wanderer on ChatGPT"), calibration feedback.
- **Differentiation:** computed from your real behavioral trace **with receipts**,
  cross-8-platform, local-first — vs question-asking web toys; nobody else stored
  the per-conversation signals to do this cheaply.
- **Key open Q:** flagship viral hook vs delightful secondary? Type-code style
  (playful 4-letter vs descriptive)? Privacy line for the LLM portrait step.

### 4.3 学习和知识整理助手 — "Learn" tab
**Concept:** reframe the KB as a **personal curriculum** by re-projecting existing
signals. Domain Map (topics/clusters + depth trend), Learning Digest (key_insights
glossary + weekly rollup), Knowledge Gaps & Review Queue (`unresolved_threads`/
`recurring_questions` + spaced review), Content Recommendations.
- **MVP (M):** read-only "Learn" tab, **no new model dependency** — domains from the
  existing `topics` table, glossary/gaps from cached summaries, deep-links to the
  reader.
- **V1 (L):** SM-2 spaced review (new `review_items` store, schema v18), vector-
  cluster domains + LLM labels (fix the 12-keyword gardener), "next questions"
  synthesized locally, export learning report.
- **Deep (L):** external sources via opt-in web tool, mastery model, auto-quiz.
- **Differentiation:** learning-from-your-own-questions across 8 platforms, local,
  **zero authoring** (cards auto-mined from real Q&A, with source deep-links) — vs
  Anki (manual) and native "memory" (single-app personalization).
- **Key open Q:** is spaced-repetition actually wanted, or just "show me what I
  learned + what's unresolved"? New 5th tab vs a mode inside Explore?

### 4.4 AI 圆桌 — AI Roundtable
> ⚠️ Your description was truncated ("可以将…"). The design assumes: convene multiple
> AI **personas/seats** in a moderated debate over a question, optionally grounded
> in your captured KB, producing a structured synthesis. **Please confirm/complete.**

**Two interpretations:**
- **(A) Multi-persona on VESTI's own LLM — recommended, buildable now.** Each seat =
  a distinct `systemPrompt` to the existing `callInference`; a Moderator frames +
  synthesizes. Reuses the Explore **tool-trace spine** so each turn is an
  inspectable timed step; persists as an explore session (no migration). Honest
  framing: "multi-**perspective** panel," not "different AIs."
- **(B) True multi-model via live platform tabs** (seat = ChatGPT tab, etc.) — genuine
  model diversity but DOM-fragile, slow, ToS-grey. Flagged "Deep" experiment only.
- **MVP (M):** "Quick Panel" mode in Explore — pick 2–3 preset personas + Moderator,
  one round, structured synthesis (Consensus/Disagreements/Recommendation/Open
  Questions), rendered as seats + trace.
- **V1 (L):** optional **grounding in your history** (per-seat RAG slices), rebuttal
  round, editable roster (activates dormant prompt category/tags), export to
  Notion/Obsidian.
- **Deep (L):** true multi-model via BYOK (after provider-agnostic routing) and/or
  live-tab orchestration; streaming; convergence meter.
- **Differentiation:** structurally manufactured disagreement + moderated synthesis,
  **grounded in your own cross-platform history**, auditable (who said what, citing
  which conversation), saved as a durable artifact — vs single-voice native chat and
  headless dev frameworks (AutoGen/CrewAI).
- **Key open Q:** interpretation A vs B; is grounding core or optional; is streaming
  a prerequisite for acceptable UX.

---

## 5. Recommended roadmap (Now / Next / Later)

**Now — perfect the core (correctness/resilience; invisible until it isn't):**
1. Retrieval correctness: normalize embeddings + true cosine; chunk per-message/segment.
2. Ship **streaming** for Explore/Insights (flip the gated scaffolding) — fastest
   high-visibility UX win.
3. BYOK embeddings + provider-agnostic LLM routing (make local-first true).
4. Fix the dedup delete-and-reinsert footgun (stable message ids).
5. Capture hardening: incremental parse + selector-health self-check.

**Next — highest-leverage new value:**
1. **Direction 1 "Send to…"** (the most monetizable, sticky, low-risk new surface).
2. ANN/index + incremental graph edges (scale retrieval/Network).
3. Close history-import gap for 2–4 more platforms (+ telemetry).
4. **AITI Card MVP** (near-free local aggregation; viral/identity lever).
5. Resolve the prompt capability-vs-surface gap (expose category/tags/quality).

**Later:** AITI full (LLM portrait/share/evolution); Office/WPS depth + auto-export;
per-message exact-citation anchors (safe post dedup-fix); **Learn** + **Roundtable**
productization; modularize the giant files (library-tab 4986 / insightGen 2652 /
capsule-ui 2562); raise max_tokens; local/WASM embeddings; more locales.

---

## 6. Decisions (founder, R6)

- **Window priority = balanced track** (founder: "其他按照你的推荐来"): retrieval-
  quality fix → streaming → **Send to… MVP** → **AITI Card MVP**.
- **Proxy stays as-is this round** — **no BYOK/de-proxy** work now (revisit later).
  (So core item #3 "de-proxy" is deferred; embeddings/LLM keep the proxy/ModelScope
  route.)
- **AI 圆桌 = interpretation A** (multi-persona on our own model, history-grounded),
  but it stays in **Later** — not built this window.
- **Direction 1**: default exported unit = the conversation **and** its AI summary;
  lead with Notion + Obsidian generalization, then rich-clipboard/.docx. (Office/WPS
  via paste/.docx, not live sync.)

### Execution order for this window (risk-adjusted)
1. Retrieval **correctness** fix — normalize embeddings on write + true cosine
   (safe, foundational). [chunking = a larger follow-up; stage carefully]
2. **AITI Card MVP** — pure local aggregation over stored summaries (no LLM, fully
   testable, fast win).
3. **Send to… MVP** — generalize Notion/Obsidian to whole conversation/summary +
   rich-HTML clipboard.
4. **Streaming** for Explore/Insights — examine the gated scaffolding; un-gate if
   safe.
5. Retrieval **chunking** re-architecture — deepest; needs device data to validate.
