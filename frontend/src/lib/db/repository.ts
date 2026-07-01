import {
  getConversationCaptureFreshnessAt,
  getConversationFirstCapturedAt,
  getConversationOriginAt
} from "../conversations/timestamps"
import type { ConversationFilters } from "../messaging/protocol"
import { normalizePlatform, SUPPORTED_PLATFORMS } from "../platform"
import {
  buildExportJsonV1,
  buildExportMdV1,
  buildExportTxtV1
} from "../services/exportSerializers"
import type {
  Annotation,
  Conversation,
  ConversationMatchSummary,
  ConversationSummaryV2,
  CreateNoteInput,
  DashboardStats,
  DataOverviewSnapshot,
  ExploreAgentMeta,
  ExploreMessage,
  ExploreSession,
  ExportFormat,
  ExportPayload,
  ImportDataResult,
  InsightFormat,
  InsightStatus,
  Message,
  Note,
  NoteImportAssetRef,
  NoteImportMeta,
  NoteObsidianExportMeta,
  ObsidianImportFileEntry,
  ObsidianImportSummary,
  Platform,
  RelatedConversation,
  SearchConversationMatchesQuery,
  SearchMatchSurface,
  StorageUsageSnapshot,
  SummaryRecord,
  Topic,
  UpdateNoteChanges,
  WeeklyLiteReportV1,
  WeeklyReportRecord
} from "../types"
import { normalizeMessageArtifacts } from "../utils/messageArtifacts"
import { normalizeMessageAttachments } from "../utils/messageAttachments"
import { normalizeMessageCitations } from "../utils/messageCitations"
import {
  buildAnnotationSearchEntry,
  buildMessageSearchEntries,
  buildSearchExcerpt,
  compareSearchSurfacePriority
} from "../utils/messageSearchProjection"
import {
  normalizeSearchQuery,
  shouldRunFullTextSearch
} from "../utils/searchReadiness"
import {
  buildNoteExcerpt,
  computeNoteHash,
  extractFrontmatterTitle,
  parseNoteFrontmatter,
  updateFrontmatterTitle
} from "../notes/markdown"
import {
  prepareObsidianDirectoryImport,
  prepareObsidianZipImport
} from "../notes/obsidianImport"
import { db } from "./schema"
import type {
  AnnotationRecord,
  ConversationRecord,
  ExploreMessageRecord,
  ExploreSessionRecord,
  MessageRecord,
  NoteAssetRecord,
  NoteRecord,
  NoteSourceRecord,
  SummaryRecordRecord,
  TopicRecord,
  WeeklyReportRecordRecord
} from "./schema"
import {
  enforceStorageWriteGuard,
  getStorageUsageSnapshot
} from "./storageLimits"

type ExploreSourceRecord = RelatedConversation

function normalizeExploreSources(
  sources: ExploreSourceRecord[] | undefined
): ExploreSourceRecord[] | undefined {
  if (!sources) {
    return undefined
  }

  return sources.flatMap((source) => {
    const platform = normalizePlatform(source.platform)
    if (!platform) {
      return []
    }

    return [{ ...source, platform }]
  })
}

function parseExploreSources(raw?: string): ExploreSourceRecord[] | undefined {
  if (!raw) {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw) as ExploreSourceRecord[]
    return normalizeExploreSources(parsed)
  } catch {
    return undefined
  }
}

function normalizeExploreAgentMeta(
  meta: ExploreAgentMeta | undefined
): ExploreAgentMeta | undefined {
  if (!meta) {
    return undefined
  }

  const normalizedCandidates = Array.isArray(meta.contextCandidates)
    ? meta.contextCandidates
        .filter((candidate) => candidate && typeof candidate === "object")
        .map((candidate) => {
          const platform = normalizePlatform(candidate.platform)
          return {
            ...candidate,
            platform: platform ?? candidate.platform
          }
        })
    : undefined

  const selectedContextConversationIds = Array.isArray(
    meta.selectedContextConversationIds
  )
    ? meta.selectedContextConversationIds.filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id)
      )
    : undefined

  const toolCalls = Array.isArray(meta.toolCalls)
    ? meta.toolCalls
        .filter((toolCall) => toolCall && typeof toolCall === "object")
        .map((toolCall) => ({
          ...toolCall,
          description:
            typeof toolCall.description === "string"
              ? toolCall.description
              : undefined
        }))
    : []

  const searchScope =
    meta.searchScope && typeof meta.searchScope === "object"
      ? {
          mode:
            meta.searchScope.mode === "selected"
              ? ("selected" as const)
              : ("all" as const),
          conversationIds: Array.isArray(meta.searchScope.conversationIds)
            ? meta.searchScope.conversationIds.filter(
                (id): id is number =>
                  typeof id === "number" && Number.isFinite(id)
              )
            : undefined
        }
      : undefined

  const requestedTimeScope =
    meta.plan?.requestedTimeScope &&
    typeof meta.plan.requestedTimeScope === "object"
      ? {
          preset:
            meta.plan.requestedTimeScope.preset === "current_week_to_date" ||
            meta.plan.requestedTimeScope.preset === "last_7_days" ||
            meta.plan.requestedTimeScope.preset === "last_full_week" ||
            meta.plan.requestedTimeScope.preset === "custom"
              ? meta.plan.requestedTimeScope.preset
              : ("none" as const),
          label:
            typeof meta.plan.requestedTimeScope.label === "string"
              ? meta.plan.requestedTimeScope.label
              : undefined,
          startDate:
            typeof meta.plan.requestedTimeScope.startDate === "string"
              ? meta.plan.requestedTimeScope.startDate
              : undefined,
          endDate:
            typeof meta.plan.requestedTimeScope.endDate === "string"
              ? meta.plan.requestedTimeScope.endDate
              : undefined
        }
      : undefined

  const resolvedTimeScope =
    meta.plan?.resolvedTimeScope &&
    typeof meta.plan.resolvedTimeScope === "object"
      ? {
          preset:
            meta.plan.resolvedTimeScope.preset === "current_week_to_date" ||
            meta.plan.resolvedTimeScope.preset === "last_7_days" ||
            meta.plan.resolvedTimeScope.preset === "last_full_week" ||
            meta.plan.resolvedTimeScope.preset === "custom"
              ? meta.plan.resolvedTimeScope.preset
              : ("last_7_days" as const),
          label:
            typeof meta.plan.resolvedTimeScope.label === "string"
              ? meta.plan.resolvedTimeScope.label
              : "Resolved range",
          rangeStart:
            typeof meta.plan.resolvedTimeScope.rangeStart === "number" &&
            Number.isFinite(meta.plan.resolvedTimeScope.rangeStart)
              ? meta.plan.resolvedTimeScope.rangeStart
              : 0,
          rangeEnd:
            typeof meta.plan.resolvedTimeScope.rangeEnd === "number" &&
            Number.isFinite(meta.plan.resolvedTimeScope.rangeEnd)
              ? meta.plan.resolvedTimeScope.rangeEnd
              : 0,
          startDate:
            typeof meta.plan.resolvedTimeScope.startDate === "string"
              ? meta.plan.resolvedTimeScope.startDate
              : "",
          endDate:
            typeof meta.plan.resolvedTimeScope.endDate === "string"
              ? meta.plan.resolvedTimeScope.endDate
              : ""
        }
      : undefined

  const plan =
    meta.plan && typeof meta.plan === "object"
      ? {
          intent:
            meta.plan.intent === "cross_conversation_summary" ||
            meta.plan.intent === "weekly_review" ||
            meta.plan.intent === "timeline" ||
            meta.plan.intent === "clarification_needed"
              ? meta.plan.intent
              : ("fact_lookup" as const),
          reason:
            typeof meta.plan.reason === "string"
              ? meta.plan.reason
              : "UNSPECIFIED_REASON",
          preferredPath:
            meta.plan.preferredPath === "weekly_summary" ||
            meta.plan.preferredPath === "clarify"
              ? meta.plan.preferredPath
              : ("rag" as const),
          sourceLimit:
            typeof meta.plan.sourceLimit === "number" &&
            Number.isFinite(meta.plan.sourceLimit)
              ? meta.plan.sourceLimit
              : 5,
          summaryTargetCount:
            typeof meta.plan.summaryTargetCount === "number" &&
            Number.isFinite(meta.plan.summaryTargetCount)
              ? meta.plan.summaryTargetCount
              : 0,
          answerGoal:
            typeof meta.plan.answerGoal === "string"
              ? meta.plan.answerGoal
              : undefined,
          needsClarification:
            typeof meta.plan.needsClarification === "boolean"
              ? meta.plan.needsClarification
              : undefined,
          clarifyingQuestion:
            typeof meta.plan.clarifyingQuestion === "string"
              ? meta.plan.clarifyingQuestion
              : undefined,
          requestedTimeScope,
          resolvedTimeScope:
            resolvedTimeScope &&
            resolvedTimeScope.rangeStart > 0 &&
            resolvedTimeScope.rangeEnd >= resolvedTimeScope.rangeStart
              ? resolvedTimeScope
              : undefined,
          toolPlan: Array.isArray(meta.plan.toolPlan)
            ? meta.plan.toolPlan.filter(
                (
                  toolName
                ): toolName is NonNullable<
                  typeof meta.plan
                >["toolPlan"][number] => typeof toolName === "string"
              )
            : undefined
        }
      : undefined

  return {
    ...meta,
    query: typeof meta.query === "string" ? meta.query : undefined,
    searchScope,
    plan,
    toolCalls,
    contextCandidates: normalizedCandidates,
    selectedContextConversationIds
  }
}

