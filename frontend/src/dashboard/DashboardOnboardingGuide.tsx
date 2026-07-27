import { useCallback, useEffect, useRef, useState } from "react"

import {
  getExplorePromptStage,
  getExplorePromptStageFromSearch,
  getOnboardingGuideCopy,
  normalizeExplorePromptStage,
  ONBOARDING_EXPLORE_PROMPT_PENDING_KEY,
  setExplorePromptStage as setStoredExplorePromptStage,
  type ExplorePromptStage
} from "~lib/features/onboardingTourService"
import { navigateSidepanel } from "~lib/features/sidepanelNavigation"
import { openOnboardingSidePanel } from "~lib/onboarding/sidepanel"
import { OnboardingCoachmark } from "~sidepanel/components/OnboardingCoachmark"
import { useOnboardingGuide } from "~sidepanel/hooks/useOnboardingGuide"

function target(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector)
}

export function DashboardOnboardingGuide({ locale }: { locale: string }) {
  const explore = useOnboardingGuide("explore", 3)
  const aiti = useOnboardingGuide("aiti", 2)
  const learn = useOnboardingGuide("learn", 2)
  const roundtable = useOnboardingGuide("roundtable", 2)
  const copy = getOnboardingGuideCopy(locale)
  const pendingRef = useRef(new Set<string>())
  const explorePromptRecoveryRef = useRef(false)
  const [explorePromptStage, setExplorePromptStageState] =
    useState<ExplorePromptStage>(() =>
      getExplorePromptStageFromSearch(window.location.search)
    )
  const exploreUrlRequested =
    getExplorePromptStageFromSearch(window.location.search) !== null
  const showExploreHandoff = explore.active || exploreUrlRequested

  const persistExplorePromptStage = useCallback(
    async (stage: ExplorePromptStage) => {
      setExplorePromptStageState(stage)
      const url = new URL(window.location.href)
      if (stage === "explore_tab") {
        url.searchParams.set("onboarding", "explore-tab")
      } else {
        url.searchParams.delete("onboarding")
      }
      window.history.replaceState(null, "", url.toString())
      await setStoredExplorePromptStage(stage)
    },
    []
  )

  useEffect(() => {
    let mounted = true
    const urlStage = getExplorePromptStageFromSearch(window.location.search)
    void (async () => {
      if (urlStage !== null) {
        await setStoredExplorePromptStage(urlStage)
      }
      const storedStage = await getExplorePromptStage()
      if (mounted) {
        setExplorePromptStageState(storedStage ?? urlStage)
      }
    })()
      .catch(() => undefined)

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") return
      const change = changes[ONBOARDING_EXPLORE_PROMPT_PENDING_KEY]
      if (change) {
        setExplorePromptStageState(
          normalizeExplorePromptStage(change.newValue)
        )
      }
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    if (
      explore.active &&
      explore.step >= 2 &&
      explorePromptStage !== null
    ) {
      void persistExplorePromptStage(null)
      return
    }
    if (
      explorePromptRecoveryRef.current ||
      !explore.active ||
      explore.step > 1 ||
      explorePromptStage !== null
    ) {
      return
    }
    explorePromptRecoveryRef.current = true
    void persistExplorePromptStage("explore_tab")
  }, [
    explore.active,
    explore.step,
    explorePromptStage,
    persistExplorePromptStage
  ])

  const runOnce = useCallback((key: string, action: () => Promise<void>) => {
    if (pendingRef.current.has(key)) return
    pendingRef.current.add(key)
    void action().finally(() => pendingRef.current.delete(key))
  }, [])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-onboarding-action]")
          : null
      const action = element?.dataset.onboardingAction
      if (!action) return

      if (
        explorePromptStage === "explore_tab" &&
        action === "explore-tab" &&
        explore.step <= 1
      ) {
        void persistExplorePromptStage(null)
        runOnce("explore-tab", () => explore.advance(2))
        return
      }
      if (aiti.active && action === "aiti-mode" && aiti.step === 0) {
        runOnce("aiti-mode", () => aiti.advance(1))
        return
      }
      if (learn.active && action === "learn-mode" && learn.step === 0) {
        runOnce("learn-mode", () => learn.advance(1))
        return
      }
      if (
        roundtable.active &&
        action === "roundtable-mode" &&
        roundtable.step === 0
      ) {
        runOnce("roundtable-mode", () => roundtable.advance(1))
      }
    }

    document.addEventListener("click", handleClick, true)
    return () => document.removeEventListener("click", handleClick, true)
  }, [
    aiti,
    explore,
    explorePromptStage,
    learn,
    roundtable,
    runOnce,
    persistExplorePromptStage
  ])

  const clickAndAdvance = async (
    selector: string,
    advance: () => Promise<void>
  ) => {
    const element = target(selector)
    if (element) {
      element.click()
      return
    }
    await advance()
  }

  const endDemo = async (end: () => Promise<void>) => {
    void openOnboardingSidePanel()
    await navigateSidepanel("/dashboard")
    await end()
  }

  const openExploreFromGuide = async () => {
    target('[data-onboarding-target="explore-tab"]')?.click()
    await persistExplorePromptStage(null)
    await explore.advance(2)
  }

  const endExploreHandoff = async () => {
    await persistExplorePromptStage(null)
    await endDemo(explore.end)
  }

  const finishRoundtable = async () => {
    void openOnboardingSidePanel()
    await navigateSidepanel("/dashboard")
    await roundtable.complete()
  }

  return (
    <>
      {showExploreHandoff && explorePromptStage === "explore_tab" ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="explore-tab"]'
          icon="🐱"
          targetIcon="🐱"
          animateHighlight
          locale={locale}
          message={copy.explore[1]}
          placement="bottom"
          primaryLabel="打开探索"
          onPrimary={openExploreFromGuide}
          onSkip={openExploreFromGuide}
          onEndDemo={endExploreHandoff}
        />
      ) : null}
      {explore.active &&
      explorePromptStage === null &&
      explore.step >= 2 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="explore-input"]'
          icon="💬"
          targetIcon="🐱"
          locale={locale}
          message={copy.explore[2]}
          placement="top"
          primaryLabel={copy.next}
          onPrimary={explore.complete}
          onSkip={explore.complete}
          onEndDemo={() => endDemo(explore.end)}
        />
      ) : null}

      {aiti.active && aiti.step === 0 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="aiti-mode"]'
          icon="🧠"
          locale={locale}
          message={copy.aiti[0]}
          placement="bottom"
          onSkip={() =>
            clickAndAdvance('[data-onboarding-target="aiti-mode"]', () =>
              aiti.advance(1)
            )
          }
          onEndDemo={() => endDemo(aiti.end)}
        />
      ) : null}
      {aiti.active && aiti.step >= 1 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="aiti-card"]'
          icon="🐱"
          locale={locale}
          message={copy.aiti[1]}
          placement="bottom"
          primaryLabel={copy.next}
          onPrimary={aiti.complete}
          onSkip={aiti.complete}
          onEndDemo={() => endDemo(aiti.end)}
        />
      ) : null}

      {learn.active && learn.step === 0 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="learn-mode"]'
          icon="📚"
          locale={locale}
          message={copy.learn[0]}
          placement="bottom"
          onSkip={() =>
            clickAndAdvance('[data-onboarding-target="learn-mode"]', () =>
              learn.advance(1)
            )
          }
          onEndDemo={() => endDemo(learn.end)}
        />
      ) : null}
      {learn.active && learn.step >= 1 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="learn-card"]'
          icon="🐱"
          locale={locale}
          message={copy.learn[1]}
          placement="bottom"
          primaryLabel={copy.next}
          onPrimary={learn.complete}
          onSkip={learn.complete}
          onEndDemo={() => endDemo(learn.end)}
        />
      ) : null}

      {roundtable.active && roundtable.step === 0 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="roundtable-mode"]'
          icon="🪑"
          locale={locale}
          message={copy.roundtable[0]}
          placement="bottom"
          onSkip={() =>
            clickAndAdvance(
              '[data-onboarding-target="roundtable-mode"]',
              () => roundtable.advance(1)
            )
          }
          onEndDemo={() => endDemo(roundtable.end)}
        />
      ) : null}
      {roundtable.active && roundtable.step >= 1 ? (
        <OnboardingCoachmark
          targetSelector='[data-onboarding-target="roundtable-card"]'
          icon="🐱"
          locale={locale}
          message={copy.roundtable[1]}
          placement="bottom"
          primaryLabel="查看周报"
          onPrimary={finishRoundtable}
          onSkip={finishRoundtable}
          onEndDemo={() => endDemo(roundtable.end)}
        />
      ) : null}
    </>
  )
}
