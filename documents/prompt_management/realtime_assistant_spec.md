# Real-Time In-Page Prompt Assistant — Design Spec

Status: Synthesized by design workflow (judge panel: minimal / rich / robust lenses).
Branch: feat/prompt-management. Implements the real-time scoring/clarity/suggestion/fill feature.

> Auto-generated from the design workflow synthesis, then implemented. See
> prompt_management_engineering_spec.md for the broader prompt suite.

# Real-Time In-Page Prompt Assistant — Implementation Spec

## 0. Summary & guiding principles
A toggleable, real-time prompt coach for the 8 supported chat platforms. As the user types in the composer, an offline heuristic pipeline (debounced, IME-safe) computes a 0–100 score, a list of concrete clarity issues, and cheap actionable suggestions, surfaced through a tiny **score chip** anchored in the existing Vesti launcher cluster. Rich detail (issues, suggestions, AI rewrite) is revealed **only on hover/click** — never unsolicited beyond the chip itself. One-click "Optimize with AI" reuses the existing `COMPLETE_PROMPT` RPC, always preview-then-apply, **never auto-submit**.

Invariants (hard):
- **Offline-first hot path**: every keystroke → only pure `promptlib` functions. Zero network, zero storage, zero LLM on the hot path.
- **Fail-closed & non-destructive**: if the composer can't be resolved, text is empty/whitespace, or state is indeterminate, the chip hides and no work runs. There is exactly **one write path** (`setComposerText`) invoked only from an explicit preview-confirm click. No code path ever dispatches Enter / clicks Send / submits a form.
- **IME-safe**: scoring is suspended during composition (`compositionstart`→`compositionend`) and re-fired once on `compositionend`.
- **Isolated per CLAUDE.md rule 2**: new pure/service/i18n modules in isolated files; the in-page widget is grafted into the existing `prompt-assist.ts` (which already owns composer I/O + an input listener) behind a feature flag, sharing one composer-resolution source of truth rather than spawning a second racing content script.
- **i18n en/zh** via a new content-script-safe (non-React) accessor.

---

## 1. UX design

