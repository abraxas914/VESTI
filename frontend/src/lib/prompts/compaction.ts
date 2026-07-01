import type { Message } from "../types";
import { getLocaleDateTag, getLlmLanguageName, type SupportedLocale } from "../i18n/locales";
import { buildMessageFallbackDisplayText } from "../utils/messageContentPackage";
import type { CompactionPromptPayload, PromptVersion } from "./types";

const COMPACTION_SYSTEM = `You are Agent A: Vesti's structured context compaction engine.

Your job is to compress a conversation into a compact markdown skeleton that preserves:
1) reasoning trajectory,
2) speaker ownership,
3) empirical grounding.

Output must contain these exact section headings:
## Core Logic Chain
## Concept Matrix
## Unresolved Tensions

Hard rules:
1) Use only evidence present in input messages. No fabrication.
2) Keep [User] and [AI] boundaries explicit in logic-chain bullets.
3) Keep reasoning order chronological; do not collapse multi-step arguments into one slogan.
4) For each concept, include working definition + concrete mapping in this conversation.
5) Keep unresolved tensions only when they are truly unresolved in this input slice.
6) Target concise volume (roughly 8%-15% of natural-language input).
7) If input is sparse, still return a minimal valid skeleton with available evidence.
8) Output markdown only. No JSON. No code fences.`;

function formatTime(value: number, locale: SupportedLocale): string {
  return new Date(value).toLocaleTimeString(getLocaleDateTag(locale), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toCompactTranscript(
  messages: Message[],
  locale: SupportedLocale,
  transcriptOverride?: string
): string {
  if (transcriptOverride?.trim()) {
    return transcriptOverride.trim();
  }

  if (!messages.length) {
    return "[No messages available]";
  }

  return messages
    .map((message, index) => {
      const role = message.role === "user" ? "User" : "AI";
      return `${index + 1}. [${formatTime(message.created_at, locale)}] [${role}] ${buildMessageFallbackDisplayText(message)}`;
    })
    .join("\n");
}

function buildCompactionPrompt(payload: CompactionPromptPayload): string {
  const locale = payload.locale || "en";
  const conversationTitle = payload.conversationTitle || "(untitled)";
  const conversationPlatform = payload.conversationPlatform || "unknown";
  const conversationOriginAt = payload.conversationOriginAt
    ? new Date(payload.conversationOriginAt).toLocaleString(getLocaleDateTag(locale))
    : "unknown";

  return `Build an Agent-A compaction markdown skeleton from this conversation slice.

Metadata:
- Title: ${conversationTitle}
- Platform: ${conversationPlatform}
- StartedAt: ${conversationOriginAt}
- Locale: ${locale}
- MessageCount: ${payload.messages.length}

Conversation:
${toCompactTranscript(payload.messages, locale, payload.transcriptOverride)}

Execution constraints:
1) Input boundary is strict: use this slice only.
2) Preserve speaker ownership with [User]/[AI] in logic-chain bullets.
3) Keep chronological reasoning steps; avoid flattening into generic summary lines.
4) Keep empirical anchors concrete and verifiable from this slice.
5) Keep section headings exactly:
   - ## Core Logic Chain
   - ## Concept Matrix
   - ## Unresolved Tensions
6) If evidence is sparse, keep sections but use minimal conservative bullets.
7) Write all user-facing skeleton text in ${getLlmLanguageName(locale)} (keep the section headings exactly as listed above in English).
8) Output markdown only (no JSON, no code fences).`;
}

function buildCompactionFallbackPrompt(payload: CompactionPromptPayload): string {
  const locale = payload.locale || "en";
  return `Write a concise plain-text compaction for this conversation in 5-8 lines.
Focus on: core tension, key reasoning transitions, concrete anchor, and unresolved points.
Write the output in ${getLlmLanguageName(locale)}.

Conversation:
${toCompactTranscript(payload.messages, locale, payload.transcriptOverride)}`;
}

export const CURRENT_COMPACTION_PROMPT: PromptVersion<CompactionPromptPayload> = {
  version: "v1.0.0-agent-a-baseline1",
  createdAt: "2026-02-24",
  description:
    "Agent A runtime baseline aligned with downstream mapping constraints (schema-preserving).",
  system: COMPACTION_SYSTEM,
  fallbackSystem: "You are a concise technical compaction assistant. Output plain text only.",
  userTemplate: buildCompactionPrompt,
  fallbackTemplate: buildCompactionFallbackPrompt,
};

export const EXPERIMENTAL_COMPACTION_PROMPT: PromptVersion<CompactionPromptPayload> = {
  version: "v1.0.0-agent-a-baseline1-exp",
  createdAt: "2026-02-24",
  description: "Experimental variant for Agent A runtime quality diagnostics.",
  system: COMPACTION_SYSTEM,
  fallbackSystem: "You are a concise technical compaction assistant. Output plain text only.",
  userTemplate: buildCompactionPrompt,
  fallbackTemplate: buildCompactionFallbackPrompt,
};
