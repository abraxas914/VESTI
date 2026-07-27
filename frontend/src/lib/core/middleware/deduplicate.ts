import type { ConversationDraft, ParsedMessage } from "../../messaging/protocol";
import { countAiTurns } from "../../capture/turn-metrics";
import {
  db,
  resolveConversationRecordOriginAt,
} from "../../db/schema";
import type { ConversationRecord, MessageRecord } from "../../db/schema";
import { enforceStorageWriteGuard } from "../../db/storageLimits";
import { isAstRoot } from "../../utils/astText";
import { normalizeMessageAttachments } from "../../utils/messageAttachments";
import { buildRichOnlyNormalizedHtmlSnapshot } from "../../utils/normalizedHtmlSnapshot";
import { normalizeMessageArtifacts } from "../../utils/messageArtifacts";
import { normalizeMessageCitations } from "../../utils/messageCitations";

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildParsedSignatures(messages: ParsedMessage[]): string[] {
  return messages.map((message) =>
    buildSignature({
      role: message.role,
      contentText: message.textContent,
      contentAst: message.contentAst ?? null,
      contentAstVersion: message.contentAstVersion ?? null,
        degradedNodesCount: message.degradedNodesCount,
        citations: message.citations ?? [],
        attachments: message.attachments ?? [],
        artifacts: message.artifacts ?? [],
        normalizedHtmlSnapshot: message.normalizedHtmlSnapshot ?? null,
      })
  );
}

function buildStoredSignatures(messages: MessageRecord[]): string[] {
  return [...messages]
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at - b.created_at;
      const aId = a.id ?? 0;
      const bId = b.id ?? 0;
      return aId - bId;
    })
    .map((message) =>
      buildSignature({
        role: message.role,
        contentText: message.content_text,
        contentAst: isAstRoot(message.content_ast) ? message.content_ast : null,
        contentAstVersion: message.content_ast_version ?? null,
        degradedNodesCount: message.degraded_nodes_count,
        citations: message.citations ?? [],
        attachments: message.attachments ?? [],
        artifacts: message.artifacts ?? [],
        normalizedHtmlSnapshot: message.normalized_html_snapshot ?? null,
      })
    );
}

function signaturesMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sanitizeIncomingMessages(messages: ParsedMessage[]): ParsedMessage[] {
  return messages.filter(
    (message) =>
      normalizeText(message.textContent).length > 0 ||
      (message.attachments?.length ?? 0) > 0 ||
      (message.artifacts?.length ?? 0) > 0,
  );
}

function normalizeDegradedNodesCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function buildSignature(params: {
  role: "user" | "ai";
  contentText: string;
  contentAst: unknown | null;
  contentAstVersion: string | null | undefined;
  degradedNodesCount: number | undefined;
  citations: unknown;
  attachments: unknown;
  artifacts: unknown;
  normalizedHtmlSnapshot: string | null;
}): string {
  const {
    role,
    contentText,
    contentAst,
    contentAstVersion,
    degradedNodesCount,
    citations,
    attachments,
    artifacts,
    normalizedHtmlSnapshot,
  } = params;
  const astSignature = contentAst ? JSON.stringify(contentAst) : "";
  const citationSignature = JSON.stringify(
    normalizeMessageCitations(citations).map((citation) => ({
      label: citation.label,
      href: citation.href,
      host: citation.host,
      sourceType: citation.sourceType,
    }))
  );
  const artifactSignature = JSON.stringify(
    normalizeMessageArtifacts(artifacts).map((artifact) => ({
      kind: artifact.kind,
      label: artifact.label ?? "",
      captureMode: artifact.captureMode ?? null,
      renderDimensions: artifact.renderDimensions ?? null,
      plainText: artifact.plainText ?? null,
      markdownSnapshot: artifact.markdownSnapshot ?? null,
      normalizedHtmlSnapshot: artifact.normalizedHtmlSnapshot ?? null,
    }))
  );
  const attachmentSignature = JSON.stringify(
    normalizeMessageAttachments(attachments).map((attachment) => ({
      indexAlt: attachment.indexAlt,
      label: attachment.label ?? null,
      mime: attachment.mime ?? null,
      occurrenceRole: attachment.occurrenceRole,
    }))
  );
  const snapshotSignature = normalizedHtmlSnapshot ?? "";
  return [
    role,
    normalizeText(contentText),
    contentAstVersion ?? "",
    normalizeDegradedNodesCount(degradedNodesCount),
    astSignature,
    citationSignature,
    attachmentSignature,
    artifactSignature,
    snapshotSignature,
  ].join("|");
}

