// LLM-backed conversation classification for the Gardener.
//
// Pure prompt-building and output-parsing logic lives here so it can be unit
// tested. The actual inference call + degradation policy live in
// gardenerService.ts. Any malformed model output parses to null, which the
// caller treats as "fall back to heuristics".

import { z } from "zod";
import { parseJsonObjectFromText } from "./insightSchemas";
import { TOPIC_PATH_SEPARATOR } from "./topicMatching";

export interface ClassificationTopicOption {
  id: number;
  path: string;
}

export interface ClassificationPromptInput {
  title: string;
  snippet: string;
  /** Pre-trimmed message excerpts, in conversation order. */
  messages: string[];
  /** Existing topic tree as flattened hierarchy paths. */
  topicPaths: ClassificationTopicOption[];
  /** Frequently used user tags, ordered by observed frequency. */
  existingTags?: string[];
}

export interface ConversationClassification {
  /** Hierarchy segments, [] when the model declines to pick a topic. */
  topicPath: string[];
  /** True when the model proposes a topic that does not exist yet. */
  isNewTopic: boolean;
  tags: string[];
  confidence: number;
}

/** Below this confidence the topic assignment is ignored (tags still apply). */
export const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.5;
/** Creating a brand-new topic demands stronger confidence than reusing one. */
export const NEW_TOPIC_CONFIDENCE_THRESHOLD = 0.6;

const MAX_TOPIC_OPTIONS = 60;
const MAX_EXISTING_TAG_OPTIONS = 80;
const MAX_MESSAGE_EXCERPTS = 12;
const MAX_MESSAGE_CHARS = 420;
const MAX_PATH_SEGMENTS = 3;
const MAX_SEGMENT_LENGTH = 40;
const MAX_TAG_LENGTH = 40;
const MAX_TAGS = 6;

export const CLASSIFICATION_SYSTEM_PROMPT = [
  "You are a librarian who files AI chat conversations into a personal topic tree.",
  "Read the conversation and decide:",
  '1) "topic_path": the best matching EXISTING topic path copied EXACTLY from the provided list. Only if nothing reasonably fits, propose ONE new path (at most 3 segments, reuse existing parent segments when possible) and set "is_new_topic": true. Use [] if the conversation is too generic to file.',
  '2) "tags": 3-6 semantic tags describing what the conversation is ABOUT (themes, goals, domains), not just technology names. Prefer an EXACT tag from the existing tag vocabulary when it expresses the same concept; create a concise new tag when none fits. Write tags in the same language as the conversation itself.',
  '3) "confidence": 0-1 number for how certain you are about topic_path.',
  'Return ONLY a JSON object: {"topic_path": ["segment", ...], "is_new_topic": false, "tags": ["..."], "confidence": 0.8}.',
  "No markdown, no code fences, no explanations.",
].join("\n");

export function buildClassificationPrompt(
  input: ClassificationPromptInput
): string {
  const topicLines =
    input.topicPaths.length > 0
      ? input.topicPaths
          .slice(0, MAX_TOPIC_OPTIONS)
          .map((option) => `- ${option.path}`)
          .join("\n")
      : "(no topics exist yet)";

  const messageLines = input.messages
    .slice(0, MAX_MESSAGE_EXCERPTS)
    .map((message, index) => `[${index + 1}] ${message.slice(0, MAX_MESSAGE_CHARS)}`)
    .join("\n");

  const existingTagLine = (input.existingTags ?? [])
    .slice(0, MAX_EXISTING_TAG_OPTIONS)
    .join(", ");

  return [
    `Existing topic paths (separator "${TOPIC_PATH_SEPARATOR.trim()}"):`,
    topicLines,
    "",
    "Existing tag vocabulary (reuse exact spelling when appropriate):",
    existingTagLine || "(no tags exist yet)",
    "",
    `Conversation title: ${input.title || "(untitled)"}`,
    input.snippet ? `Summary: ${input.snippet}` : "",
    "Messages:",
    messageLines || "(no messages)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function cleanSegment(value: string): string {
  return value
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEGMENT_LENGTH);
}

