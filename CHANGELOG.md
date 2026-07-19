# Changelog

All notable changes to this project will be documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/lang/zh-CN/).

版本控制流程说明见：[`documents/version_control_plan.md`](documents/version_control_plan.md)

---

## [Unreleased]

### Added
- **Connect to VESTI desktop** (Bridge Protocol v1.1): pair the extension with
  the Vesti desktop app over loopback HTTP (`127.0.0.1:28765`) using a one-time
  6-digit pair code; the Bearer token stays in `chrome.storage.local` and is
  never exposed to extension pages. The first sync uploads everything; a daily
  alarm then sends incremental updates against the server-returned cursor, with
  manual sync and disconnect in the new Settings → desktop connect card.
- **AI relay injection** (desktop → browser): relay packs pushed from the
  desktop arrive through the bridge outbox (polled every 2 minutes, toolbar
  badge counter, sidepanel outbox list) and can be injected into the composer
  of all 8 supported platforms — fill only, never auto-sends; items are acked
  back to the desktop only after a read-back check confirms the fill.
- Added multi-language support for the UI and AI-generated content (English / 中文 / 日本語 / 한국어), driven by a central locale registry; thread summaries, the weekly recap, and Explore answers all follow the selected language.
- **Real local search (CJK-aware, ranked)** — the #1 user need. Replaced the naive
  substring scan with a dependency-free engine: Lucene-style CJK character
  unigram+bigram tokenization (Chinese/Japanese queries actually match, incl. the
  single-character case — something Western tools structurally can't do),
  multi-term AND ("design database" finds "database … design"), type-ahead prefix,
  and a relevance score. The sidebar shows a "最相关结果 / Top matches" relevance list
  while searching. Fully offline; verified by unit tests.
- **Bulk organize in the sidebar** — the batch bar gains **Star** and **Add to
  folder** over a whole selection (alongside Export/Delete), backed by idempotent
  bulk repository ops. (Bulk archive + an Archived view are next; backend ready.)
- **"What leaves your device" disclosure** in Settings → Model Access: an honest
  note that capture/storage/keyword-search are 100% local while AI features send
  conversation text to the configured model (by default via the proxy). en/zh.
- **探索 hub — four reflective modes** under 探索/Explore (one switcher): 问答
  (ask), **AITI 画像** (a local, empowering strengths portrait from your own
  conversations), **学习 (Learn)** — your KB reframed as a personal curriculum
  (knowledge domains with a depth mix, a glossary of "things you've learned", and
  open loops, all computed locally), and **AI 圆桌 (Roundtable)** — a
  multi-perspective panel (Skeptic/Optimist/Pragmatist/Domain Expert/Devil's
  Advocate) on your configured model with a moderated, structured synthesis.
  Bilingual; 圆桌 needs a connected model.
- **Send to… (whole conversation or its summary)**: from the reader you can now
  export a conversation — or its AI summary — to **Notion** (a new page under your
  selected database, via a dependency-free Markdown→Notion-blocks renderer) or
  **Obsidian** (a `Vesti/<title>.md` file with frontmatter). Plus per-message
  **Copy as rich text** (faithful AST→HTML) that pastes formatted into
  Word/WPS/Notion/Obsidian. Bilingual; Notion needs OAuth, Obsidian a connected
  vault.
- **提示词超市 (Prompt Supermarket)**: a large bilingual curated catalog (by
  big-category) on the Prompts page; **加入/已加入** adopts prompts into a personal
  **我的广场** shelf (kept separate from the auto-extracted 常用提示词).
- **Toolbar icon opens the dashboard**: clicking the Vesti browser-toolbar icon
  now opens (or focuses) the full standalone web UI (`options.html`) in its own
  tab. The in-page owl still opens the sidepanel.
- **Hover tooltips** on the sidebar dock: each item shows a clear title +
  description card on hover/focus (reusable, dependency-free component).
- **提示词广场 (Prompt Plaza)**: the Prompts page now recommends curated,
  high-quality prompts from trusted public sources (with attribution + links),
  plus a date-seeded "每日推荐" strip that rotates daily. Bundled and offline;
  bilingual. Clicking a card prefills the editor.
- **Timeline range filter + sort mode**: the Threads timeline gains a draggable
  two-handle scrubber (with histogram) to filter conversations to a time window,
  and a toggle to order/group by the conversation's own time (按对话时间) vs
  capture time (按捕获时间).
- **Bulk-import historical conversations** (8 platforms: ChatGPT, Claude,
  Gemini, DeepSeek, Doubao, Qwen, Kimi, Yuanbao): a new "Import platform
  history" panel in the Data page reads your existing threads through each
  platform's own API (using your current login) and saves them locally via the
  normal capture pipeline (dedup keeps re-runs idempotent). Read-only,
  throttled, cancellable, with live progress; new platforms slot into the
  provider registry. Fully localized (en/zh).
- **One-click prompt backup**: export/import the prompt library as a JSON file
  from the Prompts tab, so prompts survive reinstalls (IndexedDB already survives
  version upgrades).
- **In-dock prompt manager**: the owl/dock now hosts a unified prompt feature —
  提示词优化 (optimize), 提示词续写 (continue, a new `mode` on `COMPLETE_PROMPT`),
  and 常用提示词 input (search by 唤醒词, click to fill, or Enter to one-click fill
  the top match).
- Auto-built prompt library: the dashboard Prompts tab now extracts reusable
  prompts from captured conversations automatically when opened (empty or stale),
  not just via the manual button.
- Added message-sidecar metadata for structured citations and artifact presence.
- Added a **Prompt Management** system: a new dashboard **Prompts** tab that
  intelligently archives high-value prompts extracted from captured
  conversations (LLM-assisted titling/summary/scoring with heuristic fallback),
  a personal favorites ("常用") library with full CRUD, and an in-page assist
  content script offering slash/quick-insert (`/v`) of saved prompts plus
  LLM-powered draft "补写" (smart completion) across all supported AI platforms.
- Added a new IndexedDB `prompts` store (schema v17) and offscreen routes for
  prompt CRUD, library extraction, search, usage tracking, and completion.
- Added a **real-time in-page prompt assistant**: as you type in any supported
  platform's composer, it scores the draft (offline heuristics), flags clarity
  issues, and suggests concrete improvements; a one-click "Optimize with AI"
  rewrites the draft (preview before insert). IME-safe (no scoring mid Chinese
  input), never auto-submits, and toggleable globally (Settings) or per-site.
  Localized in English and Chinese.

### Changed
- **常用提示词 curation refreshes instead of accumulating** (fixes "数量太多"):
  extraction now clears the prior auto-set before installing a new one, and
  auto-extract runs only on an empty library (re-running is the explicit Extract
  button). Tighter caps (≤8) + higher quality gates + an LLM consolidation pass
  that ranks/merges the best fragments across chunks. Editing a prompt promotes
  it to `manual` so it survives a refresh.
- **AITI is now an empowering, strengths-based portrait** (给人力量): both poles
  framed as strengths, a "你的思维优势" section, obsessions reframed as areas
  you've invested in.
- 常用提示词 are now LLM-distilled reusable **fragments** (短小、可复用的片段，含
  {{变量}}) when a model is configured, instead of whole captured turns; falls
  back to the offline frequency heuristic with no model.
- The in-dock 提示词助手 search now spans **both** your 常用提示词 and the curated
  优质提示词 (plaza), with curated results tagged 广场.
- Prompt curation is now selective: the library auto-collects only frequent +
  high-quality prompts (capped, with a quality floor) instead of everything; the
  tab is now labelled **常用提示词**. The dock prompt module is renamed
  **提示词助手** and its hint now reads "实时监听输入框：输入唤醒词即时匹配，回车
  一键填入。".
- Merged the standalone in-page prompt assistant into the owl/dock as one
  feature with a single open/close toggle; the lower dock holds a clean
  prompt-manager panel. The existing per-host "real-time assistant" setting now
  gates the in-dock panel.
- Prompt library is now lightweight: the editor's "Title" field is relabeled
  **唤醒词** (Trigger), the favorites control is gone, and extraction surfaces the
  most frequent reusable prompts.
- Extended i18n coverage (en/zh) across the sidepanel (data management dialogs,
  export dialog, reader copy buttons, dock/card aria) and filled missing
  explore/library tab label keys.
- Renamed the conversation library to **对话知识库** (zh) and fully internationalized
  the Prompts tab (~59 strings, en/zh) so it follows the app/browser language.
- The in-page real-time assistant now follows Vesti's design tokens (monochrome
  accent, semantic score colors) in both light and dark themes (was hardcoded).
