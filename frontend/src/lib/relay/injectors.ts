// Relay composer injectors — fill (never send) the prompt composer of each
// supported AI platform.
//
// Each platform entry is an ordered selector list, most specific first, with
// generic textarea/contenteditable fallbacks at the tail. The selectors are
// the same DOM knowledge the capture parsers rely on (a `form`-scoped
// contenteditable/textarea composer — see lib/core/parser/<platform>), plus
// the platform's stable composer hooks (#prompt-textarea, .ql-editor, …).
//
// A fill is only reported as ok after a read-back verification, so a stale
// selector can never produce a false "injected" ack to the desktop.

export type RelayPlatformKey =
  | "chatgpt"
  | "claude"
  | "gemini"
  | "deepseek"
  | "doubao"
  | "qwen"
  | "kimi"
  | "yuanbao"

export interface RelayInjectResult {
  ok: boolean
  /** composer_not_found | composer_not_editable | fill_rejected | platform_unsupported */
  error?: string
}

type RelayInjector = (text: string) => RelayInjectResult

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function findComposer(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    let candidates: HTMLElement[] = []
    try {
      candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    } catch {
      continue
    }
    const hit = candidates.find(
      (el) => isVisible(el) && !el.closest("[aria-hidden='true']")
    )
    if (hit) return hit
  }
  return null
}

/** Whitespace-insensitive read-back check (editors normalize whitespace). */
function verifyFilled(readBack: string, text: string): boolean {
  const squash = (value: string) => value.replace(/\s+/g, "")
  const probe = squash(text).slice(0, 24)
  return probe.length > 0 && squash(readBack).includes(probe)
}

function fillTextControl(
  el: HTMLTextAreaElement | HTMLInputElement,
  text: string
): boolean {
  el.focus()
  const hadText = el.value.trim().length > 0
  const next = hadText ? `${el.value.replace(/\s+$/, "")}\n${text}` : text
  // React-controlled inputs ignore plain `.value =` assignments; go through
  // the prototype's setter so the framework's onChange pipeline picks it up.
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value")
  if (descriptor?.set) {
    descriptor.set.call(el, next)
  } else {
    el.value = next
  }
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  return verifyFilled(el.value, text)
}

function fillContentEditable(el: HTMLElement, text: string): boolean {
  el.focus()
  const hadText = (el.innerText ?? "").trim().length > 0
  const payload = hadText ? `\n${text}` : text

  let inserted = false
  try {
    // Caret to the end of the composer, then a real text insertion: rich
    // editors (ProseMirror/Lexical/Quill) translate the insertText input event
    // into their own document model — a direct DOM write would be reverted.
    const selection = window.getSelection()
    if (selection) {
      selection.selectAllChildren(el)
      selection.collapseToEnd()
    }
    inserted = document.execCommand("insertText", false, payload)
  } catch {
    inserted = false
  }

  if (!inserted) {
    const current = (el.innerText ?? "").replace(/\s+$/, "")
    el.textContent = hadText ? `${current}\n${text}` : text
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: payload,
      })
    )
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: payload,
      })
    )
  }

  return verifyFilled(el.innerText ?? el.textContent ?? "", text)
}

function makeInjector(selectors: string[]): RelayInjector {
  return (text) => {
    const el = findComposer(selectors)
    if (!el) return { ok: false, error: "composer_not_found" }
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return fillTextControl(el, text)
        ? { ok: true }
        : { ok: false, error: "fill_rejected" }
    }
    if (el.isContentEditable) {
      return fillContentEditable(el, text)
        ? { ok: true }
        : { ok: false, error: "fill_rejected" }
    }
    return { ok: false, error: "composer_not_editable" }
  }
}

const RELAY_INJECTORS: Record<RelayPlatformKey, RelayInjector> = {
  // chatgpt.com — ProseMirror composer (#prompt-textarea).
  chatgpt: makeInjector([
    "#prompt-textarea",
    "form [contenteditable='true']",
    "[contenteditable='true']",
    "textarea",
  ]),
  // claude.ai — ProseMirror inside the composer fieldset.
  claude: makeInjector([
    "fieldset [contenteditable='true']",
    "[data-testid*='chat-input'] [contenteditable='true']",
    "[contenteditable='true']",
  ]),
  // gemini.google.com — Quill editor hosted in <rich-textarea>.
  gemini: makeInjector([
    "rich-textarea [contenteditable='true']",
    ".ql-editor[contenteditable='true']",
    "[contenteditable='true']",
    "textarea",
  ]),
  // chat.deepseek.com — plain textarea (#chat-input).
  deepseek: makeInjector(["#chat-input", "textarea", "[contenteditable='true']"]),
  // doubao.com — textarea inside the chat_input testid container.
  doubao: makeInjector([
    "[data-testid*='chat_input'] textarea",
    "textarea[data-testid*='chat_input']",
    "textarea",
    "[contenteditable='true']",
  ]),
  // chat.qwen.ai — textarea composer.
  qwen: makeInjector(["#chat-input", "textarea", "[contenteditable='true']"]),
  // kimi.com — contenteditable chat editor.
  kimi: makeInjector([
    "[contenteditable='true']",
    "textarea",
  ]),
  // yuanbao.tencent.com — Quill-style contenteditable.
  yuanbao: makeInjector([
    ".ql-editor[contenteditable='true']",
    "[contenteditable='true']",
    "textarea",
  ]),
}

/** Fill the composer for `platform`; the result decides the desktop ack. */
export function injectRelayPrompt(
  platform: RelayPlatformKey,
  text: string
): RelayInjectResult {
  const injector = RELAY_INJECTORS[platform]
  if (!injector) return { ok: false, error: "platform_unsupported" }
  return injector(text)
}
