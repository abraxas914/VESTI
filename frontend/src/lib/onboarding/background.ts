import { logger } from "../utils/logger"
import {
  completeOnboarding,
  getOnboardingState,
  hasCompletedOnboardingTour,
  initializeFreshInstall,
  migrateOnExtensionUpdate,
  ONBOARDING_FEATURES,
  resolveOnboardingDestination,
  startOnboardingTour,
  updateOnboardingGuideProgress,
  type OnboardingFeature
} from "./state"

let onboardingMutationQueue: Promise<void> = Promise.resolve()

function serializeOnboardingMutation<T>(
  operation: () => Promise<T>
): Promise<T> {
  const result = onboardingMutationQueue.then(operation, operation)
  onboardingMutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function setPanelActionBehavior(
  openPanelOnActionClick: boolean
): Promise<void> {
  if (!chrome.sidePanel?.setPanelBehavior) return Promise.resolve()
  return new Promise((resolve, reject) => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick }, () => {
      const error = chrome.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve()
    })
  })
}

export async function syncOnboardingPanelBehavior(): Promise<void> {
  try {
    const state = await getOnboardingState()
    await setPanelActionBehavior(state.hasSeenOnboarding)
  } catch (error) {
    logger.warn("background", "Unable to sync onboarding toolbar behavior", {
      error: (error as Error)?.message ?? String(error)
    })
  }
}

function queryTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, (tabs) => {
      const error = chrome.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(tabs)
    })
  })
}

function focusTab(tab: chrome.tabs.Tab): Promise<void> {
  if (typeof tab.id !== "number") return Promise.resolve()
  return new Promise((resolve) => {
    chrome.tabs.update(tab.id as number, { active: true }, (updated) => {
      void chrome.runtime.lastError
      if (typeof updated?.windowId !== "number") {
        resolve()
        return
      }
      chrome.windows.update(updated.windowId, { focused: true }, () => {
        void chrome.runtime.lastError
        resolve()
      })
    })
  })
}

function createTab(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, () => {
      const error = chrome.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve()
    })
  })
}

async function focusOrCreateOnboardingPage(): Promise<void> {
  const baseUrl = chrome.runtime.getURL("onboarding.html")
  const onboardingPageUrl = chrome.runtime.getURL("tabs/onboarding.html")
  const tabs = await queryTabs()
  const existing = tabs.find((tab) => {
    if (!tab.url) return false
    return tab.url === baseUrl || tab.url === onboardingPageUrl
  })

  if (existing) {
    await focusTab(existing)
    return
  }
  await createTab(baseUrl)
}

export async function handleOnboardingInstalled(
  details: chrome.runtime.InstalledDetails
): Promise<void> {
  if (details.reason === "install") {
    await initializeFreshInstall()
    await setPanelActionBehavior(false)
    await focusOrCreateOnboardingPage()
    return
  }

  if (details.reason === "update") {
    const state = await migrateOnExtensionUpdate()
    await setPanelActionBehavior(state.hasSeenOnboarding)
  }
}

export async function handleOnboardingActionClick(): Promise<void> {
  try {
    const state = await getOnboardingState()
    const destination = resolveOnboardingDestination(state)
    if (destination === "sidepanel") return

    await setPanelActionBehavior(false)
    await focusOrCreateOnboardingPage()
  } catch (error) {
    logger.warn("background", "Unable to route onboarding toolbar click", {
      error: (error as Error)?.message ?? String(error)
    })
    await focusOrCreateOnboardingPage()
  }
}

export function finishOnboarding(
  via: "quick_start" | "skip",
  hasCleanedMockData?: boolean
): Promise<{ completed: true }> {
  return serializeOnboardingMutation(async () => {
    if (via === "quick_start") {
      const state = await getOnboardingState()
      if (!hasCompletedOnboardingTour(state.onboardingStepCompleted)) {
        throw new Error("ONBOARDING_TOUR_INCOMPLETE")
      }
    }
    await completeOnboarding(via, { hasCleanedMockData })
    await setPanelActionBehavior(true)
    return { completed: true }
  })
}

export function beginOnboardingTour(): Promise<{ started: true }> {
  return serializeOnboardingMutation(async () => {
    await startOnboardingTour()
    await setPanelActionBehavior(false)
    return { started: true }
  })
}

export function recordOnboardingGuideProgress(
  feature: OnboardingFeature,
  options: { step?: number; completed?: boolean }
): Promise<{ completed: boolean; allCompleted: boolean }> {
  return serializeOnboardingMutation(async () => {
    if (!ONBOARDING_FEATURES.includes(feature)) {
      throw new Error("ONBOARDING_FEATURE_INVALID")
    }
    const state = await updateOnboardingGuideProgress(feature, options)
    const allCompleted = hasCompletedOnboardingTour(
      state.onboardingStepCompleted
    )
    if (allCompleted && !state.hasSeenOnboarding) {
      await focusOrCreateOnboardingPage()
    }
    return {
      completed: state.onboardingStepCompleted[feature],
      allCompleted
    }
  })
}
