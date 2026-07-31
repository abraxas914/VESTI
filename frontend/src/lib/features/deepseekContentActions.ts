import {
  getComposerText,
  resolveComposer,
  setComposerText,
  type ComposerEl
} from "../contents/composerIo"
import { callPromptOptimizerAPI, optimizePrompt } from "./deepseekPromptActions"

const SELECTION_ACTIONS_ID = "vesti-deepseek-selection-actions"
const ACTION_TOAST_ID = "vesti-deepseek-action-toast"
const SUCCESS_MESSAGE = "小猫帮你把问题磨得更锋利"

function currentComposer(): ComposerEl | null {
  return resolveComposer("chat.deepseek.com")
}

function selectedText(): string {
  return window.getSelection()?.toString().trim() ?? ""
}

function sourceText(): string {
  const composer = currentComposer()
  return selectedText() || (composer ? getComposerText(composer).trim() : "")
}

export function showDeepSeekActionToast(message = SUCCESS_MESSAGE): void {
  document.getElementById(ACTION_TOAST_ID)?.remove()
  const toast = document.createElement("div")
  toast.id = ACTION_TOAST_ID
  toast.textContent = message
  Object.assign(toast.style, {
    position: "fixed",
    left: "50%",
    bottom: "28px",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    maxWidth: "min(420px, calc(100vw - 32px))",
    padding: "10px 14px",
    border: "1px solid rgba(75, 85, 99, .22)",
    borderRadius: "12px",
    background: "rgba(255, 255, 255, .96)",
    boxShadow: "0 14px 35px rgba(15, 23, 42, .18)",
    color: "#202127",
    font: "600 13px/1.45 Inter, system-ui, sans-serif"
  })
  document.documentElement.appendChild(toast)
  window.setTimeout(() => toast.remove(), 2800)
}

function flashComposer(composer: ComposerEl): void {
  const element = composer as HTMLElement
  const previousTransition = element.style.transition
  const previousOutline = element.style.outline
  const previousOutlineOffset = element.style.outlineOffset
  element.style.transition = "outline-color 180ms ease"
  element.style.outline = "3px solid rgba(99, 102, 241, .65)"
  element.style.outlineOffset = "3px"

  let flashes = 0
  const timer = window.setInterval(() => {
    flashes += 1
    element.style.outlineColor =
      flashes % 2 === 0 ? "rgba(99, 102, 241, .65)" : "rgba(99, 102, 241, .12)"
    if (flashes >= 5) {
      window.clearInterval(timer)
      element.style.transition = previousTransition
      element.style.outline = previousOutline
      element.style.outlineOffset = previousOutlineOffset
    }
  }, 180)
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  )
}

function findSendControl(composer: ComposerEl): HTMLElement | null {
  const selectors = [
    "button[type='submit']",
    "button[aria-label*='发送']",
    "button[aria-label*='Send']",
    "button[data-testid*='send']",
    "button[class*='send']",
    "[role='button'][aria-label*='发送']",
    "[role='button'][aria-label*='Send']",
    "[role='button'][class*='send']"
  ]
  let scope: HTMLElement | null = composer as HTMLElement
  for (let level = 0; scope && level < 6; level += 1) {
    for (const selector of selectors) {
      const candidate = scope.querySelector<HTMLElement>(selector)
      if (
        candidate &&
        isVisible(candidate) &&
        candidate.getAttribute("aria-disabled") !== "true" &&
        !(candidate instanceof HTMLButtonElement && candidate.disabled)
      ) {
        return candidate
      }
    }
    scope = scope.parentElement
  }
  return null
}

export function findDeepSeekSendControl(): HTMLElement | null {
  const composer = currentComposer()
  return composer ? findSendControl(composer) : null
}

export function findDeepSeekNewChatControl(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    "button, a, [role='button']"
  )
  const labelPattern =
    /新建对话|开启新对话|新对话|创建对话|new chat|start new chat/i
  return (
    Array.from(candidates).find((element) => {
      if (!isVisible(element)) return false
      const label = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.textContent
      ]
        .filter(Boolean)
        .join(" ")
      return labelPattern.test(label)
    }) ?? null
  )
}

function submitComposer(composer: ComposerEl): void {
  const sendControl = findSendControl(composer)
  if (sendControl) {
    sendControl.click()
    return
  }

  const form = (composer as HTMLElement).closest("form")
  if (form instanceof HTMLFormElement) {
    form.requestSubmit()
    return
  }

  const keyboardOptions: KeyboardEventInit = {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true
  }
  composer.dispatchEvent(new KeyboardEvent("keydown", keyboardOptions))
  composer.dispatchEvent(new KeyboardEvent("keyup", keyboardOptions))
}