- Integrated the team's multi-language (en/zh) i18n, network-page content, and
  Claude/Gemini parser + warm-start capture improvements from `origin/main`.
- Hardened the i18n type system: locale files now mirror the English key shape
  while allowing their own strings (`DeepStringify` of `TranslationsType`),
  fixing a large class of pre-existing translation type errors and completing
  the missing Chinese dashboard-settings strings.
- Unified citation stripping with structured source retention across capture, reader, and export.
- Hardened Qwen and Yuanbao parser alignment against current live DOM structures.
- Added a reproducible Playwright auth, storage-state, and DOM sampling bootstrap workflow.
- Reclassified parser observability heuristics (e.g. "captured only one role",
  "kept zero messages", perf-mode switches) from `console.warn` to a new
  `logger.debug` level so they no longer surface in the `chrome://extensions`
  Errors panel as if the extension were failing.

### Fixed
- **Retrieval correctness**: Explore RAG, related-conversations, and graph edges
  now use true cosine similarity (was a raw dot product), so similarity scores and
  the 0.15/0.4 cutoffs behave as intended across embeddings of differing norms.
- Fixed Doubao (`www.doubao.com`) "cannot capture": added the staggered initial
  capture triggers the content script was missing (parity with ChatGPT/Yuanbao)
  and scoped `DoubaoParser.isGenerating()` to message bubbles so persistent page
  chrome can't wedge capture. Added a one-time capture-path diagnostic.
