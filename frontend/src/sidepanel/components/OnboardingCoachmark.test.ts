import { describe, expect, it } from "vitest"

import { resolveVisibleOnboardingTarget } from "./onboardingCoachmarkTarget"

function target(width: number, left: number) {
  return {
    getBoundingClientRect: () => ({
      top: 20,
      right: left + width,
      bottom: 52,
      left,
      width,
      height: 32
    })
  }
}

describe("resolveVisibleOnboardingTarget", () => {
  it("skips a hidden responsive duplicate and selects the visible target", () => {
    const hiddenDesktopTarget = target(0, 0)
    const visibleMobileTarget = target(96, 24)

    expect(
      resolveVisibleOnboardingTarget([
        hiddenDesktopTarget,
        visibleMobileTarget
      ])
    ).toEqual({
      target: visibleMobileTarget,
      rect: {
        top: 20,
        right: 120,
        bottom: 52,
        left: 24,
        width: 96,
        height: 32
      }
    })
  })

  it("does not render a coachmark when every matching target is hidden", () => {
    expect(resolveVisibleOnboardingTarget([target(0, 0)])).toBeNull()
  })
})
