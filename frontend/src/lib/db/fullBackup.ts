import { z } from 'zod'
import { db } from './schema'
import type { ExportPayload, ImportDataResult } from '../types'

export const BACKUP_TABLES = ['conversations', 'messages', 'summaries', 'weekly_reports', 'topics', 'vectors', 'notes', 'note_sources', 'note_assets', 'annotations', 'explore_sessions', 'explore_messages', 'prompts'] as const
const id = z.number().int().positive()
const time = z.number().finite()
const text = z.string()
const strings = z.array(text)
const row = (shape: z.ZodRawShape) => z.object(shape).passthrough()
const dated = { created_at: time, updated_at: time }
const schemas = {
  conversations: row({ id, uuid: text, platform: z.enum(['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Doubao', 'Kimi', 'Yuanbao']), title: text, snippet: text, url: text, ...dated, source_created_at: time.nullable(), first_captured_at: time, last_captured_at: time, message_count: z.number().int().nonnegative(), turn_count: z.number().int().nonnegative(), is_starred: z.boolean(), is_archived: z.boolean(), is_trash: z.boolean(), tags: strings, topic_id: id.nullable() }),
  messages: row({ id, conversation_id: id, role: z.enum(['user', 'ai']), content_text: text, created_at: time }),
  summaries: row({ id, conversationId: id, content: text, modelId: text, createdAt: time, sourceUpdatedAt: time }),
  weekly_reports: row({ id, rangeStart: time, rangeEnd: time, content: text, modelId: text, createdAt: time, sourceHash: text }),
  topics: row({ id, parent_id: id.nullable(), name: text, ...dated }),
  vectors: row({ id, conversation_id: id, text_hash: text, embedding: z.array(z.number().finite()).min(1), embedding_provider: text, embedding_model: text, embedding_dimensions: id, index_version: text }),
  notes: row({ id, title: text, content: text, excerpt: text, hash: text, ...dated, linked_conversation_ids: z.array(id), source_type: z.enum(['native', 'obsidian']), source_path: text.nullable(), import_meta: z.unknown().nullable(), obsidian_export: z.unknown().nullable() }),
  note_sources: row({ id: text.min(1), name: text, kind: z.enum(['directory', 'zip']), ...dated }),
  note_assets: row({ id: text.min(1), vault_id: text.min(1), relative_path: text, mime_type: text, hash: text, byte_size: z.number().int().nonnegative(), blob_base64: text, blob_type: text, ...dated }),
  annotations: row({ id, conversation_id: id, message_id: id, content_text: text, created_at: time, days_after: z.number().int().nonnegative() }),
  explore_sessions: row({ id: text.min(1), title: text, preview: text, messageCount: z.number().int().nonnegative(), createdAt: time, updatedAt: time }),
  explore_messages: row({ id: text.min(1), sessionId: text.min(1), role: z.enum(['user', 'assistant']), content: text, timestamp: time }),
  prompts: row({ id, title: text, body: text, category: text.nullable(), tags: strings, source: z.enum(['manual', 'extracted']), source_platform: text.nullable(), source_conversation_id: id.nullable(), source_message_id: id.nullable(), is_favorite: z.boolean(), is_archived: z.boolean(), quality_score: z.number().finite(), summary: text.nullable(), variables: strings, use_count: z.number().int().nonnegative(), last_used_at: time.nullable(), body_hash: text, ...dated })
}
type TableName = typeof BACKUP_TABLES[number]
type BackupRows = Record<TableName, Array<Record<string, unknown> & { id: string | number }>>

function assertStoreCoverage() {
  if (db.tables.length !== BACKUP_TABLES.length || db.tables.some((table) => !BACKUP_TABLES.includes(table.name as TableName))) throw new Error('BACKUP_STORE_SCHEMA_MISMATCH')
}
function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
function decodeBytes(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('INVALID_BACKUP_ASSET_BASE64')
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  if (encodeBytes(bytes) !== value) throw new Error('INVALID_BACKUP_ASSET_BASE64')
  return bytes
}

