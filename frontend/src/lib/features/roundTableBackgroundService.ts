import type {
  CoreRoundtableReply,
  CoreRoundtableResult,
  CoreRoundtableRoleId
} from "../messaging/protocol"
import {
  buildDefaultLlmSettings,
  normalizeLlmSettings
} from "../services/llmConfig"
import { callInference } from "../services/llmService"
import { resolveUsableLlmConfig } from "../services/promptLlmService"

const ROLE_PROMPTS: Record<
  CoreRoundtableRoleId,
  { name: string; systemPrompt: string }
> = {
  domain_expert: {
    name: "领域专家",
    systemPrompt:
      "你是圆桌中的领域专家。请给出准确的原理、最佳实践与常见误区；明确不确定性。使用中文，控制在180字以内。"
  },
  devils_advocate: {
    name: "唱反调者",
    systemPrompt:
      "你是圆桌中的唱反调者。请提出最有力的反方论证，挑战默认共识并指出它在什么条件下会失败。使用中文，控制在180字以内。"
  },
  skeptic: {
    name: "怀疑者",
    systemPrompt:
      "你是圆桌中的怀疑者。请检查证据、隐藏假设和风险，提出需要进一步验证的问题。使用中文，控制在180字以内。"
  }
}

async function runRole(
  role: CoreRoundtableRoleId,
  topic: string
): Promise<CoreRoundtableReply> {
  const startedAt = Date.now()
  const roleConfig = ROLE_PROMPTS[role]
  try {
    const stored = await resolveUsableLlmConfig()
    const config = stored ?? normalizeLlmSettings(buildDefaultLlmSettings())
    const response = await callInference(
      config,
      `讨论话题：${topic}\n\n请只给出你这个角色的观点，不要代替其他角色发言。`,
      { systemPrompt: roleConfig.systemPrompt }
    )
    return {
      role,
      name: roleConfig.name,
      content: response.content.trim(),
      ok: true,
      durationMs: Date.now() - startedAt
    }
  } catch (error) {
    return {
      role,
      name: roleConfig.name,
      content: "",
      ok: false,
      error: (error as Error)?.message ?? String(error),
      durationMs: Date.now() - startedAt
    }
  }
}

export async function runCoreRoundTableService(
  topic: string
): Promise<CoreRoundtableResult> {
  const startedAt = Date.now()
  const roles = Object.keys(ROLE_PROMPTS) as CoreRoundtableRoleId[]
  const replies = await Promise.all(roles.map((role) => runRole(role, topic)))
  return {
    topic,
    replies,
    totalDurationMs: Date.now() - startedAt
  }
}
