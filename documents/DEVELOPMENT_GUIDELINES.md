# VESTI — Development Guidelines (开发守则)

Working agreement for evolving VESTI safely. Written after the round-3 feature
batch; reflects the architecture as it actually is, not as docs once described it.
Keep this file current — **docs are work-state** (CLAUDE.md §4).

---

## 1. Architecture at a glance

VESTI is a Chrome **MV3 / Plasmo** extension that captures AI-chat conversations
from 8 platforms and surfaces them in a sidepanel + options dashboard.

```
Platform tab (content scripts)                 Extension (background SW)            UI (sidepanel/options)
─────────────────────────────                  ───────────────────────             ──────────────────────
contents/<platform>.ts  ── parser+pipeline ──► background/index.ts                  React + useI18n
contents/capsule-ui.ts  (owl dock + prompts)     • handleOffscreenRequest  ◄──────  sendRequest(target:"offscreen")
contents/history-import.ts (backfill)            • handleBackgroundRequest ◄──────  sendRequest(target:"background")
lib/contents/* (composerIo, history/, ...)       • relays to active tab ──────────► chrome.tabs.sendMessage
                                                 Dexie/IndexedDB (MemoryHubDB)
```

### Message routing — the one fact that bites people
`frontend/src/background/index.ts` has **two** dispatchers:
- `handleOffscreenRequest` ← messages with `target: "offscreen"` (DB/prompts/capture).
- `handleBackgroundRequest` ← messages with `target: "background"` (active-tab status, force-archive, history import).

There is **no offscreen document**. `frontend/src/offscreen/index.ts` is **dead/duplicate** —
do NOT add routes there; they will silently never run (this caused the
"Unsupported message type: LIST_PROMPTS" bug). Add new message types to:
1. `lib/messaging/protocol.ts` — `RequestMessage` union + `ResponseDataMap`.
2. the correct dispatcher in `background/index.ts`.

### Capture pipeline
`contents/<platform>.ts` instantiates a platform `Parser` + `ConversationObserver`
+ `CapturePipeline`, which sends `CAPTURE_CONVERSATION` → `interceptAndPersistCapture`
→ `deduplicateAndSave`. Dedup is by `[platform+uuid]` (conversation) and per-message
signature. Any new path that creates conversations (e.g. history import) should reuse
`CAPTURE_CONVERSATION` rather than writing the DB directly — you get dedup, vectorization,
and the gardener for free.

### Storage
Dexie `MemoryHubDB` (schema in `lib/db/schema.ts`). **IndexedDB survives extension
version upgrades** — don't re-architect for "persistence"; for portability use the
export/import backup paths (`exportAllData`/`importAllData` + the prompt backup).
Bump the schema version + add a migration for any store/index change; never mutate an
existing version's stores.

---

## 2. i18n — three surfaces, don't mix them

| Surface | How to translate | Source of truth |
|---|---|---|
| Frontend React (`frontend/src/**`) | `const { t } = useI18n()` → `t.section.key` | `lib/i18n/translations/{en,zh}.ts` |
| `@vesti/ui` package components | a `labels` **prop** (no `useI18n`) | frontend passes `t.dashboard` → `DashboardLabels` |
| Content scripts (non-React) | `contentI18n.ts` helpers, or a local map (capsule has its own `capsuleEn/Zh`) | per-file |

Rules:
- `en.ts` is the type source: `TranslationsType = DeepStringify<typeof enTranslations>`.
  **Every key added to `en.ts` MUST be added to `zh.ts`** — `tsc` enforces this (zh is
  typed as `TranslationsType`). Run `pnpm exec tsc --noEmit` to check parity.
- vesti-ui tab `labels` are loose `Record<string,string>` with English fallbacks
  (`labels.x ?? "X"`). To localize a vesti-ui string, **add the key to
  `t.dashboard.<tab>` in `en.ts`+`zh.ts`** (the fallback only shows when a key is
  missing). Adding keys there is type-safe; you rarely need to touch `DashboardLabels`.
- Never ship a user-visible literal. Brand names ("Vesti") and proper nouns are exempt.
- Parameterize with `{placeholder}` + a small `replace`/`fmt` helper; don't concatenate.

---

## 3. Where new code goes (CLAUDE.md §2 — isolated paths)

- **New cross-cutting capability** → its own folder under `lib/` (see
  `lib/contents/history/` — providers + registry + runner, then a thin content-script
  entry in `contents/`). Keep the engine pure and the content-script glue thin.
- **New content script** → `contents/<name>.ts` (Plasmo auto-registers from its
  `export const config.matches`). Guard with `window.top === window.self` for top-frame.
- **New message** → protocol + the right background dispatcher (see §1).
- Don't grow `background/index.ts` god-handlers with business logic — delegate to a
  `lib/` service and keep the case thin.

---

## 4. Build, typecheck, verify

- `pnpm build` (in `frontend/`) = prebuild (esbuild for `vesti-content-package` +
  `vesti-ui`, then `pnpm -C .. install --frozen-lockfile`) → `plasmo build`. Output:
  `frontend/build/chrome-mv3-prod/`. ~4 min.
- **esbuild does NOT typecheck.** There is standing `tsc` debt (~30 errors, mostly
  vesti-ui `library-tab` label scoping) that does **not** block builds. Before
  committing, run `pnpm exec tsc --noEmit -p tsconfig.json` and confirm your files add
  **zero new** errors (compare the count + the per-file breakdown; don't just trust
  "exit 0").
- CJK strings are esbuild-escaped to `\uXXXX` in bundles — grep the escaped form to
  verify a Chinese string shipped.
- Background `pnpm build` wrappers append `; echo "BUILD_EXIT=$?"`; the harness "exit 0"
  is the echo's — grep the log for `BUILD_EXIT=0` and `Finished`.

---

## 5. Content-script discipline

- **Never auto-submit** to a platform. Fills go into the composer only on explicit user
  action (see `composerIo` + the capsule prompt manager + history import = read-only).
- One shadow root per UI; respect per-host enable/visibility (capsule settings).
- IME-safe: debounce on `input`, never score/act mid-composition
  (`compositionstart`/`end`).
- Platform history APIs are **unofficial** — providers must be defensive (count+skip
  errors, throttle requests, hard page caps) and fail soft.

---

## 6. Git / process

- Branch off `main`; never commit straight to it. Small, themed commits per item.
- Commit only when asked; end messages with the Co-Authored-By trailer.
- WSL2 quirk: clear `.git/index.lock` (`rm -f .git/index.lock`) if a commit fails.
- Design-first for anything non-trivial (CLAUDE.md §3): a short doc in `documents/`
  before large work; update it as work-state when done.

---

## 7. Known debt / follow-ups (good first cleanups)

- Remove dead `frontend/src/offscreen/index.ts` once confirmed it is not a Plasmo
  entry in the built manifest.
- Pay down the ~30 `tsc` errors (vesti-ui `library-tab` `labels`/`t` scoping; a few in
  dashboard/InsightsPage/MessageBubble/obsidianVaultService/repository).
- Localize remaining low-traffic literals: explore-tab agent-trace maps
  (`MODE_STAGES`/`TOOL_LABELS`/`TOOL_EXPLANATIONS`), new-note default title, AST
  "Column 1" fallback.
- History import: add the other 6 platforms via `lib/contents/history/registry.ts`.
- `documents/` is the canonical design/work-state store; keep one index (README) and
  prune superseded plans.
