// Kimi (www.kimi.com / kimi.com / kimi.moonshot.cn) historical-import provider.
//
// Uses Kimi's own web backend API from the content script (same origin as the
// page, so `credentials: "include"` attaches the session cookies), plus the
// Bearer access_token the web app stores in page localStorage ("access_token"
// key). Read-only: every endpoint below only queries data. The two POST calls
// are RPC-style reads (list/scroll), not state mutations.
//   probe:  GET  /api/user                                   → logged-in check
//   list:   POST /api/chat/list           body {offset, size} → {total, items}
//           (GET /api/chat/list?offset&size fallback on 404/405; the GET form
//           is the historically documented one, POST is what third-party
//           clients use today — both confirmed against public sources)
//   detail: POST /api/chat/{id}/segment/scroll  body {last}   → {total, items}
//   refresh: GET /api/auth/token/refresh  (Bearer refresh_token; used ONLY to
//           recover from a 401, mirroring the web app's own token rotation —
//           the rotated pair is written back to localStorage, nothing is sent
//           to the platform beyond the read itself)
//
// Field-shape confidence (from public reverse-engineered clients such as
// kimi-free-api / revKimi / zotero-paper-agent, not from first-party docs):
//   confirmed: chat id, list items[].id, segment items[].role/.content,
//              token storage in localStorage, Bearer auth scheme.
//   inferred (parsed defensively): title as name|title, timestamps as
//              created_at|updated_at|create_time|update_time (ISO or epoch
//              s/ms). Segments are assumed chronological (oldest → newest), as
//              third-party clients render them in returned order.
// `segment/scroll` returns the LAST N segments; we ask for 1000 which covers
// virtually all threads — longer threads are truncated (oldest messages lost).

import type { ParsedMessage } from "../../messaging/protocol";
import { logger } from "../../utils/logger";
import {
  buildConversationDraft,
  type HistoryConversation,
  type HistoryConversationRef,
  type HistoryProvider,
  type ListOptions,
} from "./types";

const PAGE_LIMIT = 50;
const MAX_PAGES = 200; // hard safety cap (~10000 conversations)
const SEGMENT_FETCH_SIZE = 1000; // single-shot history window per conversation

interface ChatListItem {
  id?: string;
  name?: string;
  title?: string;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  create_time?: string | number | null;
  update_time?: string | number | null;
}

interface ChatListResponse {
  total?: number;
  items?: ChatListItem[];
}

interface SegmentItem {
  id?: string;
  role?: string;
  content?: string | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  create_time?: string | number | null;
}

interface SegmentScrollResponse {
  total?: number;
  items?: SegmentItem[];
}

interface RefreshResponse {
  access_token?: string;
  refresh_token?: string;
}

type TokenKind = "access_token" | "refresh_token";

function toMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    // Could be epoch seconds or milliseconds depending on the endpoint.
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Strip the JSON-style quotes some apps wrap around stored token strings. */
function normalizeToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function createKimiHistoryProvider(): HistoryProvider {
  // Same provider serves all Kimi hosts; stay on the page's own origin.
  const origin = window.location.origin || "https://www.kimi.com";
  // Remembers where tokens were actually found so a refresh writes them back
  // to the same keys.
  const tokenKeys: Record<TokenKind, string> = {
    access_token: "access_token",
    refresh_token: "refresh_token",
  };

  const readToken = (kind: TokenKind): string | null => {
    try {
      const direct = window.localStorage.getItem(tokenKeys[kind]);
      if (direct) return normalizeToken(direct);
      // Fallback: some deployments prefix keys (e.g. "kimi.access_token").
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key || !key.toLowerCase().includes(kind)) continue;
        const value = window.localStorage.getItem(key);
        if (value) {
          tokenKeys[kind] = key;
          return normalizeToken(value);
        }
      }
    } catch {
      // Storage access can throw in hardened contexts.
    }
    return null;
  };

  const refreshTokens = async (signal?: AbortSignal): Promise<boolean> => {
    const stored = readToken("refresh_token");
    if (!stored) return false;
    try {
      const res = await fetch(`${origin}/api/auth/token/refresh`, {
        credentials: "include",
        headers: { Accept: "application/json", Authorization: `Bearer ${stored}` },
        signal,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as RefreshResponse;
      if (!data.access_token) return false;
      window.localStorage.setItem(tokenKeys.access_token, data.access_token);
      if (data.refresh_token) {
        window.localStorage.setItem(tokenKeys.refresh_token, data.refresh_token);
      }
      return true;
    } catch {
      return false;
    }
  };

  const authedFetch = async (
    path: string,
    init: { body?: unknown } = {},
    signal?: AbortSignal,
    allowRefresh = true,
  ): Promise<Response> => {
    const token = readToken("access_token");
    if (!token) throw new Error("no_access_token");
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${origin}${path}`, {
      method: init.body !== undefined ? "POST" : "GET",
      credentials: "include",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    });
    // One recovery attempt on an expired access_token, like the web app does.
    if (res.status === 401 && allowRefresh && (await refreshTokens(signal))) {
      return authedFetch(path, init, signal, false);
    }
    return res;
  };

  // POST is what third-party clients use; GET is the historically documented
  // form. Auto-detect once, then stick with whichever the server accepts.
  let listViaGet: boolean | null = null;
  const listPage = async (offset: number, signal?: AbortSignal): Promise<Response> => {
    if (listViaGet !== true) {
      const res = await authedFetch(
        "/api/chat/list",
        { body: { offset, size: PAGE_LIMIT } },
        signal,
      );
      if (res.status !== 404 && res.status !== 405) {
        listViaGet = false;
        return res;
      }
      listViaGet = true;
    }
    return authedFetch(`/api/chat/list?offset=${offset}&size=${PAGE_LIMIT}`, {}, signal);
  };

  return {
    platform: "Kimi",

    async isAvailable() {
      try {
        if (!readToken("access_token")) return false;
        const res = await authedFetch("/api/user");
        // 404: endpoint may differ across hosts; token presence still counts.
        return res.ok || res.status === 404;
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
        const res = await listPage(offset, options.signal);
        if (!res.ok) throw new Error(`list ${res.status}`);
        const data = (await res.json()) as ChatListResponse;
        const items = data.items ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          if (!item.id) continue;
          refs.push({
            id: item.id,
            title: item.name ?? item.title,
            createdAt: toMs(item.created_at ?? item.create_time),
            updatedAt: toMs(item.updated_at ?? item.update_time),
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
      const res = await authedFetch(
        `/api/chat/${ref.id}/segment/scroll`,
        { body: { last: SEGMENT_FETCH_SIZE } },
        signal,
      );
      if (!res.ok) throw new Error(`detail ${res.status}`);
      const data = (await res.json()) as SegmentScrollResponse;
      const items = data.items ?? [];

      const messages: ParsedMessage[] = [];
      for (const item of items) {
        const role = item.role === "user" ? "user" : item.role === "assistant" ? "ai" : null;
        if (!role) continue;
        const text = (item.content ?? "").trim();
        if (!text) continue;
        messages.push({
          role,
          textContent: text,
          timestamp: toMs(item.created_at ?? item.create_time) ?? undefined,
        });
      }

      if (messages.length === 0) return null;

      const firstTs = messages[0]?.timestamp ?? null;
      const lastTs = messages[messages.length - 1]?.timestamp ?? null;
      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "Kimi",
        title: ref.title ?? "",
        url: `${origin}/chat/${ref.id}`,
        messages,
        sourceCreatedAt: ref.createdAt ?? firstTs,
        sourceUpdatedAt: ref.updatedAt ?? lastTs,
      });

      logger.debug("content", "Kimi history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
