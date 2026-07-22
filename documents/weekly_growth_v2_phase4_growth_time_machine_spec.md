# Weekly Growth V2 — Phase 4 Growth Time Machine

## Goal

Turn the existing weekly growth series and stored V2 reports into a local-first
longitudinal reflection tool. A user can compare the current week with an earlier,
non-overlapping period and understand metric momentum, personal bests, identity
evolution, and topic movement without another model request.

## Why this is the Phase 4 innovation

Phase 1 deliberately introduced:

- `WeeklyReportPeriodType`;
- `WeeklyGrowthReportV2.growth.series`;
- the `[periodType+rangeStart]` weekly report index.

Phases 2 and 3 did not consume those longitudinal boundaries. Growth Time Machine
uses them directly and extends the weekly report without adding an unrelated product
surface or cloud dependency.

## Invariants

1. Computation is deterministic, local, and makes no LLM or embedding request.
2. The current source must be a persisted, non-blank
   `weekly_growth_report.v2`.
3. Historical report lookup uses `[periodType+rangeStart]`, is bounded before
   materialization, and never scans conversations, messages, topics, or all reports.
4. A comparison baseline must end before the current period starts. Overlapping
   rolling reports are excluded to avoid misleading deltas.
5. The current report's embedded growth series is always the primary fallback.
   Stored reports only enrich or extend it with identity and topic context.
6. Points are deduplicated by exact range, sorted deterministically, and bounded to
   twelve history periods.
7. Invalid, blank, legacy, overlapping, or malformed history records are skipped.
8. Topic comparison is only shown when both current and baseline topic evidence
   exists. Missing evidence is not interpreted as an empty topic set.
9. A negative delta is framed as rebalancing, not failure. The feature is reflective,
   not evaluative.
10. No new database version or persistent user state is required.

## Domain Model

Each time-machine point contains only privacy-bounded aggregate data:

- period range and whether a persisted report enriched the point;
- conversation count and active days;
- focus, rhythm, and breadth scores;
- optional identity label;
- up to twelve normalized topic labels.

The comparison derives:

- signed metric deltas;
- personal-best flags across the bounded timeline;
- overall momentum (`rising`, `steady`, or `rebalancing`);
- emerging topics, returning topics, and cooled topics;
- a chronological, consecutive-deduplicated identity trail.

No raw conversation or message content crosses this boundary.

## Service Boundary

- Pure domain module: validates V2 reports, merges embedded and stored history, and
  computes a selected baseline comparison.
- Repository: retrieves a bounded candidate window through the compound period index.
- Background service: validates the report id, loads current/history records, and
  returns the aggregate timeline.
- Sidepanel: loads the timeline lazily, lets the user select a baseline, and renders
  the comparison inside the weekly report.

## UX

- The section appears only for a non-blank V2 weekly report.
- It starts with the most recent non-overlapping baseline.
- The baseline selector lists available historical ranges.
- Metric cards show the current value, signed delta, and a personal-best marker.
- Identity and topic movement appear only with sufficient historical evidence.
- Loading, unavailable-history, and retry states are compact and non-blocking.
- Exported weekly PNG excludes interactive controls but includes the selected
  time-machine comparison. Identity evolution follows the report's existing
  private-export rule and is omitted.

## Acceptance

- Repeated requests return the same ordered aggregate timeline.
- Embedded series provides a comparison when no older report was persisted.
- Stored report data enriches the matching embedded point instead of duplicating it.
- Overlapping reports, blank reports, and legacy reports never become baselines.
- History queries remain index-backed and bounded.
- Topic movement distinguishes first-seen topics from returning topics.
- Four supported UI locales compile.
- Domain verification, strict TypeScript, UI boundary checks, full extension build,
  and an isolated extension smoke test pass.
