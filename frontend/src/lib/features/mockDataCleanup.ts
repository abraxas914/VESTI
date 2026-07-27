import {
  deleteConversations,
  getConversations
} from "../services/storageService"

export interface MockDataCleanupResult {
  deleted: number
}

export async function clearSeededMockData(): Promise<MockDataCleanupResult> {
  const conversations = await getConversations()
  const mockIds = conversations
    .filter((conversation) => conversation.isMock === true)
    .map((conversation) => conversation.id)
  await deleteConversations(mockIds)
  return { deleted: mockIds.length }
}