function parseExploreAgentMeta(raw?: string): ExploreAgentMeta | undefined {
  if (!raw) {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw) as ExploreAgentMeta
    return normalizeExploreAgentMeta(parsed)
  } catch {
    return undefined
  }
}

function serializeExploreAgentMeta(
  meta?: ExploreAgentMeta
): string | undefined {
  const normalized = normalizeExploreAgentMeta(meta)
  if (!normalized) {
    return undefined
  }

  try {
    return JSON.stringify(normalized)
  } catch {
    return undefined
  }
}

function toConversation(record: ConversationRecord): Conversation {
  if (record.id === undefined) {
    throw new Error("Conversation record missing id")
  }
  const messageCount =
    typeof record.message_count === "number" &&
    Number.isFinite(record.message_count)
      ? Math.max(0, Math.floor(record.message_count))
      : 0
  const turnCount =
    typeof record.turn_count === "number" && Number.isFinite(record.turn_count)
      ? Math.max(0, Math.floor(record.turn_count))
      : Math.floor(messageCount / 2)
  const platform = normalizePlatform(
    (record as { platform?: unknown }).platform
  )
  const createdAt =
    typeof record.created_at === "number" && Number.isFinite(record.created_at)
      ? record.created_at
      : 0
  const updatedAt =
    typeof record.updated_at === "number" && Number.isFinite(record.updated_at)
      ? record.updated_at
      : createdAt
  const firstCapturedAt =
    typeof record.first_captured_at === "number" &&
    Number.isFinite(record.first_captured_at)
      ? record.first_captured_at
      : createdAt
  const lastCapturedAt =
    typeof record.last_captured_at === "number" &&
    Number.isFinite(record.last_captured_at)
      ? record.last_captured_at
      : updatedAt

  return {
    ...(record as Conversation),
    platform: platform ?? record.platform,
    source_created_at:
      typeof record.source_created_at === "number" &&
      Number.isFinite(record.source_created_at)
        ? record.source_created_at
        : null,
    created_at: createdAt,
    updated_at: updatedAt,
    first_captured_at: firstCapturedAt,
    last_captured_at: lastCapturedAt,
    turn_count: turnCount
  }
}

function toTopic(record: TopicRecord): Topic {
  if (record.id === undefined) {
    throw new Error("Topic record missing id")
  }
  return {
    ...record,
    id: record.id
  }
}

function toMessage(record: MessageRecord): Message {
  if (record.id === undefined) {
    throw new Error("Message record missing id")
  }
  const degradedNodesCount =
    typeof record.degraded_nodes_count === "number" &&
    Number.isFinite(record.degraded_nodes_count)
      ? Math.max(0, Math.floor(record.degraded_nodes_count))
      : 0

  return {
    ...(record as Message),
    content_ast: (record.content_ast ?? null) as Message["content_ast"],
    content_ast_version: record.content_ast_version ?? null,
    degraded_nodes_count: degradedNodesCount,
    citations: normalizeMessageCitations(record.citations),
    attachments: normalizeMessageAttachments(record.attachments),
    artifacts: normalizeMessageArtifacts(record.artifacts),
    normalized_html_snapshot:
      typeof record.normalized_html_snapshot === "string"
        ? record.normalized_html_snapshot
        : null
  }
}

function toAnnotation(record: AnnotationRecord & { id: number }): Annotation {
  return {
    id: record.id,
    conversation_id: record.conversation_id,
    message_id: record.message_id,
    content_text: record.content_text,
    created_at: record.created_at,
    days_after: record.days_after
  }
}

export interface AnnotationExportContext {
  annotation: Annotation
  conversation: Conversation
  message: Message
  messages: Message[]
}

function toSummary(record: SummaryRecordRecord): SummaryRecord {
  if (record.id === undefined) {
    throw new Error("Summary record missing id")
  }

  const summary = record as SummaryRecord
  const format: InsightFormat =
    summary.format ?? (summary.structured ? "structured_v1" : "plain_text")
  const status: InsightStatus =
    summary.status ?? (summary.structured ? "ok" : "fallback")

  const isV2Structured = (value: unknown): value is ConversationSummaryV2 => {
    if (!value || typeof value !== "object") return false
    return "core_question" in value && "thinking_journey" in value
  }

  return {
    ...summary,
    structured: summary.structured ?? null,
    format,
    status,
    schemaVersion:
      summary.schemaVersion ??
      (isV2Structured(summary.structured)
        ? "conversation_summary.v2"
        : summary.structured
          ? "conversation_summary.v1"
          : undefined)
  }
}

function toWeeklyReport(record: WeeklyReportRecordRecord): WeeklyReportRecord {
  if (record.id === undefined) {
    throw new Error("Weekly report record missing id")
  }

  const weekly = record as WeeklyReportRecord
  const format: InsightFormat =
    weekly.format ?? (weekly.structured ? "structured_v1" : "plain_text")
  const status: InsightStatus =
    weekly.status ?? (weekly.structured ? "ok" : "fallback")

  const isWeeklyLiteStructured = (
    value: unknown
  ): value is WeeklyLiteReportV1 => {
    if (!value || typeof value !== "object") return false
    return "time_range" in value && "highlights" in value
  }

  return {
    ...weekly,
    structured: weekly.structured ?? null,
    format,
    status,
    schemaVersion:
      weekly.schemaVersion ??
      (isWeeklyLiteStructured(weekly.structured)
        ? "weekly_lite.v1"
        : weekly.structured
          ? "weekly_report.v1"
          : undefined)
  }
}

function normalizeTag(tag: string): string {
  return tag.replace(/\s+/g, " ").trim()
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const tag of tags) {
    const normalized = normalizeTag(tag)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

type ImportObject = Record<string, unknown>

const IMPORT_SUMMARY_FORMATS = new Set<InsightFormat>([
  "plain_text",
  "structured_v1",
  "fallback_plain_text"
])
const IMPORT_SUMMARY_STATUSES = new Set<InsightStatus>(["ok", "fallback"])
const IMPORT_SUMMARY_SCHEMA_VERSIONS = new Set<
  NonNullable<SummaryRecord["schemaVersion"]>
>(["conversation_summary.v1", "conversation_summary.v2"])
const IMPORT_WEEKLY_SCHEMA_VERSIONS = new Set<
  NonNullable<WeeklyReportRecord["schemaVersion"]>
>(["weekly_report.v1", "weekly_lite.v1", "weekly_recap.v1"])

function invalidImport(path: string, message: string): never {
  throw new Error(`Invalid Vesti import JSON: ${path} ${message}`)
}

function asImportObject(value: unknown, path: string): ImportObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidImport(path, "must be an object.")
  }
  return value as ImportObject
}

function readImportArray(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean }
): unknown[] {
  const value = record[key]
  if (value == null && options?.optional) {
    return []
  }
  if (!Array.isArray(value)) {
    invalidImport(`${path}.${key}`, "must be an array.")
  }
  return value
}

function readImportString(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean; fallback?: string }
): string {
  const value = record[key]
  if (typeof value === "string") {
    return value
  }
  if (value == null && options?.optional) {
    return options.fallback ?? ""
  }
  invalidImport(`${path}.${key}`, "must be a string.")
}

function readImportNumber(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean; fallback?: number }
): number {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (
    value == null &&
    options?.optional &&
    typeof options.fallback === "number"
  ) {
    return options.fallback
  }
  invalidImport(`${path}.${key}`, "must be a finite number.")
}

function readImportBoolean(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean; fallback?: boolean }
): boolean {
  const value = record[key]
  if (typeof value === "boolean") {
    return value
  }
  if (value == null && options?.optional) {
    return options.fallback ?? false
  }
  invalidImport(`${path}.${key}`, "must be a boolean.")
}

function readImportNullableNumber(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean }
): number | null {
  const value = record[key]
  if (value == null && options?.optional) {
    return null
  }
  if (value === null) {
    return null
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  invalidImport(`${path}.${key}`, "must be a finite number or null.")
}

function readImportInteger(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean; fallback?: number; min?: number }
): number {
  const value = readImportNumber(record, key, path, options)
  const normalized = Math.floor(value)
  if (normalized !== value) {
    invalidImport(`${path}.${key}`, "must be an integer.")
  }
  if (typeof options?.min === "number" && normalized < options.min) {
    invalidImport(`${path}.${key}`, `must be >= ${options.min}.`)
  }
  return normalized
}

function readImportNullableInteger(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean; min?: number }
): number | null {
  const value = readImportNullableNumber(record, key, path, options)
  if (value === null) {
    return null
  }
  const normalized = Math.floor(value)
  if (normalized !== value) {
    invalidImport(`${path}.${key}`, "must be an integer or null.")
  }
  if (typeof options?.min === "number" && normalized < options.min) {
    invalidImport(`${path}.${key}`, `must be >= ${options.min} or null.`)
  }
  return normalized
}

function readImportStringArray(
  record: ImportObject,
  key: string,
  path: string,
  options?: { optional?: boolean }
): string[] {
  const value = record[key]
  if (value == null && options?.optional) {
    return []
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalidImport(`${path}.${key}`, "must be an array of strings.")
  }
  return value as string[]
}

function normalizeImportNonNegativeInt(value: number): number {
  return Math.max(0, Math.floor(value))
}

function parseImportJsonContent(content: string): unknown {
  const trimmed = content.replace(/^\uFEFF/, "").trim()
  if (!trimmed) {
    throw new Error("Import file is empty.")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error("Import file is not valid JSON.")
  }

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      throw new Error("Import file is double-encoded and could not be parsed.")
    }
  }

  return parsed
}

