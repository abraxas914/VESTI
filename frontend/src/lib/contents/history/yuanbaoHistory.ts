// Tencent Yuanbao (yuanbao.tencent.com) historical-import provider.
//
// Uses Yuanbao's own web backend API, authenticated by the page's session
// cookies (hy_token / hy_user) via `credentials: "include"` — the public
// projects below all call these endpoints with cookies only, no bearer token
// and no signed x-uskey header. READ-ONLY: the platform routes reads through
// POST, but these two endpoints only query data; the mutating endpoints
// (/conversation/create, /conversation/v1/clear, /api/chat/{id}) are NEVER
// called by this provider.
//   list:   POST /api/user/agent/conversation/v1/list
//           (404-fallback: /api/user/agent/conversation/list)
//           body { agentId, offset, limit, filterGoodQuestion: true }
//           → { conversations: [{ id, agentId?, title?, createTime?, updateTime? }] }
//   detail: POST /api/user/agent/conversation/v1/detail
//           body { conversationId, offset, limit }
//           → { title?, createTime?, updateTime?, convs: [...] }  (convs newest-first)
//           turn = { index, speaker: "human"|"ai", displayPrompt?, createTime?,
//                    speechesV2: [{ content: [{ type: "text", msg }, ...] }] }
//
// Field knowledge is assembled from public third-party projects built against
// the live site, not from first-hand capture:
//   - Confirmed by source: the non-v1 list path + body shape + `conversations[].id`
//     (github.com/2van/yuanbao-api); the v1/detail path + body + `convs` being
//     newest-first with `speaker` / `displayPrompt` / `speechesV2[].content[]`
//     blocks ({ type: "text", msg }) (github.com/SsparKluo/Yuanbao-Markdown-Copy,
//     a userscript intercepting this endpoint on the live site, and
//     github.com/qingfengDuan/yuanbao_ai); cookie-only auth (all of the above
//     plus github.com/juzeon/yuanbao-chat2api); the canonical conversation URL
//     /chat/{agentId}/{chatId} and default agent id "naQivTmsDa".
//   - Inferred / unverified: the v1/list variant (v1/detail and v1/clear exist,
//     so it likely does too; a 404 falls back to the confirmed non-v1 path);
//     list-item `title`/`createTime`/`updateTime` field names; timestamp units
//     (Tencent APIs typically use epoch SECONDS — toMs() handles s/ms/ISO);
//     detail offset/limit pagination (a seen-turns guard stops the loop if the
//     server ignores paging); `filterGoodQuestion: true`, replicated from the
//     one observed list request; whether listing is scoped to the given
//     agentId or returns all of the user's conversations.
//   - Risk: if Tencent starts enforcing the signed x-uskey header on these
//     reads, auth will start failing → isAvailable() returns false and the
//     framework skips this provider (fail-closed; no DOM fallback implemented).

import type { ParsedMessage } from "../../messaging/protocol";
import { logger } from "../../utils/logger";
import {
  buildConversationDraft,
  type HistoryConversation,
  type HistoryConversationRef,
  type HistoryProvider,
  type ListOptions,
} from "./types";

const PAGE_LIMIT = 50; // observed maximum accepted by the list endpoint
const MAX_PAGES = 200; // hard safety cap (~10000 conversations)
const DETAIL_PAGE_LIMIT = 30; // matches the paging size observed on v1/detail
const DETAIL_MAX_PAGES = 100; // hard safety cap (~3000 turns per thread)
const DEFAULT_AGENT_ID = "naQivTmsDa"; // Yuanbao's default assistant agent
const LIST_PATHS = [
  "/api/user/agent/conversation/v1/list",
  "/api/user/agent/conversation/list",
];
const DETAIL_PATH = "/api/user/agent/conversation/v1/detail";

interface ListItem {
  id?: string;
  agentId?: string;
  title?: string;
  createTime?: number | string | null;
  updateTime?: number | string | null;
}

interface ListResponse {
  conversations?: ListItem[];
}

interface ContentBlock {
  type?: string;
  msg?: string;
  fileName?: string;
  url?: string;
}

interface Speech {
  content?: ContentBlock[];
}

interface ConvTurn {
  id?: string;
  index?: number;
  speaker?: string; // "human" | "ai"
  displayPrompt?: string;
  createTime?: number | string | null;
  updateTime?: number | string | null;
  speechesV2?: Speech[];
}

interface DetailResponse {
  title?: string;
  createTime?: number | string | null;
  updateTime?: number | string | null;
  convs?: ConvTurn[];
}

function toMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    // Tencent backends typically use epoch SECONDS; tolerate epoch ms too.
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function turnBlocks(turn: ConvTurn): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const speech of turn.speechesV2 ?? []) {
    for (const block of speech.content ?? []) {
      blocks.push(block);
    }
  }
  return blocks;
}

function userTurnText(turn: ConvTurn): string {
  const blocks = turnBlocks(turn);
  const textBlock = blocks.find(
    (b) => b.type === "text" && typeof b.msg === "string" && b.msg.trim(),
  );
  const mediaLinks = blocks
    .filter((b) => b.type !== "text" && b.fileName && b.url)
    .map((b) => `[${b.fileName as string}](${b.url as string})`);
  const base = (textBlock?.msg ?? turn.displayPrompt ?? "").trim();
  return [base, ...mediaLinks].filter(Boolean).join("\n").trim();
}

