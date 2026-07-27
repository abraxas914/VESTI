import type {
  CoreRoundtableResult,
  CoreRoundtableRoleId
} from "../messaging/protocol"
import { sendRequest } from "../messaging/runtime"

export const CORE_ROUNDTABLE_ROLES: CoreRoundtableRoleId[] = [
  "domain_expert",
  "devils_advocate",
  "skeptic"
]

export async function roundTableService(
  topic: string
): Promise<CoreRoundtableResult> {
  const normalized = topic.trim()
  if (!normalized) throw new Error("ROUNDTABLE_TOPIC_REQUIRED")

  return sendRequest<"RUN_CORE_ROUNDTABLE">(
    {
      type: "RUN_CORE_ROUNDTABLE",
      target: "background",
      payload: { topic: normalized }
    },
    120_000
  )
}
