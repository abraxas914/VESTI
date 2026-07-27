import { sendRequest } from "../messaging/runtime"
import {
  getOnboardingState,
  ONBOARDING_STATE_KEY,
  type OnboardingFeature,
  type OnboardingState
} from "../onboarding/state"

export const ONBOARDING_EXPLORE_PROMPT_PENDING_KEY =
  "vesti_onboarding_explore_prompt_pending"

export type ExplorePromptStage = "explore_tab" | null

export function normalizeExplorePromptStage(
  value: unknown
): ExplorePromptStage {
  if (value === true || value === "explore_tab") return "explore_tab"
  return null
}

export function getExplorePromptStageFromSearch(
  search: string
): ExplorePromptStage {
  const value = new URLSearchParams(search).get("onboarding")
  if (value === "explore" || value === "explore-tab") {
    return "explore_tab"
  }
  return null
}

export function setExplorePromptStage(
  stage: ExplorePromptStage
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(
      { [ONBOARDING_EXPLORE_PROMPT_PENDING_KEY]: stage },
      () => {
        const error = chrome.runtime.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        resolve()
      }
    )
  })
}

export function getExplorePromptStage(): Promise<ExplorePromptStage> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(
      [ONBOARDING_EXPLORE_PROMPT_PENDING_KEY],
      (result) => {
        const error = chrome.runtime.lastError
        if (error) {
          reject(new Error(error.message))
          return
        }
        resolve(
          normalizeExplorePromptStage(
            result[ONBOARDING_EXPLORE_PROMPT_PENDING_KEY]
          )
        )
      }
    )
  })
}

export const ONBOARDING_GUIDE_COPY = {
  zh: {
    skipStep: "跳过该步骤",
    endDemo: "结束演示",
    next: "下一步",
    gotIt: "知道了",
    dashboard: [
      "先勾选第一条想合并的对话",
      "再勾选一条，共选择两条对话",
      "✨ 点击生成合并摘要",
      "点击延续对话"
    ],
    explore: [
      "现在点击这里进入资料库面板",
      "点击对话知识库旁边的“探索”，进入问答",
      "小猫带你对自己的知识库进行提问、总结和探索。"
    ],
    aiti: [
      "点击 AITI，查看你的 AI 对话画像",
      "小猫根据你的AI对话形象进行分析，你是脑洞大开的创新者，还是深度专研的思考者呢？"
    ],
    learn: [
      "点击“学习”，查看小猫为你整理的学习地图",
      "小猫把过去的对话整理成知识领域、重要术语和待解决问题，方便你持续回顾。"
    ],
    roundtable: [
      "点击 AI 圆桌聊天，邀请三个角色入席",
      "领域专家、唱反调者和怀疑者会从多个角度与你共同讨论感兴趣的话题。"
    ],
    insights: [
      "点击侧栏的“洞察”，查看个人成长周报",
      "洞察会梳理一周内的对话主题、关键进展和成长线索，生成你的个人成长周报。"
    ],
    deepseek: [
      "点击浏览器页面上的 VESTI 小猫，打开随身工具",
      "“优化”帮你打磨提问思路，“续写”帮你自然延展当前内容；这里只做介绍，不会打开网页或代你操作。"
    ] as readonly string[]
  }
} as const

export function getOnboardingGuideCopy(locale: string) {
  return (
    ONBOARDING_GUIDE_COPY[
      locale as keyof typeof ONBOARDING_GUIDE_COPY
    ] ?? ONBOARDING_GUIDE_COPY.zh
  )
}

export async function beginOnboardingTour(): Promise<void> {
  await sendRequest<"ONBOARDING_TOUR_START">({
    type: "ONBOARDING_TOUR_START",
    target: "background"
  })
}

export async function endOnboardingTour(): Promise<void> {
  await sendRequest<"ONBOARDING_COMPLETE">({
    type: "ONBOARDING_COMPLETE",
    target: "background",
    payload: { via: "skip" }
  })
}

export async function setOnboardingGuideProgress(
  feature: OnboardingFeature,
  options: { step?: number; completed?: boolean }
): Promise<{ completed: boolean; allCompleted: boolean }> {
  return sendRequest<"ONBOARDING_GUIDE_PROGRESS">({
    type: "ONBOARDING_GUIDE_PROGRESS",
    target: "background",
    payload: { feature, ...options }
  })
}

export async function setOnboardingGuideProgressIfActive(
  feature: OnboardingFeature,
  options: { step?: number; completed?: boolean }
): Promise<boolean> {
  const state = await getOnboardingState()
  if (
    state.hasSeenOnboarding ||
    !state.tourStarted ||
    state.onboardingStepCompleted[feature]
  ) {
    return false
  }
  await setOnboardingGuideProgress(feature, options)
  return true
}

export function subscribeToOnboardingState(
  listener: (state: OnboardingState) => void
): () => void {
  const handleStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== "local" || !changes[ONBOARDING_STATE_KEY]) return
    void getOnboardingState().then(listener).catch(() => undefined)
  }
  chrome.storage.onChanged.addListener(handleStorageChange)
  return () => chrome.storage.onChanged.removeListener(handleStorageChange)
}
