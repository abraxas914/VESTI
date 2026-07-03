// Historical-conversation import framework — shared types.
//
// Real-time capture only sees conversations the user opens AFTER install. To
// bring in older threads, a per-platform "history provider" calls the
// platform's OWN backend API from the content script (which inherits the page's
// session cookies via `fetch(..., { credentials: "include" })`), maps each
// thread to the canonical capture shape, and feeds it through the existing
// CAPTURE_CONVERSATION persist path (dedup by [platform+uuid] keeps re-imports
// idempotent and merges with anything already captured live).
//
// Providers live on an isolated path and never auto-submit anything to the
// platform — they only READ history.

import type { Platform } from "../../types";
import type { ConversationDraft, ParsedMessage } from "../../messaging/protocol";

/** Lightweight reference to a remote conversation, from the list endpoint. */
export interface HistoryConversationRef {
  /** Platform conversation id — becomes ConversationDraft.uuid (dedup key). */
  id: string;
  title?: string;
  /** Epoch ms when the platform created the thread, if known. */
  createdAt?: number | null;
  /** Epoch ms of the platform's last update, if known. */
  updatedAt?: number | null;
}

/** A fully-built import unit ready for the CAPTURE_CONVERSATION pipeline. */
export interface HistoryConversation {
  conversation: ConversationDraft;
  messages: ParsedMessage[];
}

export interface ListOptions {
  signal?: AbortSignal;
  /** Called as pages stream in, with the running total discovered so far. */
  onDiscover?: (total: number) => void;
  /** Hard cap on how many conversations to enumerate (safety valve). */
  max?: number;
}

/**
 * One per platform. Implementations should be defensive: network/parse errors
 * surface as thrown errors (the runner records and continues) and an empty or
 * unusable thread should resolve to `null` so it is skipped, not persisted.
 */
export interface HistoryProvider {
  platform: Platform;
  /** True when this page looks logged-in / able to serve history. */
  isAvailable(): Promise<boolean>;
  /** Enumerate the user's conversations (newest first when possible). */
  listConversations(options?: ListOptions): Promise<HistoryConversationRef[]>;
  /** Fetch + map one conversation; `null` when empty/unparseable. */
  fetchConversation(
    ref: HistoryConversationRef,
    signal?: AbortSignal,
  ): Promise<HistoryConversation | null>;
}

/** Build a ConversationDraft from platform metadata + parsed messages. */
export function buildConversationDraft(args: {
  uuid: string;
  platform: Platform;
  title: string;
  url: string;
  messages: ParsedMessage[];
  sourceCreatedAt?: number | null;
  sourceUpdatedAt?: number | null;
}): ConversationDraft {
  const now = Date.now();
  const firstUser = args.messages.find((m) => m.role === "user");
  const snippetSource = (firstUser?.textContent ?? args.messages[0]?.textContent ?? "").trim();
  const snippet = snippetSource.slice(0, 100);
  const turnCount = args.messages.filter((m) => m.role === "ai").length;
  const sourceCreatedAt =
    typeof args.sourceCreatedAt === "number" ? args.sourceCreatedAt : null;
  return {
    uuid: args.uuid,
    platform: args.platform,
    title: args.title?.trim() || snippet || "Untitled",
    snippet,
    url: args.url,
    source_created_at: sourceCreatedAt,
    first_captured_at: now,
    last_captured_at: now,
    created_at: now,
    updated_at: now,
    message_count: args.messages.length,
    turn_count: turnCount,
    is_archived: false,
    is_trash: false,
    tags: [],
    topic_id: null,
    is_starred: false,
  };
}
