# Historical Conversation Import (#3) — Design

Status: implemented (framework + ChatGPT + Claude). Device verification pending
(requires a logged-in session on each platform; not testable in CI).

## Problem

Real-time capture only sees conversations the user opens **after** install.
Threads created before that are invisible. #3 asks for a one-click way to pull
those historical conversations into Vesti.

## Approach

Each platform exposes its own backend API that the page itself uses. A content
script running on the platform origin can call those endpoints with the user's
existing session (`fetch(..., { credentials: "include" })`), map each thread to
Vesti's canonical capture shape, and persist it through the **existing**
`CAPTURE_CONVERSATION` path. Dedup by `[platform+uuid]` makes re-runs idempotent
and merges with anything already captured live. The import is **read-only** and
never submits anything to the platform.

## Pieces (all on an isolated path)

- `lib/contents/history/types.ts` — `HistoryProvider` interface +
  `buildConversationDraft()` (maps platform metadata + messages →
  `ConversationDraft`).
- `lib/contents/history/chatgptHistory.ts` — ChatGPT provider.
  - token: `GET /api/auth/session` → `accessToken`
  - list: `GET /backend-api/conversations?offset&limit=28&order=updated`
  - detail: `GET /backend-api/conversation/{id}` (linearise the node `mapping`
    by user/assistant text nodes ordered by `create_time`).
- `lib/contents/history/claudeHistory.ts` — Claude provider.
  - org: `GET /api/organizations` → pick chat-capable org
  - list: `GET /api/organizations/{org}/chat_conversations?limit=30&offset`
  - detail: `…/chat_conversations/{uuid}?tree=True&rendering_mode=raw`
- `lib/contents/history/registry.ts` — host → provider. Supported today:
  ChatGPT, Claude. Others return `null` (UI shows "not yet supported").
- `lib/contents/history/importRunner.ts` — orchestrator: list → for each, fetch
  + `sendRequest(CAPTURE_CONVERSATION, forceFlag)`; throttled (400ms),
  AbortSignal-cancellable, streams `ImportProgress`.
- `contents/history-import.ts` — content script (chatgpt/claude hosts). Handles
  `IMPORT_HISTORY_PROBE` / `IMPORT_HISTORY_RUN` / `IMPORT_HISTORY_CANCEL`, runs
  the runner, broadcasts `IMPORT_HISTORY_PROGRESS` to extension pages.
- `background/index.ts` — relays UI ↔ active tab: `IMPORT_HISTORY_PROBE` /
  `IMPORT_HISTORY_START` / `IMPORT_HISTORY_CANCEL` (target `background`) →
  `sendMessageToTab` on the active supported tab.
- `protocol.ts` — typed request/response entries for the three messages.
- `sidepanel/components/DataManagementPanel.tsx` — "Import platform history"
  accordion: probes the active tab, Start/Cancel, progress bar + live counters,
  result summary. Fully i18n (`t.data.history.*`, en + zh).

## Flow

1. User opens the **History** accordion in the sidepanel's Data page while on a
   ChatGPT/Claude tab → UI sends `IMPORT_HISTORY_PROBE` → background forwards to
   the tab → content script reports `{supported, platform, available}`.
2. User clicks Import → confirm dialog → `IMPORT_HISTORY_START` → content script
   runs the import, streaming `IMPORT_HISTORY_PROGRESS`.
3. UI renders progress; on done/error/cancelled it refreshes the overview.

## Why this shape

- Reuses the dedup + persistence + vectorization pipeline unchanged (no new DB
  write path, no schema change).
- Cookies/session only exist in the page context, so the fetch must run in a
  content script — hence the background relay.
- No auto-submit; politeness throttle + hard page caps guard the platform APIs.

## Adding a platform

Implement a `HistoryProvider`, register it in `registry.ts`, and add the host to
`contents/history-import.ts` `matches`. The runner, background relay, and UI need
no changes.

## Limitations / follow-ups

- Only ChatGPT + Claude wired (the two with stable, well-known read APIs).
- Platform APIs are unofficial and may change; providers are defensive (errors
  are counted and skipped, not fatal).
- Detail mapping is text-only for now (no attachments/artifacts/AST); live
  capture still enriches a thread when the user reopens it.
