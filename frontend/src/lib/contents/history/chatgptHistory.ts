// ChatGPT historical-import provider.
//
// Uses ChatGPT's own backend API, authenticated with the access token from
// /api/auth/session plus the page's session cookies. Read-only.
//   list:   GET /backend-api/conversations?offset&limit&order=updated
//   detail: GET /backend-api/conversation/{id}  (a node "mapping" tree)
// The detail tree can branch (edited messages); we linearise by taking every
// user/assistant text node and ordering by create_time, which reconstructs a
// faithful read of the thread for archival.

import type { ParsedMessage } from "../../messaging/protocol";
import { logger } from "../../utils/logger";
import {
  buildConversationDraft,
  type HistoryConversation,
  type HistoryConversationRef,
  type HistoryProvider,
  type ListOptions,
} from "./types";

const PAGE_LIMIT = 28;
const MAX_PAGES = 200; // hard safety cap (~5600 conversations)

interface SessionResponse {
  accessToken?: string;
}

interface ListItem {
  id: string;
  title?: string;
  create_time?: string | number | null;
  update_time?: string | number | null;
}

interface ListResponse {
  items?: ListItem[];
  total?: number;
}

interface MappingNode {
  id?: string;
  message?: {
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
    create_time?: number | null;
  } | null;
  parent?: string | null;
  children?: string[];
}

interface DetailResponse {
  title?: string;
  create_time?: number | null;
  update_time?: number | null;
  mapping?: Record<string, MappingNode>;
}

function toMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    // Backend uses epoch SECONDS (float); list endpoint sometimes ISO strings.
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function partsToText(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      if (part.trim()) chunks.push(part);
    } else if (part && typeof part === "object") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

export function createChatGptHistoryProvider(): HistoryProvider {
  const origin = "https://chatgpt.com";
  let cachedToken: string | null = null;

  const getToken = async (signal?: AbortSignal): Promise<string> => {
    if (cachedToken) return cachedToken;
    const res = await fetch(`${origin}/api/auth/session`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) throw new Error(`session ${res.status}`);
    const data = (await res.json()) as SessionResponse;
    if (!data.accessToken) throw new Error("no_access_token");
    cachedToken = data.accessToken;
    return cachedToken;
  };

  const authedFetch = async (path: string, signal?: AbortSignal): Promise<Response> => {
    const token = await getToken(signal);
    return fetch(`${origin}${path}`, {
      credentials: "include",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal,
    });
  };

  return {
    platform: "ChatGPT",

    async isAvailable() {
      try {
        const token = await getToken();
        return !!token;
      } catch {
        return false;
      }
    },

    async listConversations(options: ListOptions = {}): Promise<HistoryConversationRef[]> {
      const refs: HistoryConversationRef[] = [];
      const max = options.max ?? Infinity;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (options.signal?.aborted) break;
        const offset = page * PAGE_LIMIT;
        const res = await authedFetch(
          `/backend-api/conversations?offset=${offset}&limit=${PAGE_LIMIT}&order=updated`,
          options.signal,
        );
        if (!res.ok) throw new Error(`list ${res.status}`);
        const data = (await res.json()) as ListResponse;
        const items = data.items ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          if (!item.id) continue;
          refs.push({
            id: item.id,
            title: item.title,
            createdAt: toMs(item.create_time),
            updatedAt: toMs(item.update_time),
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
      const res = await authedFetch(`/backend-api/conversation/${ref.id}`, signal);
      if (!res.ok) throw new Error(`detail ${res.status}`);
      const data = (await res.json()) as DetailResponse;
      const mapping = data.mapping ?? {};

      const collected: Array<{ role: "user" | "ai"; text: string; ts: number }> = [];
      for (const node of Object.values(mapping)) {
        const msg = node?.message;
        if (!msg) continue;
        const role = msg.author?.role;
        if (role !== "user" && role !== "assistant") continue;
        const contentType = msg.content?.content_type;
        if (contentType && contentType !== "text" && contentType !== "multimodal_text") {
          continue;
        }
        const text = partsToText(msg.content?.parts);
        if (!text) continue;
        collected.push({
          role: role === "user" ? "user" : "ai",
          text,
          ts: toMs(msg.create_time ?? null) ?? 0,
        });
      }

      if (collected.length === 0) return null;
      collected.sort((a, b) => a.ts - b.ts);

      const messages: ParsedMessage[] = collected.map((c) => ({
        role: c.role,
        textContent: c.text,
        timestamp: c.ts || undefined,
      }));

      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "ChatGPT",
        title: data.title ?? ref.title ?? "",
        url: `${origin}/c/${ref.id}`,
        messages,
        sourceCreatedAt: toMs(data.create_time ?? null) ?? ref.createdAt ?? null,
        sourceUpdatedAt: toMs(data.update_time ?? null) ?? ref.updatedAt ?? null,
      });

      logger.debug("content", "ChatGPT history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
