import { afterEach, expect, test } from 'bun:test'
import { askKnowledgeBase, getAllEdges, saveNote, updateNote } from './storageService.ts'

const originalChrome = globalThis.chrome
const requests = []
function mockRuntime(data) {
  requests.length = 0
  globalThis.chrome = { runtime: { sendMessage(message, callback) {
    requests.push(message)
    callback({ ok: true, type: message.type, data })
  } } }
}
afterEach(() => { globalThis.chrome = originalChrome })

test('Explore preserves session, mode and context options', async () => {
  const result = { answer: 'answer', sources: [], sessionId: 'session' }
  mockRuntime(result)
  const options = { contextDraft: 'context', selectedContextConversationIds: [1] }
  expect(await askKnowledgeBase('question', 'session', 3, 'agent', options)).toEqual(result)
  expect(requests[0].payload).toEqual({ query: 'question', sessionId: 'session', limit: 3, mode: 'agent', options })
})

test('network edges preserve the dashboard options object', async () => {
  mockRuntime([])
  await getAllEdges({ threshold: 0.7, conversationIds: [1, 2] })
  expect(requests[0].payload).toEqual({ threshold: 0.7, conversationIds: [1, 2] })
  await getAllEdges()
  expect(requests[1].payload.threshold).toBe(0.3)
})

test('note create/update preserve metadata from the shared UI contract', async () => {
  const note = { id: 1, title: 'note', content: 'text', excerpt: 'text', source_type: 'manual' }
  mockRuntime({ note })
  const input = { title: 'note', content: 'text', linked_conversation_ids: [], is_starred: true }
  expect(await saveNote(input)).toEqual(note)
  expect(requests[0].payload).toEqual(input)
  const changes = { linked_conversation_ids: [2], is_starred: false }
  expect(await updateNote(1, changes)).toEqual(note)
  expect(requests[1].payload).toEqual({ id: 1, changes })
})

test('pages without an extension runtime fail explicitly', async () => {
  globalThis.chrome = undefined
  await expect(getAllEdges()).rejects.toThrow('CHROME_RUNTIME_UNAVAILABLE')
})
