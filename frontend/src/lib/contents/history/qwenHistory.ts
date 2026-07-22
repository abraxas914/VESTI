// Qwen (chat.qwen.ai, international) historical-import provider.
//
// Uses Qwen's own web backend API from the content script (same origin as the
// page, so `credentials: "include"` attaches the session cookies), plus the
// Bearer token the web app stores in page localStorage ("token" key) when
// present. Read-only: both endpoints below only query data.
//   list:   GET /api/v2/chats/?page={n}&exclude_project=true   (1-indexed)
//           → { success, data: [{ id, title, created_at, updated_at, ... }] }
//   detail: GET /api/v2/chats/{id}
//           → { success, data: { title, created_at, updated_at,
//               chat: { history: { messages: {id→msg}, current_id } } } }
// Extra headers mirror the web frontend: source: "web" + a random X-Request-Id.
//
// Field-shape confidence (from actively maintained third-party clients of this
// API — the Qwen2API Go proxy, the ophel browser extension (which calls the
// list endpoint from page context exactly as below) and the qwen-api proxy
// README documenting localStorage "token" + Bearer — not from first-party docs):
//   confirmed: list endpoint + 1-indexed ?page= pagination, list item id/title,
//              Bearer token in localStorage, conversation URL /c/{id}.
//   inferred (parsed defensively): Open WebUI-style detail payload
//              (data.chat.history.messages as an id→message map with
//              role/content/timestamp (epoch s), current_id marking the active
//              branch leaf); server-fixed page size (we stop on an empty or
//              fully duplicate page). Edited-out sibling branches are excluded
//              by walking the current branch; without current_id we fall back
//              to all messages sorted by timestamp.

import type { ParsedMessage } from "../../messaging/protocol";
import { logger } from "../../utils/logger";
import {
  buildConversationDraft,
  type HistoryConversation,
  type HistoryConversationRef,
  type HistoryProvider,
  type ListOptions,
} from "./types";

const MAX_PAGES = 200; // hard safety cap (page size is server-fixed)
const TOKEN_STORAGE_KEY = "token";

interface ListItem {
  id?: string;
  title?: string;
  created_at?: string | number | null;
  updated_at?: string | number | null;
}

interface ListResponse {
  success?: boolean;
  data?: ListItem[] | null;
}

interface ChatMessageRecord {
  id?: string;
  role?: string;
  content?: unknown; // string, or an array of {type:"text", text} parts
  timestamp?: string | number | null;
  created_at?: string | number | null;
  parentId?: string | null;
}

interface DetailChat {
  title?: string;
  timestamp?: string | number | null;
  history?: {
    current_id?: string | null;
    messages?: Record<string, ChatMessageRecord> | ChatMessageRecord[] | null;
  } | null;
  messages?: ChatMessageRecord[] | null;
}

interface DetailData {
  id?: string;
  title?: string;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  chat?: DetailChat | null;
}

interface DetailResponse {
  success?: boolean;
  data?: DetailData | null;
}

function toMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    // Backend uses epoch SECONDS; tolerate milliseconds just in case.
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageTs(msg: ChatMessageRecord): number {
  return toMs(msg.timestamp ?? msg.created_at) ?? 0;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        if (part.trim()) chunks.push(part);
      } else if (part && typeof part === "object") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) chunks.push(text);
      }
    }
    return chunks.join("\n").trim();
  }
  return "";
}

/** Strip the JSON-style quotes some apps wrap around stored token strings. */
function normalizeToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Linearise the detail payload. Preferred shape is an id→message map plus a
 * `current_id` pointer to the active branch leaf: walk parentId up from there
 * so edited-out sibling branches stay excluded. Falls back to every message
 * in chronological order, then to a flat array form.
 */