- Fixed prompt-library extraction returning nothing: relaxed the over-aggressive
  score/length/frequency thresholds that were silently filtering out every
  candidate, so the library now populates from captured conversations.
- Fixed "Import to Notes" from a summary card landing on a blank page — it now
  opens the notes view with the imported note shown and the "New Note" button
  available.
- Fixed the real-time in-page assistant not working on Kimi and Claude: input
  events on nested nodes of rich editors (ProseMirror/Quill) are now resolved up
  to the contenteditable root, and the Optimize/Save actions use a cached
  composer reference so a focus shift to the panel no longer yields an empty draft.
- Fixed ChatGPT thinking UI so it no longer splits a single assistant reply into multiple logical messages.
- Fixed reader rendering so citation and search noise no longer appears as abrupt tail text after the main reply body.
- Fixed Qwen and Yuanbao capture drift against current production DOM structures while keeping tables, math, and code paths intact.
- Fixed Yuanbao "cannot capture": added the initial capture trigger the content
  script was missing (parity with ChatGPT) so already-rendered conversations
  are picked up on load, and scoped the `isGenerating()` streaming selectors to
  AI bubbles so persistent page chrome can no longer wedge capture permanently.
  Added a one-time capture-path diagnostic and a `no_messages` skip log to make
  future "cannot capture" reports self-diagnosing.

### Removed
- Removed the standalone in-page prompt-assist floating window (its capabilities
  now live in the dock prompt manager) and the dock's 消息/轮次 metric cards.
- Removed the dead/duplicate `src/offscreen/index.ts` request handler (no
  offscreen document exists; the live dispatchers are `handleOffscreenRequest` /
  `handleBackgroundRequest` in `background/index.ts`). It was a known footgun —
  routes added there silently never ran.

### Docs
- Added `documents/DEVELOPMENT_GUIDELINES.md` (architecture map, message-routing
  rules, the three i18n surfaces, build/verify checklist, known debt).
- Added the historical-import design under `documents/prompt_management/`.
- Added DOM sampling bootstrap and platform handoff notes for thinking-boundary repair, citation governance, and five-platform parser sampling.
- Added the Prompt Management engineering spec, README, and manual acceptance
  checklist under `documents/prompt_management/`.

### Chore
- Added Playwright local auth and DOM sampling tooling for repeatable capture verification.

---

## [1.2.0-rc.8] - 2026-03-08

### Changed
- Updated the internal `GET_ALL_EDGES` contract so Network can request edge computation for its current node set instead of relying on previously opened Library conversations.

### Fixed
- Restored Network graph edges by lazily ensuring vectors for the active node set when opening the Network view, removing the hidden dependency on Library detail opens.

### Chore
- Bumped extension release metadata to `1.2.0-rc.8` for tagging and distribution alignment.

---

