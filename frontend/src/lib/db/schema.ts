import Dexie from "dexie";
import type { Table } from "dexie";
import type {
  Conversation,
  Message,
  NoteObsidianExportMeta,
  NoteImportMeta,
  NoteSourceType,
  SummaryRecord,
  WeeklyReportRecord,
} from "../types";
import { buildNoteExcerpt, computeNoteHash } from "../notes/markdown";
import {
  extractAstPlainText,
  inspectAstStructure,
  isAstRoot,
  shouldPreferAstCanonicalText,
} from "../utils/astText";

export type ConversationRecord = Omit<Conversation, "id"> & { id?: number };
export type MessageRecord = Omit<Message, "id" | "content_ast"> & {
  id?: number;
  content_ast?: unknown | null;
};
export type SummaryRecordRecord = Omit<SummaryRecord, "id"> & { id?: number };
export type WeeklyReportRecordRecord = Omit<WeeklyReportRecord, "id"> & { id?: number };
export interface TopicRecord {
  id?: number;
  parent_id: number | null;
  name: string;
  created_at: number;
  updated_at: number;
}
export interface VectorRecord {
  id?: number;
  conversation_id: number;
  text_hash: string;
  embedding: Float32Array;
}
export interface NoteRecord {
  id?: number;
  title: string;
  content: string;
  excerpt: string;
  hash: string;
  created_at: number;
  updated_at: number;
  linked_conversation_ids: number[];
  source_type: NoteSourceType;
  source_path: string | null;
  import_meta: NoteImportMeta | null;
  obsidian_export: NoteObsidianExportMeta | null;
}
export interface AnnotationRecord {
  id?: number;
  conversation_id: number;
  message_id: number;
  content_text: string;
  created_at: number;
  days_after: number;
}

// Explore (RAG Chat) Records
export interface ExploreSessionRecord {
  id: string; // UUID format: "sess_xxx"
  title: string;
  preview: string; // Last message preview for list display
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExploreMessageRecord {
  id: string; // UUID format: "msg_xxx"
  sessionId: string; // Foreign key to explore_sessions
  role: "user" | "assistant";
  content: string;
  sources?: string; // JSON serialized RelatedConversation[]
  agentMeta?: string; // JSON serialized ExploreAgentMeta
  timestamp: number;
}

export interface NoteSourceRecord {
  id: string;
  name: string;
  kind: "directory" | "zip";
  created_at: number;
  updated_at: number;
}

export interface NoteAssetRecord {
  id: string;
  vault_id: string;
  relative_path: string;
  mime_type: string;
  hash: string;
  byte_size: number;
  blob: Blob;
  created_at: number;
  updated_at: number;
}

export type PromptSource = "manual" | "extracted";

export interface PromptRecord {
  id?: number;
  title: string;
  body: string;
  category: string | null;
  tags: string[];
  source: PromptSource;
  source_platform: ConversationRecord["platform"] | null;
  source_conversation_id: number | null;
  source_message_id: number | null;
  is_favorite: boolean;
  is_archived: boolean;
  quality_score: number;
  summary: string | null;
  variables: string[];
  use_count: number;
  last_used_at: number | null;
  body_hash: string;
  created_at: number;
  updated_at: number;
}

function normalizePersistedPlatform(value: unknown): ConversationRecord["platform"] | undefined {
  if (value === "Yuanbao" || value === "YUANBAO") {
    return "Yuanbao";
  }

  switch (value) {
    case "ChatGPT":
    case "Claude":
    case "Gemini":
    case "DeepSeek":
    case "Qwen":
    case "Doubao":
    case "Kimi":
      return value;
    default:
      return undefined;
  }
}

function normalizeSerializedSources(raw?: string): string | undefined {
  if (!raw) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return raw;
    }

    let changed = false;
    const normalized = parsed.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      const platform = normalizePersistedPlatform((item as { platform?: unknown }).platform);
      if (!platform || platform === (item as { platform?: unknown }).platform) {
        return item;
      }

      changed = true;
      return {
        ...(item as Record<string, unknown>),
        platform,
      };
    });

    return changed ? JSON.stringify(normalized) : raw;
  } catch {
    return raw;
  }
}

