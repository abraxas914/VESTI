// DeepSeek (chat.deepseek.com) historical-import provider.
//
// Uses DeepSeek's own web backend API from the content script (same origin as
// the page, so `credentials: "include"` attaches the session cookies), plus the
// Bearer token the web app stores in page localStorage ("userToken" key — the
// value may be a plain string or JSON like {"value": "..."}).
// Read-only: every endpoint below is a GET that only queries data.
//   probe:  GET /api/v0/chat_session/fetch_page?count=1   → logged-in check
//   list:   GET /api/v0/chat_session/fetch_page?count=50
//                 [&lte_cursor.pinned=0|1&lte_cursor.updated_at=<epoch s>]
//           → data.biz_data.{chat_sessions[], has_more}; newest first, cursor
//             paginated (cursor = last item's {pinned, updated_at}, INCLUSIVE,
//             so ids are deduped client-side)
//   detail: GET /api/v0/chat/history_messages?chat_session_id={id}
//           → data.biz_data.chat_messages[]
// All responses share the envelope {code, msg, data:{biz_code, biz_msg,
// biz_data}}; code !== 0 (or biz_code !== 0 when present) means failure
// (40002/40003 = token expired).
//
// Field-shape confidence (from third-party in-page/proxy clients — the
// ds-enhance and DeepSeek-backup-web userscripts and the deepseek2api proxy,
// which call these exact endpoints from chat.deepseek.com pages — not from
// first-party docs):
//   confirmed: endpoint paths, Bearer auth via localStorage "userToken",
//              envelope shape, list chat_sessions[].id/.title/.updated_at
//              (epoch seconds float) + has_more + lte_cursor pagination,
//              detail chat_messages[].message_id/.role ("USER"|"ASSISTANT")
//              /.content/.status ("in_progress" while streaming).
//   inferred (parsed defensively): message timestamps as inserted_at|
//              updated_at epoch seconds (consistent with every other biz_data
//              entity; toMs tolerates s/ms either way), list inserted_at as
//              the thread creation time, chronological (oldest → newest)
//              message order (third-party exporters render returned order).
// The X-App-Version header mirrors what the web app sends; the exact version
// string is not validated today but may need a bump if DeepSeek starts
// enforcing it.

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
const APP_VERSION = "2025.04.25"; // mirrors the web client's x-app-version

interface ApiEnvelope<T> {
  code?: number;
  msg?: string;
  data?: {
    biz_code?: number;
    biz_msg?: string;
    biz_data?: T;
  };
}

interface SessionItem {
  id?: string;
  title?: string | null;
  pinned?: boolean | number | null;
  inserted_at?: number | string | null;
  updated_at?: number | string | null;
}

interface SessionPage {
  chat_sessions?: SessionItem[];
  has_more?: boolean;
}

interface HistoryMessage {
  message_id?: string;
  parent_id?: string | null;
  role?: string;
  content?: string | null;
  status?: string;
  inserted_at?: number | string | null;
  updated_at?: number | string | null;
}

interface HistoryPage {
  chat_messages?: HistoryMessage[];
}

function toMs(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  // DeepSeek uses epoch SECONDS (float); tolerate milliseconds too.
  return num > 1e12 ? Math.round(num) : Math.round(num * 1000);
}

/** Raw epoch-seconds value for the lte_cursor pagination cursor. */
function toSeconds(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return num > 1e12 ? num / 1000 : num;
}

/** The web app stores the bearer token as a plain string or JSON-wrapped. */
function readUserToken(): string | null {
  try {
    const raw = window.localStorage.getItem("userToken");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string") return parsed;
      if (parsed && typeof parsed === "object") {
        const obj = parsed as { value?: unknown; token?: unknown };
        if (typeof obj.value === "string") return obj.value;
        if (typeof obj.token === "string") return obj.token;
      }
      return null;
    } catch {
      return raw; // not JSON — already the bare token string
    }
  } catch {
    // Storage access can throw in hardened contexts.
    return null;
  }
}