## [1.2.0-rc.7] - 2026-03-07

### Added
- Added a shared platform normalization helper for runtime-facing `Yuanbao` identity handling with legacy `YUANBAO` compatibility.
- Added a web dashboard `Appearance` section in the avatar settings drawer with an explicit dark-mode toggle.

### Changed
- Canonicalized platform naming from `YUANBAO` to `Yuanbao` across runtime types, storage reads/writes, sidepanel filters, and `@vesti/ui` platform metadata.
- Migrated stored conversation platform values to `Yuanbao` and kept short-term legacy normalization for persisted inputs.
- Restored web dashboard badges to the solid-fill platform style while keeping dock / Threads visuals on their existing token system.
- Synced web dashboard theme state with dock appearance via shared `vesti_ui_settings.themeMode` updates.

### Fixed
- Realigned Kimi capture to the current DOM structure, excluded `chat-header` pollution, and restored cold-start transient availability.
- Realigned Yuanbao capture to the current `hyc-*` DOM and merged CoT + final response into a single archived AI turn without doc-title noise.
- Hardened ChatGPT capture with selector+anchor extraction, startup warm capture, and content cleaning for noisy toolbars and controls.
- Fixed reader AST rendering so structured math, tables, lists, and code blocks preserve their intended layout instead of collapsing into plain paragraphs.
- Hardened Qwen capture for Monaco code blocks and custom markdown paragraph spacing so code and flowing prose render cleanly in Threads Reader.
- Declared a local `@vesti/ui` dashboard type shim to unblock rc7 typecheck/build on the current mainline.
- Fixed Kimi web badge contrast so light mode uses dark text and dark mode uses white text.
- Fixed web dashboard theme refresh so dock-initiated appearance changes propagate without reopening the page.

### Docs
- Updated Kimi / Yuanbao Phase 3 capture docs and execution notes.
- Updated the UI refactor spec to document web-vs-dock badge decoupling and dashboard theme sync.
- Added the rc7 engineering handoff for the Yuanbao web dashboard and capture-engine follow-up context.

### Chore
- Prepared release metadata and mirror packaging for `v1.2.0-rc.7`.

---

## [1.2.0-rc.6] - 2026-03-07

### Added
- Added Kimi and Yuanbao capture entrypoints (`frontend/src/contents/kimi.ts`, `frontend/src/contents/yuanbao.ts`) with transient status + force-archive handlers.
- Added Kimi and Yuanbao parser modules with selector+anchor extraction, strict session-ID gating, parse stats logging, and v1.2 governance compatibility.

### Changed
- Expanded capture host routing for Kimi to include `www.kimi.com` + `kimi.com` (with transitional `kimi.moonshot.cn` compatibility) and Yuanbao `yuanbao.tencent.com` for `GET_ACTIVE_CAPTURE_STATUS` and `FORCE_ARCHIVE_TRANSIENT`.
- Expanded platform enum/theme mapping to 8 platforms (ChatGPT/Claude/Gemini/DeepSeek/Qwen/Doubao/Kimi/Yuanbao).
- Added sidepanel + capsule light/dark token mapping for Kimi/Yuanbao while preserving existing Threads layout structure.
- Updated extension manifest host permissions and web-accessible matches for Kimi/Yuanbao domains.

### Fixed
- _None yet_

### Docs
- Updated `documents/capture_engine/v1_3_platform_expansion_spec.md` for Phase 3 (Kimi + Yuanbao).
- Added `documents/capture_engine/v1_3_phase3_manual_sampling_checklist.md`.
- Added `documents/capture_engine/v1_3_phase3_execution_log.md`.
- Updated `documents/ui_refactor/v1_4_ui_refactor_component_system_spec.md` with 8-platform token contract and Yuanbao naming rule.

### Chore
- _None yet_

---
## [1.2.0-rc.3] - 2026-02-27

### Added
- _None yet_

### Changed
- Updated `@vesti/ui` build chain to use a stable invocation path without `pnpm exec esbuild` dependency coupling.
- Added explicit `esbuild` dependency in `frontend` to guarantee CI binary availability during packaging.
- Refreshed frontend dependency sync after `prebuild` so `file:` package snapshots stay aligned in CI packaging runs.

### Fixed
- Stabilized CI release packaging path to avoid intermittent `esbuild not found` and `@vesti/ui` resolve failures.