function fillComposer(text: string): ComposerEl {
  const composer = currentComposer()
  if (!composer) throw new Error("DEEPSEEK_COMPOSER_NOT_FOUND")
  setComposerText(composer, text)
  flashComposer(composer)
  return composer
}

export async function runDeepSeekExpertExplainAction(): Promise<void> {
  const optimized = await optimizePrompt(sourceText(), "expert_explain")
  const composer = fillComposer(optimized)
  await new Promise<void>((resolve) =>
    window.requestAnimationFrame(() => resolve())
  )
  submitComposer(composer)
  showDeepSeekActionToast()
}

export async function runDeepSeekOptimizeAction(): Promise<void> {
  const original = sourceText()
  if (!original) throw new Error("DEEPSEEK_PROMPT_REQUIRED")
  const optimized = await callPromptOptimizerAPI(original)
  fillComposer(optimized)
  showDeepSeekActionToast()
}

export function mountDeepSeekSelectionActions(): () => void {
  if (
    window.top !== window.self ||
    window.location.hostname !== "chat.deepseek.com" ||
    document.getElementById(SELECTION_ACTIONS_ID)
  ) {
    return () => undefined
  }

  const host = document.createElement("div")
  host.id = SELECTION_ACTIONS_ID
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483646",
    display: "none",
    pointerEvents: "auto"
  })
  const shadow = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = `
    :host { all: initial; }
    .actions {
      display: flex;
      gap: 6px;
      padding: 6px;
      border: 1px solid rgba(75, 85, 99, .2);
      border-radius: 12px;
      background: rgba(255, 255, 255, .97);
      box-shadow: 0 12px 30px rgba(15, 23, 42, .18);
      font-family: Inter, system-ui, sans-serif;
    }
    button {
      border: 0;
      border-radius: 8px;
      padding: 7px 9px;
      background: #f3f4f6;
      color: #202127;
      cursor: pointer;
      font: 600 11px/1.3 Inter, system-ui, sans-serif;
      white-space: nowrap;
    }
    button:first-of-type { background: #202127; color: white; }
    button:hover { transform: translateY(-1px); }
    button:disabled { cursor: wait; opacity: .55; }
  `
  const actions = document.createElement("div")
  actions.className = "actions"
  const expertButton = document.createElement("button")
  expertButton.type = "button"
  expertButton.textContent = "像专家导师一样讲解"
  const optimizeButton = document.createElement("button")
  optimizeButton.type = "button"
  optimizeButton.textContent = "优化我的提示词"
  actions.append(expertButton, optimizeButton)
  shadow.append(style, actions)
  document.documentElement.appendChild(host)

  const setBusy = (busy: boolean) => {
    expertButton.disabled = busy
    optimizeButton.disabled = busy
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      host.style.display = "none"
    } catch {
      showDeepSeekActionToast("操作没有完成，请检查输入框后重试")
    } finally {
      setBusy(false)
    }
  }
  expertButton.addEventListener("pointerdown", (event) =>
    event.preventDefault()
  )
  optimizeButton.addEventListener("pointerdown", (event) =>
    event.preventDefault()
  )
  expertButton.addEventListener(
    "click",
    () => void run(runDeepSeekExpertExplainAction)
  )
  optimizeButton.addEventListener(
    "click",
    () => void run(runDeepSeekOptimizeAction)
  )

  const updateSelectionActions = () => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ""
    if (!selection || !text || selection.rangeCount === 0) {
      host.style.display = "none"
      return
    }
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      host.style.display = "none"
      return
    }
    host.style.display = "block"
    const width = host.getBoundingClientRect().width
    host.style.left = `${Math.max(
      8,
      Math.min(window.innerWidth - width - 8, rect.left)
    )}px`
    host.style.top = `${Math.max(8, rect.top - 48)}px`
  }

  document.addEventListener("mouseup", updateSelectionActions)
  document.addEventListener("keyup", updateSelectionActions)
  document.addEventListener("scroll", updateSelectionActions, true)

  return () => {
    document.removeEventListener("mouseup", updateSelectionActions)
    document.removeEventListener("keyup", updateSelectionActions)
    document.removeEventListener("scroll", updateSelectionActions, true)
    host.remove()
  }
}
