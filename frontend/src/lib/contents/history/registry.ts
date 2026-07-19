// Host → history-provider registry.
//
// Every capture platform now has a provider wired. Providers call the
// platform's own backend API from the content script (page cookies apply) and
// stay read-only; a host without a provider returns null so the UI can show
// "not yet supported" rather than failing silently.

import type { Platform } from "../../types";
import type { HistoryProvider } from "./types";
import { createChatGptHistoryProvider } from "./chatgptHistory";
import { createClaudeHistoryProvider } from "./claudeHistory";
import { createGeminiHistoryProvider } from "./geminiHistory";
import { createDeepseekHistoryProvider } from "./deepseekHistory";
import { createKimiHistoryProvider } from "./kimiHistory";
import { createDoubaoHistoryProvider } from "./doubaoHistory";
import { createQwenHistoryProvider } from "./qwenHistory";
import { createYuanbaoHistoryProvider } from "./yuanbaoHistory";

const HOST_PLATFORM: Record<string, Platform> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "claude.ai": "Claude",
  "gemini.google.com": "Gemini",
  "chat.deepseek.com": "DeepSeek",
  "www.doubao.com": "Doubao",
  "chat.qwen.ai": "Qwen",
  "www.kimi.com": "Kimi",
  "kimi.com": "Kimi",
  "kimi.moonshot.cn": "Kimi",
  "yuanbao.tencent.com": "Yuanbao",
};

/** Platforms with a working history provider (for UI capability hints). */
export const SUPPORTED_HISTORY_PLATFORMS: Platform[] = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "DeepSeek",
  "Doubao",
  "Qwen",
  "Kimi",
  "Yuanbao",
];

export function platformForHistoryHost(hostname: string): Platform | null {
  const host = String(hostname ?? "").trim().toLowerCase();
  return HOST_PLATFORM[host] ?? null;
}

export function getHistoryProvider(hostname: string): HistoryProvider | null {
  const platform = platformForHistoryHost(hostname);
  if (!platform) return null;
  switch (platform) {
    case "ChatGPT":
      return createChatGptHistoryProvider();
    case "Claude":
      return createClaudeHistoryProvider();
    case "Gemini":
      return createGeminiHistoryProvider();
    case "DeepSeek":
      return createDeepseekHistoryProvider();
    case "Doubao":
      return createDoubaoHistoryProvider();
    case "Qwen":
      return createQwenHistoryProvider();
    case "Kimi":
      return createKimiHistoryProvider();
    case "Yuanbao":
      return createYuanbaoHistoryProvider();
    default:
      return null;
  }
}
