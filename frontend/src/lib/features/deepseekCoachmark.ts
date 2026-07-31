const DEEPSEEK_COACHMARK_ID = "vesti-deepseek-coachmark"
const TARGET_GAP = 7
const BUBBLE_GAP = 14

export interface DeepSeekCoachmarkController {
  show: (
    target: HTMLElement,
    message: string,
    onSkip: () => void | Promise<void>,
    skipLabel?: string
  ) => void
  hide: () => void
  destroy: () => void
}

export function createDeepSeekCoachmark(): DeepSeekCoachmarkController {
  document.getElementById(DEEPSEEK_COACHMARK_ID)?.remove()

  const host = document.createElement("div")
  host.id = DEEPSEEK_COACHMARK_ID
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none"
  })
  const shadow = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; }
    .dim {
      position: fixed;
      background: rgba(15, 18, 28, .24);
      pointer-events: auto;
    }
    .highlight {
      position: fixed;
      border: 2px solid #7c6fe8;
      border-radius: 15px;
      box-shadow: 0 0 0 4px rgba(124,111,232,.14), 0 12px 34px rgba(15,18,28,.16);
      pointer-events: none;
    }
    .bubble {
      --pointer-offset: 0px;
      position: fixed;
      box-sizing: border-box;
      width: min(324px, calc(100vw - 28px));
      padding: 22px 22px 18px;
      transform: translateX(-50%);
      border: 1px solid #dfe1e8;
      border-radius: 20px;
      background: #f5f6f9;
      color: #202127;
      box-shadow:
        inset 0 1px 0 #ffffff,
        0 15px 34px rgba(15,18,28,.16),
        0 34px 74px rgba(15,18,28,.1);
      font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
      pointer-events: auto;
      animation: enter .4s cubic-bezier(.22,1,.36,1) both;
    }
    .bubble::after {
      content: "";
      position: absolute;
      left: calc(50% + var(--pointer-offset));
      width: 13px;
      height: 13px;
      transform: translateX(-50%) rotate(45deg);
      border: solid #dfe1e8;
      background: #f5f6f9;
    }
    .bubble.top::after {
      bottom: -7px;
      border-width: 0 1px 1px 0;
    }
    .bubble.bottom::after {
      top: -7px;
      border-width: 1px 0 0 1px;
    }
    .icon { display: block; margin-bottom: 12px; font-size: 24px; line-height: 1; }
    p { margin: 0; font-size: 14px; font-weight: 650; line-height: 1.7; }
    button {
      margin-top: 18px;
      padding: 3px 0;
      border: 0;
      background: transparent;
      color: #747783;
      font: 500 11px/1.4 Inter, system-ui, sans-serif;
      cursor: pointer;
    }
    button:hover { color: #202127; }
    @keyframes enter {
      from { opacity: 0; transform: translate(-50%, 10px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .bubble { animation: none; }
    }
  `
  const layer = document.createElement("div")
  layer.className = "layer"
  layer.hidden = true
  const dims = Array.from({ length: 4 }, () => {
    const element = document.createElement("div")
    element.className = "dim"
    layer.appendChild(element)
    return element
  })
  const highlight = document.createElement("div")
  highlight.className = "highlight"
  layer.appendChild(highlight)
  const bubble = document.createElement("div")
  bubble.className = "bubble top"
  bubble.setAttribute("role", "dialog")
  bubble.setAttribute("aria-modal", "true")
  const icon = document.createElement("span")
  icon.className = "icon"
  icon.textContent = "🐱"
  const copy = document.createElement("p")
  const skip = document.createElement("button")
  skip.type = "button"
  skip.textContent = "跳过此步骤"
  bubble.append(icon, copy, skip)
  layer.appendChild(bubble)
  shadow.append(style, layer)
  document.documentElement.appendChild(host)

  let currentTarget: HTMLElement | null = null
  let currentMessage = ""
  let currentSkip: (() => void | Promise<void>) | null = null
  let resizeObserver: ResizeObserver | null = null

  const update = () => {
    if (!currentTarget || !currentTarget.isConnected) {
      layer.hidden = true
      return
    }
    const rect = currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      layer.hidden = true
      return
    }

    layer.hidden = false
    const top = Math.max(0, rect.top - TARGET_GAP)
    const bottom = Math.min(window.innerHeight, rect.bottom + TARGET_GAP)
    const left = Math.max(0, rect.left - TARGET_GAP)
    const right = Math.min(window.innerWidth, rect.right + TARGET_GAP)
    Object.assign(dims[0].style, {
      top: "0px",
      right: "0px",
      height: `${top}px`,
      left: "0px"
    })
    Object.assign(dims[1].style, {
      top: `${bottom}px`,
      right: "0px",
      bottom: "0px",
      left: "0px"
    })
    Object.assign(dims[2].style, {
      top: `${top}px`,
      width: `${left}px`,
      height: `${bottom - top}px`,
      left: "0px"
    })
    Object.assign(dims[3].style, {
      top: `${top}px`,
      right: "0px",
      height: `${bottom - top}px`,
      left: `${right}px`
    })
    Object.assign(highlight.style, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`
    })

    const targetCenter = rect.left + rect.width / 2
    const halfWidth = Math.min(162, (window.innerWidth - 28) / 2)
    const bubbleCenter = Math.min(
      window.innerWidth - 12 - halfWidth,
      Math.max(12 + halfWidth, targetCenter)
    )
    const pointerOffset = Math.min(
      halfWidth - 24,
      Math.max(-halfWidth + 24, targetCenter - bubbleCenter)
    )
    const placeAbove = rect.top > 150
    bubble.className = `bubble ${placeAbove ? "top" : "bottom"}`
    bubble.style.left = `${bubbleCenter}px`
    bubble.style.setProperty("--pointer-offset", `${pointerOffset}px`)
    bubble.style.top = placeAbove ? "" : `${rect.bottom + BUBBLE_GAP}px`
    bubble.style.bottom = placeAbove
      ? `${window.innerHeight - rect.top + BUBBLE_GAP}px`
      : ""
  }

  const handleViewportChange = () => update()
  window.addEventListener("resize", handleViewportChange)
  window.addEventListener("scroll", handleViewportChange, true)
  skip.addEventListener("click", () => void currentSkip?.())

  return {
    show(target, message, onSkip, skipLabel = "跳过此步骤") {
      const unchanged = currentTarget === target && currentMessage === message
      currentTarget = target
      currentMessage = message
      currentSkip = onSkip
      copy.textContent = message
      skip.textContent = skipLabel
      bubble.setAttribute("aria-label", message)
      resizeObserver?.disconnect()
      resizeObserver =
        typeof ResizeObserver === "function"
          ? new ResizeObserver(() => update())
          : null
      resizeObserver?.observe(target)
      update()
      window.requestAnimationFrame(update)
      if (
        !unchanged &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        bubble.animate(
          [
            { opacity: 0, transform: "translate(-50%, 10px)" },
            { opacity: 1, transform: "translate(-50%, 0)" }
          ],
          {
            duration: 400,
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "both"
          }
        )
      }
    },
    hide() {
      currentTarget = null
      currentMessage = ""
      currentSkip = null
      resizeObserver?.disconnect()
      layer.hidden = true
    },
    destroy() {
      resizeObserver?.disconnect()
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
      host.remove()
    }
  }
}