function validateData(value: unknown): BackupRows {
  const object = z.object(Object.fromEntries(BACKUP_TABLES.map((name) => [name, z.array(schemas[name])]))).strict().parse(value) as BackupRows
  for (const name of BACKUP_TABLES) {
    const ids = object[name].map((record) => record.id)
    if (new Set(ids).size !== ids.length) throw new Error(`DUPLICATE_BACKUP_ID:${name}`)
  }
  const topics = new Map(object.topics.map((record) => [record.id, record]))
  for (const topic of object.topics) {
    const visited = new Set<string | number>([topic.id])
    let parentId = topic.parent_id
    while (parentId !== null) {
      if (visited.has(parentId as number)) throw new Error('BACKUP_TOPIC_CYCLE')
      const parent = topics.get(parentId as number)
      if (!parent) throw new Error('BACKUP_TOPIC_PARENT_MISSING')
      visited.add(parent.id)
      parentId = parent.parent_id
    }
  }
  for (const record of object.conversations) if (record.topic_id !== null && !topics.has(record.topic_id as number)) throw new Error('BACKUP_CONVERSATION_TOPIC_MISSING')
  const sources = new Set(object.note_sources.map((record) => record.id))
  for (const record of object.note_assets) if (!sources.has(record.vault_id as string)) throw new Error('BACKUP_ASSET_SOURCE_MISSING')
  const conversationIds = new Set(object.conversations.map((record) => record.id))
  const messages = new Map(object.messages.map((record) => [record.id, record]))
  for (const record of [...object.messages, ...object.vectors]) if (!conversationIds.has(record.conversation_id as number)) throw new Error('BACKUP_CONVERSATION_MISSING')
  for (const record of object.summaries) if (!conversationIds.has(record.conversationId as number)) throw new Error('BACKUP_CONVERSATION_MISSING')
  for (const record of object.annotations) {
    const message = messages.get(record.message_id as number)
    if (!message || message.conversation_id !== record.conversation_id) throw new Error('BACKUP_ANNOTATION_TARGET_INVALID')
  }
  const sessions = new Set(object.explore_sessions.map((record) => record.id))
  for (const record of object.explore_messages) if (!sessions.has(record.sessionId as string)) throw new Error('BACKUP_EXPLORE_SESSION_MISSING')
  for (const record of object.vectors) if ((record.embedding as number[]).length !== record.embedding_dimensions) throw new Error('BACKUP_VECTOR_DIMENSION_MISMATCH')
  for (const record of object.note_assets) if (decodeBytes(record.blob_base64 as string).length !== record.byte_size) throw new Error('BACKUP_ASSET_SIZE_MISMATCH')
  // Note and extracted-prompt source IDs are provenance, not live foreign keys:
  // users can retain their notes/prompts after deleting the source conversation.
  return object
}

export async function exportFullBackup(): Promise<ExportPayload> {
  assertStoreCoverage()
  const snapshot = await db.transaction('r', db.tables, async () => Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (name) => [name, await db.table(name).toArray()]))))
  // Blob conversion is outside the IndexedDB transaction; the snapshot is fixed.
  const data = { ...snapshot,
    vectors: snapshot.vectors.map((record) => ({ ...record, embedding: Array.from(record.embedding) })),
    note_assets: await Promise.all(snapshot.note_assets.map(async ({ blob, ...record }) => ({ ...record, blob_base64: encodeBytes(new Uint8Array(await blob.arrayBuffer())), blob_type: blob.type })))
  }
  validateData(data)
  const exportedAt = new Date().toISOString()
  return {
    content: JSON.stringify({ schema_version: 'vesti_export.v2', exported_at: exportedAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', app_version: typeof chrome === 'undefined' ? 'unknown' : chrome.runtime?.getManifest?.().version ?? 'unknown', data }, null, 2),
    filename: `vesti-backup-${exportedAt.replace(/[:.]/g, '-')}.json`, mime: 'application/json'
  }
}

export async function importFullBackup(root: unknown): Promise<ImportDataResult> {
  assertStoreCoverage()
  const parsed = z.object({ schema_version: z.literal('vesti_export.v2'), data: z.unknown() }).passthrough().parse(root)
  const data = validateData(parsed.data)
  const restored = { ...data,
    vectors: data.vectors.map((record) => ({ ...record, embedding: new Float32Array(record.embedding as number[]) })),
    note_assets: data.note_assets.map(({ blob_base64, blob_type, ...record }) => ({ ...record, blob: new Blob([decodeBytes(blob_base64 as string)], { type: blob_type as string }) }))
  }
  // Validate/decode everything before clearing any store, then replace atomically.
  await db.transaction('rw', db.tables, async () => {
    for (const name of BACKUP_TABLES) await db.table(name).clear()
    for (const name of BACKUP_TABLES) if (restored[name].length) await db.table(name).bulkPut(restored[name])
  })
  return { conversations: data.conversations.length, messages: data.messages.length, summaries: data.summaries.length, weeklyReports: data.weekly_reports.length, annotations: data.annotations.length, restoredRecords: BACKUP_TABLES.reduce((count, name) => count + data[name].length, 0) }
}
