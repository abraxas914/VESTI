import type { Platform } from "../types"

export const SUPPORTED_CAPTURE_MATCH_PATTERNS = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://claude.ai/*",
  "https://gemini.google.com/*",
  "https://chat.deepseek.com/*",
  "https://www.doubao.com/*",
  "https://chat.qwen.ai/*",
  "https://www.kimi.com/*",
  "https://kimi.com/*",
  "https://kimi.moonshot.cn/*",
  "https://yuanbao.tencent.com/*"
] as const

const SUPPORTED_CAPTURE_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "chat.deepseek.com",
  "www.doubao.com",
  "chat.qwen.ai",
  "www.kimi.com",
  "kimi.com",
  "kimi.moonshot.cn",
  "yuanbao.tencent.com"
])

export function resolvePlatformFromUrl(url: string): Platform | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === "chatgpt.com" || host === "chat.openai.com") {
      return "ChatGPT"
    }
    if (host === "claude.ai") return "Claude"
    if (host === "gemini.google.com") return "Gemini"
    if (host === "chat.deepseek.com") return "DeepSeek"
    if (host === "www.doubao.com") return "Doubao"
    if (host === "chat.qwen.ai") return "Qwen"
    if (
      host === "www.kimi.com" ||
      host === "kimi.com" ||
      host === "kimi.moonshot.cn"
    ) {
      return "Kimi"
    }
    if (host === "yuanbao.tencent.com") return "Yuanbao"
  } catch {
    return undefined
  }
  return undefined
}

export function isSupportedCaptureTabUrl(url?: string): boolean {
  if (!url) return false
  try {
    return SUPPORTED_CAPTURE_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

function tabRecency(tab: chrome.tabs.Tab): number {
  const lastAccessed = (tab as chrome.tabs.Tab & { lastAccessed?: number })
    .lastAccessed
  return typeof lastAccessed === "number" && Number.isFinite(lastAccessed)
    ? lastAccessed
    : 0
}

export function rankSupportedCaptureTabs(
  tabs: chrome.tabs.Tab[],
  excludeTabId?: number
): chrome.tabs.Tab[] {
  return tabs
    .filter(
      (tab) =>
        typeof tab.id === "number" &&
        tab.id !== excludeTabId &&
        isSupportedCaptureTabUrl(tab.url)
    )
    .sort((left, right) => {
      const recencyDifference = tabRecency(right) - tabRecency(left)
      if (recencyDifference !== 0) return recencyDifference
      if (left.active !== right.active) return left.active ? -1 : 1
      return (right.id ?? 0) - (left.id ?? 0)
    })
}

export async function findMostRecentSupportedCaptureTab(
  excludeTabId?: number
): Promise<chrome.tabs.Tab | null> {
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query(
      { url: [...SUPPORTED_CAPTURE_MATCH_PATTERNS] },
      (result) => {
        const error = chrome.runtime?.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        resolve(result)
      }
    )
  })
  return rankSupportedCaptureTabs(tabs, excludeTabId)[0] ?? null
}
