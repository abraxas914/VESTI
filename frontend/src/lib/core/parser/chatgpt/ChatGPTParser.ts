import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import {
  collapseNodesToNearestRoots,
  closestAnySelector,
  extractEarliestTimeFromSelectors,
  hasAnySelector,
  normalizeCandidateNodes,
  queryAllUnique,
  queryAllWithinUnique,
  queryFirst,
  queryFirstWithin,
  safeTextContent,
  uniqueNodesInDocumentOrder,
} from "../shared/selectorUtils";
import { extractAstFromElement } from "../shared/astExtractor";
import {
  cloneAndSanitizeMessageContent,
  getCitationNoiseProfile,
} from "../shared/citationNoise";
import { resolveCanonicalMessageText } from "../shared/canonicalMessageText";
import { astPerfModeController, type AstPerfMode } from "../shared/astPerfMode";
import {
  createMessageAttachment,
  inferMimeFromLabel,
  sanitizeAttachmentLabel,
} from "../../../utils/messageAttachments";
import { logger } from "../../../utils/logger";

const SELECTORS = {
  userRoleAnchors: [
    "[data-message-author-role='user']",
    "[data-testid*='user-message']",
    "[data-testid*='user']",
  ],
  assistantRoleAnchors: [
    "[data-message-author-role='assistant']",
    "[data-testid*='assistant-message']",
    "[data-testid*='assistant']",
    "[data-testid*='chatgpt-message']",
    "[data-testid*='model-message']",
  ],
  turnBlocks: [
    "[data-testid^='conversation-turn']",
    "[data-testid*='conversation-turn']",
    "[data-message-id]",
  ],
  hardMessageRoots: [
    "[data-message-id][data-message-author-role='user']",
    "[data-message-id][data-message-author-role='assistant']",
  ],
  preferredMessageContent: [
    "[data-message-content]",
    "[data-testid*='message-content']",
    ".markdown",
    ".prose",
    "div[class*='markdown']",
  ],
  userMessageContent: [
    "[data-message-content]",
    "[class*='whitespace-pre-wrap']",
    "[dir='auto']",
  ],
  messageContent: [
    ".markdown",
    ".prose",
    "[data-testid*='message-content']",
    "[data-message-content]",
    "div[class*='markdown']",
  ],
  copyActionAnchors: [
    "[data-testid='action-bar-copy']",
    "[data-testid*='action-copy']",
    "[data-testid*='copy']",
    "[aria-label*='copy' i]",
  ],
  removableContentSelectors: [
    "form",
    "footer",
    "nav",
    "button",
    "svg",
    "[role='navigation']",
    "[role='button']",
    "[data-testid*='composer']",
    "[data-testid*='action-bar']",
    "[data-testid*='copy']",
    "[data-testid*='retry']",
    "[data-testid*='regenerate']",
    "[data-testid*='share']",
    "[class*='action-bar']",
    "[class*='toolbar']",
    "[data-testid*='thinking']",
    "[data-testid*='reasoning']",
    "[data-testid*='thought']",
    "[contenteditable='true']",
    "[aria-label*='copy' i]",
    "[aria-label*='read aloud' i]",
  ],
  title: ["nav h1", "title"],
  generating: [
    ".result-streaming",
    "[data-testid='result-streaming']",
    "[data-testid*='streaming']",
    ".typing",
    "[data-is-streaming='true']",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "[role='navigation']",
    "[data-testid*='composer']",
    "[contenteditable='true']",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^search chats$/i,
    /^chatgpt can make mistakes\.?/i,
    /^upgrade plan$/i,
    /^thought for\s+\d+s(?:\s+show more)?(?:\s+done)?$/i,
    /^\u5df2\u601d\u8003\s*\d+\s*s$/i,
    /^show more$/i,
    /^done$/i,
  ],
  roleAncestorHints: [
    "[data-message-author-role]",
    "[data-testid]",
    "[data-message-id]",
    "[class*='user']",
    "[class*='assistant']",
    "[class*='chatgpt']",
    "[class*='model']",
  ],
  sourceTimes: ["main time[datetime]", "article time[datetime]"],
  userAttachmentFileTiles: [
    "[role='group'][aria-label]",
    "[class*='group/file-tile'][aria-label]",
  ],
  userAttachmentImageButtons: [
    "button[aria-label*='open image' i]",
    "button[aria-label*='uploaded image' i]",
    "button[aria-label*='view image' i]",
    "button[aria-label*='打开图片' i]",
    "button[aria-label*='全视图' i]",
  ],
  userAttachmentImages: [
    "img[alt*='uploaded image' i]",
    "img[alt*='已上传的图片' i]",
    "img[alt*='图片' i]",
  ],
};

