# Round-3 Plan (8 items) — feat/prompt-management

Investigated via 4 parallel recon agents + 2 clarifications. Execution order favors
fast, high-confidence fixes first (unblock device testing), then the large features.

## Decisions (from user)
- **#2 persistence** = ensure upgrade-persistence (IndexedDB already survives version
  upgrades) **+ add one-click export/import backup file** (recoverable after reinstall).
  No cloud/sync.
- **#3 one-click history** = **bulk-import of HISTORICAL conversations** from each AI
  platform (pre-install conversations that real-time capture never saw).

## Phases

### Phase A — fast fixes (do first)
- **#6 extraction returns nothing**: relax `promptExtractor` thresholds
  (minScore 0.3→0.15, minLength 24→16) and raise `MIN_RESULTS` top-up so the library
  populates with the best/most-recurring user prompts. (root cause: over-aggressive
  score/length/frequency filtering → silent 0.)
- **#1 Doubao capture**: mirror the Yuanbao fix in `contents/doubao.ts` (staggered
  initial captures + one-time diagnostic) and scope `DoubaoParser.isGenerating()` to
  message containers. Selector/session validation needs the user's console diagnostic.
- **#4 prompt library**: rename the editor "Title" field → **唤醒词** (Trigger);
  confirm no favorites/收藏 control remains.

### Phase B — i18n sweep
- **#7**: wire the ~45 hardcoded strings (library-tab dialogs/aria/error fallbacks,
  explore-tab, a few sidepanel components) to existing keys, add new keys where needed.

### Phase C — persistence
- **#2**: export/import backup — extend the existing exportAllData/importAllData
  (already includes conversations/messages/notes/etc.) to also include `prompts`;
  surface a clear "Backup / Restore" in Data settings. Verify upgrade persistence.

### Phase D — dock redesign (large)
- **#5**: merge `prompt-assist` into the capsule (owl) as one toggleable
  "prompt manager" panel in the lower dock providing: optimize, 续写 (continuation),
  常用提示词 input (list + select-to-fill + 唤醒词→full text→Enter fill), smarter 唤醒.
  Remove the standalone prompt-assist root + the 消息/轮次 metric cards
  (capsule-ui.ts lines 1346–1372). One open/close toggle on the owl. Reuse composerIo +
  promptlib; single shadow root; keep IME-safe / never-auto-submit.

### Phase E — historical import (large)
- **#3**: a "import history" action that walks a platform's conversation list, opens
  each, and runs the existing parser→capture pipeline (backfill). Per-platform DOM work;
  start with a framework + 1–2 platforms, expand. Needs care (no auto-submit, rate-limit,
  progress UI). May need a follow-up on platform priority.

Each phase: typecheck + build + device-test checkpoint.

---

## STATUS (work-state)

All 8 items implemented; each commit typechecks (30 pre-existing team tsc errors,
none new) and builds clean (`pnpm build`, exit 0).

- **#1 Doubao** — staggered initial captures + diagnostic; isGenerating scoped. ✅ (Phase A commit) — device re-test pending.
- **#2 persistence/backup** — prompts export/import backup in the prompt tab; IndexedDB survives upgrades. ✅
- **#3 historical import** — provider framework + ChatGPT + Claude + dock-relay + sidepanel UI. ✅ (commit `8c4f102`) — implemented; **needs device verification** (live login per platform; not CI-testable). Design: `history_import_design.md`.
- **#4 prompt library** — favorites removed, Title→唤醒词. ✅
- **#5 dock merge** — prompt manager merged into the owl/dock (optimize/续写/常用提示词 + smart 唤醒); 消息/轮次 metrics removed; standalone prompt-assist deleted; COMPLETE_PROMPT gained `mode`. ✅ (commit `aaa9d08`)
- **#6 extraction** — relaxed thresholds. ✅ (Phase A)
- **#7 i18n** — localized the frontend-direct surfaces (Dock nav, ConversationCard aria, DataManagementPanel dialogs/messages, ExportDialog, AstMessageRenderer copy) + filled all genuinely-missing `labels.*` keys in explore/library tabs + explore/library "You". en+zh parity enforced by `TranslationsType`. ✅
  - **Remaining low-priority literals (follow-up):** explore-tab agent-trace `MODE_STAGES`/`TOOL_LABELS`/`TOOL_EXPLANATIONS` (debug-ish), `library-tab` new-note default title "New Note" (seeded data), AST table "Column 1" fallback. These are low-traffic; localizing the trace maps needs new label keys + read sites in vesti-ui.

## Pre-existing tsc debt (not from this round)
19 in vesti-ui `library-tab.tsx` + ~11 across dashboard/InsightsPage/MessageBubble/
obsidianVaultService/repository — `labels`/DEFAULT_LABELS scoping gaps. esbuild does
not typecheck so these don't block builds. Candidate cleanup for #9.