function normalizeImportedConversation(
  value: unknown,
  index: number
): ConversationRecord {
  const path = `data.conversations[${index}]`
  const record = asImportObject(value, path)
  const id = readImportInteger(record, "id", path, { min: 1 })
  const platform = normalizePlatform(record.platform)
  if (!platform) {
    invalidImport(
      `${path}.platform`,
      "must be one of the supported Vesti platforms."
    )
  }
  const createdAt = readImportNumber(record, "created_at", path)
  const updatedAt = readImportNumber(record, "updated_at", path, {
    optional: true,
    fallback: createdAt
  })
  const firstCapturedAt = readImportNumber(record, "first_captured_at", path, {
    optional: true,
    fallback: createdAt
  })
  const lastCapturedAt = readImportNumber(record, "last_captured_at", path, {
    optional: true,
    fallback: updatedAt
  })

  return {
    id,
    uuid: readImportString(record, "uuid", path),
    platform,
    title: readImportString(record, "title", path),
    snippet: readImportString(record, "snippet", path, {
      optional: true,
      fallback: ""
    }),
    url: readImportString(record, "url", path, {
      optional: true,
      fallback: ""
    }),
    source_created_at: readImportNullableNumber(
      record,
      "source_created_at",
      path,
      {
        optional: true
      }
    ),
    first_captured_at: firstCapturedAt,
    last_captured_at: lastCapturedAt,
    created_at: createdAt,
    updated_at: updatedAt,
    message_count: normalizeImportNonNegativeInt(
      readImportNumber(record, "message_count", path, {
        optional: true,
        fallback: 0
      })
    ),
    turn_count: normalizeImportNonNegativeInt(
      readImportNumber(record, "turn_count", path, {
        optional: true,
        fallback: 0
      })
    ),
    is_archived: readImportBoolean(record, "is_archived", path, {
      optional: true,
      fallback: false
    }),
    is_trash: readImportBoolean(record, "is_trash", path, {
      optional: true,
      fallback: false
    }),
    tags: dedupeTags(
      readImportStringArray(record, "tags", path, { optional: true })
    ).slice(0, 6),
    topic_id: readImportNullableInteger(record, "topic_id", path, {
      optional: true,
      min: 1
    }),
    is_starred: readImportBoolean(record, "is_starred", path, {
      optional: true,
      fallback: false
    })
  }
}

function normalizeImportedMessage(
  value: unknown,
  index: number
): MessageRecord {
  const path = `data.messages[${index}]`
  const record = asImportObject(value, path)
  const role = record.role
  if (role !== "user" && role !== "ai") {
    invalidImport(`${path}.role`, 'must be "user" or "ai".')
  }

  return {
    id: readImportInteger(record, "id", path, { min: 1 }),
    conversation_id: readImportInteger(record, "conversation_id", path, {
      min: 1
    }),
    role,
    content_text: readImportString(record, "content_text", path, {
      optional: true,
      fallback: ""
    }),
    content_ast: record.content_ast ?? null,
    content_ast_version:
      record.content_ast_version === "ast_v1" ||
      record.content_ast_version === "ast_v2"
        ? record.content_ast_version
        : null,
    degraded_nodes_count: normalizeImportNonNegativeInt(
      readImportNumber(record, "degraded_nodes_count", path, {
        optional: true,
        fallback: 0
      })
    ),
    citations: normalizeMessageCitations(record.citations),
    attachments: normalizeMessageAttachments(record.attachments),
    artifacts: normalizeMessageArtifacts(record.artifacts),
    normalized_html_snapshot:
      typeof record.normalized_html_snapshot === "string"
        ? record.normalized_html_snapshot
        : null,
    created_at: readImportNumber(record, "created_at", path)
  }
}

function normalizeImportedSummary(
  value: unknown,
  index: number
): SummaryRecordRecord {
  const path = `data.summaries[${index}]`
  const record = asImportObject(value, path)
  const format =
    typeof record.format === "string" &&
    IMPORT_SUMMARY_FORMATS.has(record.format as InsightFormat)
      ? (record.format as InsightFormat)
      : undefined
  const status =
    typeof record.status === "string" &&
    IMPORT_SUMMARY_STATUSES.has(record.status as InsightStatus)
      ? (record.status as InsightStatus)
      : undefined
  const schemaVersion =
    typeof record.schemaVersion === "string" &&
    IMPORT_SUMMARY_SCHEMA_VERSIONS.has(
      record.schemaVersion as NonNullable<SummaryRecord["schemaVersion"]>
    )
      ? (record.schemaVersion as NonNullable<SummaryRecord["schemaVersion"]>)
      : undefined

  return {
    id: readImportInteger(record, "id", path, { min: 1 }),
    conversationId: readImportInteger(record, "conversationId", path, {
      min: 1
    }),
    content: readImportString(record, "content", path),
    structured: (record.structured ?? null) as SummaryRecord["structured"],
    format,
    status,
    schemaVersion,
    modelId: readImportString(record, "modelId", path),
    createdAt: readImportNumber(record, "createdAt", path),
    sourceUpdatedAt: readImportNumber(record, "sourceUpdatedAt", path)
  }
}

function normalizeImportedWeeklyReport(
  value: unknown,
  index: number
): WeeklyReportRecordRecord {
  const path = `data.weeklyReports[${index}]`
  const record = asImportObject(value, path)
  const format =
    typeof record.format === "string" &&
    IMPORT_SUMMARY_FORMATS.has(record.format as InsightFormat)
      ? (record.format as InsightFormat)
      : undefined
  const status =
    typeof record.status === "string" &&
    IMPORT_SUMMARY_STATUSES.has(record.status as InsightStatus)
      ? (record.status as InsightStatus)
      : undefined
  const schemaVersion =
    typeof record.schemaVersion === "string" &&
    IMPORT_WEEKLY_SCHEMA_VERSIONS.has(
      record.schemaVersion as NonNullable<WeeklyReportRecord["schemaVersion"]>
    )
      ? (record.schemaVersion as NonNullable<
          WeeklyReportRecord["schemaVersion"]
        >)
      : undefined

  return {
    id: readImportInteger(record, "id", path, { min: 1 }),
    rangeStart: readImportNumber(record, "rangeStart", path),
    rangeEnd: readImportNumber(record, "rangeEnd", path),
    content: readImportString(record, "content", path),
    structured: (record.structured ?? null) as WeeklyReportRecord["structured"],
    format,
    status,
    schemaVersion,
    modelId: readImportString(record, "modelId", path),
    createdAt: readImportNumber(record, "createdAt", path),
    sourceHash: readImportString(record, "sourceHash", path)
  }
}

function normalizeImportedAnnotation(
  value: unknown,
  index: number
): AnnotationRecord {
  const path = `data.annotations[${index}]`
  const record = asImportObject(value, path)

  return {
    id: readImportInteger(record, "id", path, { min: 1 }),
    conversation_id: readImportInteger(record, "conversation_id", path, {
      min: 1
    }),
    message_id: readImportInteger(record, "message_id", path, { min: 1 }),
    content_text: readImportString(record, "content_text", path),
    created_at: readImportNumber(record, "created_at", path),
    days_after: normalizeImportNonNegativeInt(
      readImportNumber(record, "days_after", path, {
        optional: true,
        fallback: 0
      })
    )
  }
}

