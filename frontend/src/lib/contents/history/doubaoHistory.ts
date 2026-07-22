// Doubao (www.doubao.com) historical-import provider.
//
// Uses Doubao web's own IM-style gateway under /im/* (the "samantha"/"alice"
// backend family), authenticated by the page's session cookies via
// `fetch(..., { credentials: "include" })`. Read-only — every call is a POST
// that only pulls data, nothing is ever submitted or mutated.
//   list:   POST /im/chain/recent_conv   (cmd 3200, pull_recent_conv_chain_*)
//   info:   POST /im/conversation/info   (cmd 1110, get_conv_info_*)
//   detail: POST /im/chain/single        (cmd 3100, pull_singe_chain_*)
// All three share one request envelope
//   { cmd, uplink_body: { <uplinkKey>: payload }, sequence_id, channel: 2, version: "1" }
// and answer with { status_code, status_desc, downlink_body: { <downlinkKey>: ... } }.
//
// The gateway expects ByteDance's usual web query params (aid, device_id,
// web_id, samantha_web=1, ...). We reuse the query string of an /im/ request
// the page itself already made (via performance resource entries); when none
// is found we rebuild it from localStorage/cookies. The anti-bot params
// `a_bogus` / `msToken` ride along in that query but are NOT validated on
// these read endpoints (public reverse-engineered clients send random or
// empty values successfully), so no signature is ever computed here.
//
// Confirmed by reading the official web bundle (chunk async-infra-message-cmd
// on lf-flow-web-cdn.doubao.com): endpoint paths, cmd codes, uplink/downlink
// key names ("pull_singe_chain_*" — the server's own typo), request fields,
// the direction enum (1=OLDER, 2=NEWER, 3=FROM_LATEST) and wire field names
// (index_in_conv, create_time, user_type, content_type, status).
// Confirmed by third-party userscripts (greasyfork 579136 "豆包批量删除对话
// 稳定版", 542188 "AI对话导出"): cookie auth sufficiency, the cell/message
// JSON shapes and the content encodings (user text = JSON {text}; AI answer =
// JSON block array, text lives in block_type 10000 → content.text_block.text).
// Inferred, not verified against a live account: whether anchor_index is
// inclusive (message_id dedupe makes either behaviour safe), which optional
// fields (e.g. create_time on list cells) are always present, and whether
// FROM_LATEST is accepted on /im/chain/single when the initial anchor is
// unknown (only used as a fallback; failures surface as thrown errors).

import type { ParsedMessage } from "../../messaging/protocol";
import { logger } from "../../utils/logger";
import {
  buildConversationDraft,
  type HistoryConversation,
  type HistoryConversationRef,
  type HistoryProvider,
  type ListOptions,
} from "./types";

const PAGE_LIMIT = 50; // page size third-party clients use successfully against this API
const MAX_PAGES = 200; // hard safety cap (~10k conversations)
const MESSAGE_PAGE_LIMIT = 50;
const MESSAGE_MAX_PAGES = 100; // hard safety cap (~5k messages per thread)

const CMD_PULL_RECENT_CONV_CHAIN = 3200;
const CMD_GET_CONVERSATION_INFO = 1110;
const CMD_PULL_SINGLE_CHAIN = 3100;

const CONVERSATION_TYPE_ONE_TO_BOT = 3; // every doubao.com thread is a user↔bot chat
const DIRECTION_OLDER = 1;
const DIRECTION_FROM_LATEST = 3;

const USER_TYPE_HUMAN = 1;
const CONTENT_TYPE_TEXT = 1;
const CONTENT_TYPE_BLOCK = 9999;
const BLOCK_TYPE_TEXT = 10000;
const MESSAGE_STATUS_AVAILABLE = 0;

interface ImResponse {
  status_code?: number;
  status_desc?: string;
  downlink_body?: Record<string, unknown> | null;
}

interface ImCellConversation {
  conversation_id?: string | number;
  name?: string;
  create_time?: string | number | null;
  update_time?: string | number | null;
}

interface ImCell {
  conversation?: ImCellConversation | null;
  // Some payloads flatten the conversation fields onto the cell itself.
  conversation_id?: string | number;
  name?: string;
  create_time?: string | number | null;
  update_time?: string | number | null;
}

interface RecentConvDownlink {
  cells?: ImCell[];
  next_conv_version?: string | number | null;
  has_more?: boolean;
}