### Docs
- _None yet_

### Chore
- _None yet_

---

## [1.2.0-rc.2] - 2026-02-25

### Added
- Added v1.5-lite floating capsule shell baseline with Shadow DOM isolation, collapsed/expanded views, runtime status polling, and in-capsule action wiring (`Archive now`, `Open Dock`).
- Added host-scoped capsule settings service persisted to `chrome.storage.local` under `vesti_capsule_settings`.

### Changed
- Expanded capsule primary rollout hosts from partial whitelist to all currently supported chat platforms (ChatGPT, Claude, Gemini, DeepSeek, Qwen, Doubao).
- Kept draggable hotfix behavior as default: collapsed capsule is directly draggable with 5px anti-misfire threshold and post-drag click suppression.
- Polished expanded capsule card UI to match the approved prototype skin (spacing, hierarchy, status rows, metric cards, and action buttons) while preserving v1.5-lite state semantics.
- Synced expanded capsule light/dark rendering to `vesti_ui_settings.themeMode` with runtime storage-change updates and listener cleanup on destroy.
- Aligned platform badge color tokens to sidepanel light/dark triplets (`bg/text/border`) for ChatGPT, Claude, Gemini, DeepSeek, Qwen, and Doubao.
- Aligned expanded-card typography with sidepanel stacks (`--font-ui`, `--font-vesti-serif` equivalent), including serif + tabular numerics for `Messages/Turns` large metrics.
- Rolled back collapsed capsule theming to fixed light appearance (independent from theme mode) while keeping expanded-card theme switching enabled.

### Fixed
- Fixed capsule drag regression that blocked viewport repositioning on primary hosts.
- Disabled native image drag on capsule logo to avoid dragging into composer inputs as text/image payload.

### Docs
- Added engineering handoff `documents/engineering_handoffs/2026-02-25-v1_5_lite_capsule_rollout_and_ui_closeout.md` covering implementation log, release plan, and architecture details.

### Chore
- _None yet_

---

## [1.2.0-rc.1] - 2026-02-25

### Added
- Gemini/DeepSeek Phase1 capture entrypoints (`frontend/src/contents/gemini.ts`, `frontend/src/contents/deepseek.ts`) with transient status + force-archive handlers.
- Formal Gemini/DeepSeek parser modules with selector+anchor strategies, noise cleaning, role inference, parse stats logging, strict session ID extraction, and `source_created_at` best-effort extraction.
- Doubao/Qwen Phase2 capture entrypoints (`frontend/src/contents/doubao.ts`, `frontend/src/contents/qwen.ts`) with transient status + force-archive handlers.
- Formal Doubao/Qwen parser modules with selector+anchor strategies, role inference fallbacks, strict session ID extraction, and parse stats logging.
- v1.6 dual-track AST foundation: strict `ast_v1` node contract, shared DOM-to-AST extractor (P0 full coverage, P1 math/table probes for ChatGPT/Claude/Gemini), parser perf fallback controller, and Reader-side AST renderer component with KaTeX support.

### Changed
- Extension host permissions now include `https://gemini.google.com/*` and `https://chat.deepseek.com/*`.
- Extension host permissions now also include `https://www.doubao.com/*` and `https://chat.qwen.ai/*`.
- Background capture host resolver now recognizes Gemini/DeepSeek for `GET_ACTIVE_CAPTURE_STATUS` and `FORCE_ARCHIVE_TRANSIENT`.
- Background capture host resolver now recognizes Doubao/Qwen for `GET_ACTIVE_CAPTURE_STATUS` and `FORCE_ARCHIVE_TRANSIENT`.
- Capture observability tightened: gate and pipeline logs now include platform/session + decision metadata.
- Settings capture-status guidance now references all supported capture platforms (ChatGPT/Claude/Gemini/DeepSeek/Doubao/Qwen).
- Added internal `turn_count` semantics (AI replies) to conversation capture/persistence and upgraded Smart `minTurns` evaluation to the same AI-turn metric.
- Timeline/Insights counters now display `X messages · Y turns`; Reader header now labels count as messages.
- Platform badge color tokens are now unified to six Metro theme colors (ChatGPT/Claude/Gemini/DeepSeek/Qwen/Doubao).
- Release-line governance is split into serial tracks: `v1.6` data pipeline, `v1.7` multi-agent/prompt backend, `v1.8` Reader+Insights UI.
- Insights page now keeps v1.8.1 grouped IA (`On-demand`, `Scheduled`, `Discovery`) and upgrades Weekly Digest to a dynamic state machine (`idle/generating/ready/sparse_week/error`) with phase-track generation feedback, previous-natural-week Mon-Sun range unification, and local idle-list collapse (`N more`/`Collapse`).
- Thread Summary pipeline is now aligned to the latest skill contract while keeping `conversation_summary.v2` naming: parser and adapter support both legacy v2 shape and upgraded v2 shape (`thinking_journey[]`, `real_world_anchor`, glossary-style `key_insights[]`), and Insights Thread Summary UI now renders the full structured journey view with generation shell + no-flash regeneration behavior.
- Capture persistence upgraded to schema v5-compatible writes (`content_ast`, `content_ast_version`, `degraded_nodes_count`) with legacy-safe read defaults; Reader now uses hybrid AST-first rendering with plain-text fallback; JSON export now carries AST fields as optional extensions.
- Floating capsule now supports in-page drag interaction with a 5px anti-misfire threshold and a 90%-scaled diameter (`43.2px`).

