import {
  formatArtifactDescriptor,
  getArtifactExcerptText,
} from "@vesti/content-package";
import type { AnnotationRecord } from "../db/schema";
import type {
  Message,
  MessageSearchEntry,
  SearchMatchSurface,
} from "../types";
import { resolveCanonicalBodyText } from "./messageContentPackage";
import { tokenize } from "../search/textSearch";

type MessageSearchProjectionLike = Pick<
  Message,
  "id" | "content_text" | "citations" | "attachments" | "artifacts"
> & {
  content_ast?: unknown;
};

export interface AnnotationSearchEntry {
  surface: "annotation";
  messageId: number;
  targetKey: string;
  text: string;
}

const SEARCH_SURFACE_PRIORITY: Record<SearchMatchSurface, number> = {
  body: 0,
  source: 1,
  attachment: 2,
  artifact: 3,
  annotation: 4,
};

export function compareSearchSurfacePriority(
  left: SearchMatchSurface,
  right: SearchMatchSurface
): number {
  return SEARCH_SURFACE_PRIORITY[left] - SEARCH_SURFACE_PRIORITY[right];
}

export function getSearchMatchHintLabel(surface: SearchMatchSurface): string {
  switch (surface) {
    case "source":
      return "Matched in sources";
    case "attachment":
      return "Matched in attachments";
    case "artifact":
      return "Matched in artifacts";
    case "annotation":
      return "Matched in notes";
    case "body":
    default:
      return "Matched in messages";
  }
}

export function buildSearchExcerpt(text: string, normalizedQuery: string): string {
  const lower = text.toLowerCase();
  let idx = lower.indexOf(normalizedQuery);
  let matchLen = normalizedQuery.length;
  if (idx < 0) {
    // Non-contiguous multi-term match (e.g. "design database" matching a doc that
    // says "database … design"): anchor the excerpt on the earliest matched token.
    let best = -1;
    for (const token of tokenize(normalizedQuery)) {
      const at = lower.indexOf(token);
      if (at >= 0 && (best < 0 || at < best)) {
        best = at;
        matchLen = token.length;
      }
    }
    if (best < 0) {
      return "";
    }
    idx = best;
  }

  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + matchLen + 60);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export function buildMessageSearchEntries(
  message: MessageSearchProjectionLike
): MessageSearchEntry[] {
  const entries: MessageSearchEntry[] = [];
  const bodyText = resolveCanonicalBodyText(message);
  if (bodyText) {
    entries.push({
      surface: "body",
      messageId: message.id,
      targetKey: `msg-${message.id}:body`,
      text: bodyText,
    });
  }

  (message.citations ?? []).forEach((citation, index) => {
    const value = [`Source: ${citation.label}`, citation.host ? `(${citation.host})` : ""]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!value) {
      return;
    }

    entries.push({
      surface: "source",
      messageId: message.id,
      targetKey: `msg-${message.id}:source[${index}]`,
      text: value,
    });
  });

  (message.attachments ?? []).forEach((attachment, index) => {
    const value = [
      `Attachment: ${attachment.indexAlt}`,
      attachment.label && attachment.label !== attachment.indexAlt ? `- ${attachment.label}` : "",
      attachment.mime ? `(${attachment.mime})` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!value) {
      return;
    }

    entries.push({
      surface: "attachment",
      messageId: message.id,
      targetKey: `msg-${message.id}:attachment[${index}]`,
      text: value,
    });
  });

  (message.artifacts ?? []).forEach((artifact, index) => {
    const title = artifact.label ?? artifact.kind;
    const descriptor = formatArtifactDescriptor(artifact);
    const summary = [`Artifact: ${title}`, descriptor ? `(${descriptor})` : ""]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (summary) {
      entries.push({
        surface: "artifact",
        messageId: message.id,
        targetKey: `msg-${message.id}:artifact[${index}]:summary`,
        text: summary,
      });
    }

    const excerpt = getArtifactExcerptText(artifact, {
      maxLines: 2,
      maxCharsPerLine: 120,
      separator: " | ",
    });
    if (excerpt) {
      entries.push({
        surface: "artifact",
        messageId: message.id,
        targetKey: `msg-${message.id}:artifact[${index}]:excerpt`,
        text: excerpt,
      });
    }
  });

  return entries;
}

export function buildAnnotationSearchEntry(
  annotation: Pick<AnnotationRecord, "message_id" | "content_text"> & { id?: number }
): AnnotationSearchEntry | null {
  const text = annotation.content_text.trim();
  if (!text || typeof annotation.message_id !== "number") {
    return null;
  }

  return {
    surface: "annotation",
    messageId: annotation.message_id,
    targetKey: `msg-${annotation.message_id}:annotation[${annotation.id ?? 0}]`,
    text,
  };
}
