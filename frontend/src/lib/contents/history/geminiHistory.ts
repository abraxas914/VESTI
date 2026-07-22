// Gemini (gemini.google.com) historical-import provider.
//
// Uses Gemini's own internal batchexecute RPC (Google's Wiz framework), riding
// the page's session cookies plus the "SNlM0e" CSRF token extracted from the
// page itself — no separate login request is needed inside the content script.
// Read-only: only the two read RPCs below are ever issued.
//
//   tokens: window.WIZ_global_data.{SNlM0e, cfb2h, FdrFJe}, with a regex over
//           the page HTML as fallback (SNlM0e = `at` form field, cfb2h = `bl`
//           query param, FdrFJe = `f.sid` query param).
//   list:   POST /_/BardChatUi/data/batchexecute  rpcid "MaZiqc"
//           payload [count, null, [flag, null, 1]]; the response inner payload
//           holds the chat array at index 2 (fallback 0), each entry
//           [cid, title, pinned, ..., [epochSec, nanos]].
//   detail: POST /_/BardChatUi/data/batchexecute  rpcid "hNvQHb"
//           payload [cid, turnLimit, null, 1, [1], [4], null, 1]; the response
//           inner payload[0] is the turn array, NEWEST first. Per turn:
//           [0]=[cid, rid], [2][0][0]=user text, [3][0]=model candidates
//           (first candidate with text at [1][0] wins), [4]=timestamp pair.
//
// Provenance: rpcids, payloads and field paths follow public reverse-engineering
// of the Gemini web app (HanaokaYuzu/Gemini-API "gemini-webapi", mh567/
// gemini-web-cli, both still using these ids as of early 2026) — they are NOT
// verified against a live account here. Google rotates rpcids and payload shapes
// without notice; failures surface as thrown errors and the runner records them.
// Two points are inferred rather than documented anywhere: (1) MaZiqc has no
// known cursor, so pagination grows the requested `count` window until a round
// adds nothing new; (2) RPC cids carry a "c_" prefix that the web URL
// (/app/<id>) omits — uuid/url use the URL form so imports dedup against live
// captures from GeminiParser.getSessionUUID().

import type { ParsedMessage } from "../../messaging/protocol";
import { logger } from "../../utils/logger";
import {
  buildConversationDraft,
  type HistoryConversation,
  type HistoryConversationRef,
  type HistoryProvider,
  type ListOptions,
} from "./types";

const PAGE_LIMIT = 100; // conversations requested per growing-window round
const MAX_PAGES = 20; // hard safety cap (~2000 conversations)
const DETAIL_TURN_LIMIT = 500; // max turns requested per conversation

const RPC_LIST_CHATS = "MaZiqc";
const RPC_READ_CHAT = "hNvQHb";
// The list RPC is observed being called with two flag variants; query both and
// merge by id so neither bucket is missed.
const LIST_FLAG_VARIANTS = [1, 0] as const;

// Model text sometimes points at a rendered card instead of holding content, and
// generated-media replies embed googleusercontent artifact links.
const CARD_CONTENT_RE = /^http:\/\/googleusercontent\.com\/card_content\/\d+/;
const ARTIFACTS_RE = /http:\/\/googleusercontent\.com\/\w+\/\d+\n*/g;

interface PageTokens {
  at: string;
  bl: string | null;
  sid: string | null;
}

interface WizGlobalData {
  SNlM0e?: unknown;
  cfb2h?: unknown;
  FdrFJe?: unknown;
}

function getAt(value: unknown, path: number[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!Array.isArray(current) || key < 0 || key >= current.length) return undefined;
    current = current[key];
  }
  return current;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Epoch-seconds + nanos pair (Google protobuf Timestamp JSON), or plain number. */