function aiTurnText(turn: ConvTurn): string {
  const chunks: string[] = [];
  for (const block of turnBlocks(turn)) {
    // Only final-answer text; think / searchGuid / card blocks are skipped.
    if (block.type === "text" && typeof block.msg === "string" && block.msg.trim()) {
      chunks.push(block.msg.trim());
    }
  }
  return chunks.join("\n\n").trim();
}

export function createYuanbaoHistoryProvider(): HistoryProvider {
  const origin = "https://yuanbao.tencent.com";
  let cachedAgentId: string | null = null;
  let cachedListPath: string | null = null;
  const agentIdByConversation = new Map<string, string>();

  const getAgentId = (): string => {
    if (cachedAgentId) return cachedAgentId;
    let agentId = DEFAULT_AGENT_ID;
    try {
      // Conversation URLs look like /chat/{agentId}/{chatId}; when the user is
      // on a non-default agent's page, list that agent's threads instead.
      const match = window.location.pathname.match(/\/chat\/([^/]+)/);
      if (match?.[1]) agentId = match[1];
    } catch {
      // Non-page context — fall back to the default agent.
    }
    cachedAgentId = agentId;
    return cachedAgentId;
  };

  const api = async (
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> =>
    fetch(`${origin}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

  const listBody = (offset: number, limit: number): Record<string, unknown> => ({
    agentId: getAgentId(),
    offset,
    limit,
    filterGoodQuestion: true,
  });

  const getListPath = async (signal?: AbortSignal): Promise<string> => {
    if (cachedListPath) return cachedListPath;
    for (const path of LIST_PATHS) {
      const res = await api(path, listBody(0, 1), signal);
      // Any non-404 response (200, 401, ...) means this path exists.
      if (res.status !== 404) {
        cachedListPath = path;
        return cachedListPath;
      }
    }
    // Neither resolved — return the confirmed path so callers surface its error.
    return LIST_PATHS[LIST_PATHS.length - 1];
  };

  return {
    platform: "Yuanbao",

    async isAvailable() {
      try {
        const path = await getListPath();
        const res = await api(path, listBody(0, 1));
        return res.ok;
      } catch {
        return false;
      }
    },

    async listConversations(options: ListOptions = {}): Promise<HistoryConversationRef[]> {
      const listPath = await getListPath(options.signal);
      const refs: HistoryConversationRef[] = [];
      const max = options.max ?? Infinity;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (options.signal?.aborted) break;
        const offset = page * PAGE_LIMIT;
        const res = await api(listPath, listBody(offset, PAGE_LIMIT), options.signal);
        if (!res.ok) throw new Error(`list ${res.status}`);
        const data = (await res.json()) as ListResponse;
        const items = data.conversations ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          if (!item.id) continue;
          if (item.agentId) agentIdByConversation.set(item.id, item.agentId);
          refs.push({
            id: item.id,
            title: item.title,
            createdAt: toMs(item.createTime),
            updatedAt: toMs(item.updateTime),
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
      // v1/detail pages turns newest-first; accumulate then flip to chrono order.
      const turns: ConvTurn[] = [];
      const seenTurnKeys = new Set<string>();
      let meta: DetailResponse | null = null;
      for (let page = 0; page < DETAIL_MAX_PAGES; page += 1) {
        if (signal?.aborted) break;
        const res = await api(
          DETAIL_PATH,
          { conversationId: ref.id, offset: page * DETAIL_PAGE_LIMIT, limit: DETAIL_PAGE_LIMIT },
          signal,
        );
        if (!res.ok) throw new Error(`detail ${res.status}`);
        const data = (await res.json()) as DetailResponse;
        if (page === 0) meta = data;
        const convs = data.convs ?? [];
        if (convs.length === 0) break;
        let added = 0;
        for (const turn of convs) {
          const key = turn.id ?? (typeof turn.index === "number" ? `idx:${turn.index}` : null);
          if (key) {
            if (seenTurnKeys.has(key)) continue;
            seenTurnKeys.add(key);
          }
          turns.push(turn);
          added += 1;
        }
        // Stop when the server ignores offset/limit (same page replayed) or
        // returns a short (last) page.
        if (added === 0 || convs.length < DETAIL_PAGE_LIMIT) break;
      }
      if (turns.length === 0) return null;
      turns.reverse();

      const messages: ParsedMessage[] = [];
      for (const turn of turns) {
        const role = turn.speaker === "human" ? "user" : turn.speaker === "ai" ? "ai" : null;
        if (!role) continue;
        const text = role === "user" ? userTurnText(turn) : aiTurnText(turn);
        if (!text) continue;
        messages.push({
          role,
          textContent: text,
          timestamp: toMs(turn.createTime) ?? undefined,
        });
      }
      if (messages.length === 0) return null;

      const agentId = agentIdByConversation.get(ref.id) ?? getAgentId();
      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "Yuanbao",
        title: meta?.title ?? ref.title ?? "",
        url: `${origin}/chat/${agentId}/${ref.id}`,
        messages,
        sourceCreatedAt:
          toMs(meta?.createTime) ?? ref.createdAt ?? toMs(turns[0]?.createTime) ?? null,
        sourceUpdatedAt:
          toMs(meta?.updateTime) ??
          ref.updatedAt ??
          toMs(turns[turns.length - 1]?.createTime) ??
          null,
      });

      logger.debug("content", "Yuanbao history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
