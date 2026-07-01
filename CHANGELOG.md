# Changelog

All notable changes to this project will be documented in this file.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/lang/zh-CN/).

版本控制流程说明见：[`documents/version_control_plan.md`](documents/version_control_plan.md)

---

## [Unreleased]

### Added
- Added multi-language support for the UI and AI-generated content (English / 中文 / 日本語 / 한국어), driven by a central locale registry; thread summaries, the weekly recap, and Explore answers all follow the selected language.
- Added message-sidecar metadata for structured citations and artifact presence.

### Changed
- Unified citation stripping with structured source retention across capture, reader, and export.
- Hardened Qwen and Yuanbao parser alignment against current live DOM structures.
- Added a reproducible Playwright auth, storage-state, and DOM sampling bootstrap workflow.

### Fixed
- Fixed ChatGPT thinking UI so it no longer splits a single assistant reply into multiple logical messages.
- Fixed reader rendering so citation and search noise no longer appears as abrupt tail text after the main reply body.
- Fixed Qwen and Yuanbao capture drift against current production DOM structures while keeping tables, math, and code paths intact.

### Docs
- Added DOM sampling bootstrap and platform handoff notes for thinking-boundary repair, citation governance, and five-platform parser sampling.

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