export function createDeepseekHistoryProvider(): HistoryProvider {
  const origin = "https://chat.deepseek.com";
  let cachedToken: string | null = null;

  const getToken = (): string => {
    if (cachedToken) return cachedToken;
    const token = readUserToken();
    if (!token) throw new Error("no_user_token");
    cachedToken = token;
    return cachedToken;
  };

  const api = async (path: string, signal?: AbortSignal): Promise<Response> =>
    fetch(`${origin}${path}`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${getToken()}`,
        "X-App-Version": APP_VERSION,
      },
      signal,
    });

  /** GET one endpoint and unwrap the DeepSeek biz envelope. */
  const fetchBizData = async <T>(
    label: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<T> => {
    const res = await api(path, signal);
    if (!res.ok) throw new Error(`${label} ${res.status}`);
    const envelope = (await res.json()) as ApiEnvelope<T>;
    const code = envelope.code ?? 0;
    const bizCode = envelope.data?.biz_code ?? 0;
    if (code !== 0 || bizCode !== 0) {
      throw new Error(`${label} code=${code} biz_code=${bizCode}`);
    }
    if (envelope.data?.biz_data == null) throw new Error(`${label} no_data`);
    return envelope.data.biz_data;
  };

  return {
    platform: "DeepSeek",

    async isAvailable() {
      try {
        if (!readUserToken()) return false;
        await fetchBizData<SessionPage>("probe", "/api/v0/chat_session/fetch_page?count=1");
        return true;
      } catch {
        return false;
      }
    },

    async listConversations(options: ListOptions = {}): Promise<HistoryConversationRef[]> {
      const refs: HistoryConversationRef[] = [];
      const seen = new Set<string>(); // lte_cursor is inclusive → pages overlap
      const max = options.max ?? Infinity;
      let cursor: { pinned: number; updatedAt: number } | null = null;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (options.signal?.aborted) break;
        const params = new URLSearchParams({ count: String(PAGE_LIMIT) });
        if (cursor) {
          params.set("lte_cursor.pinned", String(cursor.pinned));
          params.set("lte_cursor.updated_at", String(cursor.updatedAt));
        }
        const biz = await fetchBizData<SessionPage>(
          "list",
          `/api/v0/chat_session/fetch_page?${params.toString()}`,
          options.signal,
        );
        const items = biz.chat_sessions ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          if (!item.id || seen.has(item.id)) continue;
          seen.add(item.id);
          refs.push({
            id: item.id,
            title: item.title ?? undefined,
            createdAt: toMs(item.inserted_at),
            updatedAt: toMs(item.updated_at),
          });
          if (refs.length >= max) break;
        }
        options.onDiscover?.(refs.length);
        if (refs.length >= max || !biz.has_more) break;
        const last = items[items.length - 1];
        const lastUpdatedAt = toSeconds(last?.updated_at);
        if (lastUpdatedAt == null) break;
        const lastPinned = last?.pinned ? 1 : 0;
        // Stop if the cursor failed to advance (server ignored it).
        if (cursor && cursor.pinned === lastPinned && cursor.updatedAt === lastUpdatedAt) {
          break;
        }
        cursor = { pinned: lastPinned, updatedAt: lastUpdatedAt };
      }
      return refs;
    },

    async fetchConversation(
      ref: HistoryConversationRef,
      signal?: AbortSignal,
    ): Promise<HistoryConversation | null> {
      const biz = await fetchBizData<HistoryPage>(
        "detail",
        `/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(ref.id)}`,
        signal,
      );
      const chatMessages = biz.chat_messages ?? [];

      const messages: ParsedMessage[] = [];
      for (const msg of chatMessages) {
        const role =
          msg.role === "USER" ? "user" : msg.role === "ASSISTANT" ? "ai" : null;
        if (!role) continue;
        if (msg.status === "in_progress") continue; // unfinished stream
        const text = (msg.content ?? "").trim();
        if (!text) continue;
        messages.push({
          role,
          textContent: text,
          timestamp: toMs(msg.inserted_at ?? msg.updated_at) ?? undefined,
        });
      }

      if (messages.length === 0) return null;

      const firstTs = messages[0]?.timestamp ?? null;
      const lastTs = messages[messages.length - 1]?.timestamp ?? null;
      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "DeepSeek",
        title: ref.title ?? "",
        url: `${origin}/a/chat/s/${ref.id}`,
        messages,
        sourceCreatedAt: ref.createdAt ?? firstTs,
        sourceUpdatedAt: ref.updatedAt ?? lastTs,
      });

      logger.debug("content", "DeepSeek history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