function toMs(value: unknown): number | null {
  if (Array.isArray(value) && typeof value[0] === "number" && value[0] > 0) {
    const nanos = typeof value[1] === "number" ? value[1] : 0;
    return Math.round(value[0] * 1000 + nanos / 1e6);
  }
  if (typeof value === "number" && value > 0) {
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  return null;
}

/** RPC cids are "c_"-prefixed; the web URL (/app/<id>) drops the prefix. */
function toUrlId(rpcCid: string): string {
  return rpcCid.replace(/^c_/, "");
}

function toRpcCid(urlId: string): string {
  return urlId.startsWith("c_") ? urlId : `c_${urlId}`;
}

function matchHtmlToken(html: string, key: string): string | null {
  const match = new RegExp(`"${key}":"([^"]+)"`).exec(html);
  return match?.[1] ?? null;
}

function extractPageTokens(): PageTokens | null {
  const wiz = (window as unknown as { WIZ_global_data?: WizGlobalData }).WIZ_global_data;
  let at = asString(wiz?.SNlM0e);
  let bl = asString(wiz?.cfb2h);
  let sid = asString(wiz?.FdrFJe);
  if (!at) {
    const html = document.documentElement?.innerHTML ?? "";
    at = matchHtmlToken(html, "SNlM0e");
    bl = bl ?? matchHtmlToken(html, "cfb2h");
    sid = sid ?? matchHtmlToken(html, "FdrFJe");
  }
  return at ? { at, bl, sid } : null;
}

/** Parse Google's length-prefixed response framing into a flat envelope list. */
function parseFrames(content: string): unknown[] {
  const frames: unknown[] = [];
  let pos = 0;
  while (pos < content.length) {
    while (pos < content.length && /\s/.test(content.charAt(pos))) pos += 1;
    if (pos >= content.length) break;
    const match = /^(\d{1,10})/.exec(content.slice(pos, pos + 12));
    if (!match) break;
    // Google counts UTF-16 code units — equal to JS string length. The count
    // covers the newline after the digits and the one after the JSON.
    const length = Number(match[1]);
    const start = pos + match[1].length;
    if (!Number.isFinite(length) || length <= 0 || start + length > content.length) break;
    const chunk = content.slice(start, start + length).trim();
    pos = start + length;
    if (!chunk) continue;
    try {
      const parsed: unknown = JSON.parse(chunk);
      if (Array.isArray(parsed)) frames.push(...parsed);
      else frames.push(parsed);
    } catch {
      // Skip unparseable frame; other frames may still carry the payload.
    }
  }
  if (frames.length === 0) {
    // NDJSON fallback: some builds answer with one JSON array per line.
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("[")) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) frames.push(...parsed);
        else frames.push(parsed);
      } catch {
        // Not a JSON line — ignore.
      }
    }
  }
  return frames;
}

/** Extract the parsed inner payloads ("wrb.fr" envelopes) for one rpcid. */
function extractRpcPayloads(rawText: string, rpcid: string): unknown[] {
  let content = rawText;
  if (content.startsWith(")]}'")) content = content.slice(4);
  const payloads: unknown[] = [];
  for (const envelope of parseFrames(content)) {
    if (!Array.isArray(envelope)) continue;
    if (envelope[0] !== "wrb.fr" || envelope[1] !== rpcid) continue;
    const inner = envelope[2];
    if (typeof inner !== "string" || !inner) continue;
    try {
      payloads.push(JSON.parse(inner));
    } catch {
      // Malformed inner payload — skip.
    }
  }
  return payloads;
}

function cleanModelText(text: string): string {
  let cleaned = text.replace(ARTIFACTS_RE, "");
  if (cleaned.endsWith("\n```")) cleaned = cleaned.slice(0, -4);
  return cleaned.trim();
}