function resolveOrderedMessages(chat: DetailChat | null | undefined): ChatMessageRecord[] {
  const history = chat?.history;
  const raw = history?.messages ?? chat?.messages ?? null;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  const byId = new Map<string, ChatMessageRecord>();
  for (const [key, msg] of Object.entries(raw)) {
    if (msg && typeof msg === "object") byId.set(key, msg);
  }
  if (byId.size === 0) return [];

  const currentId = typeof history?.current_id === "string" ? history.current_id : null;
  if (currentId && byId.has(currentId)) {
    const branch: ChatMessageRecord[] = [];
    const seen = new Set<string>();
    let cursor: string | null = currentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const msg = byId.get(cursor);
      if (!msg) break;
      branch.push(msg);
      cursor = typeof msg.parentId === "string" ? msg.parentId : null;
    }
    if (branch.length > 0) return branch.reverse();
  }

  return Array.from(byId.values()).sort((a, b) => messageTs(a) - messageTs(b));
}

export function createQwenHistoryProvider(): HistoryProvider {
  const origin = "https://chat.qwen.ai";

  const readToken = (): string | null => {
    try {
      const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      if (raw && raw.trim()) return normalizeToken(raw);
    } catch {
      // Storage access can throw in hardened contexts.
    }
    return null;
  };

  const api = async (path: string, signal?: AbortSignal): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      source: "web",
      "X-Request-Id": crypto.randomUUID(),
    };
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${origin}${path}`, {
      credentials: "include",
      headers,
      signal,
    });
  };

  return {
    platform: "Qwen",

    async isAvailable() {
      try {
        if (readToken()) return true;
        // The session may live only in cookies; probe the list endpoint once.
        const res = await api("/api/v2/chats/?page=1&exclude_project=true");
        return res.ok;
      } catch {
        return false;
      }
    },

    async listConversations(options: ListOptions = {}): Promise<HistoryConversationRef[]> {
      const refs: HistoryConversationRef[] = [];
      const seen = new Set<string>();
      const max = options.max ?? Infinity;
      // Pages are 1-indexed and server-sized; an empty (or fully duplicate)
      // page marks the end.
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        if (options.signal?.aborted) break;
        const res = await api(`/api/v2/chats/?page=${page}&exclude_project=true`, options.signal);
        if (!res.ok) throw new Error(`list ${res.status}`);
        const data = (await res.json()) as ListResponse;
        if (data.success === false) throw new Error("list failed");
        const items = Array.isArray(data.data) ? data.data : [];
        if (items.length === 0) break;
        let newCount = 0;
        for (const item of items) {
          if (!item.id || seen.has(item.id)) continue;
          seen.add(item.id);
          refs.push({
            id: item.id,
            title: item.title,
            createdAt: toMs(item.created_at),
            updatedAt: toMs(item.updated_at),
          });
          newCount += 1;
          if (refs.length >= max) break;
        }
        options.onDiscover?.(refs.length);
        if (refs.length >= max || newCount === 0) break;
      }
      return refs;
    },

    async fetchConversation(
      ref: HistoryConversationRef,
      signal?: AbortSignal,
    ): Promise<HistoryConversation | null> {
      const res = await api(`/api/v2/chats/${encodeURIComponent(ref.id)}`, signal);
      if (!res.ok) throw new Error(`detail ${res.status}`);
      const payload = (await res.json()) as DetailResponse;
      if (payload.success === false) throw new Error("detail failed");
      const data: DetailData = payload.data ?? {};

      const messages: ParsedMessage[] = [];
      for (const msg of resolveOrderedMessages(data.chat)) {
        const role = msg.role === "user" ? "user" : msg.role === "assistant" ? "ai" : null;
        if (!role) continue;
        const text = contentToText(msg.content);
        if (!text) continue;
        messages.push({
          role,
          textContent: text,
          timestamp: toMs(msg.timestamp ?? msg.created_at) ?? undefined,
        });
      }

      if (messages.length === 0) return null;

      const firstTs = messages[0]?.timestamp ?? null;
      const lastTs = messages[messages.length - 1]?.timestamp ?? null;
      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "Qwen",
        title: data.title ?? data.chat?.title ?? ref.title ?? "",
        url: `${origin}/c/${ref.id}`,
        messages,
        sourceCreatedAt:
          toMs(data.created_at ?? data.chat?.timestamp ?? null) ?? ref.createdAt ?? firstTs,
        sourceUpdatedAt: toMs(data.updated_at) ?? ref.updatedAt ?? lastTs,
      });

      logger.debug("content", "Qwen history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
