# VESTI Reflective Modules: AITI & Learn

## Overview

The **Explore** tab in the VESTI dashboard contains two locally-computed reflective modules:

- **AITI（个人内向探索）** — a "thinking fingerprint" that surfaces a user's cognitive style from their captured AI conversations.
- **Learn（学习）** — a personal curriculum view that organizes conversations into domains, glossary, open loops, learning paths, and review queues.

Both modules run **100% locally** in the extension UI / offscreen document. No LLM is invoked during computation. They can optionally consume raw messages as a fallback when structured summaries are missing, so they remain useful even for users with only a few conversations.

---

## File map

| Concern | Path |
|---------|------|
| Shared pure helpers | `frontend/src/lib/reflective/shared.ts` |
| AITI computation | `frontend/src/lib/aiti/computeAiti.ts` |
| Learn computation | `frontend/src/lib/learn/computeLearn.ts` |
| AITI UI card | `packages/vesti-ui/src/components/AitiCard.tsx` |
| Learn UI card | `packages/vesti-ui/src/components/LearnCard.tsx` |
| Type definitions | `packages/vesti-ui/src/types.ts` |
| Default labels | `packages/vesti-ui/src/dashboard.tsx` |
| i18n translations | `frontend/src/lib/i18n/translations/{en,zh,ja,ko}.ts` |
| Markdown export | `packages/vesti-ui/src/lib/exploreMarkdown.ts` |
| Test fixture validator | `scripts/validate-test-data.py` |
| Algorithm sanity check | `scripts/test-reflective-logic.mjs` |

---

## Data flow

```text
captured messages
  → summary generation (optional, LLM-powered)
  → IndexedDB summaries table
  → VESTI_DATA_UPDATED broadcast
  → frontend/src/dashboard.tsx fetches summaries + conversations + messages
  → computeAiti / computeLearn
  → AitiCard / LearnCard in packages/vesti-ui
```

When summaries are missing, `computeAiti` and `computeLearn` fall back to lightweight heuristics over conversation titles, snippets, and raw messages.

---

## AITI axes

| Axis | Left pole | Right pole | Signal source |
|------|-----------|------------|---------------|
| `depth` | Explorer | Excavator | `meta_observations.depth_level` or message keyword heuristics |
| `maker` | Theorist | Maker | `actionable_next_steps` / `tech_stack_detected` or action/tech keywords in messages |
| `focus` | Converger | Wanderer | Count of `unresolved_threads` or user questions |
| `affect` | Cool-headed | Spirited | `emotional_tone` / `sentiment` or emotion keywords |
| `curiosity` | Settled | Curious | Question density and follow-up chains in messages |
| `interdisciplinary` | Focused | Interdisciplinary | Distinct topics + platforms across conversations |

Each axis carries:
- `score` (0–100)
- `evidenceConversationIds` (top contributing conversations)
- `hasSignal` (false when the score is a neutral default with no evidence)

### Trends

When enough data exists, AITI computes a 30-day trend for each axis by comparing the recent window to the all-time profile.

---

## Learn outputs

| Output | Description |
|--------|-------------|
| `domains` | Conversations grouped by topic, with a depth mix bar |
| `glossary` | Recurring key terms with definitions (from summaries) or frequent terms (fallback) |
| `openLoops` | Unresolved questions from summaries or raw user messages |
| `learningPath` | 3–4 staged suggestions: foundation → expand → apply → synthesize |
| `reviewQueue` | Terms due for review, inferred from recency-based spaced repetition intervals |
| `goals` | Inferred goals from top domains, with a progress estimate |

### Confidence levels

Both modules report a `confidence` field:

- `low` — preliminary, often based on raw messages or very few conversations
- `medium` — growing signal, typically 2–4 conversations with summaries
- `high` — solid, 5+ conversations with summaries

---

## Thresholds

| Module | Minimum sample to show a result | Notes |
|--------|----------------------------------|-------|
| AITI | 2 conversations | 1 conversation returns `available: false` with a hint |
| Learn | 1 conversation | Requires at least one domain or glossary item |

---

## Testing

### Validate the test fixture

```bash
python3 scripts/validate-test-data.py
```

### Run the algorithm sanity check

```bash
node scripts/test-reflective-logic.mjs
```

This prints AITI / Learn profiles for subsets of the test fixture (1, 2, 5, 10, all conversations) without requiring TypeScript compilation.

### Manual QA

1. Import `test_data/vesti-export-*.json` into the extension via Settings → Data Management → Import JSON.
2. Open the Dashboard → Explore → AITI / Learn.
3. Verify that profiles appear even though the fixture has no pre-generated summaries.

---

## Design principles

1. **Privacy first** — no LLM calls during AITI/Learn computation.
2. **Graceful degradation** — works with or without structured summaries.
3. **Evidence-backed** — every axis and obsession links to source conversations.
4. **Localized** — all user-facing strings live in i18n files.
5. **Exportable** — profiles can be exported as Markdown via `SendToMenu`.
