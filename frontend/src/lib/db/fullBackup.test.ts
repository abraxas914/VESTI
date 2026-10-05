import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './schema'
import { BACKUP_TABLES } from './fullBackup'
import { exportAllDataAsJson, exportBridgeDataAsJson, importAllData } from './repository'

const dated = { created_at: 1, updated_at: 2 }
const fixtures = {
  conversations: { id: 1, uuid: 'fixture', platform: 'ChatGPT', title: 'Fixture', snippet: 'fixture', url: 'https://chatgpt.com/c/fixture', ...dated, source_created_at: null, first_captured_at: 1, last_captured_at: 2, message_count: 1, turn_count: 1, is_starred: false, is_archived: false, is_trash: false, tags: [], topic_id: 1 },
  messages: { id: 1, conversation_id: 1, role: 'ai', content_text: 'fixture message', created_at: 1 },
  summaries: { id: 1, conversationId: 1, content: 'fixture summary', modelId: 'fixture', createdAt: 1, sourceUpdatedAt: 2 },
  weekly_reports: { id: 1, rangeStart: 1, rangeEnd: 2, content: 'weekly', modelId: 'fixture', createdAt: 2, sourceHash: 'fixture' },
  topics: { id: 1, parent_id: null, name: 'fixture topic', ...dated },
  vectors: { id: 1, conversation_id: 1, text_hash: 'fixture', embedding: new Float32Array([0.5, 1]), embedding_provider: 'fixture', embedding_model: 'fixture', embedding_dimensions: 2, index_version: 'fixture' },
  notes: { id: 1, title: 'fixture note', content: '# note', excerpt: 'note', hash: 'fixture', ...dated, linked_conversation_ids: [1], source_type: 'obsidian', source_path: 'note.md', import_meta: { vault_id: 'source-1' }, obsidian_export: null },
  note_sources: { id: 'source-1', name: 'fixture source', kind: 'directory', ...dated },
  note_assets: { id: 'asset-1', vault_id: 'source-1', relative_path: 'file.bin', mime_type: 'application/octet-stream', hash: 'fixture', byte_size: 4, blob: new Blob([new Uint8Array([0, 128, 255, 42])], { type: 'application/octet-stream' }), ...dated },
  annotations: { id: 1, conversation_id: 1, message_id: 1, content_text: 'fixture annotation', created_at: 2, days_after: 0 },
  explore_sessions: { id: 'session-1', title: 'fixture chat', preview: 'answer', messageCount: 1, createdAt: 1, updatedAt: 2 },
  explore_messages: { id: 'message-1', sessionId: 'session-1', role: 'assistant', content: 'fixture answer', sources: '[{"id":1}]', timestamp: 2 },
  prompts: { id: 1, title: 'fixture prompt', body: 'prompt body', category: null, tags: [], source: 'manual', source_platform: null, source_conversation_id: null, source_message_id: null, is_favorite: true, is_archived: false, quality_score: 0, summary: null, variables: [], use_count: 0, last_used_at: null, body_hash: 'fixture', ...dated }
}

beforeEach(async () => {
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: 'test' }) } })
  await db.open()
  await db.transaction('rw', db.tables, async () => {
    for (const name of BACKUP_TABLES) { await db.table(name).clear(); await db.table(name).put(fixtures[name]) }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

const snapshot = async () => Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (name) => [name, await db.table(name).toArray()])))

describe('complete JSON backup', () => {
  it('round-trips all stores, binary assets, vectors and metadata', async () => {
    const backup = await exportAllDataAsJson()
    const parsed = JSON.parse(backup)
    expect(parsed.schema_version).toBe('vesti_export.v2')
    expect(Object.keys(parsed.data).sort()).toEqual([...BACKUP_TABLES].sort())
    await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear() })
    expect(await importAllData(backup)).toMatchObject({ restoredRecords: 13 })
    for (const name of BACKUP_TABLES) {
      const record = await db.table(name).get(fixtures[name].id)
      if (name === 'note_assets') {
        const { blob, ...fields } = record
        const { blob: original, ...expected } = fixtures.note_assets
        expect(fields).toEqual(expected)
        expect(blob.type).toBe(original.type)
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()))
      } else expect(record).toEqual(fixtures[name])
    }
  })

  it.each(['missing-store', 'duplicate-id', 'bad-asset', 'bad-dimensions', 'missing-message', 'topic-cycle', 'missing-asset-source'])('rejects %s before touching stored data', async (kind) => {
    const before = await snapshot()
    const parsed = JSON.parse(await exportAllDataAsJson())
    if (kind === 'missing-store') delete parsed.data.notes
    if (kind === 'duplicate-id') parsed.data.notes.push(parsed.data.notes[0])
    if (kind === 'bad-asset') parsed.data.note_assets[0].blob_base64 = 'broken!'
    if (kind === 'bad-dimensions') parsed.data.vectors[0].embedding_dimensions = 3
    if (kind === 'topic-cycle') parsed.data.topics[0].parent_id = 1
    if (kind === 'missing-asset-source') parsed.data.note_assets[0].vault_id = 'missing'
    if (kind === 'missing-message') parsed.data.annotations[0].message_id = 99
    await expect(importAllData(JSON.stringify(parsed))).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })

  it('rolls back every store on a restore write failure', async () => {
    const before = await snapshot()
    const backup = await exportAllDataAsJson()
    const original = db.notes.bulkPut
    vi.spyOn(Object.getPrototypeOf(db.notes), 'bulkPut').mockImplementation(function (this: typeof db.notes, rows) {
      if (this.name === 'notes') return Promise.reject(new Error('fixture failure'))
      return original.call(this, rows)
    })
    await expect(importAllData(backup)).rejects.toThrow('fixture failure')
    expect(await snapshot()).toEqual(before)
  })

  it('keeps the desktop bridge v1 export and legacy import compatible', async () => {
    const bridge = await exportBridgeDataAsJson()
    expect(JSON.parse(bridge).schema_version).toBe('vesti_export.v1')
    await expect(importAllData(bridge)).resolves.toMatchObject({ conversations: 1, messages: 1 })
    expect(await db.notes.count()).toBe(1)
  })
})
