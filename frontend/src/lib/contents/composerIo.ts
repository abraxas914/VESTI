// Shared composer I/O for the in-page assist content script.
//
// Single source of truth for the 8-platform chat-composer selectors and the
// read/write strategy, used by BOTH the slash-insert flow and the real-time
// scoring pipeline so selector drift is fixed in one place.
//
// Write strategy (validated per-platform): textarea uses the prototype `value`
// setter + input/change events so React registers the change; contenteditable /
// rich editors (Claude ProseMirror, Gemini & Yuanbao Quill, Kimi) use
// execCommand("insertText") which bridges into the editor's own input handlers
// (raw textContent writes are reverted by virtual editors). Reads use
// `value` (textarea) or `innerText` (contenteditable — never innerHTML).

import type { Platform } from "../types";
import { logger } from "../utils/logger";

export type ComposerEl = HTMLTextAreaElement | HTMLElement;

/** Strip a leading "www." for host-keyed lookups. */
export function normalizeHost(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

export const PLATFORM_BY_HOST: Record<string, Platform> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "claude.ai": "Claude",
  "gemini.google.com": "Gemini",
  "chat.deepseek.com": "DeepSeek",
  "chat.qwen.ai": "Qwen",
  "doubao.com": "Doubao",
  "kimi.com": "Kimi",
  "kimi.moonshot.cn": "Kimi",
  "yuanbao.tencent.com": "Yuanbao",
};

export function platformForHost(host: string): Platform | undefined {
  return PLATFORM_BY_HOST[normalizeHost(host)];
}

// Per-host composer hints, tried in order. A generic fallback handles drift.
const COMPOSER_SELECTORS: Record<string, string[]> = {
  "chatgpt.com": ["#prompt-textarea", "div[contenteditable='true']#prompt-textarea", "textarea"],
  "chat.openai.com": ["#prompt-textarea", "textarea"],
  "claude.ai": ["div[contenteditable='true'].ProseMirror", "div[contenteditable='true']"],
  "gemini.google.com": ["div.ql-editor[contenteditable='true']", "rich-textarea div[contenteditable='true']"],
  "chat.deepseek.com": ["#chat-input", "textarea#chat-input", "textarea"],
  "doubao.com": ["textarea", "div[contenteditable='true']"],
  "chat.qwen.ai": ["textarea", "div[contenteditable='true']"],
  "kimi.com": [".chat-input-editor", "div[contenteditable='true']", "textarea"],
  "kimi.moonshot.cn": [".chat-input-editor", "div[contenteditable='true']", "textarea"],
  "yuanbao.tencent.com": [".ql-editor[contenteditable='true']", "div[contenteditable='true']", "textarea"],
};

const GENERIC_COMPOSER_SELECTORS = ["div[contenteditable='true']", "textarea"];

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 12) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** True for nodes we treat as a chat composer (accepts raw EventTarget). */
export function isComposerElement(el: EventTarget | null): el is ComposerEl {
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/**
 * Resolve the composer from an input/composition event's target. On rich
 * editors (Claude ProseMirror, Kimi, Quill) the event target is often a nested
 * text node or span inside the contenteditable, not the editable root — a plain
 * `isComposerElement(event.target)` check then fails and the keystroke is
 * silently dropped. This climbs to the top-most contenteditable (or textarea),
 * falling back to the host resolver.
 */
export function resolveComposerFromEvent(
  target: EventTarget | null,
  host: string,
): ComposerEl | null {
  let node: Node | null =
    target && (target as Node).nodeType === Node.TEXT_NODE
      ? (target as Node).parentElement
      : (target as Node | null);

  let el = node instanceof Element ? node : null;
  while (el) {
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLElement && el.isContentEditable) {
      // Climb to the top-most contenteditable in this subtree (the editor root,
      // not an inner editable node).
      let top: HTMLElement = el;
      let parent = el.parentElement;
      while (parent && parent.isContentEditable) {
        top = parent;
        parent = parent.parentElement;
      }
      return top;
    }
    el = el.parentElement;
  }
  return resolveComposer(host);
}

/**
 * Resolve the active composer, preferring the focused editable, then per-host
 * hints, then a generic heuristic. Returns null (fail-closed) when nothing
 * suitable is visible.
 */
export function resolveComposer(host: string): ComposerEl | null {
  const active = document.activeElement;
  if (isComposerElement(active)) {
    return active;
  }

  const hints = COMPOSER_SELECTORS[normalizeHost(host)] ?? [];
  for (const selector of [...hints, ...GENERIC_COMPOSER_SELECTORS]) {
    const candidates = Array.from(document.querySelectorAll(selector)).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && isVisible(el),
    );
    // Prefer the lowest visible editable (composers sit at the bottom).
    candidates.sort(
      (a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top,
    );
    if (candidates[0]) return candidates[0];
  }

  logger.debug("content", "Prompt assist: composer not resolved", { host });
  return null;
}

/** Read the current draft text from a composer. */
export function getComposerText(el: ComposerEl): string {
  if (el instanceof HTMLTextAreaElement) return el.value;
  // Prefer innerText (respects line breaks); fall back to textContent for rich
  // editors whose nested structure can yield an empty innerText.
  const inner = el.innerText;
  if (inner && inner.trim().length > 0) return inner;
  return el.textContent ?? "";
}

/** Write text into a composer so React / ProseMirror / Quill register it. */
export function setComposerText(el: ComposerEl, text: string): void {
  el.focus();

  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  // contenteditable / rich editor: select all then insert so the editor's own
  // input handlers fire (raw textContent is reverted by virtual editors).
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
}
