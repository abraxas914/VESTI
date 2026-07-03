// Claude (claude.ai) historical-import provider.
//
// Uses claude.ai's own API with the page's session cookies (no bearer token).
//   org:    GET /api/organizations               → pick a chat-capable org
//   list:   GET /api/organizations/{org}/chat_conversations?limit&offset
//   detail: GET /api/organizations/{org}/chat_conversations/{uuid}
//             ?tree=True&rendering_mode=raw       → chat_messages[]
// Read-only.

import type { ParsedMessage } from "../../messaging/protocol";
import { logger } from "../../utils/logger";
import {
  buildConversationDraft,
  type HistoryConversation,
  type HistoryConversationRef,
  type HistoryProvider,
  type ListOptions,
} from "./types";

const PAGE_LIMIT = 30;
const MAX_PAGES = 200;

interface Org {
  uuid?: string;
  capabilities?: string[];
}

interface ListItem {
  uuid: string;
  name?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ContentBlock {
  type?: string;
  text?: string;
}

interface ChatMessage {
  uuid?: string;
  text?: string;
  sender?: string; // "human" | "assistant"
  created_at?: string | null;
  content?: ContentBlock[];
}

interface DetailResponse {
  name?: string;
  created_at?: string | null;
  updated_at?: string | null;
  chat_messages?: ChatMessage[];
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageText(msg: ChatMessage): string {
  if (Array.isArray(msg.content)) {
    const chunks = msg.content
      .filter((b) => (b?.type ?? "text") === "text" && typeof b.text === "string")
      .map((b) => (b.text as string).trim())
      .filter(Boolean);
    if (chunks.length > 0) return chunks.join("\n").trim();
  }
  return (msg.text ?? "").trim();
}

export function createClaudeHistoryProvider(): HistoryProvider {
  const origin = "https://claude.ai";
  let cachedOrg: string | null = null;

  const getOrg = async (signal?: AbortSignal): Promise<string> => {
    if (cachedOrg) return cachedOrg;
    const res = await fetch(`${origin}/api/organizations`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) throw new Error(`orgs ${res.status}`);
    const orgs = (await res.json()) as Org[];
    const chatOrg =
      orgs.find((o) => o.uuid && (o.capabilities?.includes("chat") ?? true)) ?? orgs[0];
    if (!chatOrg?.uuid) throw new Error("no_org");
    cachedOrg = chatOrg.uuid;
    return cachedOrg;
  };

  const api = async (path: string, signal?: AbortSignal): Promise<Response> =>
    fetch(`${origin}${path}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });

  return {
    platform: "Claude",

    async isAvailable() {
      try {
        return !!(await getOrg());
      } catch {
        return false;
      }
    },

    async listConversations(options: ListOptions = {}): Promise<HistoryConversationRef[]> {
      const org = await getOrg(options.signal);
      const refs: HistoryConversationRef[] = [];
      const max = options.max ?? Infinity;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (options.signal?.aborted) break;
        const offset = page * PAGE_LIMIT;
        const res = await api(
          `/api/organizations/${org}/chat_conversations?limit=${PAGE_LIMIT}&offset=${offset}`,
          options.signal,
        );
        if (!res.ok) throw new Error(`list ${res.status}`);
        const items = (await res.json()) as ListItem[];
        if (!Array.isArray(items) || items.length === 0) break;
        for (const item of items) {
          if (!item.uuid) continue;
          refs.push({
            id: item.uuid,
            title: item.name,
            createdAt: toMs(item.created_at),
            updatedAt: toMs(item.updated_at),
          });
          if (refs.length >= max) break;
        }
        options.onDiscover?.(refs.length);
        if (refs.length >= max || items.length < PAGE_LIMIT) break;
      }
      return refs;
    },

    async fetchConversation(
      ref: HistoryConversationRef,
      signal?: AbortSignal,
    ): Promise<HistoryConversation | null> {
      const org = await getOrg(signal);
      const res = await api(
        `/api/organizations/${org}/chat_conversations/${ref.id}?tree=True&rendering_mode=raw`,
        signal,
      );
      if (!res.ok) throw new Error(`detail ${res.status}`);
      const data = (await res.json()) as DetailResponse;
      const chatMessages = data.chat_messages ?? [];

      const messages: ParsedMessage[] = [];
      for (const msg of chatMessages) {
        const role: "user" | "ai" = msg.sender === "assistant" ? "ai" : "user";
        const text = messageText(msg);
        if (!text) continue;
        messages.push({
          role,
          textContent: text,
          timestamp: toMs(msg.created_at) ?? undefined,
        });
      }

      if (messages.length === 0) return null;

      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "Claude",
        title: data.name ?? ref.title ?? "",
        url: `${origin}/chat/${ref.id}`,
        messages,
        sourceCreatedAt: toMs(data.created_at) ?? ref.createdAt ?? null,
        sourceUpdatedAt: toMs(data.updated_at) ?? ref.updatedAt ?? null,
      });

      logger.debug("content", "Claude history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
