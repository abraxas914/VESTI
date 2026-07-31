import { useCallback, useEffect, useState } from "react"

import {
  endOnboardingTour,
  setOnboardingGuideProgress,
  subscribeToOnboardingState
} from "~lib/features/onboardingTourService"
import {
  getOnboardingState,
  getFirstIncompleteFeature,
  type OnboardingFeature,
  type OnboardingState
} from "~lib/onboarding/state"

export interface OnboardingGuideController {
  active: boolean
  step: number
  advance: (nextStep: number) => Promise<void>
  complete: () => Promise<void>
  skip: (nextStep?: number) => Promise<void>
  end: () => Promise<void>
}

export function useOnboardingGuide(
  feature: OnboardingFeature,
  finalStep: number
): OnboardingGuideController {
  const [state, setState] = useState<OnboardingState | null>(null)

  useEffect(() => {
    let mounted = true
    void getOnboardingState()
      .then((nextState) => {
        if (mounted) setState(nextState)
      })
      .catch(() => undefined)
    const unsubscribe = subscribeToOnboardingState((nextState) => {
      if (mounted) setState(nextState)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const advance = useCallback(
    async (nextStep: number) => {
      await setOnboardingGuideProgress(feature, { step: nextStep })
    },
    [feature]
  )

  const complete = useCallback(async () => {
    await setOnboardingGuideProgress(feature, {
      step: finalStep,
      completed: true
    })
  }, [feature, finalStep])

  const skip = useCallback(
    async (nextStep?: number) => {
      if (typeof nextStep === "number" && nextStep < finalStep) {
        await advance(nextStep)
        return
      }
      await complete()
    },
    [advance, complete, finalStep]
  )

  const end = useCallback(async () => {
    await endOnboardingTour()
  }, [])

  return {
    active:
      state?.tourStarted === true &&
      !state.hasSeenOnboarding &&
      !state.onboardingStepCompleted[feature] &&
      getFirstIncompleteFeature(state.onboardingStepCompleted) === feature,
    step: state?.guideSteps[feature] ?? 0,
    advance,
    complete,
    skip,
    end
  }
}
