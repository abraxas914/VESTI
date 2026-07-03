# Prompt Management

Documentation for Vesti's Prompt Management feature (dashboard Prompts tab +
in-page prompt assist).

## Documents

- [`prompt_management_engineering_spec.md`](prompt_management_engineering_spec.md)
  — architecture, data model, phasing, and acceptance criteria.
- [`prompt_management_manual_acceptance.md`](prompt_management_manual_acceptance.md)
  — manual sampling / acceptance checklist for QA.
- [`realtime_assistant_spec.md`](realtime_assistant_spec.md)
  — the in-page assist spec (now merged into the owl/dock prompt manager).
- [`history_import_design.md`](history_import_design.md)
  — bulk import of historical conversations from platform APIs.
- [`round3_plan.md`](round3_plan.md)
  — round-3 batch plan + work-state status.

## Surfaces at a glance

| Surface | Entry point | Notes |
|---------|-------------|-------|
| Prompts tab | `packages/vesti-ui/src/tabs/prompts-tab.tsx` | Library CRUD, extract-from-chats, AI improve |
| Engine (offline) | `frontend/src/lib/promptlib/` | normalize / heuristics / extractor (no LLM) |
| Persistence | `frontend/src/lib/db/promptRepository.ts` + `prompts` store (schema v17) | export/import backup in the Prompts tab |
| LLM enrichment/completion | `frontend/src/lib/services/promptLlmService.ts` | graceful degradation; `COMPLETE_PROMPT` has `mode: optimize \| continue` |
| In-dock prompt manager | `frontend/src/contents/capsule-ui.ts` | owl/dock panel: 优化 / 续写 / 常用提示词 search→fill / smart 唤醒 (replaced the standalone `prompt-assist.ts`) |
| History import | `frontend/src/lib/contents/history/` + `frontend/src/contents/history-import.ts` | per-platform providers → CAPTURE_CONVERSATION pipeline |
| Transport | `LIST/SEARCH/CREATE/UPDATE/DELETE/TOGGLE/INCREMENT/EXTRACT/COMPLETE` prompt routes + `IMPORT_HISTORY_PROBE/START/CANCEL` | protocol + background dispatchers |

## Design principles

LLM is always optional (heuristics fall back), all data is local IndexedDB, the
in-page script writes to the composer only on explicit user action and never
auto-submits, and new code lives in isolated paths per `CLAUDE.md`.