function assertUniqueImportIds<T extends { id?: number }>(
  records: T[],
  path: string
): void {
  const seen = new Set<number>()
  records.forEach((record, index) => {
    if (typeof record.id !== "number") {
      invalidImport(`${path}[${index}].id`, "must be a numeric primary key.")
    }
    if (seen.has(record.id)) {
      invalidImport(`${path}[${index}].id`, `duplicates id ${record.id}.`)
    }
    seen.add(record.id)
  })
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function initPlatformDistribution(): Record<Platform, number> {
  return Object.fromEntries(
    SUPPORTED_PLATFORMS.map((platform) => [platform, 0])
  ) as Record<Platform, number>
}

const MAX_CONVERSATION_TITLE_LENGTH = 120

export async function listConversations(
  filters?: ConversationFilters
): Promise<Conversation[]> {
  let results: ConversationRecord[]

  if (filters?.platform) {
    results = await db.conversations
      .where("platform")
      .equals(filters.platform)
      .toArray()
  } else {
    results = await db.conversations.toArray()
  }

  if (filters?.search) {
    const q = filters.search.toLowerCase()
    results = results.filter(
      (c) =>
        c.title.toLowerCase().includes(q) || c.snippet.toLowerCase().includes(q)
    )
  }

  if (filters?.dateRange) {
    results = results.filter((c) => {
      const originAt = getConversationOriginAt(toConversation(c))
      return (
        originAt >= filters.dateRange!.start &&
        originAt <= filters.dateRange!.end
      )
    })
  }

  return results
    .sort(
      (a, b) =>
        getConversationOriginAt(toConversation(b)) -
        getConversationOriginAt(toConversation(a))
    )
    .map(toConversation)
}

export async function getConversationById(
  id: number
): Promise<Conversation | null> {
  const record = await db.conversations.get(id)
  return record ? toConversation(record) : null
}

export async function getTopics(): Promise<Topic[]> {
  const [topicRecords, conversations] = await Promise.all([
    db.topics.toArray(),
    db.conversations.toArray()
  ])

  const directCounts = new Map<number, number>()
  for (const convo of conversations) {
    if (convo.is_archived || convo.is_trash) continue
    const topicId = convo.topic_id ?? null
    if (topicId === null) continue
    directCounts.set(topicId, (directCounts.get(topicId) ?? 0) + 1)
  }

  const nodeById = new Map<number, Topic>()
  for (const record of topicRecords) {
    if (record.id === undefined) {
      continue
    }
    nodeById.set(record.id, {
      ...toTopic(record),
      count: directCounts.get(record.id) ?? 0,
      children: []
    })
  }

  const roots: Topic[] = []
  for (const node of nodeById.values()) {
    const parentId = node.parent_id
    if (parentId !== null && nodeById.has(parentId)) {
      nodeById.get(parentId)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortByName = (items: Topic[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name))
  }

  const aggregateCounts = (node: Topic): number => {
    if (!node.children || node.children.length === 0) {
      return node.count ?? 0
    }
    sortByName(node.children)
    const childTotal = node.children.reduce(
      (sum, child) => sum + aggregateCounts(child),
      0
    )
    node.count = (node.count ?? 0) + childTotal
    return node.count ?? 0
  }

  sortByName(roots)
  roots.forEach((root) => aggregateCounts(root))

  return roots
}

export async function createTopic(payload: {
  name: string
  parent_id?: number | null
}): Promise<Topic> {
  const normalizedName = payload.name.trim()
  if (!normalizedName) {
    throw new Error("TOPIC_NAME_EMPTY")
  }

  const parentId = payload.parent_id ?? null
  if (parentId !== null) {
    const parent = await db.topics.get(parentId)
    if (!parent) {
      throw new Error("PARENT_TOPIC_NOT_FOUND")
    }
  }

  const existing =
    parentId === null
      ? await db.topics
          .where("name")
          .equals(normalizedName)
          .and((record) => record.parent_id === null)
          .first()
      : await db.topics
          .where("[parent_id+name]")
          .equals([parentId, normalizedName])
          .first()
  if (existing) {
    throw new Error("TOPIC_ALREADY_EXISTS")
  }

  await enforceStorageWriteGuard()
  const now = Date.now()
  const id = await db.topics.add({
    name: normalizedName,
    parent_id: parentId,
    created_at: now,
    updated_at: now
  })

  return {
    id,
    name: normalizedName,
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    count: 0,
    children: []
  }
}

export async function updateConversationTopic(
  id: number,
  topic_id: number | null
): Promise<Conversation> {
  const existing = await db.conversations.get(id)
  if (!existing) {
    throw new Error("CONVERSATION_NOT_FOUND")
  }
  if (existing.id === undefined) {
    throw new Error("Conversation record missing id")
  }

  if (topic_id !== null) {
    const topic = await db.topics.get(topic_id)
    if (!topic) {
      throw new Error("TOPIC_NOT_FOUND")
    }
  }

  const updatedAt = Date.now()
  await db.conversations.update(id, {
    topic_id,
    updated_at: updatedAt
  })

  return toConversation({
    ...existing,
    topic_id,
    updated_at: updatedAt,
    id: existing.id
  })
}

export async function updateConversation(
  id: number,
  changes: { topic_id?: number | null; is_starred?: boolean; tags?: string[] }
): Promise<{ updated: boolean; conversation: Conversation }> {
  const existing = await db.conversations.get(id)
  if (!existing) {
    throw new Error("CONVERSATION_NOT_FOUND")
  }
  if (existing.id === undefined) {
    throw new Error("Conversation record missing id")
  }

  const updates: Partial<ConversationRecord> = {}
  let updated = false

  if (
    changes.topic_id !== undefined &&
    changes.topic_id !== existing.topic_id
  ) {
    if (changes.topic_id !== null) {
      const topic = await db.topics.get(changes.topic_id)
      if (!topic) {
        throw new Error("TOPIC_NOT_FOUND")
      }
    }
    updates.topic_id = changes.topic_id ?? null
    updated = true
  }

  if (
    changes.is_starred !== undefined &&
    changes.is_starred !== existing.is_starred
  ) {
    updates.is_starred = changes.is_starred
    updated = true
  }

  if (changes.tags !== undefined) {
    const nextTags = dedupeTags(changes.tags).slice(0, 6)
    const current = existing.tags ?? []
    const same =
      nextTags.length === current.length &&
      nextTags.every((tag, index) => tag === current[index])
    if (!same) {
      updates.tags = nextTags
      updated = true
    }
  }

  if (!updated) {
    return { updated: false, conversation: toConversation(existing) }
  }

  updates.updated_at = Date.now()
  await db.conversations.update(existing.id, updates)

  return {
    updated: true,
    conversation: toConversation({ ...existing, ...updates, id: existing.id })
  }
}

export async function applyGardenerResult(
  id: number,
  changes: { topic_id?: number | null; tags?: string[] }
): Promise<{ updated: boolean; conversation: Conversation }> {
  return updateConversation(id, changes)
}

export async function replaceTagAcrossConversations(
  from: string,
  to?: string | null
): Promise<number> {
  const normalizedFrom = from.trim()
  if (!normalizedFrom) {
    throw new Error("TAG_EMPTY")
  }

  const normalizedTo =
    typeof to === "string" ? to.trim() : to === null ? null : undefined
  if (to !== undefined && to !== null && !normalizedTo) {
    throw new Error("TAG_EMPTY")
  }

  if (
    normalizedTo &&
    normalizedTo.toLowerCase() === normalizedFrom.toLowerCase()
  ) {
    return 0
  }

  await enforceStorageWriteGuard()
  const now = Date.now()
  let updated = 0

  await db.conversations
    .toCollection()
    .modify((record: Partial<ConversationRecord>) => {
      const tags = Array.isArray(record.tags) ? record.tags : []
      if (!tags.includes(normalizedFrom)) {
        return
      }

      let nextTags = tags.filter((tag) => tag !== normalizedFrom)
      if (normalizedTo) {
        nextTags = dedupeTags([...nextTags, normalizedTo]).slice(0, 6)
      }

      const same =
        nextTags.length === tags.length &&
        nextTags.every((tag, index) => tag === tags[index])
      if (same) {
        return
      }

      record.tags = nextTags
      record.updated_at = now
      updated += 1
    })

  return updated
}

export async function renameTagAcrossConversations(
  from: string,
  to: string
): Promise<number> {
  return replaceTagAcrossConversations(from, to)
}

export async function moveTagAcrossConversations(
  from: string,
  to: string
): Promise<number> {
  return replaceTagAcrossConversations(from, to)
}

export async function removeTagFromConversations(tag: string): Promise<number> {
  return replaceTagAcrossConversations(tag, null)
}

export async function listConversationsByRange(
  rangeStart: number,
  rangeEnd: number
): Promise<Conversation[]> {
  const records = await db.conversations.toArray()
  return records
    .map(toConversation)
    .filter((conversation) => {
      const originAt = getConversationOriginAt(conversation)
      return originAt >= rangeStart && originAt <= rangeEnd
    })
    .sort((a, b) => getConversationOriginAt(b) - getConversationOriginAt(a))
}

export async function listMessages(conversationId: number): Promise<Message[]> {
  const records = await db.messages
    .where("conversation_id")
    .equals(conversationId)
    .sortBy("created_at")

  return records.map(toMessage)
}

export async function listAnnotations(
  conversationId: number
): Promise<Annotation[]> {
  const records = await db.annotations
    .where("conversation_id")
    .equals(conversationId)
    .sortBy("created_at")

  return records
    .filter(
      (record): record is AnnotationRecord & { id: number } =>
        typeof record.id === "number"
    )
    .map(toAnnotation)
}

export async function saveAnnotation(payload: {
  conversationId: number
  messageId: number
  contentText: string
}): Promise<Annotation> {
  const trimmed = payload.contentText.trim()
  if (!trimmed) {
    throw new Error("ANNOTATION_EMPTY")
  }

  const conversation = await db.conversations.get(payload.conversationId)
  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND")
  }

  const message = await db.messages.get(payload.messageId)
  if (!message || message.conversation_id !== payload.conversationId) {
    throw new Error("MESSAGE_NOT_FOUND")
  }

  await enforceStorageWriteGuard()
  const now = Date.now()
  const daysAfter = Math.max(
    0,
    Math.floor((now - conversation.created_at) / (24 * 60 * 60 * 1000))
  )

  const id = await db.annotations.add({
    conversation_id: payload.conversationId,
    message_id: payload.messageId,
    content_text: trimmed,
    created_at: now,
    days_after: daysAfter
  })
  const record = await db.annotations.get(id)
  if (!record || record.id === undefined) {
    throw new Error("ANNOTATION_NOT_FOUND")
  }
  return toAnnotation(record as AnnotationRecord & { id: number })
}

export async function deleteAnnotation(annotationId: number): Promise<boolean> {
  const existing = await db.annotations.get(annotationId)
  if (!existing || existing.id === undefined) {
    return false
  }
  await db.annotations.delete(annotationId)
  return true
}

export async function getAnnotationExportContext(
  annotationId: number
): Promise<AnnotationExportContext> {
  const annotationRecord = await db.annotations.get(annotationId)
  if (!annotationRecord || annotationRecord.id === undefined) {
    throw new Error("ANNOTATION_NOT_FOUND")
  }

  const conversation = await db.conversations.get(
    annotationRecord.conversation_id
  )
  if (!conversation || conversation.id === undefined) {
    throw new Error("CONVERSATION_NOT_FOUND")
  }

  const message = await db.messages.get(annotationRecord.message_id)
  if (!message || message.id === undefined) {
    throw new Error("MESSAGE_NOT_FOUND")
  }

  const messages = await db.messages
    .where("conversation_id")
    .equals(annotationRecord.conversation_id)
    .sortBy("created_at")

  return {
    annotation: toAnnotation(
      annotationRecord as AnnotationRecord & { id: number }
    ),
    conversation: toConversation(conversation),
    message: toMessage(message),
    messages: messages.map(toMessage)
  }
}

export async function searchConversationIdsByText(
  query: string
): Promise<number[]> {
  if (!shouldRunFullTextSearch(query)) {
    return []
  }
  const summaries = await searchConversationMatchesByText({ query })
  return summaries.map((summary) => summary.conversationId)
}

export async function searchConversationMatchesByText(
  params: SearchConversationMatchesQuery
): Promise<ConversationMatchSummary[]> {
  const normalizedQuery = normalizeSearchQuery(params.query)
  if (!shouldRunFullTextSearch(normalizedQuery)) {
    return []
  }

  const candidateIds = params.conversationIds
    ? Array.from(
        new Set(
          params.conversationIds.filter((value) => Number.isFinite(value))
        )
      )
    : null
  if (candidateIds && candidateIds.length === 0) {
    return []
  }

  const matchMap = new Map<
    number,
    {
      messageId: number
      createdAt: number
      excerpt: string
      firstMatchedSurface: SearchMatchSurface
      matchedSurfaces: Set<SearchMatchSurface>
    }
  >()

  const collection = candidateIds
    ? db.messages.where("conversation_id").anyOf(candidateIds)
    : db.messages.toCollection()

  await collection.each((record) => {
    const conversationId = record.conversation_id
    if (typeof conversationId !== "number") {
      return
    }

    const messageId = record.id
    if (typeof messageId !== "number") {
      return
    }

    const matchedEntries = buildMessageSearchEntries({
      id: messageId,
      content_text: record.content_text,
      content_ast: record.content_ast,
      citations: record.citations,
      attachments: record.attachments,
      artifacts: record.artifacts
    }).filter((entry) => entry.text.toLowerCase().includes(normalizedQuery))
    if (matchedEntries.length === 0) {
      return
    }

    const surfaceSet = new Set<SearchMatchSurface>(
      matchedEntries.map((entry) => entry.surface)
    )
    const bestEntry = [...matchedEntries].sort((left, right) =>
      compareSearchSurfacePriority(left.surface, right.surface)
    )[0]

    const createdAt = record.created_at ?? 0
    const existing = matchMap.get(conversationId)
    const shouldReplace =
      !existing ||
      createdAt < existing.createdAt ||
      (createdAt === existing.createdAt && messageId < existing.messageId) ||
      (createdAt === existing.createdAt &&
        messageId === existing.messageId &&
        compareSearchSurfacePriority(
          bestEntry.surface,
          existing.firstMatchedSurface
        ) < 0)

    if (shouldReplace) {
      const nextSurfaces = existing
        ? new Set<SearchMatchSurface>([
            ...existing.matchedSurfaces,
            ...surfaceSet
          ])
        : surfaceSet
      matchMap.set(conversationId, {
        messageId,
        createdAt,
        excerpt: buildSearchExcerpt(bestEntry.text, normalizedQuery),
        firstMatchedSurface: bestEntry.surface,
        matchedSurfaces: nextSurfaces
      })
      return
    }

    surfaceSet.forEach((surface) => existing?.matchedSurfaces.add(surface))
  })

  await db.annotations.toCollection().each((record) => {
    const conversationId = record.conversation_id
    if (
      typeof conversationId !== "number" ||
      (candidateIds && !candidateIds.includes(conversationId))
    ) {
      return
    }

    const entry = buildAnnotationSearchEntry(record)
    if (!entry || !entry.text.toLowerCase().includes(normalizedQuery)) {
      return
    }

    const existing = matchMap.get(conversationId)
    if (existing) {
      existing.matchedSurfaces.add("annotation")
    }

    const createdAt = record.created_at ?? 0
    const shouldReplace =
      !existing ||
      createdAt < existing.createdAt ||
      (createdAt === existing.createdAt &&
        entry.messageId < existing.messageId) ||
      (createdAt === existing.createdAt &&
        entry.messageId === existing.messageId &&
        compareSearchSurfacePriority(
          "annotation",
          existing.firstMatchedSurface
        ) < 0)

    if (!shouldReplace) {
      return
    }

    const nextSurfaces = existing
      ? new Set<SearchMatchSurface>([...existing.matchedSurfaces, "annotation"])
      : new Set<SearchMatchSurface>(["annotation"])

    matchMap.set(conversationId, {
      messageId: entry.messageId,
      createdAt,
      excerpt: buildSearchExcerpt(entry.text, normalizedQuery),
      firstMatchedSurface: "annotation",
      matchedSurfaces: nextSurfaces
    })
  })

  return Array.from(matchMap.entries()).map(([conversationId, match]) => ({
    conversationId,
    firstMatchedMessageId: match.messageId,
    bestExcerpt: match.excerpt,
    firstMatchedSurface: match.firstMatchedSurface,
    matchedSurfaces: Array.from(match.matchedSurfaces).sort(
      compareSearchSurfacePriority
    )
  }))
}

export async function deleteConversation(id: number): Promise<boolean> {
  await db.transaction(
    "rw",
    db.conversations,
    db.messages,
    db.annotations,
    async () => {
      await db.messages.where("conversation_id").equals(id).delete()
      await db.annotations.where("conversation_id").equals(id).delete()
      await db.conversations.delete(id)
    }
  )
  return true
}

export async function updateConversationTitle(
  id: number,
  title: string
): Promise<Conversation> {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) {
    throw new Error("TITLE_EMPTY")
  }
  if (normalizedTitle.length > MAX_CONVERSATION_TITLE_LENGTH) {
    throw new Error("TITLE_TOO_LONG")
  }

  const existing = await db.conversations.get(id)
  if (!existing) {
    throw new Error("CONVERSATION_NOT_FOUND")
  }
  if (existing.id === undefined) {
    throw new Error("Conversation record missing id")
  }
  if (existing.title === normalizedTitle) {
    return toConversation(existing)
  }

  await db.conversations.update(id, { title: normalizedTitle })
  return toConversation({
    ...existing,
    title: normalizedTitle,
    id: existing.id
  })
}