const LANGUAGE_TOKEN_PATTERN = /^[a-z0-9+#.-]{1,24}$/i;
const LANGUAGE_NOISE_TOKENS = new Set([
  "copy",
  "copied",
  "code",
  "plain",
  "plaintext",
  "text",
  "run",
  "running",
  "done",
  "share",
  "retry",
  "regenerate",
]);
const CODE_BLOCK_CONTENT_SELECTORS = [
  "code",
  "#code-block-viewer .cm-content",
  ".cm-editor .cm-content",
  ".cm-content",
  "[class*='cm-content']",
];
const CODE_BLOCK_HINT_EXCLUDE_SELECTOR = [
  "button",
  "[role='button']",
  "pre",
  "code",
  "#code-block-viewer",
  ".cm-editor",
  ".cm-content",
  "[class*='cm-content']",
].join(", ");
const CHATGPT_THINKING_DURATION_PATTERN =
  "(?:\\u5df2\\u601d\\u8003\\s*\\d+\\s*s?|thought for\\s+\\d+\\s*s?)";

function parseLanguageFromClassName(value: string): string | null {
  const classTokens = value.split(/\s+/).filter(Boolean);
  for (const token of classTokens) {
    const normalized = token.toLowerCase();
    const languageMatch = normalized.match(/(?:^|[-_])(language|lang)[-_]?([a-z0-9+#.-]+)/i);
    if (languageMatch?.[2]) {
      return languageMatch[2];
    }
  }
  return null;
}

function normalizeLanguageToken(value: string | null | undefined): string | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const prefixed = normalized.match(/^(?:language|lang)[:_\-\s]*([a-z0-9+#.-]{1,24})$/i);
  if (prefixed?.[1]) {
    const token = prefixed[1].toLowerCase();
    return LANGUAGE_NOISE_TOKENS.has(token) ? null : token;
  }

  if (!LANGUAGE_TOKEN_PATTERN.test(normalized)) {
    return null;
  }

  return LANGUAGE_NOISE_TOKENS.has(normalized) ? null : normalized;
}

function normalizeCodeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trimEnd();
}

function collectTextWithBreaks(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  if (element.tagName.toLowerCase() === "br") {
    return "\n";
  }

  const parts = Array.from(element.childNodes).map((child) => collectTextWithBreaks(child));
  const joined = parts.join("");
  if (element.classList.contains("cm-line")) {
    return `${joined}\n`;
  }
  return joined;
}

function extractLanguageTextHint(element: Element): string | null {
  if (element.matches(CODE_BLOCK_HINT_EXCLUDE_SELECTOR)) {
    return null;
  }

  if (element.querySelector(CODE_BLOCK_HINT_EXCLUDE_SELECTOR)) {
    return null;
  }

  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 24 || text.includes(" ")) {
    return null;
  }

  return normalizeLanguageToken(text);
}

type MessageRole = "user" | "ai";
type ExtractionSource = "selector" | "anchor";

interface ParserStats {
  source: ExtractionSource;
  totalCandidates: number;
  keptMessages: number;
  hard_boundary_mode_used: boolean;
  hard_boundary_roots: number;
  roleDistribution: Record<MessageRole, number>;
  droppedUnknownRole: number;
  droppedNoise: number;
  parse_duration_ms: number;
  perf_mode: AstPerfMode;
  next_perf_mode: AstPerfMode;
  degraded_nodes_count: number;
  ast_node_count: number;
  message_count: number;
  platform: Platform;
}

interface ExtractionResult {
  source: ExtractionSource;
  messages: ParsedMessage[];
  totalCandidates: number;
  hardBoundaryModeUsed: boolean;
  hardBoundaryRoots: number;
  droppedUnknownRole: number;
  droppedNoise: number;
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ParsedNodeResult {
  message: ParsedMessage;
  astNodeCount: number;
  degradedNodesCount: number;
}

interface SanitizedContentResult {
  content: Element;
  citations: ParsedMessage["citations"];
}

export class ChatGPTParser implements IParser {
  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      return "ChatGPT";
    }
    return null;
  }

  getConversationTitle(): string {
    const titleEl = queryFirst(SELECTORS.title);
    const title = safeTextContent(titleEl);
    if (title) return title;
    return document.title || "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("ChatGPT");
    const selectorResult = this.extractUsingSelectorStrategy(perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const dedupedMessages = this.dedupeNearDuplicates(chosen.messages);

    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("ChatGPT", parseDurationMs);

    const stats: ParserStats = {
      source: chosen.source,
      totalCandidates: chosen.totalCandidates,
      keptMessages: dedupedMessages.length,
      hard_boundary_mode_used: chosen.hardBoundaryModeUsed,
      hard_boundary_roots: chosen.hardBoundaryRoots,
      roleDistribution: { user: 0, ai: 0 },
      droppedUnknownRole: chosen.droppedUnknownRole,
      droppedNoise: chosen.droppedNoise + (chosen.messages.length - dedupedMessages.length),
      parse_duration_ms: parseDurationMs,
      perf_mode: perfMode,
      next_perf_mode: modeUpdate.mode,
      degraded_nodes_count: chosen.degradedNodesCount,
      ast_node_count: chosen.astNodeCount,
      message_count: dedupedMessages.length,
      platform: "ChatGPT",
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "ChatGPT AST perf mode switched", {
        platform: "ChatGPT",
        from: modeUpdate.previousMode,
        to: modeUpdate.mode,
        parse_duration_ms: parseDurationMs,
        message_count: dedupedMessages.length,
      });
    }

    for (const message of dedupedMessages) {
      stats.roleDistribution[message.role] += 1;
    }

    this.logStats(stats, dedupedMessages);
    return dedupedMessages;
  }

  isGenerating(): boolean {
    return queryFirst(SELECTORS.generating) !== null;
  }

  getSessionUUID(): string | null {
    const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    if (match && match[1]) return match[1];
    return null;
  }

  getSourceCreatedAt(): number | null {
    return extractEarliestTimeFromSelectors(SELECTORS.sourceTimes);
  }

  private extractUsingSelectorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const hardBoundaryRoots = this.getHardMessageRoots();
    const rawCandidates = this.collectSelectorCandidates(hardBoundaryRoots);
    const normalized = normalizeCandidateNodes(rawCandidates, {
      minTextLength: 2,
      noiseContainerSelectors: SELECTORS.noiseContainers,
      noiseTextPatterns: SELECTORS.noiseTextPatterns,
    });

    let droppedUnknownRole = 0;
    let droppedNoise = normalized.droppedNoise;
    let degradedNodesCount = 0;
    let astNodeCount = 0;
    const messages: ParsedMessage[] = [];

    for (const node of normalized.nodes) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }

      if (!this.hasParsedMessageSignal(parsed.message)) {
        droppedNoise += 1;
        continue;
      }

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "selector",
      messages,
      totalCandidates: rawCandidates.length,
      hardBoundaryModeUsed: hardBoundaryRoots.length > 0,
      hardBoundaryRoots: hardBoundaryRoots.length,
      droppedUnknownRole,
      droppedNoise,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private extractUsingAnchorStrategy(perfMode: AstPerfMode): ExtractionResult {
    const mainRoot = document.querySelector("main");
    if (!mainRoot) {
      return {
        source: "anchor",
        messages: [],
        totalCandidates: 0,
        hardBoundaryModeUsed: false,
        hardBoundaryRoots: 0,
        droppedUnknownRole: 0,
        droppedNoise: 0,
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const hardBoundaryRoots = this.getHardMessageRoots(mainRoot);
    const rawCandidates =
      hardBoundaryRoots.length > 0
        ? collapseNodesToNearestRoots(
            [
              ...hardBoundaryRoots,
              ...queryAllWithinUnique(mainRoot, SELECTORS.userRoleAnchors),
              ...this.collectCopyActionCandidates(mainRoot),
            ],
            SELECTORS.hardMessageRoots,
          )
        : uniqueNodesInDocumentOrder([
            ...queryAllWithinUnique(mainRoot, SELECTORS.userRoleAnchors),
            ...this.collectCopyActionCandidates(mainRoot),
          ]);

    const normalized = normalizeCandidateNodes(rawCandidates, {
      minTextLength: 2,
      noiseContainerSelectors: SELECTORS.noiseContainers,
      noiseTextPatterns: SELECTORS.noiseTextPatterns,
    });

    let droppedUnknownRole = 0;
    let droppedNoise = normalized.droppedNoise;
    let degradedNodesCount = 0;
    let astNodeCount = 0;
    const messages: ParsedMessage[] = [];

    for (const node of normalized.nodes) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }

      if (!this.hasParsedMessageSignal(parsed.message)) {
        droppedNoise += 1;
        continue;
      }

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "anchor",
      messages,
      totalCandidates: rawCandidates.length,
      hardBoundaryModeUsed: hardBoundaryRoots.length > 0,
      hardBoundaryRoots: hardBoundaryRoots.length,
      droppedUnknownRole,
      droppedNoise,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private collectSelectorCandidates(hardBoundaryRoots: Element[]): Element[] {
    if (hardBoundaryRoots.length > 0) {
      const collapsed = collapseNodesToNearestRoots(
        [
          ...hardBoundaryRoots,
          ...queryAllUnique([...SELECTORS.userRoleAnchors, ...SELECTORS.assistantRoleAnchors]),
          ...queryAllUnique(SELECTORS.turnBlocks),
        ],
        SELECTORS.hardMessageRoots,
      );
      return collapsed.length > 0 ? collapsed : hardBoundaryRoots;
    }

    const combinedCandidates: Element[] = [
      ...queryAllUnique([...SELECTORS.userRoleAnchors, ...SELECTORS.assistantRoleAnchors]),
    ];

    for (const turnNode of queryAllUnique(SELECTORS.turnBlocks)) {
      const splitNodes = queryAllWithinUnique(turnNode, [
        ...SELECTORS.userRoleAnchors,
        ...SELECTORS.assistantRoleAnchors,
      ]);
      if (splitNodes.length > 0) {
        combinedCandidates.push(...splitNodes);
        continue;
      }
      combinedCandidates.push(turnNode);
    }

    return uniqueNodesInDocumentOrder(combinedCandidates);
  }

  private collectCopyActionCandidates(root: Element): Element[] {
    const actionAnchors = queryAllWithinUnique(root, SELECTORS.copyActionAnchors);
    const resolvedNodes: Element[] = [];

    for (const anchor of actionAnchors) {
      const resolved = this.resolveActionAnchorMessageNode(anchor, root);
      if (resolved) {
        resolvedNodes.push(resolved);
      }
    }

    const nodesBySignature = new Map<string, Element>();
    for (const node of uniqueNodesInDocumentOrder(resolvedNodes)) {
      const text = this.extractSanitizedText(node, "ai");
      if (!text) {
        continue;
      }

      const signature = `${text.slice(0, 220)}::${text.length}`;
      if (!nodesBySignature.has(signature)) {
        nodesBySignature.set(signature, node);
      }
    }

    const deduped = uniqueNodesInDocumentOrder(nodesBySignature.values());
    const collapsed = collapseNodesToNearestRoots(deduped, SELECTORS.hardMessageRoots);
    return collapsed.length > 0 ? collapsed : deduped;
  }

  private resolveActionAnchorMessageNode(anchor: Element, root: Element): Element | null {
    let current: Element | null = anchor;

    while (current && root.contains(current)) {
      if (SELECTORS.noiseContainers.some((selector) => current?.matches(selector))) {
        return null;
      }

      const text = this.extractSanitizedText(current, "ai");
      if (text.length < 12 || text.length > 20000) {
        current = current.parentElement;
        continue;
      }

      if (this.hasUserMarker(current)) {
        current = current.parentElement;
        continue;
      }

      if (this.hasCopyAction(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    const role = this.inferRole(node);
    if (!role) return null;

    const contentEl = this.resolveContentElement(node, role);
    const sanitized = this.prepareSanitizedContent(contentEl);
    const sanitizedContent = sanitized.content;
    const ast = extractAstFromElement(sanitizedContent, {
      platform: "ChatGPT",
      perfMode,
    });
    const fallbackText = this.cleanExtractedText(this.extractVisibleText(sanitizedContent));
    const textContent = resolveCanonicalMessageText({
      fallbackText,
      ast: ast.root,
      normalizeAstText: (value: string) => this.cleanExtractedText(value),
    });
    const attachments = role === "user" ? this.extractUserAttachments(node) : [];

    return {
      message: {
        role,
        textContent,
        contentAst: ast.root,
        contentAstVersion: ast.root ? "ast_v2" : null,
        degradedNodesCount: ast.degradedNodesCount,
        citations: sanitized.citations ?? [],
        attachments,
        htmlContent: sanitizedContent.innerHTML,
      },
      astNodeCount: ast.astNodeCount,
      degradedNodesCount: ast.degradedNodesCount,
    };
  }

  private resolveContentElement(node: Element, role: MessageRole): Element {
    if (role === "ai") {
      const aiPreferred = this.resolveAiPreferredContentElement(node);
      if (aiPreferred) {
        return aiPreferred;
      }
    }

    const preferredSelectors =
      role === "user" ? SELECTORS.userMessageContent : SELECTORS.preferredMessageContent;
    const preferred = queryFirstWithin(node, preferredSelectors);
    if (preferred) {
      return preferred;
    }

    return queryFirstWithin(node, SELECTORS.messageContent) ?? node;
  }

  private resolveAiPreferredContentElement(node: Element): Element | null {
    const attributeCandidates = queryAllWithinUnique(node, [
      "[data-message-content]",
      "[data-testid*='message-content']",
    ]).filter((candidate) => {
      const text = this.cleanExtractedText(this.extractVisibleText(candidate));
      return text.length > 0 && !this.isThinkingControlOnlyText(text);
    });

    const lastAttributeCandidate = attributeCandidates[attributeCandidates.length - 1];
    return lastAttributeCandidate ?? null;
  }

  private sanitizeContentElement(source: Element): Element {
    return this.prepareSanitizedContent(source).content;
  }

  private extractSanitizedText(node: Element, role: MessageRole): string {
    const contentEl = this.resolveContentElement(node, role);
    const sanitized = this.sanitizeContentElement(contentEl);
    return this.cleanExtractedText(this.extractVisibleText(sanitized));
  }

  private getHardMessageRoots(root?: Element): Element[] {
    if (root) {
      return queryAllWithinUnique(root, SELECTORS.hardMessageRoots);
    }
    return queryAllUnique(SELECTORS.hardMessageRoots);
  }

  private prepareSanitizedContent(source: Element): SanitizedContentResult {
    const result = cloneAndSanitizeMessageContent(
      source,
      getCitationNoiseProfile("ChatGPT"),
    );
    const selector = SELECTORS.removableContentSelectors.join(", ");
    result.clone.querySelectorAll(selector).forEach((node) => node.remove());
    this.normalizeCodeBlocks(result.clone);
    return {
      content: result.clone,
      citations: result.citations,
    };
  }

  private normalizeCodeBlocks(root: Element): void {
    const preBlocks = Array.from(root.querySelectorAll("pre"));

    for (const preBlock of preBlocks) {
      const contentElement = queryFirstWithin(preBlock, CODE_BLOCK_CONTENT_SELECTORS);
      if (!contentElement) {
        continue;
      }

      const codeText = this.extractCodeBlockText(contentElement);
      if (!codeText.trim()) {
        continue;
      }

      const language = this.inferCodeBlockLanguage(preBlock, contentElement);
      const normalizedCode = document.createElement("code");
      normalizedCode.textContent = codeText;

      if (language) {
        normalizedCode.setAttribute("data-language", language);
        preBlock.setAttribute("data-language", language);
      } else {
        preBlock.removeAttribute("data-language");
      }

      preBlock.replaceChildren(normalizedCode);
    }
  }

  private extractCodeBlockText(contentElement: Element): string {
    const cmLines = contentElement.matches(".cm-line")
      ? [contentElement]
      : Array.from(contentElement.querySelectorAll(".cm-line"));
    if (cmLines.length > 0) {
      const joined = cmLines
        .map((line) => collectTextWithBreaks(line).replace(/\n+$/g, ""))
        .join("\n");
      return normalizeCodeText(joined);
    }

    const withBreaks = collectTextWithBreaks(contentElement);
    if (withBreaks.trim()) {
      return normalizeCodeText(withBreaks);
    }

    if (contentElement instanceof HTMLElement) {
      const innerText = contentElement.innerText || "";
      if (innerText.trim()) {
        return normalizeCodeText(innerText);
      }
    }

    return normalizeCodeText(contentElement.textContent ?? "");
  }

  private inferCodeBlockLanguage(preBlock: Element, contentElement: Element): string | null {
    const attrCandidates = [
      contentElement.getAttribute("data-language"),
      contentElement.getAttribute("data-lang"),
      preBlock.getAttribute("data-language"),
      preBlock.getAttribute("data-lang"),
    ];

    for (const candidate of attrCandidates) {
      const token = normalizeLanguageToken(candidate);
      if (token) return token;
    }

    const classCandidates = [
      contentElement.className?.toString() ?? "",
      preBlock.className?.toString() ?? "",
    ];
    for (const candidate of classCandidates) {
      const language = parseLanguageFromClassName(candidate);
      const token = normalizeLanguageToken(language);
      if (token) return token;
    }

    const nearby = new Set<Element>();
    for (const element of Array.from(preBlock.querySelectorAll("*"))) {
      if (element === contentElement || contentElement.contains(element)) {
        continue;
      }
      nearby.add(element);
    }

    const parent = preBlock.parentElement;
    if (parent) {
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== preBlock) {
          nearby.add(sibling);
        }
      }
    }

    for (const element of nearby) {
      const token = extractLanguageTextHint(element);
      if (token) return token;
    }

    return null;
  }

  private extractVisibleText(element: Element): string {
    if (element instanceof HTMLElement) {
      const innerText = (element.innerText || "").trim();
      if (innerText) {
        return innerText;
      }
    }
    return safeTextContent(element);
  }

  private extractUserAttachments(node: Element): ParsedMessage["attachments"] {
    type AttachmentCandidate = {
      kind: "image" | "file";
      element: Element;
      label?: string;
      mime?: string | null;
    };

    const candidates: AttachmentCandidate[] = [];
    const seenElements = new Set<Element>();

    const pushCandidate = (candidate: AttachmentCandidate) => {
      if (seenElements.has(candidate.element)) {
        return;
      }
      seenElements.add(candidate.element);
      candidates.push(candidate);
    };

    for (const tile of queryAllWithinUnique(node, SELECTORS.userAttachmentFileTiles)) {
      const label = this.readUserFileTileLabel(tile);
      const mime = this.readUserFileTileMime(tile, label);
      if (!label && !mime) {
        continue;
      }

      pushCandidate({
        kind: "file",
        element: tile,
        label,
        mime,
      });
    }

    for (const button of queryAllWithinUnique(node, SELECTORS.userAttachmentImageButtons)) {
      pushCandidate({
        kind: "image",
        element: button,
        label: undefined,
        mime: null,
      });
    }

    for (const image of queryAllWithinUnique(node, SELECTORS.userAttachmentImages)) {
      const root = image.closest("button") ?? image;
      const alt = image instanceof HTMLImageElement ? image.alt : image.getAttribute("alt");
      pushCandidate({
        kind: "image",
        element: root,
        label: sanitizeAttachmentLabel(alt),
        mime: inferMimeFromLabel(alt),
      });
    }

    candidates.sort((a, b) => {
      if (a.element === b.element) return 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });

    let imageCount = 0;
    let fileCount = 0;

    return candidates.flatMap((candidate) => {
      if (candidate.kind === "image") {
        imageCount += 1;
        const attachment = createMessageAttachment({
          indexAlt: `Uploaded image ${imageCount}`,
          label: candidate.label,
          mime: candidate.mime,
          occurrenceRole: "user_upload",
        });
        return attachment ? [attachment] : [];
      }

      fileCount += 1;
      const attachment = createMessageAttachment({
        indexAlt: `Uploaded file ${fileCount}`,
        label: candidate.label,
        mime: candidate.mime,
        occurrenceRole: "user_upload",
      });
      return attachment ? [attachment] : [];
    });
  }

  private readUserFileTileLabel(tile: Element): string | undefined {
    const visibleLabel = queryFirstWithin(tile, [
      ".font-semibold",
      "[class*='font-semibold']",
      "[class*='truncate']",
    ]);
    const directLabel = sanitizeAttachmentLabel(safeTextContent(visibleLabel));
    if (directLabel) {
      return directLabel;
    }
    return sanitizeAttachmentLabel(tile.getAttribute("aria-label"));
  }

  private readUserFileTileMime(tile: Element, label?: string): string | null {
    const mimeHint = queryFirstWithin(tile, [
      ".text-token-text-secondary",
      "[class*='text-secondary']",
    ]);
    const fromVisibleType = inferMimeFromLabel(safeTextContent(mimeHint));
    if (fromVisibleType) {
      return fromVisibleType;
    }
    return inferMimeFromLabel(label);
  }

  private inferRole(node: Element): MessageRole | null {
    if (this.hasConflictingExplicitMarkers(node)) {
      return null;
    }

    const directRole = this.roleFromAttribute(node.getAttribute("data-message-author-role"));
    if (directRole) return directRole;

    const directTestIdRole = this.roleFromTestId(node.getAttribute("data-testid"));
    if (directTestIdRole) return directTestIdRole;

    const descendantRole = this.roleFromDescendants(node);
    if (descendantRole) return descendantRole;

    if (this.hasCopyAction(node) && !this.hasUserMarker(node)) {
      return "ai";
    }

    const ancestor = node.parentElement
      ? closestAnySelector(node.parentElement, SELECTORS.roleAncestorHints)
      : null;
    if (!ancestor) {
      return null;
    }

    const ancestorRole = this.roleFromAttribute(ancestor.getAttribute("data-message-author-role"));
    if (ancestorRole) return ancestorRole;

    const ancestorTestIdRole = this.roleFromTestId(ancestor.getAttribute("data-testid"));
    if (ancestorTestIdRole) return ancestorTestIdRole;

    return this.roleFromHint(ancestor.className?.toString() ?? "");
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (normalized === "assistant" || normalized === "chatgpt" || normalized === "model") {
      return "ai";
    }
    return null;
  }

  private roleFromTestId(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (/(^|[-_:])(user|human|prompt|query|question)([-_:]|$)/.test(normalized)) {
      return "user";
    }

    if (/(^|[-_:])(assistant|chatgpt|model|ai|answer|reply|response)([-_:]|$)/.test(normalized)) {
      return "ai";
    }

    return this.roleFromHint(normalized);
  }

  private roleFromHint(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (/(^|[-_:])(user|human|prompt|query|question)([-_:]|$)/.test(normalized)) {
      return "user";
    }

    if (/(^|[-_:])(assistant|chatgpt|model|ai|answer|reply|response)([-_:]|$)/.test(normalized)) {
      return "ai";
    }

    if (
      normalized.includes("user") ||
      normalized.includes("human") ||
      normalized.includes("prompt") ||
      normalized.includes("query")
    ) {
      return "user";
    }

    if (
      normalized.includes("assistant") ||
      normalized.includes("chatgpt") ||
      normalized.includes("model") ||
      normalized.includes("response")
    ) {
      return "ai";
    }

    return null;
  }

  private hasUserMarker(node: Element): boolean {
    return hasAnySelector(node, SELECTORS.userRoleAnchors);
  }

  private hasAssistantMarker(node: Element): boolean {
    return hasAnySelector(node, SELECTORS.assistantRoleAnchors);
  }

  private hasCopyAction(node: Element): boolean {
    return hasAnySelector(node, SELECTORS.copyActionAnchors);
  }

  private hasConflictingExplicitMarkers(node: Element): boolean {
    return this.hasUserMarker(node) && this.hasAssistantMarker(node);
  }

  private roleFromDescendants(node: Element): MessageRole | null {
    const hasUserDescendant = this.hasUserMarker(node);
    const hasAssistantDescendant = this.hasAssistantMarker(node);

    if (hasUserDescendant && hasAssistantDescendant) return null;
    if (hasUserDescendant) return "user";
    if (hasAssistantDescendant) return "ai";
    return null;
  }

  private cleanExtractedText(rawText: string): string {
    let text = rawText.replace(/\r/g, "");

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    text = text
      .replace(/^(?:copy|edit|retry|regenerate|share|read aloud)\s+/i, "")
      .replace(new RegExp(`^${CHATGPT_THINKING_DURATION_PATTERN}\\s*`, "i"), "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    text = text
      .replace(
        new RegExp(
          `(?:^|\\n)\\s*${CHATGPT_THINKING_DURATION_PATTERN}(?:\\s+(?:show more|done))*\\s*(?=\\n|$)`,
          "gi",
        ),
        "\n",
      )
      .replace(
        /(?:^|\n)\s*(?:copy|edit|retry|regenerate|share|read aloud|show more|done)\s*(?=\n|$)/gi,
        "\n",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text;
  }

  private isThinkingControlOnlyText(text: string): boolean {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return false;
    }

    return (
      new RegExp(`^${CHATGPT_THINKING_DURATION_PATTERN}$`, "i").test(normalized) ||
      /^(?:show more|done)$/i.test(normalized)
    );
  }

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const signature = this.buildMessageSignature(message);
      const isDuplicate = deduped.slice(Math.max(0, deduped.length - 2)).some((existing) => {
        return this.buildMessageSignature(existing) === signature;
      });

      if (!isDuplicate) {
        deduped.push(message);
      }
    }

    return deduped;
  }

  private buildMessageSignature(message: ParsedMessage): string {
    const attachmentSignature = JSON.stringify(
      (message.attachments ?? []).map((attachment) => ({
        indexAlt: attachment.indexAlt,
        label: attachment.label ?? null,
        mime: attachment.mime ?? null,
      })),
    );
    return [
      message.role,
      message.textContent.replace(/\s+/g, " ").trim(),
      attachmentSignature,
    ].join("|");
  }

  private hasParsedMessageSignal(message: ParsedMessage): boolean {
    return (
      message.textContent.trim().length > 0 ||
      (message.attachments?.length ?? 0) > 0 ||
      (message.citations?.length ?? 0) > 0 ||
      (message.artifacts?.length ?? 0) > 0
    );
  }

  private chooseBestExtraction(
    selectorResult: ExtractionResult,
    anchorResult: ExtractionResult,
  ): ExtractionResult {
    if (selectorResult.hardBoundaryModeUsed !== anchorResult.hardBoundaryModeUsed) {
      return selectorResult.hardBoundaryModeUsed ? selectorResult : anchorResult;
    }

    const selectorScore = this.scoreExtraction(selectorResult);
    const anchorScore = this.scoreExtraction(anchorResult);

    if (selectorScore > anchorScore) return selectorResult;
    if (anchorScore > selectorScore) return anchorResult;
    return selectorResult.messages.length >= anchorResult.messages.length
      ? selectorResult
      : anchorResult;
  }

  private scoreExtraction(result: ExtractionResult): number {
    if (result.messages.length === 0) return 0;

    const userCount = result.messages.filter((message) => message.role === "user").length;
    const aiCount = result.messages.length - userCount;
    const balancedPairs = Math.min(userCount, aiCount);

    return balancedPairs * 8 + aiCount * 4 + userCount * 2 + result.messages.length;
  }

  private logStats(stats: ParserStats, messages: ParsedMessage[]): void {
    logger.info("parser", "ChatGPT parse stats", stats);

    if (stats.hard_boundary_mode_used) {
      logger.info("parser", "ChatGPT hard boundary mode active", {
        source: stats.source,
        hardBoundaryRoots: stats.hard_boundary_roots,
        keptMessages: stats.keptMessages,
      });
    }

    if (stats.source === "anchor") {
      logger.debug("parser", "ChatGPT parser used anchor fallback", {
        totalCandidates: stats.totalCandidates,
        keptMessages: stats.keptMessages,
        roleDistribution: stats.roleDistribution,
      });
    }

    if (stats.hard_boundary_mode_used && stats.keptMessages > stats.hard_boundary_roots) {
      logger.debug("parser", "ChatGPT hard boundary produced extra logical messages", {
        source: stats.source,
        hardBoundaryRoots: stats.hard_boundary_roots,
        keptMessages: stats.keptMessages,
      });
    }

    if (stats.totalCandidates > 0 && stats.keptMessages === 0) {
      logger.debug("parser", "ChatGPT parser kept zero messages", {
        source: stats.source,
        totalCandidates: stats.totalCandidates,
        droppedNoise: stats.droppedNoise,
        droppedUnknownRole: stats.droppedUnknownRole,
      });
      return;
    }

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.debug("parser", "ChatGPT parser captured only one role", {
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}
