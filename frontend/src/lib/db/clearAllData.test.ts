import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './schema'
import { clearAllData } from './repository'

beforeEach(async () => {
  await db.open()
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
      await table.add({ id: table.schema.primKey.auto ? 1 : 'fixture', content: 'private test content' })
    }
  })
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

describe('Clear All database contract', () => {
  it('clears every registered store, including notes, assets and Explore', async () => {
    expect(db.tables.map((table) => table.name)).toEqual(expect.arrayContaining(['notes', 'note_assets', 'vectors', 'explore_messages', 'topics', 'prompts']))
    await clearAllData()
    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
  })

  it('rolls back all stores if any clear operation fails', async () => {
    const originalClear = db.notes.clear
    vi.spyOn(Object.getPrototypeOf(db.notes), 'clear').mockImplementation(function (this: typeof db.notes) {
      if (this.name === 'notes') return Promise.reject(new Error('fixture failure'))
      return originalClear.call(this)
    })
    await expect(clearAllData()).rejects.toThrow('fixture failure')
    for (const table of db.tables) expect(await table.count(), table.name).toBe(1)
  })
})