export async function clearAllData(): Promise<boolean> {
  await db.transaction(
    "rw",
    [
      db.conversations,
      db.messages,
      db.summaries,
      db.weekly_reports,
      db.annotations
    ],
    async () => {
      await db.messages.clear()
      await db.conversations.clear()
      await db.summaries.clear()
      await db.weekly_reports.clear()
      await db.annotations.clear()
    }
  )
  return true
}

export async function clearInsightsCache(): Promise<boolean> {
  await db.transaction("rw", db.summaries, db.weekly_reports, async () => {
    await db.summaries.clear()
    await db.weekly_reports.clear()
  })
  return true
}

async function collectExportDataset() {
  const conversations = (await db.conversations.toArray()).map(toConversation)
  const messages = (await db.messages.toArray()).map(toMessage)
  const summaries = (await db.summaries.toArray()).map(toSummary)
  const weeklyReports = (await db.weekly_reports.toArray()).map(toWeeklyReport)
  const annotations = (await db.annotations.toArray())
    .filter(
      (record): record is AnnotationRecord & { id: number } =>
        typeof record.id === "number"
    )
    .map(toAnnotation)
  return { conversations, messages, summaries, weeklyReports, annotations }
}

export async function getStorageUsage(): Promise<StorageUsageSnapshot> {
  return getStorageUsageSnapshot()
}

export async function getDataOverview(): Promise<DataOverviewSnapshot> {
  const [storage, totalConversations, summaryRecordCount, weeklyReportCount] =
    await Promise.all([
      getStorageUsageSnapshot(),
      db.conversations.count(),
      db.summaries.count(),
      db.weekly_reports.count()
    ])

  const [uniqueSummaryConversationIds, lastSummary] = await Promise.all([
    db.summaries.orderBy("conversationId").uniqueKeys(),
    db.summaries.orderBy("createdAt").last()
  ])

  return {
    storage,
    totalConversations,
    compactedThreads: uniqueSummaryConversationIds.length,
    summaryRecordCount,
    weeklyReportCount,
    lastCompactionAt:
      typeof lastSummary?.createdAt === "number" ? lastSummary.createdAt : null,
    indexedDbName: db.name
  }
}

export async function exportAllData(
  format: ExportFormat
): Promise<ExportPayload> {
  const dataset = await collectExportDataset()
  if (format === "txt") {
    return buildExportTxtV1(dataset)
  }
  if (format === "md") {
    return buildExportMdV1(dataset)
  }
  return buildExportJsonV1(dataset)
}

export async function exportAllDataAsJson(): Promise<string> {
  const payload = await exportAllData("json")
  return payload.content
}

