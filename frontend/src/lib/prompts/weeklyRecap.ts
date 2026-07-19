import { getLlmLanguageName } from "../i18n/locales";
import type { PromptVersion, WeeklyRecapPromptPayload } from "./types";

const WEEKLY_RECAP_SYSTEM = `You are Vesti's weekly growth editor.

The application has already computed every numeric metric locally. Your task is
limited to concise narrative, identity wording, emotion keywords, and selecting
valuable highlights from an explicit candidate list.

Hard constraints:
1) Output one JSON object only. No markdown or commentary.
2) Never invent a number, conversationId, messageId, quote, person, topic, or event.
3) Every highlight must copy conversationId and messageId from one supplied
   candidate and must copy its excerpt verbatim. Do not paraphrase excerpts.
4) Return 3-5 highlights when at least 3 candidates exist; otherwise return no
   more highlights than candidates. Do not repeat a messageId.
5) identity.label is playful, affirming, and about five Chinese characters or
   similarly short in the requested language. It is not a diagnosis.
6) emotionKeywords describe textual tone only. Each score is between 0 and 1.
7) narrative contains 2-3 short second-person paragraphs.
8) All user-facing values use the requested language. JSON keys stay English.

Output schema:
{
  "schema": "weekly_growth_ai.v2",
  "greeting": "string",
  "narrative": ["string"],
  "identity": {
    "label": "string",
    "rationale": "string",
    "moodEmoji": "single emoji",
    "emotionKeywords": [
      { "label": "string", "score": 0.0, "conversationIds": [1] }
    ]
  },
  "highlights": [
    {
      "conversationId": 1,
      "messageId": 2,
      "title": "string",
      "excerpt": "verbatim candidate excerpt",
      "insight": "why it mattered"
    }
  ],
  "mosts": {
    "unexpectedConversation": {
      "label": "string",
      "detail": "string",
      "conversationId": 1,
      "messageIds": [2]
    } | null,
    "mentionedEntity": {
      "label": "string",
      "detail": "string",
      "conversationId": 1,
      "messageIds": [2]
    } | null
  }
}`;

const WEEKLY_RECAP_FALLBACK_SYSTEM =
  "Write a short, encouraging weekly growth recap using only the supplied facts.";

function formatDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function buildWeeklyRecapPrompt(payload: WeeklyRecapPromptPayload): string {
  const facts = {
    range: {
      start: formatDate(payload.rangeStart),
      end: formatDate(payload.rangeEnd),
    },
    stats: payload.stats,
    energy: payload.energy ?? {},
    growthSeries: payload.growthSeries ?? [],
    tags: payload.tags ?? [],
    mosts: payload.mosts ?? {},
  };
  const candidates = (payload.highlightCandidates ?? []).slice(0, 8);

  return `Create the narrative layer for weekly_growth_report.v2.

Locale: ${payload.locale}
Language: ${getLlmLanguageName(payload.locale)}

Deterministic facts (read-only; never alter or add numbers):
${JSON.stringify(facts, null, 2)}

Allowed highlight candidates:
${JSON.stringify(candidates, null, 2)}

Requirements:
1) Match weekly_growth_ai.v2 exactly.
2) Select highlights only from Allowed highlight candidates.
3) Copy candidate conversationId, messageId, and excerpt exactly.
4) If the candidate list is empty, return highlights: [].
5) unexpectedConversation and mentionedEntity must cite allowed candidate IDs;
   return null when evidence is insufficient.
6) Keep the response concise and write all display text in ${getLlmLanguageName(
    payload.locale
  )}.`;
}

function buildWeeklyRecapFallbackPrompt(
  payload: WeeklyRecapPromptPayload
): string {
  return `Write three short lines in ${getLlmLanguageName(payload.locale)}.
Use only these facts: ${JSON.stringify(payload.stats)}.
Do not invent quotes, people, or resources.`;
}

export const CURRENT_WEEKLY_RECAP_PROMPT: PromptVersion<WeeklyRecapPromptPayload> = {
  version: "v2.0.0",
  createdAt: "2026-07-19",
  description:
    "Weekly growth V2 narrative layer with deterministic metrics and evidence-bound highlights.",
  system: WEEKLY_RECAP_SYSTEM,
  fallbackSystem: WEEKLY_RECAP_FALLBACK_SYSTEM,
  userTemplate: buildWeeklyRecapPrompt,
  fallbackTemplate: buildWeeklyRecapFallbackPrompt,
};