export class MemoryHubDB extends Dexie {
  conversations!: Table<ConversationRecord, number>;
  messages!: Table<MessageRecord, number>;
  summaries!: Table<SummaryRecordRecord, number>;
  weekly_reports!: Table<WeeklyReportRecordRecord, number>;
  topics!: Table<TopicRecord, number>;
  vectors!: Table<VectorRecord, number>;
  notes!: Table<NoteRecord, number>;
  note_sources!: Table<NoteSourceRecord, string>;
  note_assets!: Table<NoteAssetRecord, string>;
  annotations!: Table<AnnotationRecord, number>;
  explore_sessions!: Table<ExploreSessionRecord, string>;
  explore_messages!: Table<ExploreMessageRecord, string>;
  prompts!: Table<PromptRecord, number>;

  constructor() {
    super("MemoryHubDB");
    this.version(1).stores({
      conversations:
        "++id, platform, title, created_at, updated_at, uuid, [platform+created_at]",
      messages:
        "++id, conversation_id, role, created_at, [conversation_id+created_at]",
    });
    this.version(2).stores({
      conversations:
        "++id, platform, title, created_at, updated_at, uuid, [platform+created_at]",
      messages:
        "++id, conversation_id, role, created_at, [conversation_id+created_at]",
      summaries: "++id, conversationId, createdAt",
      weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
    });
    this.version(3)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, [platform+created_at], [platform+uuid]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
      })
      .upgrade((tx) => {
        return tx
          .table("conversations")
          .toCollection()
          .modify((record: Partial<ConversationRecord>) => {
            if (record.source_created_at === undefined) {
              record.source_created_at = null;
            }
          });
      });
    this.version(4)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, [platform+created_at], [platform+uuid]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
      })
      .upgrade(async (tx) => {
        const aiTurnsByConversation = new Map<number, number>();

        await tx
          .table("messages")
          .toCollection()
          .each((record: Partial<MessageRecord>) => {
            if (record.role !== "ai") {
              return;
            }

            const conversationId = record.conversation_id;
            if (typeof conversationId !== "number") {
              return;
            }

            aiTurnsByConversation.set(
              conversationId,
              (aiTurnsByConversation.get(conversationId) ?? 0) + 1
            );
          });

        await tx
          .table("conversations")
          .toCollection()
          .modify((record: Partial<ConversationRecord>) => {
            const messageCount =
              typeof record.message_count === "number" && Number.isFinite(record.message_count)
                ? Math.max(0, Math.floor(record.message_count))
                : 0;
            const fallbackTurnCount = Math.floor(messageCount / 2);

            const conversationId = typeof record.id === "number" ? record.id : undefined;
            if (conversationId === undefined) {
              if (
                typeof record.turn_count !== "number" ||
                !Number.isFinite(record.turn_count)
              ) {
                record.turn_count = fallbackTurnCount;
              }
              return;
            }

            const aiTurns = aiTurnsByConversation.get(conversationId);
            record.turn_count =
              typeof aiTurns === "number" ? aiTurns : fallbackTurnCount;
          });
      });
    this.version(5)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, [platform+created_at], [platform+uuid]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
      })
      .upgrade((tx) => {
        return tx
          .table("messages")
          .toCollection()
          .modify((record: Partial<MessageRecord>) => {
            if (record.content_ast === undefined) {
              record.content_ast = null;
            }
            if (record.content_ast_version === undefined) {
              record.content_ast_version = null;
            }
            if (
              typeof record.degraded_nodes_count !== "number" ||
              !Number.isFinite(record.degraded_nodes_count)
            ) {
              record.degraded_nodes_count = 0;
            }
          });
      });
    this.version(6)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors:
          "++id, conversation_id, text_hash, [conversation_id+text_hash]",
      })
      .upgrade(() => undefined);
    this.version(7)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
      })
      .upgrade(() => undefined);
    this.version(8)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes: "++id, created_at, updated_at",
      })
      .upgrade(() => undefined);
    this.version(9)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes: "++id, created_at, updated_at",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
      })
      .upgrade(() => undefined);
    this.version(10)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes: "++id, created_at, updated_at",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
      })
      .upgrade(async (tx) => {
        await tx
          .table("conversations")
          .toCollection()
          .modify((record: Partial<ConversationRecord>) => {
            const platform = normalizePersistedPlatform(record.platform);
            if (platform && platform !== record.platform) {
              record.platform = platform;
            }
          });

        await tx
          .table("explore_messages")
          .toCollection()
          .modify((record: Partial<ExploreMessageRecord>) => {
            const normalized = normalizeSerializedSources(record.sources);
            if (normalized !== record.sources) {
              record.sources = normalized;
            }
          });
      });
    this.version(11)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes: "++id, created_at, updated_at",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
      })
      .upgrade(() => undefined);
    this.version(12)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes: "++id, created_at, updated_at",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
      })
      .upgrade(async (tx) => {
        await tx
          .table("conversations")
          .toCollection()
          .modify((record: Partial<ConversationRecord>) => {
            if (
              typeof record.first_captured_at !== "number" ||
              !Number.isFinite(record.first_captured_at)
            ) {
              record.first_captured_at =
                typeof record.created_at === "number" && Number.isFinite(record.created_at)
                  ? record.created_at
                  : Date.now();
            }

            if (
              typeof record.last_captured_at !== "number" ||
              !Number.isFinite(record.last_captured_at)
            ) {
              record.last_captured_at =
                typeof record.updated_at === "number" && Number.isFinite(record.updated_at)
                  ? record.updated_at
                  : record.first_captured_at;
            }
          });
      });
    this.version(13)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
          topics:
            "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
          vectors: "++id, conversation_id, text_hash",
          notes: "++id, created_at, updated_at",
          annotations:
            "++id, conversation_id, message_id, created_at, days_after, [conversation_id+message_id], [conversation_id+created_at]",
          explore_sessions: "id, updatedAt, createdAt",
          explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
        })
        .upgrade(async (tx) => {
          const conversationCreatedAt = new Map<number, number>();

          await tx
            .table("conversations")
            .toCollection()
            .each((record: Partial<ConversationRecord>) => {
              if (typeof record.id !== "number" || typeof record.created_at !== "number") {
                return;
              }
              conversationCreatedAt.set(record.id, record.created_at);
            });

          await tx
            .table("annotations")
            .toCollection()
            .modify((record: Record<string, unknown>) => {
              const rawCreatedAt =
                typeof record.created_at === "number" ? record.created_at : Date.now();
              const conversationId =
                typeof record.conversation_id === "number" ? record.conversation_id : null;
              const conversationTs =
                conversationId !== null
                  ? conversationCreatedAt.get(conversationId) ?? rawCreatedAt
                  : rawCreatedAt;
              const daysAfter = Math.max(
                0,
                Math.floor((rawCreatedAt - conversationTs) / (24 * 60 * 60 * 1000))
              );

              const legacyContent =
                typeof record.content_text === "string"
                  ? record.content_text
                  : typeof record.content === "string"
                    ? record.content
                    : "";

              record.content_text = legacyContent;
              record.created_at = rawCreatedAt;
              record.days_after = daysAfter;
              delete record.content;
              delete record.updated_at;
            });

          await tx
            .table("messages")
            .toCollection()
          .modify((record: Partial<MessageRecord>) => {
            const normalizedDegradedCount = normalizePersistedDegradedNodesCount(
              record.degraded_nodes_count
            );
            if (normalizedDegradedCount !== record.degraded_nodes_count) {
              record.degraded_nodes_count = normalizedDegradedCount;
            }

            if (
              (record.content_ast_version !== "ast_v1" &&
                record.content_ast_version !== "ast_v2") ||
              !isAstRoot(record.content_ast)
            ) {
              return;
            }

            const astStats = inspectAstStructure(record.content_ast);
            if (!astStats.hasMath) {
              return;
            }

            const canonicalText = extractAstPlainText(record.content_ast);
            if (
              canonicalText &&
              canonicalText !== record.content_text &&
              shouldPreferAstCanonicalText({
                root: record.content_ast,
                fallbackText:
                  typeof record.content_text === "string" ? record.content_text : "",
              })
            ) {
              record.content_text = canonicalText;
            }
          });
      });
    this.version(14)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes:
          "++id, created_at, updated_at, source_type, source_path, [source_type+updated_at], [source_type+source_path]",
        annotations:
          "++id, conversation_id, message_id, created_at, days_after, [conversation_id+message_id], [conversation_id+created_at]",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
      })
      .upgrade(async (tx) => {
        const notesTable = tx.table("notes");
        const records = await notesTable.toArray();

        for (const rawRecord of records) {
          const record = rawRecord as Partial<NoteRecord>;
          if (typeof record.id !== "number") {
            continue;
          }

          const content = typeof record.content === "string" ? record.content : "";
          await notesTable.update(record.id, {
            excerpt: buildNoteExcerpt(content),
            hash: await computeNoteHash(content),
            source_type: record.source_type ?? "native",
            source_path: record.source_path ?? null,
            import_meta: record.import_meta ?? null,
            linked_conversation_ids: Array.isArray(record.linked_conversation_ids)
              ? record.linked_conversation_ids.filter(
                  (item): item is number => typeof item === "number"
                )
              : [],
          } satisfies Partial<NoteRecord>);
        }
      });
    this.version(15)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes:
          "++id, created_at, updated_at, source_type, source_path, [source_type+updated_at], [source_type+source_path]",
        note_sources: "id, kind, updated_at, created_at",
        note_assets:
          "id, vault_id, relative_path, hash, updated_at, [vault_id+relative_path]",
        annotations:
          "++id, conversation_id, message_id, created_at, days_after, [conversation_id+message_id], [conversation_id+created_at]",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
      })
      .upgrade(() => undefined);
    this.version(16)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes:
          "++id, created_at, updated_at, source_type, source_path, [source_type+updated_at], [source_type+source_path]",
        note_sources: "id, kind, updated_at, created_at",
        note_assets:
          "id, vault_id, relative_path, hash, updated_at, [vault_id+relative_path]",
        annotations:
          "++id, conversation_id, message_id, created_at, days_after, [conversation_id+message_id], [conversation_id+created_at]",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
      })
      .upgrade(async (tx) => {
        await tx
          .table("notes")
          .toCollection()
          .modify((record: Partial<NoteRecord>) => {
            if (record.obsidian_export === undefined) {
              record.obsidian_export = null
            }
          });
      });
    // v17 introduces the Prompt Management store. No data migration is needed
    // (new empty store); all prior stores are re-declared unchanged as Dexie
    // requires the full schema per version.
    this.version(17)
      .stores({
        conversations:
          "++id, platform, title, created_at, updated_at, uuid, source_created_at, turn_count, topic_id, is_starred, [platform+created_at], [platform+uuid], [topic_id+updated_at]",
        messages:
          "++id, conversation_id, role, created_at, [conversation_id+created_at]",
        summaries: "++id, conversationId, createdAt",
        weekly_reports: "++id, rangeStart, rangeEnd, createdAt",
        topics:
          "++id, parent_id, name, created_at, updated_at, [parent_id+name]",
        vectors: "++id, conversation_id, text_hash",
        notes:
          "++id, created_at, updated_at, source_type, source_path, [source_type+updated_at], [source_type+source_path]",
        note_sources: "id, kind, updated_at, created_at",
        note_assets:
          "id, vault_id, relative_path, hash, updated_at, [vault_id+relative_path]",
        annotations:
          "++id, conversation_id, message_id, created_at, days_after, [conversation_id+message_id], [conversation_id+created_at]",
        explore_sessions: "id, updatedAt, createdAt",
        explore_messages: "id, sessionId, timestamp, [sessionId+timestamp]",
        prompts:
          "++id, source, category, is_favorite, is_archived, quality_score, updated_at, last_used_at, use_count, body_hash, source_conversation_id, [source+updated_at], [is_favorite+updated_at]",
      })
      .upgrade(() => undefined);
  }
}

function normalizePersistedDegradedNodesCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export const db = new MemoryHubDB();