export function createGeminiHistoryProvider(): HistoryProvider {
  const origin = "https://gemini.google.com";
  let cachedTokens: PageTokens | null = null;
  let reqId = Math.floor(Math.random() * 90000) + 10000;

  const readTokens = (): PageTokens | null => {
    if (cachedTokens) return cachedTokens;
    const tokens = extractPageTokens();
    if (tokens) cachedTokens = tokens; // cache hits only; a too-early call can retry
    return tokens;
  };

  const batchExecute = async (
    rpcid: string,
    payload: unknown[],
    signal?: AbortSignal,
  ): Promise<unknown[]> => {
    const tokens = readTokens();
    if (!tokens) throw new Error("no_snlm0e_token");
    reqId += 100000;
    const params = new URLSearchParams({
      rpcids: rpcid,
      "source-path": "/app",
      _reqid: String(reqId),
      rt: "c",
    });
    if (tokens.bl) params.set("bl", tokens.bl);
    if (tokens.sid) params.set("f.sid", tokens.sid);
    const body = new URLSearchParams({
      "f.req": JSON.stringify([[[rpcid, JSON.stringify(payload), null, "generic"]]]),
      at: tokens.at,
    });
    const res = await fetch(`${origin}/_/BardChatUi/data/batchexecute?${params.toString()}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Same-Domain": "1",
      },
      body: body.toString(),
      signal,
    });
    if (!res.ok) throw new Error(`batchexecute ${rpcid} ${res.status}`);
    return extractRpcPayloads(await res.text(), rpcid);
  };

  const parseListEntry = (entry: unknown): HistoryConversationRef | null => {
    if (!Array.isArray(entry)) return null;
    const id = asString(entry[0]);
    if (!id) return null;
    return {
      id: toUrlId(id),
      title: asString(entry[1]) ?? undefined,
      createdAt: null,
      updatedAt: toMs(entry[5]),
    };
  };

  return {
    platform: "Gemini",

    async isAvailable() {
      // Cheap probe: the SNlM0e token only exists on a logged-in Gemini page.
      try {
        return !!readTokens();
      } catch {
        return false;
      }
    },

    async listConversations(options: ListOptions = {}): Promise<HistoryConversationRef[]> {
      const refs: HistoryConversationRef[] = [];
      const seen = new Set<string>();
      const max = options.max ?? Infinity;
      // No documented cursor for MaZiqc — grow the requested window each round
      // and stop once a round surfaces nothing new.
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (options.signal?.aborted) break;
        const count = PAGE_LIMIT * (page + 1);
        let added = 0;
        for (const flag of LIST_FLAG_VARIANTS) {
          const payloads = await batchExecute(
            RPC_LIST_CHATS,
            [count, null, [flag, null, 1]],
            options.signal,
          );
          for (const body of payloads) {
            // Chat array sits at index 2 in current builds; 0 in older ones.
            const entries = getAt(body, [2]) ?? getAt(body, [0]);
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
              const ref = parseListEntry(entry);
              if (!ref || seen.has(ref.id)) continue;
              seen.add(ref.id);
              refs.push(ref);
              added += 1;
              if (refs.length >= max) break;
            }
          }
          if (refs.length >= max) break;
        }
        options.onDiscover?.(refs.length);
        if (refs.length >= max || added === 0) break;
      }
      return refs;
    },

    async fetchConversation(
      ref: HistoryConversationRef,
      signal?: AbortSignal,
    ): Promise<HistoryConversation | null> {
      const payloads = await batchExecute(
        RPC_READ_CHAT,
        [toRpcCid(ref.id), DETAIL_TURN_LIMIT, null, 1, [1], [4], null, 1],
        signal,
      );

      // Turns arrive newest-first; each yields a user and/or a model message.
      const perTurn: Array<{ timestamp: number | undefined; messages: ParsedMessage[] }> = [];
      for (const body of payloads) {
        const turns = getAt(body, [0]);
        if (!Array.isArray(turns)) continue;
        for (const turn of turns) {
          const timestamp = toMs(getAt(turn, [4])) ?? undefined;
          const messages: ParsedMessage[] = [];
          const userText = asString(getAt(turn, [2, 0, 0]))?.trim();
          if (userText) messages.push({ role: "user", textContent: userText, timestamp });
          const candidates = getAt(turn, [3, 0]);
          if (Array.isArray(candidates)) {
            for (const candidate of candidates) {
              let text = asString(getAt(candidate, [1, 0]));
              if (text && CARD_CONTENT_RE.test(text)) {
                text = asString(getAt(candidate, [22, 0])) ?? text;
              }
              const cleaned = text ? cleanModelText(text) : "";
              if (cleaned) {
                messages.push({ role: "ai", textContent: cleaned, timestamp });
                break; // first candidate with content is the served reply
              }
            }
          }
          if (messages.length > 0) perTurn.push({ timestamp, messages });
        }
        if (perTurn.length > 0) break; // first payload carrying turns wins
      }

      if (perTurn.length === 0) return null;
      perTurn.reverse(); // newest-first → chronological
      const messages = perTurn.flatMap((turn) => turn.messages);

      const conversation = buildConversationDraft({
        uuid: ref.id,
        platform: "Gemini",
        title: ref.title ?? "",
        url: `${origin}/app/${ref.id}`,
        messages,
        sourceCreatedAt: perTurn[0]?.timestamp ?? ref.createdAt ?? null,
        sourceUpdatedAt: ref.updatedAt ?? perTurn[perTurn.length - 1]?.timestamp ?? null,
      });

      logger.debug("content", "Gemini history mapped", {
        id: ref.id,
        messages: messages.length,
      });
      return { conversation, messages };
    },
  };
}