function coerceTopicPath(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map(cleanSegment)
      .filter(Boolean)
      .slice(0, MAX_PATH_SEGMENTS);
  }
  if (typeof value === "string") {
    return value
      .split(/\s*(?:\/|>|→|»)\s*/)
      .map(cleanSegment)
      .filter(Boolean)
      .slice(0, MAX_PATH_SEGMENTS);
  }
  return [];
}

function coerceTags(value: unknown): string[] {
  let raw: string[] = [];
  if (Array.isArray(value)) {
    raw = value.filter((item): item is string => typeof item === "string");
  } else if (typeof value === "string") {
    raw = value.split(/[,，、;；]/);
  }
  return raw
    .map((tag) => tag.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function coerceConfidence(value: unknown): number {
  let num: number;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string") {
    num = Number(value.replace(/%$/, ""));
    if (Number.isFinite(num) && /%$/.test(value.trim())) {
      num /= 100;
    }
  } else {
    num = 0;
  }
  if (!Number.isFinite(num)) return 0;
  // Some models answer 0-100 instead of 0-1.
  if (num > 1 && num <= 100) num /= 100;
  return Math.min(1, Math.max(0, num));
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

const classificationSchema = z.object({
  topic_path: z.preprocess(coerceTopicPath, z.array(z.string())),
  is_new_topic: z.preprocess(coerceBoolean, z.boolean()),
  tags: z.preprocess(coerceTags, z.array(z.string())),
  confidence: z.preprocess(coerceConfidence, z.number()),
});

function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

/**
 * Parse raw LLM output into a classification. Tolerates code fences, wrapper
 * prose, string-encoded arrays/numbers, and percentage confidences. Returns
 * null for anything unusable so the caller can degrade to heuristics.
 */
export function parseClassificationOutput(
  raw: string
): ConversationClassification | null {
  let candidate: unknown;
  try {
    candidate = parseJsonObjectFromText(raw);
  } catch {
    return null;
  }

  const parsed = classificationSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  return {
    topicPath: parsed.data.topic_path,
    isNewTopic: parsed.data.is_new_topic,
    tags: dedupeCaseInsensitive(parsed.data.tags),
    confidence: parsed.data.confidence,
  };
}

/**
 * Match a model-proposed path against the existing topic list.
 * Returns the matched topic id, or the deepest existing prefix plus the first
 * missing segment (a creation suggestion), or null when the path is empty.
 */
export function resolveTopicPathAgainstExisting(
  topicPath: string[],
  options: ClassificationTopicOption[]
):
  | { kind: "existing"; id: number }
  | { kind: "create"; parentId: number | null; segments: string[] }
  | null {
  if (topicPath.length === 0) return null;

  const byPath = new Map<string, number>();
  for (const option of options) {
    byPath.set(option.path.toLowerCase(), option.id);
  }

  const joinPath = (segments: string[]): string =>
    segments.join(TOPIC_PATH_SEPARATOR).toLowerCase();

  // Exact full-path match.
  const exact = byPath.get(joinPath(topicPath));
  if (exact !== undefined) {
    return { kind: "existing", id: exact };
  }

  // A unique last-segment match is safe when models return only the leaf name.
  // Ambiguous leaves are deliberately ignored instead of choosing an arbitrary
  // branch in the user's topic tree.
  const leaf = topicPath[topicPath.length - 1].toLowerCase();
  const leafMatches = options.filter((option) => {
    const segments = option.path.split(TOPIC_PATH_SEPARATOR);
    return segments[segments.length - 1].toLowerCase() === leaf;
  });
  if (leafMatches.length === 1) {
    return { kind: "existing", id: leafMatches[0].id };
  }

  // Deepest existing prefix; return every missing segment so callers can
  // create the complete hierarchy instead of stopping at the first level.
  for (let depth = topicPath.length - 1; depth >= 1; depth -= 1) {
    const prefixId = byPath.get(joinPath(topicPath.slice(0, depth)));
    if (prefixId !== undefined) {
      return {
        kind: "create",
        parentId: prefixId,
        segments: topicPath.slice(depth),
      };
    }
  }

  return { kind: "create", parentId: null, segments: topicPath };
}
