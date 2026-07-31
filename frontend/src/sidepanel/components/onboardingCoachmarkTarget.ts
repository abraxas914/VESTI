export interface TargetRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

interface OnboardingTarget {
  getBoundingClientRect: () => Pick<
    DOMRect,
    "top" | "right" | "bottom" | "left" | "width" | "height"
  >
}

/**
 * Responsive dashboard navigation renders desktop and compact copies of the
 * same target. Select the first copy that is actually laid out instead of the
 * first DOM match, which may be hidden by a breakpoint.
 */
export function resolveVisibleOnboardingTarget<T extends OnboardingTarget>(
  targets: Iterable<T>
): { target: T; rect: TargetRect } | null {
  for (const target of targets) {
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    return {
      target,
      rect: {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    }
  }
  return null
}
