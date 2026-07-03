// "Send to Notion" for a whole conversation or its summary. The caller (reader)
// builds the Markdown — this transports it: Markdown → Notion blocks → a new page
// under the user's selected database. Runs in the background context (fetch +
// Notion settings live there). No DB access: the markdown arrives ready.

import { getNotionSettings } from "./notionSettingsService";
import {
  getDatabaseTitlePropertyName,
  notionRequest,
} from "./annotationExportService";
import { chunkNotionChildren, markdownToNotionBlocks } from "./markdownToNotionBlocks";

export interface ConversationNotionExportInput {
  title: string;
  markdown: string;
}

export async function exportConversationToNotion(
  input: ConversationNotionExportInput,
): Promise<{ pageId: string; url?: string }> {
  const settings = await getNotionSettings();
  const notionToken = settings.accessToken.trim();
  const databaseId = settings.selectedDatabaseId.trim();
  if (!notionToken || !databaseId) {
    throw new Error("NOTION_SETTINGS_MISSING");
  }

  const titleProperty = await getDatabaseTitlePropertyName(databaseId, notionToken);
  const blocks = markdownToNotionBlocks(input.markdown);
  const chunks = chunkNotionChildren(blocks);
  const firstChunk = chunks[0] ?? [];

  const page = await notionRequest<{ id: string; url?: string }>(`/pages`, notionToken, {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        [titleProperty]: {
          title: [{ text: { content: (input.title || "VESTI export").slice(0, 2000) } }],
        },
      },
      children: firstChunk,
    }),
  });

  // Notion caps children at 100 per request; append the rest in order.
  for (let i = 1; i < chunks.length; i += 1) {
    await notionRequest(`/blocks/${page.id}/children`, notionToken, {
      method: "PATCH",
      body: JSON.stringify({ children: chunks[i] }),
    });
  }

  return { pageId: page.id, url: page.url };
}