export async function importAllData(
  content: string
): Promise<ImportDataResult> {
  const parsed = parseImportJsonContent(content)
  const root = asImportObject(parsed, "root")
  if (root.schema_version !== "vesti_export.v1") {
    throw new Error(
      'Only Vesti JSON exports with schema_version "vesti_export.v1" can be imported.'
    )
  }

  const data = asImportObject(root.data, "data")
  const conversations = readImportArray(data, "conversations", "data").map(
    normalizeImportedConversation
  )
  const messages = readImportArray(data, "messages", "data").map(
    normalizeImportedMessage
  )
  const summaries = readImportArray(data, "summaries", "data", {
    optional: true
  }).map(normalizeImportedSummary)
  const weeklyReports = readImportArray(data, "weeklyReports", "data", {
    optional: true
  }).map(normalizeImportedWeeklyReport)
  const annotations = readImportArray(data, "annotations", "data", {
    optional: true
  }).map(normalizeImportedAnnotation)

  assertUniqueImportIds(conversations, "data.conversations")
  assertUniqueImportIds(messages, "data.messages")
  assertUniqueImportIds(summaries, "data.summaries")
  assertUniqueImportIds(weeklyReports, "data.weeklyReports")
  assertUniqueImportIds(annotations, "data.annotations")

  const conversationIds = new Set(
    conversations.map((item) => item.id as number)
  )
  const messageIds = new Map<number, MessageRecord>()
  const messageCountByConversation = new Map<number, number>()
  const aiCountByConversation = new Map<number, number>()

  for (const message of messages) {
    if (!conversationIds.has(message.conversation_id)) {
      throw new Error(
        `Invalid Vesti import JSON: message #${message.id} references missing conversation #${message.conversation_id}.`
      )
    }

    messageIds.set(message.id as number, message)
    messageCountByConversation.set(
      message.conversation_id,
      (messageCountByConversation.get(message.conversation_id) ?? 0) + 1
    )
    if (message.role === "ai") {
      aiCountByConversation.set(
        message.conversation_id,
        (aiCountByConversation.get(message.conversation_id) ?? 0) + 1
      )
    }
  }

  for (const summary of summaries) {
    if (!conversationIds.has(summary.conversationId)) {
      throw new Error(
        `Invalid Vesti import JSON: summary #${summary.id} references missing conversation #${summary.conversationId}.`
      )
    }
  }

  const conversationCreatedAt = new Map<number, number>(
    conversations.map((item) => [item.id as number, item.created_at])
  )

  for (const annotation of annotations) {
    if (!conversationIds.has(annotation.conversation_id)) {
      throw new Error(
        `Invalid Vesti import JSON: annotation #${annotation.id} references missing conversation #${annotation.conversation_id}.`
      )
    }

    const message = messageIds.get(annotation.message_id)
    if (!message) {
      throw new Error(
        `Invalid Vesti import JSON: annotation #${annotation.id} references missing message #${annotation.message_id}.`
      )
    }
    if (message.conversation_id !== annotation.conversation_id) {
      throw new Error(
        `Invalid Vesti import JSON: annotation #${annotation.id} points to message #${annotation.message_id} in a different conversation.`
      )
    }

    const conversationCreated = conversationCreatedAt.get(
      annotation.conversation_id
    )
    if (typeof conversationCreated === "number") {
      annotation.days_after = Math.max(
        0,
        Math.floor(
          (annotation.created_at - conversationCreated) / (24 * 60 * 60 * 1000)
        )
      )
    }
  }

  const normalizedConversations = conversations.map((conversation) => {
    const conversationId = conversation.id as number
    const messageCount = messageCountByConversation.get(conversationId) ?? 0
    const turnCount =
      aiCountByConversation.get(conversationId) ?? Math.floor(messageCount / 2)
    return {
      ...conversation,
      message_count: messageCount,
      turn_count: turnCount
    }
  })

  await db.transaction(
    "rw",
    [
      db.conversations,
      db.messages,
      db.summaries,
      db.weekly_reports,
      db.annotations,
      db.vectors
    ],
    async () => {
      await db.messages.clear()
      await db.annotations.clear()
      await db.conversations.clear()
      await db.summaries.clear()
      await db.weekly_reports.clear()
      await db.vectors.clear()

      if (normalizedConversations.length > 0) {
        await db.conversations.bulkPut(normalizedConversations)
      }
      if (messages.length > 0) {
        await db.messages.bulkPut(messages)
      }
      if (summaries.length > 0) {
        await db.summaries.bulkPut(summaries)
      }
      if (weeklyReports.length > 0) {
        await db.weekly_reports.bulkPut(weeklyReports)
      }
      if (annotations.length > 0) {
        await db.annotations.bulkPut(annotations)
      }
    }
  )

  return {
    conversations: normalizedConversations.length,
    messages: messages.length,
    summaries: summaries.length,
    weeklyReports: weeklyReports.length,
    annotations: annotations.length
  }
}

export async function getSummary(
  conversationId: number
): Promise<SummaryRecord | null> {
  const record = await db.summaries
    .where("conversationId")
    .equals(conversationId)
    .last()
  return record ? toSummary(record) : null
}

export async function saveSummary(
  record: Omit<SummaryRecord, "id">
): Promise<SummaryRecord> {
  await enforceStorageWriteGuard()

  const existing = await db.summaries
    .where("conversationId")
    .equals(record.conversationId)
    .first()

  if (existing?.id !== undefined) {
    await db.summaries.update(existing.id, record)
    return toSummary({ ...existing, ...record, id: existing.id })
  }

  const id = await db.summaries.add(record)
  return toSummary({ ...record, id })
}

export async function getWeeklyReport(
  rangeStart: number,
  rangeEnd: number
): Promise<WeeklyReportRecord | null> {
  const record = await db.weekly_reports
    .where("rangeStart")
    .equals(rangeStart)
    .and((item) => item.rangeEnd === rangeEnd)
    .first()
  return record ? toWeeklyReport(record) : null
}

export async function saveWeeklyReport(
  record: Omit<WeeklyReportRecord, "id">
): Promise<WeeklyReportRecord> {
  await enforceStorageWriteGuard()

  const existing = await db.weekly_reports
    .where("rangeStart")
    .equals(record.rangeStart)
    .and((item) => item.rangeEnd === record.rangeEnd)
    .first()

  if (existing?.id !== undefined) {
    await db.weekly_reports.update(existing.id, record)
    return toWeeklyReport({ ...existing, ...record, id: existing.id })
  }

  const id = await db.weekly_reports.add(record)
  return toWeeklyReport({ ...record, id })
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const conversations = (await db.conversations.toArray()).map(toConversation)
  const distribution = initPlatformDistribution()

  for (const c of conversations) {
    distribution[c.platform] += 1
  }

  const today = dayKey(Date.now())
  const firstCapturedTodayCount = conversations.filter(
    (c) => dayKey(getConversationFirstCapturedAt(c)) === today
  ).length

  const daysWithConversations = new Set(
    conversations.map((c) => dayKey(getConversationFirstCapturedAt(c)))
  )

  let firstCaptureStreak = 0
  let cursor = new Date()
  while (daysWithConversations.has(dayKey(cursor.getTime()))) {
    firstCaptureStreak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  const firstCaptureHeatmapData = Array.from(daysWithConversations).map(
    (d) => ({
      date: d,
      count: conversations.filter(
        (c) => dayKey(getConversationFirstCapturedAt(c)) === d
      ).length
    })
  )

  return {
    totalConversations: conversations.length,
    totalTokens: 0,
    firstCaptureStreak,
    firstCapturedTodayCount,
    platformDistribution: distribution,
    firstCaptureHeatmapData
  }
}

function toNote(record: NoteRecord & { id: number }): Note {
  return {
    id: record.id,
    title: record.title,
    content: record.content,
    excerpt: record.excerpt ?? buildNoteExcerpt(record.content),
    hash: record.hash ?? "",
    created_at: record.created_at,
    updated_at: record.updated_at,
    linked_conversation_ids: record.linked_conversation_ids ?? [],
    source_type: record.source_type ?? "native",
    source_path: record.source_path ?? null,
    import_meta: record.import_meta ?? null,
    obsidian_export: record.obsidian_export ?? null
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeLinkedConversationIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is number => typeof item === "number")
}

function normalizeNoteImportAssets(value: unknown): NoteImportAssetRef[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return []
    }

    const candidate = item as Record<string, unknown>
    if (typeof candidate.path !== "string") {
      return []
    }

    const kind = candidate.kind === "embed" ? "embed" : "link"
    const assetId =
      typeof candidate.asset_id === "string" && candidate.asset_id.trim()
        ? candidate.asset_id
        : null

    return [
      {
        path: candidate.path,
        asset_id: assetId,
        kind
      } satisfies NoteImportAssetRef
    ]
  })
}

function normalizeNoteImportMeta(value: NoteImportMeta | null | undefined): NoteImportMeta | null {
  if (!value) {
    return null
  }

  return {
    vault_id: typeof value.vault_id === "string" ? value.vault_id : null,
    vault_name: typeof value.vault_name === "string" ? value.vault_name : null,
    relative_path:
      typeof value.relative_path === "string" ? value.relative_path : null,
    folder_path: typeof value.folder_path === "string" ? value.folder_path : null,
    frontmatter:
      value.frontmatter && typeof value.frontmatter === "object" && !Array.isArray(value.frontmatter)
        ? value.frontmatter
        : null,
    wikilinks: normalizeStringArray(value.wikilinks),
    embeds: normalizeStringArray(value.embeds),
    tags: normalizeStringArray(value.tags),
    assets: normalizeNoteImportAssets(value.assets),
    source_mtime:
      typeof value.source_mtime === "number" && Number.isFinite(value.source_mtime)
        ? value.source_mtime
        : null,
    source_file_hash:
      typeof value.source_file_hash === "string" ? value.source_file_hash : null,
    last_imported_note_hash:
      typeof value.last_imported_note_hash === "string"
        ? value.last_imported_note_hash
        : null,
    imported_at:
      typeof value.imported_at === "number" && Number.isFinite(value.imported_at)
        ? value.imported_at
        : null,
    last_imported_at:
      typeof value.last_imported_at === "number" && Number.isFinite(value.last_imported_at)
        ? value.last_imported_at
        : null,
    conflict:
      value.conflict &&
      typeof value.conflict === "object" &&
      typeof value.conflict.detected_at === "number" &&
      typeof value.conflict.incoming_source_file_hash === "string" &&
      typeof value.conflict.incoming_content === "string"
        ? {
            detected_at: value.conflict.detected_at,
            incoming_source_file_hash: value.conflict.incoming_source_file_hash,
            incoming_content: value.conflict.incoming_content,
            incoming_frontmatter:
              value.conflict.incoming_frontmatter &&
              typeof value.conflict.incoming_frontmatter === "object" &&
              !Array.isArray(value.conflict.incoming_frontmatter)
                ? value.conflict.incoming_frontmatter
                : null
          }
        : null
  }
}

