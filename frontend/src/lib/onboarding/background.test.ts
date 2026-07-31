import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  beginOnboardingTour,
  finishOnboarding,
  handleOnboardingActionClick,
  handleOnboardingInstalled,
  recordOnboardingGuideProgress
} from "./background"
import {
  HAS_CLEANED_MOCK_DATA_KEY,
  HAS_SEEN_ONBOARDING_KEY,
  ONBOARDING_STEP_COMPLETED_KEY
} from "./state"

const storage = new Map<string, unknown>()
const createdUrls: string[] = []
const panelBehaviors: boolean[] = []

function installedDetails(
  reason: "install" | "update",
  previousVersion?: string
): chrome.runtime.InstalledDetails {
  return { reason, previousVersion } as chrome.runtime.InstalledDetails
}

function installChromeMock() {
  vi.stubGlobal("chrome", {
    runtime: {
      lastError: undefined,
      getURL(path: string) {
        return `chrome-extension://vesti/${path}`
      }
    },
    storage: {
      local: {
        get(keys: string[] | string, callback: (result: object) => void) {
          const requested = Array.isArray(keys) ? keys : [keys]
          callback(
            Object.fromEntries(
              requested
                .filter((key) => storage.has(key))
                .map((key) => [key, storage.get(key)])
            )
          )
        },
        set(payload: Record<string, unknown>, callback: () => void) {
          Object.entries(payload).forEach(([key, value]) =>
            storage.set(key, value)
          )
          callback()
        },
        remove(keys: string[] | string, callback: () => void) {
          const requested = Array.isArray(keys) ? keys : [keys]
          requested.forEach((key) => storage.delete(key))
          callback()
        }
      }
    },
    sidePanel: {
      setPanelBehavior(
        options: { openPanelOnActionClick: boolean },
        callback: () => void
      ) {
        panelBehaviors.push(options.openPanelOnActionClick)
        callback()
      }
    },
    tabs: {
      query(
        _queryInfo: chrome.tabs.QueryInfo,
        callback: (tabs: chrome.tabs.Tab[]) => void
      ) {
        callback([])
      },
      create(options: chrome.tabs.CreateProperties, callback: () => void) {
        createdUrls.push(String(options.url))
        callback()
      },
      update(
        _tabId: number,
        _options: chrome.tabs.UpdateProperties,
        callback: (tab?: chrome.tabs.Tab) => void
      ) {
        callback(undefined)
      }
    },
    windows: {
      update(
        _windowId: number,
        _options: chrome.windows.UpdateInfo,
        callback: () => void
      ) {
        callback()
      }
    }
  })
}

describe("onboarding background lifecycle", () => {
  beforeEach(() => {
    storage.clear()
    createdUrls.length = 0
    panelBehaviors.length = 0
    installChromeMock()
  })

  it("initializes a fresh install and opens the stable onboarding entry", async () => {
    await handleOnboardingInstalled(installedDetails("install"))

    expect(storage.get(HAS_SEEN_ONBOARDING_KEY)).toBe(false)
    expect(panelBehaviors.at(-1)).toBe(false)
    expect(createdUrls).toEqual(["chrome-extension://vesti/onboarding.html"])
  })

  it("routes an unfinished guided tour back through onboarding", async () => {
    await handleOnboardingInstalled(installedDetails("install"))
    createdUrls.length = 0
    await beginOnboardingTour()

    await handleOnboardingActionClick()

    expect(createdUrls).toEqual(["chrome-extension://vesti/onboarding.html"])
    expect(panelBehaviors.at(-1)).toBe(false)
  })

  it("opens the final dialog when the seventh feature completes", async () => {
    await handleOnboardingInstalled(installedDetails("install"))
    createdUrls.length = 0
    await beginOnboardingTour()
    for (const feature of [
      "deepseek",
      "dashboard",
      "explore",
      "aiti",
      "learn",
      "roundtable"
    ] as const) {
      await recordOnboardingGuideProgress(feature, { completed: true })
    }
    expect(createdUrls).toEqual([])

    const result = await recordOnboardingGuideProgress("insights", {
      completed: true
    })
    expect(result.allCompleted).toBe(true)
    expect(createdUrls).toEqual(["chrome-extension://vesti/onboarding.html"])
    expect(storage.get(ONBOARDING_STEP_COMPLETED_KEY)).toEqual({
      deepseek: true,
      dashboard: true,
      explore: true,
      aiti: true,
      learn: true,
      roundtable: true,
      insights: true
    })
  })

  it("completes skip and enables native side-panel clicks", async () => {
    await handleOnboardingInstalled(installedDetails("install"))
    await finishOnboarding("skip")

    expect(storage.get(HAS_SEEN_ONBOARDING_KEY)).toBe(true)
    expect(panelBehaviors.at(-1)).toBe(true)
  })

  it("rejects final completion before every feature is complete", async () => {
    await handleOnboardingInstalled(installedDetails("install"))
    await beginOnboardingTour()

    await expect(finishOnboarding("quick_start", false)).rejects.toThrow(
      "ONBOARDING_TOUR_INCOMPLETE"
    )
    expect(storage.get(HAS_SEEN_ONBOARDING_KEY)).toBe(false)
  })

  it("records cleanup and enables native side-panel clicks", async () => {
    await handleOnboardingInstalled(installedDetails("install"))
    await beginOnboardingTour()
    for (const feature of [
      "deepseek",
      "dashboard",
      "explore",
      "aiti",
      "learn",
      "roundtable",
      "insights"
    ] as const) {
      await recordOnboardingGuideProgress(feature, { completed: true })
    }
    createdUrls.length = 0
    await finishOnboarding("quick_start", true)

    expect(storage.get(HAS_SEEN_ONBOARDING_KEY)).toBe(true)
    expect(storage.get(HAS_CLEANED_MOCK_DATA_KEY)).toBe(true)
    expect(panelBehaviors.at(-1)).toBe(true)
  })
})