### Fixed
- Gemini title extraction now prefers `[role='heading']`, removes `You said` prefix for title-only parsing, and falls back safely when generic headings are detected.
- Corrected turns/message mismatch in sidepanel views and active capture status snapshots.
- DeepSeek parser now supports `.ds-message`-based DOM (no `<main>` requirement), hybrid class role inference, and explicit `/a/chat/s/<id>` session path extraction.
- Insights accordion header descriptions (`Thread Summary`, `Weekly Digest`) now keep compact one-line truncation when closed, expand to two-line readable copy when open, and expose full text via tooltip.

### Docs
- Updated `documents/capture_engine/v1_3_platform_expansion_spec.md` with strict-ID alignment for Phase1 execution.
- Added `documents/capture_engine/v1_3_phase1_execution_log.md`.
- Updated `documents/capture_engine/v1_3_platform_expansion_spec.md` with Phase2 execution profile and strict host scope.
- Added `documents/capture_engine/v1_3_phase2_execution_log.md`.
- Added `documents/capture_engine/v1_3_phase2_manual_sampling_checklist.md`.
- Added `documents/reader_pipeline/v1_6_data_pipeline_dual_track_spec.md`.
- Added `documents/reader_pipeline/v1_6_ast_probe_cheat_sheet.md`.
- Added `documents/reader_pipeline/v1_6_schema_v5_migration_spec.md`.
- Added `documents/reader_pipeline/v1_6_performance_fallback_spec.md`.
- Added `documents/reader_pipeline/v1_6_manual_sampling_and_acceptance.md`.
- Added `documents/orchestration/v1_7_multi_agent_orchestration_spec.md`.
- Added `documents/orchestration/v1_7_runtime_event_contract.md`.
- Added `documents/orchestration/v1_7_feature_flag_rollout_spec.md`.
- Added `documents/orchestration/v1_7_manual_sampling_and_acceptance.md`.
- Added `documents/prompt_engineering/v1_7_prompt_as_code_contract.md`.
- Added `documents/prompt_engineering/v1_7_prompt_schema_drift_gate.md`.
- Added canonical v1.7 prompt files: `documents/prompt_engineering/thread-summary-skill.md` and `documents/prompt_engineering/weekly-digest-skill.md`.
- Added temporary alias note: `documents/prompt_engineering/synthesis_skill.md`.
- Updated `documents/prompt_engineering/compaction-skill.md` to Agent A v2 contract (volume rigidity, empirical anchoring veto, subject isolation, sparse degradation rules).
- Added `documents/prompt_engineering/compaction-skill-rubric.md` (scoring matrix + veto rules split from runtime prompt).
- Updated `documents/prompt_engineering/v1_7_prompt_as_code_contract.md` with Agent A prompt/rubric layering rules.
- Updated `documents/prompt_engineering/v1_7_prompt_schema_drift_gate.md` with Agent A specialized drift checks.
- Aligned v1.7 planning docs to the new schema matrix: defaults `conversation_summary.v3` and `weekly_lite.v2`, with one-cycle legacy coexistence for `v2/v1`.
- Added `documents/ui_refactor/v1_8_1_insights_ui_refactor_spec.md`.
- Added `documents/ui_refactor/v1_8_1_insights_state_machine_contract.md`.
- Added `documents/ui_refactor/v1_8_1_insights_manual_sampling_and_acceptance.md`.
- Updated `documents/ui_refactor/README.md` with v1.8.1 Insights package inventory.
- Updated `documents/prompt_engineering/insights_prompt_ui_engineering.md` with v1.8.1 Weekly dynamic state machine, previous-natural-week range contract, and forward-compatible section rendering rules.
- Added `documents/ui_refactor/v1_8_2_thread_summary_ui_refactor_spec.md`.
- Added `documents/ui_refactor/v1_8_2_thread_summary_state_machine_contract.md`.
- Added `documents/ui_refactor/v1_8_2_thread_summary_manual_sampling_and_acceptance.md`.

