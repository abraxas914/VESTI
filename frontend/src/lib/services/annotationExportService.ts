import type { Note } from "../types";
import {
  createNote,
  getAnnotationExportContext,
  listNotes,
  updateNote,
} from "../db/repository";
import {
  disconnectNotion,
  getNotionSettings,
} from "./notionSettingsService";
import {
  buildMessageFallbackDisplayText,
  buildMessagePreviewText,
} from "../utils/messageContentPackage";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const ANNOTATION_NOTE_HEADER = "# Annotation Review";
const ANNOTATION_TIMELINE_HEADER = "## Annotation Timeline";

type NotionDatabaseProperty = {
  id: string;
  type: string;
};

type NotionDatabaseResponse = {
  properties?: Record<string, NotionDatabaseProperty>;
};

function formatLocalDate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function truncate(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildAnnotationMarker(annotationId: number): string {
  return `<!-- vesti-annotation-id:${annotationId} -->`;
}

function getAnchorRoleLabel(
  data: Awaited<ReturnType<typeof getAnnotationExportContext>>
): string {
  return data.message.role === "user" ? "You" : data.conversation.platform;
}

function buildAnnotationEntry(
  annotationId: number,
  data: Awaited<ReturnType<typeof getAnnotationExportContext>>
): string {
  const roleLabel = getAnchorRoleLabel(data);

  return [
    `### ${formatLocalDate(data.annotation.created_at)} · ${data.annotation.days_after} ${
      data.annotation.days_after === 1 ? "day" : "days"
    } after`,
    "",
    buildAnnotationMarker(annotationId),
    "",
    `#### Anchor Message`,
    "",
    `Role: ${roleLabel}`,
    "",
    buildMessageFallbackDisplayText(data.message),
    "",
    `#### Annotation`,
    "",
    data.annotation.content_text,
  ].join("\n");
}

function buildAnnotationCollectionTitle(title: string): string {
  return truncate(`Annotations - ${title}`, 96) || "Annotations";
}

function buildAnnotationPageTitle(title: string): string {
  return truncate(`Annotation - ${title}`, 96) || "Annotation";
}

function buildAnnotationNoteContent(
  annotationId: number,
  data: Awaited<ReturnType<typeof getAnnotationExportContext>>
): string {
  const conversationDate = data.conversation.source_created_at ?? data.conversation.created_at;

  return [
    ANNOTATION_NOTE_HEADER,
    "",
    `Conversation: ${data.conversation.title}`,
    `Platform: ${data.conversation.platform}`,
    `Conversation Date: ${formatLocalDate(conversationDate)}`,
    ...(data.conversation.url ? [`Source URL: ${data.conversation.url}`] : []),
    "",
    ANNOTATION_TIMELINE_HEADER,
    "",
    buildAnnotationEntry(annotationId, data),
  ].join("\n");
}

function findAnnotationTimelineMarker(content: string): boolean {
  return content.includes(ANNOTATION_NOTE_HEADER) && content.includes(ANNOTATION_TIMELINE_HEADER);
}

function appendAnnotationEntry(existingContent: string, entry: string): string {
  const trimmed = existingContent.trimEnd();
  if (!trimmed) {
    return entry;
  }
  return `${trimmed}\n\n---\n\n${entry}`;
}

export async function notionRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;

  if (!response.ok) {
    if (response.status === 401) {
      await disconnectNotion().catch(() => undefined);
      throw new Error("NOTION_RECONNECT_REQUIRED");
    }
    throw new Error(payload?.message || `NOTION_${response.status}`);
  }

  return payload as T;
}

export async function getDatabaseTitlePropertyName(
  databaseId: string,
  token: string
): Promise<string> {
  const payload = await notionRequest<NotionDatabaseResponse>(`/databases/${databaseId}`, token, {
    method: "GET",
  });

  const propertyEntry = Object.entries(payload.properties ?? {}).find(
    ([, property]) => property?.type === "title"
  );

  if (!propertyEntry) {
    throw new Error("NOTION_TITLE_PROPERTY_NOT_FOUND");
  }

  return propertyEntry[0];
}

export async function exportAnnotationToMyNotes(annotationId: number): Promise<Note> {
  const context = await getAnnotationExportContext(annotationId);
  const notes = await listNotes();
  const existingNote = notes.find(
    (note) =>
      note.linked_conversation_ids.includes(context.conversation.id) &&
      findAnnotationTimelineMarker(note.content)
  );
  const annotationIdMarker = buildAnnotationMarker(annotationId);

  if (existingNote) {
    if (existingNote.content.includes(annotationIdMarker)) {
      return existingNote;
    }

    return updateNote(existingNote.id, {
      content: appendAnnotationEntry(
        existingNote.content,
        buildAnnotationEntry(annotationId, context)
      ),
    });
  }

  return createNote({
    title: buildAnnotationCollectionTitle(context.conversation.title),
    content: buildAnnotationNoteContent(annotationId, context),
    linked_conversation_ids: [context.conversation.id],
  });
}

export async function exportAnnotationToNotion(
  annotationId: number
): Promise<{ pageId: string; url?: string }> {
  const settings = await getNotionSettings();
  const notionToken = settings.accessToken.trim();
  const databaseId = settings.selectedDatabaseId.trim();

  if (!notionToken || !databaseId) {
    throw new Error("NOTION_SETTINGS_MISSING");
  }

  const context = await getAnnotationExportContext(annotationId);
  const titleProperty = await getDatabaseTitlePropertyName(databaseId, notionToken);
  const conversationDate = context.conversation.source_created_at ?? context.conversation.created_at;
  const excerpt =
    truncate(buildMessagePreviewText(context.message, { maxChars: 100 }), 100) ||
    "(No message content)";

  const payload = await notionRequest<{ id: string; url?: string }>(`/pages`, notionToken, {
    method: "POST",
    body: JSON.stringify({
      parent: {
        database_id: databaseId,
      },
      properties: {
        [titleProperty]: {
          title: [
            {
              text: {
                content: buildAnnotationPageTitle(context.conversation.title),
              },
            },
          ],
        },
      },
      children: [
        {
          object: "block",
          type: "callout",
          callout: {
            icon: {
              type: "emoji",
              emoji: "💬",
            },
            rich_text: [
              {
                type: "text",
                text: {
                  content: excerpt,
                },
              },
            ],
            color: "gray_background",
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: context.annotation.content_text,
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `Written ${context.annotation.days_after} ${
                    context.annotation.days_after === 1 ? "day" : "days"
                  } after the conversation`,
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `Platform: ${context.conversation.platform}`,
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `Conversation date: ${formatLocalDate(conversationDate)}`,
                },
              },
            ],
          },
        },
      ],
    }),
  });

  return {
    pageId: payload.id,
    url: payload.url,
  };
}
