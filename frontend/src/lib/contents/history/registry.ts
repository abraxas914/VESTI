// Host → history-provider registry.
//
// Only platforms with a known, stable read API are wired today (ChatGPT,
// Claude). The remaining platforms return null so the UI can show "not yet
// supported" rather than failing silently; new providers slot in here.

import type { Platform } from "../../types";
import type { HistoryProvider } from "./types";
import { createChatGptHistoryProvider } from "./chatgptHistory";
import { createClaudeHistoryProvider } from "./claudeHistory";

const HOST_PLATFORM: Record<string, Platform> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "claude.ai": "Claude",
};

/** Platforms with a working history provider (for UI capability hints). */
export const SUPPORTED_HISTORY_PLATFORMS: Platform[] = ["ChatGPT", "Claude"];

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
    default:
      return null;
  }
}
