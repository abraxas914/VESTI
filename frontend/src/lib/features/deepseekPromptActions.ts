import { sendRequest } from "../messaging/runtime"

export type DeepSeekPromptActionMode = "expert_explain" | "optimize"

const TEST_TOPIC = "为什么小猫晚上睡不着"

export async function optimizePrompt(
  content: string,
  mode: DeepSeekPromptActionMode
): Promise<string> {
  const originalText = mode === "expert_explain" ? TEST_TOPIC : content.trim()
  if (!originalText) throw new Error("DEEPSEEK_PROMPT_REQUIRED")

  const result = await sendRequest<"OPTIMIZE_DEEPSEEK_PROMPT">(
    {
      type: "OPTIMIZE_DEEPSEEK_PROMPT",
      target: "background",
      payload: { originalText, mode }
    },
    120_000
  )
  return result.optimized
}

export function callPromptOptimizerAPI(originalText: string): Promise<string> {
  return optimizePrompt(originalText, "optimize")
}
