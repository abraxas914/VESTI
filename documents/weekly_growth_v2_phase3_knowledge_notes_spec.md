# Weekly Growth V2 — Phase 3 Knowledge Notes

## Goal

Turn a stored `weekly_growth_report.v2` into an editable, evidence-linked note without
making another model request. The result must remain useful after the weekly report is
regenerated and after the user edits the note.

## Invariants

1. A weekly report has at most one logical knowledge note, identified by
   `kind = "weekly_report"` and `source_report_id = report.id`.
2. A note can only be created from a persisted, non-blank V2 report.
3. The generated Markdown is deterministic and contains source conversation/message
   references where the report provides them.
4. Regeneration replaces only the marker-delimited managed block. Content outside the
   block belongs to the user and must be preserved.
5. If the user removes or damages the managed markers, refresh must not overwrite the
   note. The existing note is returned with a `preservedUserContent` result.
6. The first generated title may be localized. Later refreshes must preserve a title
   renamed by the user.
7. Weekly notes are regular native notes for editing and Obsidian export, but they are
   not eligible to become conversation split notes.
8. Save/open actions are idempotent, disable duplicate in-flight requests, and use the
   background as the only database write boundary.

## Managed Markdown

The generated block includes, when available:

- week range and report identity;
- focus, rhythm, breadth, and growth comparisons;
- narrative and highlights;
- current/new/hot topics;
- open questions and suggested learning moves;
- the weekly "most" observations and spiritual food;
- a deduplicated source map.

The block is wrapped in versioned HTML comments containing the report id and source
hash. A localized `My reflections` section follows the managed block for user writing.

## Service Boundary

- Pure serializer: validates the report, builds Markdown, collects evidence ids, and
  merges a refreshed managed block into existing content.
- Repository: resolves a report/note by indexed fields and performs guarded note writes.
- Background service: owns the idempotent save-or-refresh operation and exposes typed
  request/response messages.
- Sidepanel: saves or opens the note and routes directly to it in the dashboard.
- Dashboard: separates weekly knowledge from user notes, supports starring, and keeps
  existing edit/export behavior.

## Acceptance

- Repeated saves do not create duplicate notes.
- User text after the managed block survives refresh.
- Markerless edited content is never overwritten.
- Blank or legacy reports cannot create weekly knowledge notes.
- Weekly notes never appear as conversation split-note candidates.
- English, Chinese, Japanese, and Korean UI labels compile.
- Targeted serializer/merge checks and `pnpm -C frontend build` pass.
