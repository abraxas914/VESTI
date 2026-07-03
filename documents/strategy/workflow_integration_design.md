# VESTI — Workflow Integration Design (chat-memory → Office/Notion/Obsidian/MCP)

> From a multi-agent, web-grounded design pass (2026-06). Goal: make the owned, structured,
> local, multi-platform chat corpus flow effortlessly into the tools people actually work in.

## Thesis

The corpus's value is realized **downstream**. VESTI already owns the hard part (faithful **AST**
capture + a local multi-platform corpus + summaries + agentic Explore). The win is a **single
unifying interface — "Send to…" over one canonical payload `{title, markdown, html?, frontmatter?}`
— with per-target adapters**, applied not just to conversations but to **every derived output**
(the AI summary, and Explore's Answer / AITI portrait / Learn digest / Roundtable synthesis).
"Promote a chat (or a reflection) into the tool I live in" is the #1 validated, most-commoditized
demand; AST fidelity (code/tables/LaTeX survive) is where every OSS exporter falls back to plain
text — that's our moat, plus the Office/**WPS** audience nobody else serves.

## Architecture: one payload, many adapters

```
CanonicalPayload = { title: string; markdown: string; html?: string; frontmatter?: Record<…> }
  ← built by per-source builders:
      conversation / summary  (conversationMarkdown.ts — done)
      Explore answer · AITI · Learn · Roundtable  (new pure builders)
  → consumed by per-target adapters (one "Send to…" picker):
      Notion   (markdown→blocks, idempotent upsert by stable id)   [partly done]
      Obsidian (file + Dataview YAML frontmatter, vault layout)     [partly done]
      Clipboard (rich text/html — paste into Word/WPS/OneNote)      [done per-message]
      .docx    (client-side via fflate, OOXML)                      [P2]
      MCP/memory-folder (FS export consumable by MCP filesystem)    [P2]
```

`SendToMenu` becomes generic: it accepts a prebuilt `payload` (for derived outputs) OR builds from
a conversation (existing scope picker). Every Explore output renders the same menu.

## Prioritized plan

**P0 — the integration spine + Explore upgrade (feasible-now, no new deps, this session)**
- Generalize `SendToMenu` to take a prebuilt `{title, markdown}` payload.
- Pure markdown builders for AITI / Learn / Roundtable / Explore-answer outputs.
- Render "Send to…" on each Explore output → users promote reflections to Notion/Obsidian/clipboard.
- Richer **Obsidian YAML frontmatter** (platform, date, type, tags, vesti-source-id) → Dataview-grade.

**P1 — make destinations first-class**
- Notion: a structured **VESTI Conversations** database schema + **idempotent upsert** (cache
  `notion_page_id` per conversation; query-by-source-id before create) → sync, not duplicate dumps.
- **Code-snippet library**: AST already isolates `code_block{code,language}` — a searchable, copyable
  view of every snippet across chats (the cleanest unique encapsulation; reuses the local search engine).
- Clickable inline **citations** in Explore answers → deep-link to source conversations.

**P2 — reach + programmability**
- Client-side **.docx** export (fflate; the universal WPS/Office handoff).
- **MCP memory folder**: a zero-server FS export consumable by the MCP filesystem server (other AI
  tools query your chat memory). The full "VESTI Bridge" native-messaging MCP host is a later, larger bet.
- Saved Explorations (persist Explore outputs); periodic background sync.

## Interface contracts (build first)

- `SendToMenu` gains `payload?: { title: string; markdown: string }`; when present it's the source
  (no scope picker), else the existing conversation/summary scopes apply.
- New builders (pure, vesti-ui): `buildAitiMarkdown(profile, labels)`, `buildLearnMarkdown(profile,
  labels)`, `buildRoundtableMarkdown(result, labels)` → markdown strings.
- `exportConversationToObsidian({title, markdown, frontmatter?})` — frontmatter widened to carry
  platform/date/type/tags/source-id.

Local-first note: Obsidian/clipboard/.docx are 100% local; Notion leaves the device (disclosed).
