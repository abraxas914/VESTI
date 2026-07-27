import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  completeOnboarding,
  createInitialOnboardingState,
  getOnboardingState,
  HAS_CLEANED_MOCK_DATA_KEY,
  HAS_SEEN_ONBOARDING_KEY,
  initializeFreshInstall,
  migrateOnExtensionUpdate,
  normalizeOnboardingState,
  ONBOARDING_HANDOFF_KEY,
  ONBOARDING_STATE_KEY,
  ONBOARDING_STEP_COMPLETED_KEY,
  resolveOnboardingDestination,
  startOnboardingTour,
  updateOnboardingGuideProgress
} from "./state"

const storage = new Map<string, unknown>()

function installChromeStorageMock() {
  vi.stubGlobal("chrome", {
    runtime: { lastError: undefined },
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
          for (const [key, value] of Object.entries(payload)) {
            storage.set(key, value)
          }
          callback()
        },
        remove(keys: string[] | string, callback: () => void) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            storage.delete(key)
          }
          callback()
        }
      }
    }
  })
}

describe("onboarding state", () => {
  beforeEach(() => {
    storage.clear()
    installChromeStorageMock()
  })

  it("uses compatibility keys as the persisted source of truth", () => {
    const bundled = createInitialOnboardingState(100, "anon-test")
    const normalized = normalizeOnboardingState(
      bundled,
      true,
      { dashboard: true },
      true,
      200
    )
    expect(normalized.hasSeenOnboarding).toBe(true)
    expect(normalized.hasCleanedMockData).toBe(true)
    expect(normalized.onboardingStepCompleted.dashboard).toBe(true)
    expect(normalized.onboardingStepCompleted.explore).toBe(false)
    expect(resolveOnboardingDestination(normalized)).toBe("sidepanel")
  })

  it("persists a fresh anonymous install and exact progress keys", async () => {
    storage.set(ONBOARDING_HANDOFF_KEY, { status: "captured" })
    const state = await initializeFreshInstall(1_000)

    expect(state.hasSeenOnboarding).toBe(false)
    expect(state.tourStarted).toBe(false)
    expect(state.anonymousUserId.length).toBeGreaterThan(8)
    expect(storage.get(HAS_SEEN_ONBOARDING_KEY)).toBe(false)
    expect(storage.get(HAS_CLEANED_MOCK_DATA_KEY)).toBe(false)
    expect(storage.get(ONBOARDING_STEP_COMPLETED_KEY)).toEqual({
      deepseek: false,
      dashboard: false,
      explore: false,
      aiti: false,
      learn: false,
      roundtable: false,
      insights: false
    })
    expect(storage.has(ONBOARDING_HANDOFF_KEY)).toBe(false)
  })

  it("resumes a tour and opens the final dialog only after all features", async () => {
    await initializeFreshInstall(1_000)
    await startOnboardingTour(1_100)
    expect(resolveOnboardingDestination(await getOnboardingState())).toBe(
      "tour"
    )

    for (const feature of [
      "deepseek",
      "dashboard",
      "explore",
      "aiti",
      "learn",
      "roundtable"
    ] as const) {
      await updateOnboardingGuideProgress(
        feature,
        { step: 3, completed: true },
        2_000
      )
    }
    expect(resolveOnboardingDestination(await getOnboardingState())).toBe(
      "tour"
    )

    await updateOnboardingGuideProgress(
      "insights",
      { step: 2, completed: true },
      2_100
    )
    expect(resolveOnboardingDestination(await getOnboardingState())).toBe(
      "final"
    )
  })

  it("never moves a guide step backwards", async () => {
    await initializeFreshInstall(1_000)
    await updateOnboardingGuideProgress("dashboard", { step: 2 }, 2_000)
    await updateOnboardingGuideProgress("dashboard", { step: 1 }, 3_000)
    expect((await getOnboardingState()).guideSteps.dashboard).toBe(2)
  })

  it("completes cleanup atomically with the onboarding decision", async () => {
    await initializeFreshInstall(1_000)
    const complete = await completeOnboarding(
      "quick_start",
      { hasCleanedMockData: true },
      3_000
    )
    expect(complete.hasSeenOnboarding).toBe(true)
    expect(complete.hasCleanedMockData).toBe(true)
    expect(complete.completedVia).toBe("quick_start")
    expect(storage.get(HAS_SEEN_ONBOARDING_KEY)).toBe(true)
    expect(storage.get(HAS_CLEANED_MOCK_DATA_KEY)).toBe(true)
  })

  it("migrates a legacy update without reopening onboarding", async () => {
    const state = await migrateOnExtensionUpdate(4_000)
    expect(state.hasSeenOnboarding).toBe(true)
    expect(state.completedVia).toBe("legacy_migration")
    expect(resolveOnboardingDestination(state)).toBe("sidepanel")
    expect(storage.has(ONBOARDING_STATE_KEY)).toBe(true)
  })
})