function resolveSourceCreatedAt(
  existingSourceCreatedAt: number | null,
  incomingSourceCreatedAt: number | null
): number | null {
  if (existingSourceCreatedAt !== null) {
    return existingSourceCreatedAt;
  }
  return incomingSourceCreatedAt;
}

function resolveFirstCapturedAt(
  existingFirstCapturedAt: number | undefined,
  incomingFirstCapturedAt: number,
  fallbackCreatedAt: number
): number {
  if (
    typeof existingFirstCapturedAt === "number" &&
    Number.isFinite(existingFirstCapturedAt) &&
    existingFirstCapturedAt > 0
  ) {
    return existingFirstCapturedAt;
  }

  if (Number.isFinite(incomingFirstCapturedAt) && incomingFirstCapturedAt > 0) {
    return incomingFirstCapturedAt;
  }

  return fallbackCreatedAt;
}

export async function deduplicateAndSave(
  conversation: ConversationDraft,
  messages: ParsedMessage[]
): Promise<{ saved: boolean; newMessages: number; conversationId?: number }> {
  const cleanMessages = sanitizeIncomingMessages(messages);
  if (cleanMessages.length === 0) {
    return { saved: false, newMessages: 0 };
  }

  await enforceStorageWriteGuard();
  const turnCount = countAiTurns(cleanMessages);
  const persistedAt = Date.now();

  return db.transaction("rw", db.conversations, db.messages, async () => {
    const existing = await db.conversations
      .where("[platform+uuid]")
      .equals([conversation.platform, conversation.uuid])
      .first();

    if (existing && existing.id !== undefined) {
      const existingMessages = await db.messages
        .where("conversation_id")
        .equals(existing.id)
        .toArray();

      const incomingSignatures = buildParsedSignatures(cleanMessages);
      const storedSignatures = buildStoredSignatures(existingMessages);

      if (signaturesMatch(incomingSignatures, storedSignatures)) {
        if (conversation.isMock === true && existing.isMock !== true) {
          await db.conversations.update(existing.id, { isMock: true });
        }
        return { saved: false, newMessages: 0, conversationId: existing.id };
      }

      // Guard against destructive recaptures: a perf-mode downgrade or a
      // virtualized (partially-rendered) thread can yield FEWER or more-degraded
      // messages than we already stored. Overwriting then silently loses data,
      // so skip the wholesale delete+reinsert when the incoming set is clearly
      // poorer (fewer messages, or same count but more degraded nodes).
      const incomingDegraded = cleanMessages.reduce(
        (sum, message) => sum + normalizeDegradedNodesCount(message.degradedNodesCount),
        0
      );
      const storedDegraded = existingMessages.reduce(
        (sum, message) => sum + normalizeDegradedNodesCount(message.degraded_nodes_count),
        0
      );
      const incomingIsPoorer =
        cleanMessages.length < existingMessages.length ||
        (cleanMessages.length === existingMessages.length &&
          incomingDegraded > storedDegraded);
      if (incomingIsPoorer) {
        return { saved: false, newMessages: 0, conversationId: existing.id };
      }

      await db.messages.where("conversation_id").equals(existing.id).delete();

      const baseTimestamp = Date.now();
      const inserts: MessageRecord[] = cleanMessages.map((message, index) => ({
        conversation_id: existing.id!,
        role: message.role,
        content_text: message.textContent,
        content_ast: message.contentAst ?? null,
        content_ast_version: message.contentAstVersion ?? null,
        degraded_nodes_count: normalizeDegradedNodesCount(message.degradedNodesCount),
        citations: normalizeMessageCitations(message.citations ?? []),
        attachments: normalizeMessageAttachments(message.attachments ?? []),
        artifacts: normalizeMessageArtifacts(message.artifacts ?? []),
        normalized_html_snapshot:
          message.normalizedHtmlSnapshot ??
          buildRichOnlyNormalizedHtmlSnapshot({
            html: message.htmlContent ?? null,
            ast: message.contentAst ?? null,
            hasCitations: (message.citations ?? []).length > 0,
            hasAttachments: (message.attachments ?? []).length > 0,
            hasArtifacts: (message.artifacts ?? []).length > 0,
          }),
        created_at: message.timestamp ?? baseTimestamp + index,
      }));

      await db.messages.bulkAdd(inserts);

      // Keep user-renamed titles stable across recaptures.
      const mergedSourceCreatedAt = resolveSourceCreatedAt(
        existing.source_created_at ?? null,
        conversation.source_created_at
      );
      const mergedFirstCapturedAt = resolveFirstCapturedAt(
        existing.first_captured_at,
        conversation.first_captured_at,
        existing.created_at
      );

      await db.conversations.update(existing.id, {
        updated_at: persistedAt,
        last_captured_at: persistedAt,
        message_count: cleanMessages.length,
        turn_count: turnCount,
        snippet: cleanMessages[0]?.textContent.slice(0, 100) ?? conversation.snippet,
        source_created_at: mergedSourceCreatedAt,
        first_captured_at: mergedFirstCapturedAt,
        isMock: existing.isMock === true || conversation.isMock === true,
        origin_at: resolveConversationRecordOriginAt({
          source_created_at: mergedSourceCreatedAt,
          first_captured_at: mergedFirstCapturedAt,
          created_at: existing.created_at,
        }),
      } as Partial<ConversationRecord>);

      return {
        saved: true,
        newMessages: Math.max(0, cleanMessages.length - existingMessages.length),
        conversationId: existing.id,
      };
    }

    const firstCapturedAt = resolveFirstCapturedAt(
      undefined,
      conversation.first_captured_at,
      persistedAt
    );
    const record: ConversationRecord = {
      ...conversation,
      first_captured_at: firstCapturedAt,
      last_captured_at: persistedAt,
      created_at: persistedAt,
      updated_at: persistedAt,
      origin_at: resolveConversationRecordOriginAt({
        source_created_at: conversation.source_created_at,
        first_captured_at: firstCapturedAt,
        created_at: persistedAt,
      }),
      message_count: cleanMessages.length,
      turn_count: turnCount,
      snippet: cleanMessages[0]?.textContent.slice(0, 100) ?? conversation.snippet,
    };

    const conversationId = await db.conversations.add(record);

    const baseTimestamp = Date.now();
    const inserts: MessageRecord[] = cleanMessages.map((message, index) => ({
      conversation_id: conversationId,
      role: message.role,
      content_text: message.textContent,
      content_ast: message.contentAst ?? null,
        content_ast_version: message.contentAstVersion ?? null,
        degraded_nodes_count: normalizeDegradedNodesCount(message.degradedNodesCount),
        citations: normalizeMessageCitations(message.citations ?? []),
        attachments: normalizeMessageAttachments(message.attachments ?? []),
        artifacts: normalizeMessageArtifacts(message.artifacts ?? []),
        normalized_html_snapshot:
          message.normalizedHtmlSnapshot ??
        buildRichOnlyNormalizedHtmlSnapshot({
            html: message.htmlContent ?? null,
            ast: message.contentAst ?? null,
            hasCitations: (message.citations ?? []).length > 0,
            hasAttachments: (message.attachments ?? []).length > 0,
            hasArtifacts: (message.artifacts ?? []).length > 0,
          }),
        created_at: message.timestamp ?? baseTimestamp + index,
    }));

    await db.messages.bulkAdd(inserts);

    return { saved: true, newMessages: cleanMessages.length, conversationId };
  });
}
