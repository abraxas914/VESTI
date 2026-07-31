import {
  buildDefaultLlmSettings,
  normalizeLlmSettings
} from "../services/llmConfig"
import {
  completePromptDraft,
  resolveUsableLlmConfig
} from "../services/promptLlmService"
import type { DeepSeekPromptActionMode } from "./deepseekPromptActions"

function buildExpertDraft(topic: string): string {
  return [
    "请像一位兼具专业知识与教学耐心的导师一样讲解下面的主题。",
    `主题：${topic}`,
    "要求：先用一句话给出核心结论，再解释背后的机制，使用生活化类比，最后给出三个可以继续追问的问题。",
    "表达应准确、简单，不使用不必要的术语。"
  ].join("\n")
}

function buildOptimizerFallback(originalText: string): string {
  return [
    "请以清晰、准确、易懂的方式回答下面的问题：",
    originalText.trim(),
    "",
    "要求：先说明核心结论，再解释原因与关键机制；必要时给出具体例子，并明确任何不确定性。"
  ].join("\n")
}

export async function optimizeDeepSeekPromptInBackground(
  originalText: string,
  mode: DeepSeekPromptActionMode
): Promise<{ optimized: string; usedLlm: boolean }> {
  const draft =
    mode === "expert_explain"
      ? buildExpertDraft("为什么小猫晚上睡不着")
      : buildOptimizerFallback(originalText)
  const stored = await resolveUsableLlmConfig()
  const config = stored ?? normalizeLlmSettings(buildDefaultLlmSettings())
  const result = await completePromptDraft(config, {
    draft,
    platform: "DeepSeek",
    mode: "optimize",
    relatedPrompts: []
  })
  return {
    optimized: result.completion.trim() || draft,
    usedLlm: result.usedLlm
  }
}
