# Prompt Management — Manual Acceptance Checklist

Run after loading the unpacked extension (`frontend/build/chrome-mv3-dev`) and
opening the dashboard. Cover both **no-LLM** and **LLM-configured** states.

## 0. Build / load

- [ ] `pnpm -C frontend build` (or `dev`) completes; extension loads with no
      errors in the `chrome://extensions` Errors panel.
- [ ] Dashboard shows a new **PROMPTS** tab in the top nav; `?tab=prompts`
      deep-links to it.

## 1. Library CRUD (works with no LLM)

- [ ] **New prompt** → editor opens; saving with empty body is blocked.
- [ ] Save a prompt with title, body (include `{{topic}}`), category, tags →
      appears in the list with category/tag chips and a quality score.
- [ ] Saving an identical body again shows "an identical prompt already exists"
      (dedupe by hash) and does not create a duplicate.
- [ ] Edit a prompt (body/title/tags/category) → changes persist after reload.
- [ ] Toggle favorite (star) → persists; the **Favorites** filter shows only
      starred prompts.
- [ ] Delete a prompt (card hover trash or editor Delete) → removed after reload.
- [ ] Search, category filter, and sort (Recent / Quality / Most used) behave.
- [ ] **Copy** on a card writes the body to the clipboard and increments
      "used N×".

## 2. Extract from conversations

- [ ] With captured conversations present, click **Extract from chats** →
      toast reports created/candidate counts; new prompts have
      `source = extracted` and show the source platform badge.
- [ ] Re-running extraction does not create duplicates (skipped count rises).
- [ ] With **no LLM** configured: extraction still works (heuristic titles,
      scores, categories) and the toast does not claim "LLM-enriched".
- [ ] With **LLM** configured: titles/summaries/tags are noticeably refined and
      the toast notes "(LLM-enriched)". Editor shows the LLM summary line.
- [ ] "Open source conversation" in the editor navigates to the Library tab and
      opens the originating conversation.

## 3. AI improve (dashboard)

- [ ] In the editor, **Improve with AI** with a draft body:
  - [ ] No LLM → body unchanged, toast prompts to configure an LLM in Settings.
  - [ ] LLM configured → body is rewritten into a stronger prompt; intent and
        `{{variables}}` preserved.

## 4. In-page assist (per platform)

Test on at least ChatGPT + one domestic platform (e.g. Yuanbao or DeepSeek):

- [ ] A "✨ Prompt" launcher appears (bottom-left) and is hidden on hosts where
      the Vesti capsule is disabled.
- [ ] Launcher → panel opens; searching lists library prompts; clicking one
      inserts its body into the composer and the host app registers the text
      (send button enables, character count updates).
- [ ] Typing `​/v keyword` in the composer opens the panel seeded with
      `keyword`; selecting a prompt **replaces** the trigger text with the body.
- [ ] **Improve my draft**: with a draft typed, a preview appears; **Replace
      draft** writes the improved prompt into the composer. With no LLM, the
      suggestion equals the draft and is labelled accordingly.
- [ ] **Save draft** adds the current composer text to the library.
- [ ] The script never submits the message automatically.

## 5. Real-time in-page prompt assistant

Test on ChatGPT + one domestic platform (e.g. Yuanbao or DeepSeek):

- [ ] Start typing a short, vague prompt in the composer → the launcher badge
      shows a live quality score; opening the panel shows the score bar and
      clarity suggestions (e.g. "Specify a role…", "Describe the output format…").
- [ ] Improve the prompt (add role, constraints, format) → score rises and
      suggestions shrink.
- [ ] **IME**: type Chinese via pinyin → no scoring flicker mid-composition;
      score updates once after you commit the characters.
- [ ] **Optimize with AI** (LLM configured) → preview appears; "Replace draft"
      writes the improved prompt into the composer; nothing is auto-submitted.
      With no LLM, it shows the "configure an LLM" hint.
- [ ] **Toggle**: Settings → "Real-time prompt assistant" off → the score badge
      and panel quality section stop updating; on → resumes. "Turn off on this
      site" from the panel footer disables it for that host only.
- [ ] Switch language (Settings → Language → 中文) → the assistant panel labels
      and suggestions localize to Chinese without reload.

## 6. Regression / hygiene

- [ ] Library / Explore / Network / Prompts tabs and capture flow are unaffected.
- [ ] `node scripts/check-frontend-ui-boundary.mjs` → OK.
- [ ] No new entries appear in the `chrome://extensions` Errors panel during
      normal use (parser heuristics are now `console.debug`).
