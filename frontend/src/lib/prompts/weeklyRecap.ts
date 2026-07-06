import { getLlmLanguageName, type SupportedLocale } from "../i18n/locales";
import type { PromptVersion, WeeklyRecapPromptPayload } from "./types";

// ──────────────────────────────────────────────────────────────────────────
// weekly_recap.v1 — "Plan B" warm recap writer.
// Stats are computed in code; this prompt only writes SHORT, encouraging copy
// (Spotify Wrapped / Duolingo tone). One LLM call, JSON-only output.
// ──────────────────────────────────────────────────────────────────────────

const WEEKLY_RECAP_SYSTEM = `You are Vesti's Weekly Recap writer — warm, upbeat, and personal, in the spirit of Spotify Wrapped or Duolingo's weekly summary.

Your job: turn the provided pre-computed stats into a SHORT, emotionally-encouraging recap as weekly_recap.v1 JSON.

Hard constraints:
1) Output ONE JSON object only. No markdown, no code fences, no commentary.
2) "greeting" is a punchy one-line title. "narrative" is an array of 2-3 SHORT warm paragraphs (1-2 sentences each) that tell the story of the user's week as FLOWING PROSE — not a list of stats.
3) Write in the second person ("you"), warm and celebratory (Spotify Wrapped / Duolingo vibe).
4) Weave the REAL numbers from the provided stats INTO the narrative sentences (conversation_count, active_days, streak_weeks, top_platform). Express week_over_week_delta as a NATURAL sentence (e.g. "that's 11 more than last week") — NEVER a bare "+11". Do NOT invent anything beyond the provided stats and highlight.
5) Shape the narrative as: open by celebrating the week with the numbers; mention the change vs last week (or the streak); end with a gentle nudge for next week. Keep it tight and human.
6) If a highlight is provided, reflect it in highlight.title/detail; if none, set highlight to null.
7) mood_emoji is a single emoji matching the week's energy. persona_tag is a short, playful label (<= 24 chars), e.g. "Deep Diver".
8) Copy the numbers into "stats" exactly as provided. JSON field names stay English; only text VALUES are localized.

Output schema (weekly_recap.v1):
{
  "schema": "weekly_recap.v1",
  "greeting": "string (punchy one-line title)",
  "persona_tag": "string (<= 24 chars)",
  "mood_emoji": "string (one emoji)",
  "narrative": ["string", "string"],
  "highlight": { "title": "string", "detail": "string" } | null,
  "stats": {
    "conversation_count": 0,
    "active_days": 0,
    "streak_weeks": 0,
    "top_platform": "string",
    "week_over_week_delta": 0
  }
}`;

const WEEKLY_RECAP_FALLBACK_SYSTEM =
  "You are a warm, encouraging weekly-recap writer. Output plain text only (3 short lines). Write in the language requested by the user prompt.";

function formatDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function buildStatsBlock(payload: WeeklyRecapPromptPayload): string {
  const { stats } = payload;
  const compact = {
    conversation_count: stats.conversationCount,
    active_days: stats.activeDays,
    streak_weeks: stats.streakWeeks,
    starred_count: stats.starredCount,
    week_over_week_delta: stats.weekOverWeekDelta,
    top_platforms: stats.topPlatforms,
    busiest_day: stats.busiestDay,
    top_topics: stats.topTopics,
  };
  return JSON.stringify(compact, null, 2);
}

function buildHighlightBlock(payload: WeeklyRecapPromptPayload): string {
  if (!payload.highlightContext) {
    return "null";
  }
  const { highlightContext } = payload;
  return JSON.stringify(
    {
      title: highlightContext.title,
      topic: highlightContext.topic,
      message_count: highlightContext.messageCount,
      turn_count: highlightContext.turnCount,
      is_starred: highlightContext.isStarred,
      summary_gist: highlightContext.summaryGist ?? null,
    },
    null,
    2
  );
}

function resolveTopPlatform(payload: WeeklyRecapPromptPayload): string {
  return payload.stats.topPlatforms[0]?.platform ?? "—";
}

function buildWeeklyRecapPrompt(payload: WeeklyRecapPromptPayload): string {
  const locale = payload.locale;
  const languageDirective = `Write all user-facing text VALUES in ${getLlmLanguageName(
    locale
  )}. Keep all JSON field names in English.`;

  return `Write a warm weekly_recap.v1 recap from the pre-computed stats below.

Time range: ${formatDate(payload.rangeStart)} ~ ${formatDate(payload.rangeEnd)}
Locale: ${locale}
Top platform (use verbatim in stats.top_platform): ${resolveTopPlatform(payload)}

Pre-computed stats (the ONLY facts you may use):
${buildStatsBlock(payload)}

Heaviest conversation this week (the "you chatted a lot" highlight; null if none):
${buildHighlightBlock(payload)}

Requirements:
1) Output one JSON object only, matching weekly_recap.v1.
2) Copy the numbers into stats exactly (conversation_count, active_days, streak_weeks, top_platform, week_over_week_delta).
3) Write "narrative" as 2-3 short, warm, second-person paragraphs that weave the numbers in naturally; say the week-over-week change as a sentence (e.g. "11 more than last week"), never a bare "+11".
4) "greeting" is a punchy one-line title (not a full paragraph).
5) If the highlight above is null, set "highlight" to null; otherwise fill title + detail from it (no fabrication).
6) Pick a fitting mood_emoji and a playful persona_tag.
7) ${languageDirective}`;
}

function buildWeeklyRecapFallbackPrompt(
  payload: WeeklyRecapPromptPayload
): string {
  const locale = payload.locale;
  const languageDirective = `Write the recap in ${getLlmLanguageName(locale)}.`;

  return `Write a warm 3-line weekly recap (plain text, no JSON, no markdown).

This week: ${payload.stats.conversationCount} conversations across ${payload.stats.activeDays} active days, on a ${payload.stats.streakWeeks}-week streak. Top platform: ${resolveTopPlatform(payload)}.
${payload.highlightContext ? `Heaviest thread: ${payload.highlightContext.title}.` : ""}

Requirements:
1) Line 1: a warm greeting celebrating the week using the real numbers.
2) Line 2: one specific highlight (or general encouragement if none).
3) Line 3: a gentle nudge for next week.
4) ${languageDirective}`;
}

export const CURRENT_WEEKLY_RECAP_PROMPT: PromptVersion<WeeklyRecapPromptPayload> = {
  version: "v1.0.0",
  createdAt: "2026-06-16",
  description:
    "Weekly recap (Plan B): code-computed stats + one warm LLM copy pass producing weekly_recap.v1 JSON.",
  system: WEEKLY_RECAP_SYSTEM,
  fallbackSystem: WEEKLY_RECAP_FALLBACK_SYSTEM,
  userTemplate: buildWeeklyRecapPrompt,
  fallbackTemplate: buildWeeklyRecapFallbackPrompt,
};