### 1.1 Idle
Feature enabled but composer empty (`charCount < 12`, mirroring `scorePrompt`'s floor): user sees nothing new. The existing "✨ Prompt" launcher (bottom-left) is unchanged. The score chip is hidden.

### 1.2 Typing (the only unsolicited UI — deliberately minimal)
Once the draft crosses ~12 chars, a small **chip** fades in next to the launcher (same fixed bottom-left cluster, never overlapping composer or Send, never shifting page layout). The chip = an 8px status dot + a 0–100 number (e.g. green dot + `78`). Dot color = 3-band signal from `scorePrompt`: red `<0.34`, amber `0.34–0.66`, green `>0.66`. If clarity issues exist and `showClarityBadge` is on, a tiny superscript count appears (`78 ·2`). The chip updates **in place via `textContent` only**, rAF-batched, on a debounce (default 350 ms). No popover opens automatically.

### 1.3 Reveal on demand (hover or click — never automatic)
Hover (or click-to-pin for keyboard users) opens a compact popover (≤ ~320 px) showing:
- **Score + one-line label**: "Good prompt" / "Could be clearer" / "Very vague" derived from the band, plus an optional expandable **score breakdown** (which factors earned points).
- **Up to 3 top clarity issues** as short lines with a severity dot (high/med/low), each an i18n key (see §6).
- **Up to 3 actionable suggestion chips** (offline, cheap): e.g. "Add output format", "Specify a role", "Give an example". Clicking a suggestion chip is **explanatory only** — it does not auto-edit the composer (it can scroll/highlight the matching issue). (Future, opt-in: a scaffold-insert that appends a template snippet via the same preview gate — deferred.)
- **Primary action**: "Optimize with AI" when an LLM is configured; otherwise the button reads "Use suggestion" and runs the heuristic/degraded path (matching the existing `completePromptDraft` `usedLlm=false` contract).
- **Footer**: "Turn off here" (per-host) + a link/hint to global settings.

Popover dismisses on mouse-leave (~250 ms grace) or outside click; pinned popovers stay until outside-click/Esc.

### 1.4 Optimize → preview → fill
"Optimize with AI" → button shows spinner/disabled → `COMPLETE_PROMPT` (existing offscreen RPC, `useLibrary:true`, 120 s timeout) → result rendered in a scrollable **read-only preview** with `Cancel` / `Replace draft`. Only on `Replace draft` do we call `setComposerText`. On RPC failure/timeout: inline error in the preview, draft untouched. **Never submit.**

### 1.5 Disable
"Turn off here" writes per-host `realtimeEnabled=false` and live-tears-down the chip (storage write + onChanged re-read). When disabled globally or per-host, or when the existing capsule per-host gate hides Vesti on the host, the chip and all real-time listeners are torn down — the page looks exactly as before the feature existed.

---

## 2. Architecture & module split

### 2.1 New pure engine — `frontend/src/lib/promptlib/promptClarity.ts`
DOM-free, worker-safe, reuses `computeTextMetrics` + `scorePrompt` + `detectVariables` + `hasInstructionVerb` from existing `promptNormalize`/`promptHeuristics`. **One `computeTextMetrics()` call** is threaded through all three exports — no extra regex passes.

- `getScoreBreakdown(body): ScoreFactor[]` — `{ id, weight, earned, present }` mirroring `scorePrompt`'s exact additive bands (length band, instruction verb +0.2, role +0.12, constraints +0.12, structure +0.12, variables +0.12, code fence +0.05, short-pure-question −0.15). Makes the single 0..1 number explainable. Must stay in lockstep with `scorePrompt` — co-locate a comment cross-referencing the source weights, and a unit test asserting `sum(earned)` clamps to `scorePrompt(body)`.
- `detectClarityIssues(body, metrics?): ClarityIssue[]` — `{ id, severity }` where `id` is an i18n key (see §5 catalog). Derived from the same metrics.
- `generateSuggestions(issues, metrics?): Suggestion[]` — `{ id, priority }` mapping each issue to a remediation key, deduped, capped at 3, sorted by severity then priority.

Shared types (`ClarityIssue`, `ScoreFactor`, `Suggestion`, `ClaritySeverity`) exported from this file; barrel re-export added to `promptlib/index.ts`.

### 2.2 New settings service — `frontend/src/lib/services/promptAssistSettingsService.ts`
Exact structural clone of `capsuleSettingsService.ts` (normalize / merge / readStore / writeStore / `getPromptAssistSettingsForHost` / `updatePromptAssistSettingsForHost` / `subscribePromptAssistSettings`). Storage key `vesti_prompt_assist_settings`. Schema (`PromptAssistSettings`):
- `realtimeEnabled: boolean` (default `true`) — per-scope master on/off.
- `debounceMs: number` (default `350`, clamped 200–800 via a `normalizeDebounceMs` mirroring `normalizeAutoCollapseMs`).
- `showClarityBadge: boolean` (default `true`) — chip issue-count superscript.
- `optimizeWithLlm: boolean` (default `true`) — allow the on-demand AI rewrite button (lets a host disable network usage entirely while keeping offline scoring).

Resolution: per-host merged over global (per-host wins), giving both a global master toggle (settings page) and per-host override ("Turn off here"). Storage-unavailable → returns defaults. `subscribePromptAssistSettings` wraps `chrome.storage.onChanged` like `subscribeLanguageSettings`.

### 2.3 New content-script-safe i18n — `frontend/src/lib/i18n/contentI18n.ts`
Content scripts can't call `useI18n()` (React-only). This module imports the **same** `enTranslations`/`zhTranslations`, reads `getLanguageSettings()` + `subscribeLanguageSettings()` (both already storage-based and content-script usable), and exports:
- `getContentTranslations(): Promise<Translations>` — resolves current locale's tree; falls back to `enTranslations` on any error (labels never blank).
- `onLocaleChange(cb: (t: Translations) => void): () => void` — live updates on locale switch.

This fills the recon gap and can be adopted by the existing `prompt-assist.ts` later for its currently-hardcoded English strings.

### 2.4 Shared composer I/O — `frontend/src/lib/contents/composerIo.ts`
Extract `PLATFORM_BY_HOST`, `COMPOSER_SELECTORS`, `GENERIC_COMPOSER_SELECTORS`, `normalizeHost`, `isVisible`, `resolveComposer`, `getComposerText`, `setComposerText`, and the `ComposerEl` type **verbatim** out of `prompt-assist.ts` into one shared module. Both the slash-insert flow and the new real-time flow import from here → a single fix covers all platforms when a selector drifts. `prompt-assist.ts` imports them back (no behavior change). Add `logger.debug("content", "composer unresolved", {host})` on resolution failure for observability.

### 2.5 Widget integration — extend `frontend/src/contents/prompt-assist.ts`
The real-time widget is added **into the existing content script**, not a second one. Rationale (grounded in the read): `prompt-assist.ts` already mounts the bottom-left Shadow root, already has a document-level capture-phase `input` listener for `/v`, and already owns composer I/O. A second content script on the same `matches` would double-bind input listeners and both re-resolve/fight the same composer; the existing `debounce()` util also has **no `cancel()`**, which the IME guard needs — so we manage timers directly inside the one script. New additions inside the existing `mount()` (all gated on `promptAssistSettings.realtimeEnabled` AND the existing capsule gate):
- A `ScoreChip` sub-component (dot + number + optional badge) appended to the Shadow root near the launcher.
- A `ClarityPopover` sub-component (label + breakdown + issues + suggestion chips + Optimize button + preview block + per-host off toggle).
- The IME-safe debounced scoring pipeline (§3) reading via the shared `getComposerText`.
- The on-demand LLM optimize via existing `completeDraft()` already present in the file.
- A `subscribePromptAssistSettings` + `subscribeLanguageSettings`/`onLocaleChange` wiring to live-rebuild/tear-down.

### 2.6 Settings surface — `frontend/src/...` React settings page (Personalisation group)
Add one toggle row "Real-time prompt assistant" bound to the **global** scope via `updatePromptAssistSettingsForHost(GLOBAL, { realtimeEnabled })`, using `useI18n()` + new `t.promptAssist.realtime.toggle.*` keys. Reuses the existing settings group/row pattern; no new settings infrastructure. (Locate the Personalisation group via `settings.groups.personalisation`; the exact component file is resolved at implementation time — see filePlan note.)

### 2.7 Messaging
Reuse existing `SEARCH_PROMPTS` / `COMPLETE_PROMPT` / `INCREMENT_PROMPT_USAGE`. **No `protocol.ts` changes.** A structured `SUGGEST_PROMPT_IMPROVEMENTS` LLM message is explicitly **deferred** (heuristics cover the real-time path; AI rewrite reuses `COMPLETE_PROMPT`).

---

## 3. Debounce model & hot/cold split

**HOT PATH (every keystroke, offline only):**
`input` event on composer → IME guard (skip while `isComposing`) → debounced (default 350 ms, `settings.debounceMs` clamped 200–800) → `getComposerText(el)` (read-only) → **dirty-check via a cheap hash/length guard** (skip if unchanged since last score) → `scorePrompt()` + `detectClarityIssues()` + `getScoreBreakdown()` (synchronous, pure, sub-ms for <3000 chars) → `requestAnimationFrame`-batched chip `textContent`/color update. Zero network, zero LLM, zero storage.

**COLD PATH (explicit click only):** "Optimize with AI" → `sendRequest(COMPLETE_PROMPT, target:'offscreen', {draft, platform, useLibrary:true}, 120000)` → preview → optional `setComposerText`.

**Debounce mechanics:** because `lib/utils/debounce.ts` exposes no `cancel()`, the widget keeps its own `number | null` timer handle (like the file's existing `searchDebounce`) so `compositionstart` can `clearTimeout` it. 350 ms chosen over the 180 ms search debounce because a full re-score+clarity pass per keystroke is heavier than a search box and the chip is glanceable, not a typeahead.

**Listener strategy:** prefer a focus-scoped listener bound to the resolved composer when present; fall back to the existing document-level capture-phase `input` handler (already in the file for `/v`) extended to also drive scoring. Guard against re-binding (idempotent mount; `mount()` already early-returns if the root exists).

---

## 4. IME safety & never-auto-submit

**IME (Chinese/Japanese/Korean):** maintain `isComposing`. `compositionstart` → set true and **cancel** the pending debounced score (clear the timer). `input` handler early-returns while `isComposing`. `compositionend` → set false and schedule exactly **one** debounced score (composed text is now final). Secondary guard: honor `InputEvent.isComposing` for browsers that fire `input` before `compositionend`. We only ever **read** during composition and never write, so candidate windows and caret are untouched.

**Never auto-submit (hard invariant):** the only write is `setComposerText`, called solely from the preview `Replace draft` / `Use suggestion` click handler. `setComposerText` dispatches only `input`/`change`/`InputEvent` — never `keydown` Enter, never a Send click, never `form.submit()`. The chip, hover reveal, and suggestion chips never mutate the composer.

---

## 5. Per-platform composer handling
Reuse the proven 8-platform logic now centralized in `composerIo.ts`:
- **ChatGPT** (`chatgpt.com`/`chat.openai.com`): `#prompt-textarea` then `textarea`; write via prototype `value` setter + bubbling `input`/`change`.
- **Claude** (`claude.ai`): `div[contenteditable].ProseMirror`; read `innerText`, write via `execCommand('insertText')` with `textContent`+`InputEvent` fallback.
- **Gemini** (`gemini.google.com`): `div.ql-editor[contenteditable]` (Quill).
- **DeepSeek**: `#chat-input` / `textarea#chat-input`.
- **Doubao / Qwen**: `textarea` then `div[contenteditable]`.
- **Kimi** (`kimi.com`/`kimi.moonshot.cn`): `.chat-input-editor` then contenteditable/textarea.
- **Yuanbao** (`yuanbao.tencent.com`): `.ql-editor[contenteditable]`.
Active-element preference + lowest-visible-editable heuristic + `isVisible` filter are retained. If `resolveComposer` returns null → fail-closed (chip hidden, no work). Selector drift remains the maintenance burden (same as capture parsers); centralization means a single fix point. Reading is `innerText` for contenteditable and `.value` for textarea (existing `getComposerText`).

---

## 6. i18n keys (add to en.ts and zh.ts under `promptAssist.realtime`)
New top-level `promptAssist` section (en.ts is a `const ... as const`; zh.ts mirrors the shape). Structure:
- `score.labels.good` / `.fair` / `.vague`
- `score.breakdown.title` and per-factor labels (`length`, `instruction`, `role`, `constraints`, `structure`, `variables`, `codeFence`, `pureQuestion`)
- `issues.<id>` for every clarity check id (§ clarityChecks)
- `suggestions.<id>` for every remediation id
- `actions.optimize`, `actions.optimizeRunning`, `actions.useSuggestion`, `actions.replaceDraft`, `actions.cancel`, `actions.offlineHint`, `errors.completionFailed`
- `toggle.label`, `toggle.description`, `toggle.enabled`, `toggle.disabled`, `toggle.turnOffHere`, `toggle.openSettings`
Content script consumes these via `getContentTranslations()` → `t.promptAssist.realtime...`; React settings row via `useI18n()`. `contentI18n` falls back to `enTranslations` so labels are never blank.

---

## 7. Failure & degradation matrix
- Composer unresolved / text empty-whitespace → chip hidden, hot path bails.
- `chrome.storage` unavailable on settings read → defaults (`realtimeEnabled:true`), consistent with `prompt-assist.ts` default-on precedent; capsule per-host gate still applies. (Tradeoff surfaced for team review: this is "fail to non-destructive/default-on," not "fail to globally-off." We never auto-write and never block typing, so default-on is safe; flag if the team prefers strict fail-to-off.)
- `COMPLETE_PROMPT` fails/times out → inline preview error, draft untouched.
- No LLM configured → Optimize runs the degraded path (`usedLlm=false`), button label switches to "Use suggestion" + offline hint.
- i18n load failure → English fallback.
- Heuristic false positives (coarse regex) → acceptable: issues only appear on hover and never auto-apply, so blast radius is a wrong glanceable hint, not a destructive edit.

---

## 8. Performance
- Pure scoring functions are O(n) over draft length, sub-ms for typical drafts; capped work via dirty-check + debounce.
- Chip updates: `textContent`/CSS-class only, rAF-batched, `:host { all: initial }` + CSS `contain: layout style` on chip/popover to avoid layout thrash.
- No `getBoundingClientRect` on the hot path (chip is fixed-position in the launcher cluster, not anchored to the moving caret).
- Single Shadow root reused; sub-components are created once and updated, not re-created per keystroke.

---

## Prompt management optimizations (broader suite, worth doing alongside)
Concrete, low-risk improvements to the wider prompt suite, reusing the new engine:
1. **Dashboard Prompts tab — show score + clarity inline.** Render the same `getScoreBreakdown()`/`detectClarityIssues()` on each library card (a quality badge + "improve" hints), so the dashboard and in-page assistant share one definition of "good." The `dashboard.tabs.prompts` tab already exists.
2. **Score breakdown in the card detail / save flow.** When saving a draft as a prompt (existing `CREATE_PROMPT` path / "Save draft" button), surface the breakdown so users learn why a prompt scores low before storing it.
3. **Smarter extraction thresholds.** `extractCandidatesFromMessages` filters user turns by score/length; expose `detectClarityIssues` count as a secondary gate so very-vague turns are demoted even when long — reduces low-value library noise.
4. **Slash-insert ranking by quality.** `SEARCH_PROMPTS` results in the `/v` panel can be tie-broken by `quality_score` so the highest-quality matching prompts surface first; show the quality dot in each list item for parity with the chip.
5. **Variable-aware insert.** When an inserted prompt contains `{{variables}}` (already detected by `detectVariables`), highlight them in the preview and place the caret at the first variable after insert (still non-submitting) — improves the template workflow.
6. **Unify hardcoded English in `prompt-assist.ts`.** Adopt the new `contentI18n.ts` for the existing launcher/panel strings (currently hardcoded) so the whole in-page surface is en/zh — a natural follow-on once `contentI18n` lands.
7. **"Optimize" telemetry via existing logger.** `logger.debug` on optimize requests/outcomes (no PII, draft length only) to observe LLM-vs-heuristic usage and tune the debounce/threshold defaults.