interface ConvInfoDownlink {
  conversation_info?: {
    name?: string;
    latest_index?: string | number | null;
    create_time?: string | number | null;
    update_time?: string | number | null;
  } | null;
}

interface ImTextBlock {
  block_type?: number;
  content?: unknown;
}

interface ImMessage {
  message_id?: string | number;
  index_in_conv?: string | number | null;
  user_type?: number;
  content_type?: number;
  content?: unknown;
  content_block?: ImTextBlock[] | null;
  create_time?: string | number | null;
  status?: number;
}

interface SingleChainDownlink {
  messages?: ImMessage[];
  has_more?: boolean;
}

function toMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    // Backend uses epoch SECONDS on some fields and epoch MILLIS on others.
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    return asNumber > 1e12 ? Math.round(asNumber) : Math.round(asNumber * 1000);
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** next_conv_version may arrive as a numeric string; the wire wants a number. */
function asWireVersion(value: string | number | null | undefined): number | string {
  if (value == null || value === "") return 0;
  const text = String(value);
  if (/^\d+$/.test(text)) {
    const num = Number(text);
    if (Number.isSafeInteger(num)) return num;
  }
  return text;
}

function parseJsonContent(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function blockText(block: ImTextBlock): string {
  if (block.block_type !== BLOCK_TYPE_TEXT) return "";
  const content = parseJsonContent(block.content) as {
    text_block?: { text?: unknown } | null;
  } | null;
  const text = content?.text_block?.text;
  return typeof text === "string" ? text.trim() : "";
}

function messageText(msg: ImMessage): string {
  if (msg.content_type === CONTENT_TYPE_TEXT) {
    const parsed = parseJsonContent(msg.content) as { text?: unknown } | null;
    if (parsed && typeof parsed.text === "string") return parsed.text.trim();
    return typeof msg.content === "string" ? msg.content.trim() : "";
  }
  if (msg.content_type === CONTENT_TYPE_BLOCK) {
    const blocks = parseJsonContent(msg.content);
    if (Array.isArray(blocks)) {
      const chunks = (blocks as ImTextBlock[]).map(blockText).filter(Boolean);
      if (chunks.length > 0) return chunks.join("\n\n");
    }
    // Fallback: some responses carry the same blocks on content_block instead.
    if (Array.isArray(msg.content_block)) {
      const chunks = msg.content_block.map(blockText).filter(Boolean);
      if (chunks.length > 0) return chunks.join("\n\n");
    }
  }
  return "";
}

export function createDoubaoHistoryProvider(): HistoryProvider {
  const origin = "https://www.doubao.com";
  let cachedSearch: string | null = null;

  const cookieValue = (name: string): string => {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : "";
  };

  const storageValue = (...names: string[]): string => {
    for (const name of names) {
      try {
        const value = localStorage.getItem(name);
        if (value && value.length > 4) return value.replace(/^"|"$/g, "");
      } catch {
        // ignore and try the next key
      }
    }
    return "";
  };

  // The page's own /im/ requests carry the full, currently-valid query params
  // (device_id, web_id, pc_version, ...). Reusing one verbatim is the most
  // faithful reproduction of a first-party call.
  const scanPerformanceSearch = (): string => {
    let best = "";
    try {
      for (const entry of performance.getEntriesByType("resource")) {
        if (!entry.name || !entry.name.includes("/im/")) continue;
        let url: URL;
        try {
          url = new URL(entry.name);
        } catch {
          continue;
        }
        if (url.hostname !== "www.doubao.com") continue;
        if (url.search.length > best.length) best = url.search;
      }
    } catch {
      // performance entries unavailable — the fallback below covers this
    }
    return best;
  };

  const buildFallbackSearch = (): string => {
    const deviceId =
      storageValue("device_id", "tea_device_id", "__tea_device_id") || cookieValue("device_id");
    const webId =
      storageValue("web_id", "__tea_web_id", "tea_web_id") || cookieValue("web_id") || deviceId;
    const params = new URLSearchParams({
      version_code: "20800",
      language: "zh",
      device_platform: "web",
      aid: "497858",
      real_aid: "497858",
      pkg_type: "release_version",
      device_id: deviceId,
      pc_version: "3.19.3",
      web_id: webId,
      tea_uuid: webId,
      region: "CN",
      sys_region: "CN",
      samantha_web: "1",
      "use-olympus-account": "1",
      web_tab_id: crypto.randomUUID(),
    });
    return `?${params.toString()}`;
  };

  const getSearch = (): string => {
    if (!cachedSearch) cachedSearch = scanPerformanceSearch();
    if (!cachedSearch) cachedSearch = buildFallbackSearch();
    return cachedSearch;
  };

  const postIm = async <T>(
    path: string,
    cmd: number,
    uplinkKey: string,
    downlinkKey: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<T | undefined> => {
    const res = await fetch(`${origin}${path}${getSearch()}`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json; encoding=utf-8",
        "agw-js-conv": "str",
      },
      body: JSON.stringify({
        cmd,
        uplink_body: { [uplinkKey]: payload },
        sequence_id: crypto.randomUUID(),
        channel: 2,
        version: "1",
      }),
      signal,
    });
    if (!res.ok) throw new Error(`im ${path} ${res.status}`);
    const data = (await res.json()) as ImResponse;
    if (typeof data.status_code === "number" && data.status_code !== 0) {
      throw new Error(`im ${path} status ${data.status_code}: ${data.status_desc ?? ""}`);
    }
    return data.downlink_body?.[downlinkKey] as T | undefined;
  };

  return {
    platform: "Doubao",

    async isAvailable() {
      try {
        // Cheapest truthful probe: one single-item list page. A logged-out or
        // expired session answers with a non-zero status_code / HTTP error.
        await postIm<RecentConvDownlink>(
          "/im/chain/recent_conv",
          CMD_PULL_RECENT_CONV_CHAIN,
          "pull_recent_conv_chain_uplink_body",
          "pull_recent_conv_chain_downlink_body",
          {
            limit: 1,
            message_count_per_conv: 0,
            api_version: 1,
            conv_version: 0,
            direction: DIRECTION_FROM_LATEST,
            option: {
              not_need_message: true,
              need_complete_conversation: true,
              need_coco_conversation: true,
              need_coco_bot: true,
              need_pc_pin_chain: true,
              pc_pin_query_type: 0,
            },
          },
        );
        return true;
      } catch {
        return false;
      }
    },

    async listConversations(options: ListOptions = {}): Promise<HistoryConversationRef[]> {
      const refs: HistoryConversationRef[] = [];
      const seen = new Set<string>();
      const max = options.max ?? Infinity;
      let convVersion: number | string = 0;
      let hasMore = true;
      for (let page = 0; page < MAX_PAGES && hasMore; page += 1) {
        if (options.signal?.aborted) break;
        const firstPage = page === 0;
        const body = await postIm<RecentConvDownlink>(
          "/im/chain/recent_conv",
          CMD_PULL_RECENT_CONV_CHAIN,
          "pull_recent_conv_chain_uplink_body",
          "pull_recent_conv_chain_downlink_body",
          {
            limit: PAGE_LIMIT,
            message_count_per_conv: 0,
            api_version: 1,
            conv_version: convVersion,
            direction: firstPage ? DIRECTION_FROM_LATEST : DIRECTION_OLDER,
            option: {
              not_need_message: true,
              need_complete_conversation: true,
              need_coco_conversation: firstPage,
              need_coco_bot: firstPage,
              need_pc_pin_chain: true,
              pc_pin_query_type: firstPage ? 0 : 1,
            },
          },
          options.signal,
        );
        const cells = body?.cells ?? [];
        if (cells.length === 0) break;
        let added = 0;
        for (const cell of cells) {
          const conversation = cell.conversation ?? cell;
          const id = String(conversation.conversation_id ?? "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          refs.push({
            id,
            title: conversation.name,
            createdAt: toMs(conversation.create_time),
            updatedAt: toMs(conversation.update_time),
          });
          added += 1;
          if (refs.length >= max) break;
        }
        options.onDiscover?.(refs.length);
        const next = body?.next_conv_version;
        hasMore = Boolean(body?.has_more) && next != null && String(next) !== "" && added > 0;
        convVersion = asWireVersion(next) || convVersion;
        if (refs.length >= max || added === 0) break;
      }
      return refs;
    },

    async fetchConversation(
      ref: HistoryConversationRef,
      signal?: AbortSignal,
    ): Promise<HistoryConversation | null> {
      // Conversation info gives the canonical title plus latest_index, which
      // is the anchor the message pager starts from. Failure is tolerated —
      // the ref carries a usable title and the pager falls back to FROM_LATEST.
      let title = ref.title ?? "";
      let anchor = 0;
      let sourceCreatedAt = ref.createdAt ?? null;
      let sourceUpdatedAt = ref.updatedAt ?? null;
      try {
        const info = await postIm<ConvInfoDownlink>(
          "/im/conversation/info",
          CMD_GET_CONVERSATION_INFO,
          "get_conv_info_uplink_body",
          "get_conv_info_downlink_body",
          {
            conversation_id: ref.id,
            ext: {},
            bot_id: "",
            conversation_type: CONVERSATION_TYPE_ONE_TO_BOT,
            option: { need_bot_info: true },
          },
          signal,
        );
        const conversationInfo = info?.conversation_info;
        if (conversationInfo) {
          if (conversationInfo.name) title = conversationInfo.name;
          anchor = Number(conversationInfo.latest_index) || 0;
          sourceCreatedAt = toMs(conversationInfo.create_time) ?? sourceCreatedAt;
          sourceUpdatedAt = toMs(conversationInfo.update_time) ?? sourceUpdatedAt;
        }
      } catch {
        // fall back to ref metadata
      }

      const collected: Array<{ role: "user" | "ai"; text: string; ts: number; idx: number }> = [];
      const seenMessages = new Set<string>();
      let hasMore = true;
      let cursor = anchor;
      for (let page = 0; page < MESSAGE_MAX_PAGES && hasMore; page += 1) {
        if (signal?.aborted) break;
        const body = await postIm<SingleChainDownlink>(
          "/im/chain/single",
          CMD_PULL_SINGLE_CHAIN,
          "pull_singe_chain_uplink_body",
          "pull_singe_chain_downlink_body",
          {
            conversation_id: ref.id,
            anchor_index: cursor,
            conversation_type: CONVERSATION_TYPE_ONE_TO_BOT,
            direction: cursor > 0 ? DIRECTION_OLDER : DIRECTION_FROM_LATEST,
            limit: MESSAGE_PAGE_LIMIT,
            ext: {},
            filter: { index_list: [] },
            evaluate_ab_params: "",
            evaluate_common_params: "",
          },
          signal,
        );
        const rawMessages = body?.messages ?? [];
        if (rawMessages.length === 0) break;
        let minIndex = Infinity;
        for (const msg of rawMessages) {
          // Skip replaced/deleted revisions (edits & regenerations); keep only
          // the currently-visible version of each message.
          if (typeof msg.status === "number" && msg.status !== MESSAGE_STATUS_AVAILABLE) continue;
          const messageId = String(msg.message_id ?? "").trim();
          if (messageId && seenMessages.has(messageId)) continue;
          const text = messageText(msg);
          if (!text) continue;
          if (messageId) seenMessages.add(messageId);
          const indexInConv = Number(msg.index_in_conv);
          const idx = Number.isFinite(indexInConv) ? indexInConv : 0;
          if (idx > 0 && idx < minIndex) minIndex = idx;
          collected.push({
            role: msg.user_type === USER_TYPE_HUMAN ? "user" : "ai",
            text,
            ts: toMs(msg.create_time) ?? 0,
            idx,
          });
        }
        // The web client keeps paging while a full page comes back (indexes
        // are dense per thread), stepping the anchor back one page; when we
        // learned the oldest fetched index we anchor just below it instead.
        hasMore = Boolean(body?.has_more) && rawMessages.length >= MESSAGE_PAGE_LIMIT;
        if (!hasMore) break;
        const nextCursor = Number.isFinite(minIndex) ? minIndex - 1 : cursor - MESSAGE_PAGE_LIMIT;
        if (nextCursor <= 0) break;
        if (cursor > 0 && nextCursor >= cursor) break; // anchor failed to move back
        cursor = nextCursor;
      }

      if (collected.length === 0) return null;
      collected.sort((a, b) => a.ts - b.ts || a.idx - b.idx);

      const messages: ParsedMessage[] = collected.map((c) => ({
        role: c.role,
        textContent: c.text,
        timestamp: c.ts || undefined,
      }));

      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "Doubao",
        title,
        url: `${origin}/chat/${ref.id}`,
        messages,
        sourceCreatedAt,
        sourceUpdatedAt,
      });

      logger.debug("content", "Doubao history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
