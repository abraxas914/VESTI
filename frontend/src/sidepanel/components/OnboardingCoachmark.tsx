import { useLayoutEffect, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"

import { getOnboardingGuideCopy } from "~lib/features/onboardingTourService"

import {
  resolveVisibleOnboardingTarget,
  type TargetRect
} from "./onboardingCoachmarkTarget"

type Placement = "top" | "bottom"

interface OnboardingCoachmarkProps {
  targetSelector: string
  icon?: string
  targetIcon?: string
  animateHighlight?: boolean
  message: string
  placement?: Placement
  locale?: string
  primaryLabel?: string
  onPrimary?: () => void | Promise<void>
  onSkip: () => void | Promise<void>
  onEndDemo: () => void | Promise<void>
}

const TARGET_GAP = 6
const BUBBLE_GAP = 13
const BUBBLE_HALF_WIDTH = 162
const VIEWPORT_MARGIN = 12

function readVisibleTarget(selector: string) {
  return resolveVisibleOnboardingTarget(
    document.querySelectorAll<HTMLElement>(selector)
  )
}

export function OnboardingCoachmark({
  targetSelector,
  icon = "🐱",
  targetIcon,
  animateHighlight = false,
  message,
  placement = "top",
  locale = "zh",
  primaryLabel,
  onPrimary,
  onSkip,
  onEndDemo
}: OnboardingCoachmarkProps) {
  const [rect, setRect] = useState<TargetRect | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const next = readVisibleTarget(targetSelector)?.rect ?? null
      setRect((current) => {
        if (!current || !next) return current === next ? current : next
        return current.top === next.top &&
          current.right === next.right &&
          current.bottom === next.bottom &&
          current.left === next.left &&
          current.width === next.width &&
          current.height === next.height
          ? current
          : next
      })
    }
    update()

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(update)
        : null
    document
      .querySelectorAll<HTMLElement>(targetSelector)
      .forEach((target) => resizeObserver?.observe(target))

    const mutationObserver = new MutationObserver(update)
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "disabled"]
    })
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)

    return () => {
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [targetSelector])

  if (!rect) return null

  const targetCenter = rect.left + rect.width / 2
  const bubbleCenter = Math.min(
    window.innerWidth - VIEWPORT_MARGIN - BUBBLE_HALF_WIDTH,
    Math.max(VIEWPORT_MARGIN + BUBBLE_HALF_WIDTH, targetCenter)
  )
  const pointerOffset = Math.min(
    BUBBLE_HALF_WIDTH - 24,
    Math.max(-BUBBLE_HALF_WIDTH + 24, targetCenter - bubbleCenter)
  )
  const resolvedPlacement =
    placement === "top" && rect.top < 150
      ? "bottom"
      : placement === "bottom" && rect.bottom > window.innerHeight - 150
        ? "top"
        : placement
  const bubbleStyle: CSSProperties & {
    "--coachmark-pointer-offset": string
  } = {
    left: bubbleCenter,
    "--coachmark-pointer-offset": `${pointerOffset}px`,
    ...(resolvedPlacement === "top"
      ? { bottom: window.innerHeight - rect.top + BUBBLE_GAP }
      : { top: rect.bottom + BUBBLE_GAP })
  }

  return createPortal(
    <div
      className="onboarding-coachmark-layer"
      role="dialog"
      aria-modal="true"
      aria-label={message}>
      <div
        className="onboarding-coachmark-dim"
        style={{
          top: 0,
          right: 0,
          height: Math.max(0, rect.top - TARGET_GAP),
          left: 0
        }}
      />
      <div
        className="onboarding-coachmark-dim"
        style={{
          top: rect.bottom + TARGET_GAP,
          right: 0,
          bottom: 0,
          left: 0
        }}
      />
      <div
        className="onboarding-coachmark-dim"
        style={{
          top: Math.max(0, rect.top - TARGET_GAP),
          width: Math.max(0, rect.left - TARGET_GAP),
          height: rect.height + TARGET_GAP * 2,
          left: 0
        }}
      />
      <div
        className="onboarding-coachmark-dim"
        style={{
          top: Math.max(0, rect.top - TARGET_GAP),
          right: 0,
          height: rect.height + TARGET_GAP * 2,
          left: rect.right + TARGET_GAP
        }}
      />
      <div
        className={`onboarding-coachmark-highlight${
          animateHighlight
            ? " onboarding-coachmark-highlight-animated"
            : ""
        }`}
        style={{
          top: rect.top - TARGET_GAP,
          left: rect.left - TARGET_GAP,
          width: rect.width + TARGET_GAP * 2,
          height: rect.height + TARGET_GAP * 2
        }}
      />
      {targetIcon ? (
        <div
          className="onboarding-coachmark-target-icon"
          aria-hidden="true"
          style={{
            top: Math.max(
              VIEWPORT_MARGIN,
              Math.min(
                window.innerHeight - 44,
                rect.top + rect.height / 2 - 18
              )
            ),
            left: Math.max(VIEWPORT_MARGIN, rect.left - 46)
          }}>
          <span>{targetIcon}</span>
        </div>
      ) : null}
      <div
        className={`onboarding-coachmark onboarding-coachmark-${resolvedPlacement}`}
        style={bubbleStyle}>
        <span className="onboarding-coachmark-icon" aria-hidden="true">
          {icon}
        </span>
        <p>{message}</p>
        <div className="onboarding-coachmark-actions">
          <div className="onboarding-coachmark-secondary-actions">
            <button type="button" onClick={() => void onSkip()}>
              {getOnboardingGuideCopy(locale).skipStep}
            </button>
            <button type="button" onClick={() => void onEndDemo()}>
              {getOnboardingGuideCopy(locale).endDemo}
            </button>
          </div>
          {primaryLabel && onPrimary ? (
            <button
              className="onboarding-coachmark-primary"
              type="button"
              onClick={() => void onPrimary()}>
              {primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