function normalizeNoteObsidianExportMeta(
  value: NoteObsidianExportMeta | null | undefined
): NoteObsidianExportMeta | null {
  if (!value) {
    return null
  }

  const vaultId =
    typeof value.vault_id === "string" ? value.vault_id.trim() : ""
  const relativePath =
    typeof value.relative_path === "string" ? value.relative_path.trim() : ""
  const lastExportedAt =
    typeof value.last_exported_at === "number" &&
    Number.isFinite(value.last_exported_at)
      ? value.last_exported_at
      : null

  if (!vaultId || !relativePath || lastExportedAt === null) {
    return null
  }

  return {
    vault_id: vaultId,
    relative_path: relativePath,
    last_exported_at: lastExportedAt
  }
}

async function resolveStoredNoteFields(
  input: CreateNoteInput | UpdateNoteChanges,
  existing?: NoteRecord & { id: number }
): Promise<Omit<NoteRecord, "id" | "created_at" | "updated_at">> {
  let content =
    typeof input.content === "string" ? input.content : (existing?.content ?? "")

  if (
    input.content === undefined &&
    typeof input.title === "string" &&
    splitNoteSupportsFrontmatter(existing?.content)
  ) {
    content = updateFrontmatterTitle(existing?.content ?? "", input.title)
  }

  const titleFromFrontmatter = extractFrontmatterTitle(content)
  const fallbackTitle =
    typeof input.title === "string"
      ? input.title.trim()
      : typeof existing?.title === "string"
        ? existing.title.trim()
        : ""

  const title = titleFromFrontmatter ?? fallbackTitle || "Untitled"
  const sourceType = input.source_type ?? existing?.source_type ?? "native"
  const sourcePath =
    input.source_path !== undefined
      ? input.source_path
      : existing?.source_path ?? null
  const importMeta =
    input.import_meta !== undefined
      ? normalizeNoteImportMeta(input.import_meta)
      : normalizeNoteImportMeta(existing?.import_meta ?? null)
  const obsidianExport =
    input.obsidian_export !== undefined
      ? normalizeNoteObsidianExportMeta(input.obsidian_export)
      : normalizeNoteObsidianExportMeta(existing?.obsidian_export ?? null)

  return {
    title,
    content,
    excerpt: buildNoteExcerpt(content),
    hash: await computeNoteHash(content),
    linked_conversation_ids:
      input.linked_conversation_ids !== undefined
        ? normalizeLinkedConversationIds(input.linked_conversation_ids)
        : normalizeLinkedConversationIds(existing?.linked_conversation_ids ?? []),
    source_type: sourceType,
    source_path: typeof sourcePath === "string" && sourcePath.trim() ? sourcePath : null,
    import_meta: importMeta,
    obsidian_export: obsidianExport
  }
}

function splitNoteSupportsFrontmatter(content: string | undefined): boolean {
  if (typeof content !== "string") {
    return false
  }

  return parseNoteFrontmatter(content) !== null || content.startsWith("---\n") || content.startsWith("---\r\n")
}

export async function listNotes(): Promise<Note[]> {
  const records = await db.notes.orderBy("updated_at").reverse().toArray()
  return records
    .filter(
      (record): record is NoteRecord & { id: number } => record.id !== undefined
    )
    .map(toNote)
}

export async function getNoteById(id: number): Promise<Note | null> {
  const record = await db.notes.get(id)
  if (!record || record.id === undefined) {
    return null
  }

  return toNote(record as NoteRecord & { id: number })
}

export async function createNote(
  data: CreateNoteInput
): Promise<Note> {
  await enforceStorageWriteGuard()

  const now = Date.now()
  const resolved = await resolveStoredNoteFields(data)
  const id = await db.notes.add({
    ...resolved,
    created_at: now,
    updated_at: now
  })
  const record = await db.notes.get(id)
  if (!record || record.id === undefined) {
    throw new Error("Failed to create note")
  }
  return toNote(record as NoteRecord & { id: number })
}

export async function updateNote(
  id: number,
  changes: UpdateNoteChanges
): Promise<Note> {
  await enforceStorageWriteGuard()

  const existing = await db.notes.get(id)
  if (!existing || existing.id === undefined) {
    throw new Error("Note not found")
  }

  const resolved = await resolveStoredNoteFields(
    changes,
    existing as NoteRecord & { id: number }
  )

  await db.notes.update(id, { ...resolved, updated_at: Date.now() })
  const record = await db.notes.get(id)
  if (!record || record.id === undefined) {
    throw new Error("Note not found")
  }
  return toNote(record as NoteRecord & { id: number })
}

export async function deleteNote(id: number): Promise<void> {
  await enforceStorageWriteGuard()
  await db.notes.delete(id)
}

export async function setNoteObsidianExportMeta(
  id: number,
  exportMeta: NoteObsidianExportMeta | null
): Promise<Note> {
  await enforceStorageWriteGuard()

  const existing = await db.notes.get(id)
  if (!existing || existing.id === undefined) {
    throw new Error("Note not found")
  }

  await db.notes.update(id, {
    obsidian_export: normalizeNoteObsidianExportMeta(exportMeta)
  })

  const record = await db.notes.get(id)
  if (!record || record.id === undefined) {
    throw new Error("Note not found")
  }

  return toNote(record as NoteRecord & { id: number })
}

async function findImportedNoteBySourcePath(
  vaultId: string,
  relativePath: string
): Promise<(NoteRecord & { id: number }) | null> {
  const candidates = await db.notes
    .where("[source_type+source_path]")
    .equals(["obsidian", relativePath])
    .toArray()

  const match = candidates.find(
    (record): record is NoteRecord & { id: number } =>
      typeof record.id === "number" && record.import_meta?.vault_id === vaultId
  )

  return match ?? null
}

async function resolveVaultSource(
  name: string,
  kind: NoteSourceRecord["kind"]
): Promise<NoteSourceRecord> {
  const now = Date.now()
  const existing = await db.note_sources
    .toCollection()
    .filter((record) => record.name === name && record.kind === kind)
    .first()

  if (existing) {
    const next = {
      ...existing,
      updated_at: now
    }
    await db.note_sources.put(next)
    return next
  }

  const id = `vault_${(await computeNoteHash(`${kind}:${name}`)).slice(0, 16)}`
  const record: NoteSourceRecord = {
    id,
    name,
    kind,
    created_at: now,
    updated_at: now
  }
  await db.note_sources.put(record)
  return record
}

async function upsertNoteAsset(
  vaultId: string,
  asset: {
    relativePath: string
    mimeType: string
    hash: string
    data: Uint8Array
  }
): Promise<{ assetId: string; imported: boolean }> {
  const existing = await db.note_assets
    .where("[vault_id+relative_path]")
    .equals([vaultId, asset.relativePath])
    .first()
  const now = Date.now()

  if (existing && existing.hash === asset.hash) {
    return {
      assetId: existing.id,
      imported: false
    }
  }

  const nextRecord: NoteAssetRecord = {
    id: existing?.id ?? generateId("asset"),
    vault_id: vaultId,
    relative_path: asset.relativePath,
    mime_type: asset.mimeType,
    hash: asset.hash,
    byte_size: asset.data.byteLength,
    blob: new Blob([asset.data], { type: asset.mimeType }),
    created_at: existing?.created_at ?? now,
    updated_at: now
  }

  await db.note_assets.put(nextRecord)
  return {
    assetId: nextRecord.id,
    imported: true
  }
}

export async function getNoteAsset(
  assetId: string
): Promise<NoteAssetRecord | null> {
  const asset = await db.note_assets.get(assetId)
  return asset ?? null
}

export async function importObsidianDirectory(
  vaultName: string,
  entries: ObsidianImportFileEntry[]
): Promise<ObsidianImportSummary> {
  await enforceStorageWriteGuard()
  const prepared = await prepareObsidianDirectoryImport(vaultName, entries)
  return persistPreparedObsidianVault(prepared)
}

export async function importObsidianZip(
  fileName: string,
  data: ArrayBuffer
): Promise<ObsidianImportSummary> {
  await enforceStorageWriteGuard()
  const prepared = await prepareObsidianZipImport(fileName, data)
  return persistPreparedObsidianVault(prepared)
}