### Chore
- Added CI workflow `/.github/workflows/prompt-schema-drift-pr.yml` for strict mock prompt-schema drift gating on PR changes.
- Added CI workflow `/.github/workflows/prompt-live-smoke-nightly.yml` for scheduled live smoke evaluation with optional secrets.

---

## [1.1.0-rc.4] - 2026-02-15

### Added
- Timeline conversation cards now support inline title rename with persistence (`Pencil`, `Enter/Blur` save, `Esc` cancel).
- Added dedicated `Data` tab in Dock with full Data Management panel.
- Added local telemetry action type `rename_title` for card action tracking.
- Added `unlimitedStorage` permission and storage limit helpers (`900MB` warning, `1GB` write block).
- Added export serializer layer for `json/txt/md` with unified payload (`content`, `mime`, `filename`).
- Added bundled serif assets: `frontend/public/fonts/TiemposHeadline-Medium.woff2`, `frontend/public/fonts/TiemposText-Regular.woff2`.

### Changed
- Settings page now keeps model access controls and links to Data Management instead of duplicating full data actions.
- Sidepanel typography contract tightened (`vesti-page-title`, `vesti-brand-wordmark`) with preload/fallback behavior.
- Export pipeline uses structured `EXPORT_DATA` format responses across runtime handlers.
- Release artifacts refreshed from commit `a9e1572`.

### Fixed
- Settings toggle thumb vertical alignment is center-locked (`44x24` track, `20x20` thumb, no Y-axis jitter).
- Duration utility ambiguity resolved to explicit transition duration syntax in key UI controls.

### Docs
- Added `documents/engineering_data_management_v1_2.md`.
- Updated `documents/prompt_engineering/insights_prompt_ui_engineering.md` to `v1.2-ui-pre.6`.
- Added UI guardrail section in `archive/frontend_prototypes/frontend-prompting-system.md`.

### Release Artifact
- `release/Vesti_MVP_v1.1.0-rc.4.zip`
- `SHA256: B86BF1B8BC4064504D1CA850A4A80CCD8FEFAFD93E723635FD86E2D2D99F7AF6`
- Built at: `2026-02-15 21:38:32 +08:00`

---

## [1.0.0] - 2026-02-11

### Added
- MVP 基线发布（Local-First）
- ChatGPT / Claude 会话捕获、IndexedDB 存储、Sidepanel Timeline/Reader
- ModelScope 摘要与周报基础能力（MVP 范围）

### Notes
- `v1.0.0` 作为后续版本治理起点；从该版本之后，统一采用分支 + annotated tag 发布。

---

[Unreleased]: https://github.com/abraxas914/VESTI/compare/v1.2.0-rc.7...HEAD
[1.2.0-rc.7]: https://github.com/abraxas914/VESTI/releases/tag/v1.2.0-rc.7
[1.2.0-rc.6]: https://github.com/abraxas914/VESTI/releases/tag/v1.2.0-rc.6
[1.2.0-rc.3]: https://github.com/abraxas914/VESTI/releases/tag/v1.2.0-rc.3
[1.2.0-rc.2]: https://github.com/abraxas914/VESTI/releases/tag/v1.2.0-rc.2
[1.2.0-rc.1]: https://github.com/abraxas914/VESTI/releases/tag/v1.2.0-rc.1
[1.1.0-rc.4]: https://github.com/abraxas914/VESTI/releases/tag/v1.1.0-rc.4
[1.0.0]: https://github.com/abraxas914/VESTI/releases/tag/v1.0.0