async function persistPreparedObsidianVault(
  prepared: Awaited<ReturnType<typeof prepareObsidianDirectoryImport>>
): Promise<ObsidianImportSummary> {
  const source = await resolveVaultSource(prepared.name, prepared.kind)
  const assetIdByPath = new Map<string, string>()
  let importedAssets = 0

  for (const asset of prepared.assets) {
    const result = await upsertNoteAsset(source.id, asset)
    assetIdByPath.set(asset.relativePath, result.assetId)
    if (result.imported) {
      importedAssets += 1
    }
  }

  let importedNotes = 0
  let updatedNotes = 0
  let skippedNotes = 0
  let conflictedNotes = 0
  const now = Date.now()

  for (const preparedNote of prepared.notes) {
    const existing = await findImportedNoteBySourcePath(
      source.id,
      preparedNote.relativePath
    )

    const mappedAssets = preparedNote.importMeta.assets.map((asset) => ({
      ...asset,
      asset_id: assetIdByPath.get(asset.path) ?? null
    }))

    const nextImportMetaBase: NoteImportMeta = {
      vault_id: source.id,
      vault_name: source.name,
      relative_path: preparedNote.relativePath,
      folder_path: preparedNote.folderPath,
      frontmatter: preparedNote.importMeta.frontmatter,
      wikilinks: preparedNote.importMeta.wikilinks,
      embeds: preparedNote.importMeta.embeds,
      tags: preparedNote.importMeta.tags,
      assets: mappedAssets,
      source_mtime: preparedNote.sourceMtime,
      source_file_hash: preparedNote.sourceFileHash,
      last_imported_note_hash: await computeNoteHash(preparedNote.content),
      imported_at: existing?.import_meta?.imported_at ?? now,
      last_imported_at: now,
      conflict: null
    }

    if (!existing) {
      await createNote({
        title: preparedNote.title,
        content: preparedNote.content,
        linked_conversation_ids: [],
        source_type: "obsidian",
        source_path: preparedNote.relativePath,
        import_meta: nextImportMetaBase
      })
      importedNotes += 1
      continue
    }

    if (existing.import_meta?.source_file_hash === preparedNote.sourceFileHash) {
      skippedNotes += 1
      continue
    }

    if (existing.hash === existing.import_meta?.last_imported_note_hash) {
      await updateNote(existing.id, {
        title: preparedNote.title,
        content: preparedNote.content,
        source_type: "obsidian",
        source_path: preparedNote.relativePath,
        import_meta: nextImportMetaBase
      })
      updatedNotes += 1
      continue
    }

    await updateNote(existing.id, {
      source_type: "obsidian",
      source_path: preparedNote.relativePath,
      import_meta: {
        ...(normalizeNoteImportMeta(existing.import_meta ?? null) ?? {}),
        vault_id: source.id,
        vault_name: source.name,
        relative_path: preparedNote.relativePath,
        folder_path: preparedNote.folderPath,
        frontmatter: preparedNote.importMeta.frontmatter,
        wikilinks: preparedNote.importMeta.wikilinks,
        embeds: preparedNote.importMeta.embeds,
        tags: preparedNote.importMeta.tags,
        assets: mappedAssets,
        source_mtime: preparedNote.sourceMtime,
        conflict: {
          detected_at: now,
          incoming_source_file_hash: preparedNote.sourceFileHash,
          incoming_content: preparedNote.content,
          incoming_frontmatter: preparedNote.importMeta.frontmatter
        }
      }
    })
    conflictedNotes += 1
  }

  return {
    vaultId: source.id,
    importedNotes,
    updatedNotes,
    skippedNotes,
    conflictedNotes,
    importedAssets,
    unsupportedFiles: prepared.unsupportedFiles
  }
}

// ===== Explore (RAG Chat) Operations =====

const MAX_SESSIONS = 50
const MAX_MESSAGES_PER_SESSION = 100
const MAX_TOTAL_MESSAGES = 1000

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Session CRUD

export async function createExploreSession(title: string): Promise<string> {
  await enforceStorageWriteGuard()

  const now = Date.now()
  const session: ExploreSessionRecord = {
    id: generateId("sess"),
    title: title.slice(0, 100), // Limit title length
    preview: "",
    messageCount: 0,
    createdAt: now,
    updatedAt: now
  }

  await db.explore_sessions.add(session)

  // Cleanup old sessions if needed
  await cleanupExploreSessionsIfNeeded()

  return session.id
}

export async function getExploreSession(
  id: string
): Promise<ExploreSession | null> {
  const record = await db.explore_sessions.get(id)
  if (!record) return null
  return record as ExploreSession
}

export async function listExploreSessions(
  limit = 50
): Promise<ExploreSession[]> {
  const records = await db.explore_sessions
    .orderBy("updatedAt")
    .reverse()
    .limit(limit)
    .toArray()
  return records as ExploreSession[]
}

export async function updateExploreSession(
  id: string,
  changes: Partial<
    Pick<ExploreSessionRecord, "title" | "preview" | "messageCount">
  >
): Promise<void> {
  await db.explore_sessions.update(id, {
    ...changes,
    updatedAt: Date.now()
  })
}

export async function deleteExploreSession(id: string): Promise<void> {
  // Delete all messages first
  await db.explore_messages.where("sessionId").equals(id).delete()
  // Delete session
  await db.explore_sessions.delete(id)
}

// Message CRUD

export async function addExploreMessage(
  sessionId: string,
  message: Omit<ExploreMessage, "id" | "sessionId">
): Promise<ExploreMessage> {
  await enforceStorageWriteGuard()
  const normalizedSources = normalizeExploreSources(
    message.sources as ExploreSourceRecord[] | undefined
  )
  const serializedAgentMeta = serializeExploreAgentMeta(message.agentMeta)

  const record: ExploreMessageRecord = {
    id: generateId("msg"),
    sessionId,
    role: message.role,
    content: message.content,
    sources: normalizedSources ? JSON.stringify(normalizedSources) : undefined,
    agentMeta: serializedAgentMeta,
    timestamp: message.timestamp
  }

  await db.explore_messages.add(record)

  // Update session message count
  const session = await db.explore_sessions.get(sessionId)
  if (session) {
    const newCount = session.messageCount + 1
    const preview =
      message.role === "assistant"
        ? message.content.slice(0, 100)
        : session.preview

    await db.explore_sessions.update(sessionId, {
      messageCount: newCount,
      preview,
      updatedAt: Date.now()
    })

    // Cleanup old messages if needed
    if (newCount > MAX_MESSAGES_PER_SESSION) {
      await cleanupSessionMessages(sessionId)
    }
  }

  await cleanupExploreMessagesIfNeeded()

  return {
    id: record.id,
    sessionId,
    role: message.role,
    content: message.content,
    sources: normalizedSources,
    agentMeta: parseExploreAgentMeta(serializedAgentMeta),
    timestamp: message.timestamp
  }
}

export async function getExploreMessages(
  sessionId: string
): Promise<ExploreMessage[]> {
  const records = await db.explore_messages
    .where("sessionId")
    .equals(sessionId)
    .sortBy("timestamp")

  return records.map((record) => ({
    id: record.id,
    sessionId: record.sessionId,
    role: record.role,
    content: record.content,
    sources: parseExploreSources(record.sources),
    agentMeta: parseExploreAgentMeta(record.agentMeta),
    timestamp: record.timestamp
  }))
}

export async function getRecentExploreMessages(
  sessionId: string,
  limit = 6
): Promise<ExploreMessage[]> {
  const records = await db.explore_messages
    .where("sessionId")
    .equals(sessionId)
    .reverse()
    .limit(limit)
    .sortBy("timestamp")

  // Return in chronological order
  return records.reverse().map((record) => ({
    id: record.id,
    sessionId: record.sessionId,
    role: record.role,
    content: record.content,
    sources: parseExploreSources(record.sources),
    agentMeta: parseExploreAgentMeta(record.agentMeta),
    timestamp: record.timestamp
  }))
}

export async function updateExploreMessageContext(
  messageId: string,
  contextDraft: string,
  selectedContextConversationIds: number[]
): Promise<void> {
  await enforceStorageWriteGuard()

  const record = await db.explore_messages.get(messageId)
  if (!record) {
    throw new Error("EXPLORE_MESSAGE_NOT_FOUND")
  }

  const existingMeta = parseExploreAgentMeta(record.agentMeta)
  const nextMeta = normalizeExploreAgentMeta({
    mode: existingMeta?.mode ?? "agent",
    toolCalls: existingMeta?.toolCalls ?? [],
    contextCandidates: existingMeta?.contextCandidates ?? [],
    ...existingMeta,
    contextDraft,
    selectedContextConversationIds
  })

  await db.explore_messages.update(messageId, {
    agentMeta: serializeExploreAgentMeta(nextMeta)
  })
}

// Cleanup functions

async function cleanupExploreSessionsIfNeeded(): Promise<void> {
  const count = await db.explore_sessions.count()
  if (count <= MAX_SESSIONS) return

  const toDelete = await db.explore_sessions
    .orderBy("updatedAt")
    .limit(count - MAX_SESSIONS)
    .toArray()

  for (const session of toDelete) {
    await deleteExploreSession(session.id)
  }
}

async function cleanupSessionMessages(sessionId: string): Promise<void> {
  const messages = await db.explore_messages
    .where("sessionId")
    .equals(sessionId)
    .sortBy("timestamp")

  if (messages.length <= MAX_MESSAGES_PER_SESSION) return

  const toDelete = messages.slice(0, messages.length - MAX_MESSAGES_PER_SESSION)
  for (const msg of toDelete) {
    await db.explore_messages.delete(msg.id)
  }

  // Update count
  await db.explore_sessions.update(sessionId, {
    messageCount: MAX_MESSAGES_PER_SESSION
  })
}

async function cleanupExploreMessagesIfNeeded(): Promise<void> {
  const count = await db.explore_messages.count()
  if (count <= MAX_TOTAL_MESSAGES) return

  // Get oldest messages across all sessions
  const toDelete = await db.explore_messages
    .orderBy("timestamp")
    .limit(count - MAX_TOTAL_MESSAGES)
    .toArray()

  const sessionCounts = new Map<string, number>()

  for (const msg of toDelete) {
    await db.explore_messages.delete(msg.id)
    sessionCounts.set(
      msg.sessionId,
      (sessionCounts.get(msg.sessionId) || 0) + 1
    )
  }

  // Update session counts
  for (const [sessionId, deletedCount] of sessionCounts) {
    const session = await db.explore_sessions.get(sessionId)
    if (session) {
      await db.explore_sessions.update(sessionId, {
        messageCount: Math.max(0, session.messageCount - deletedCount)
      })
    }
  }
}

// For export functionality
export async function getAllExploreSessions(): Promise<ExploreSession[]> {
  return db.explore_sessions.toArray() as Promise<ExploreSession[]>
}

export async function getAllExploreMessages(): Promise<ExploreMessage[]> {
  const records = await db.explore_messages.toArray()
  return records.map((record) => ({
    id: record.id,
    sessionId: record.sessionId,
    role: record.role,
    content: record.content,
    sources: parseExploreSources(record.sources),
    agentMeta: parseExploreAgentMeta(record.agentMeta),
    timestamp: record.timestamp
  }))
}
