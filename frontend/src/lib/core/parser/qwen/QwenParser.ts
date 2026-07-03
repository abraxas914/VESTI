import type { IParser, ParsedMessage } from "../IParser";
import type { Platform } from "../../../types";
import {
  collapseNodesToNearestRoots,
  closestAnySelector,
  extractEarliestTimeFromSelectors,
  normalizeCandidateNodes,
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
import { logger } from "../../../utils/logger";

const USER_ROLE_ANCHORS = [
  "[data-testid='send_message']",
  "[data-testid*='send_message']",
  ".questionItem",
  "[data-role='user']",
  "[data-author='user']",
  "[data-message-author-role='user']",
  "[data-testid*='user']",
  "[data-testid*='question']",
  "[data-testid*='prompt']",
  "[class*='user-message']",
  "[class*='message-user']",
  "[class*='question']",
];

const ASSISTANT_ROLE_ANCHORS = [
  "[data-testid='receive_message']",
  "[data-testid*='receive_message']",
  "[data-role='assistant']",
  "[data-author='assistant']",
  "[data-message-author-role='assistant']",
  "[data-testid*='assistant']",
  "[data-testid*='answer']",
  "[data-testid*='response']",
  "[class*='assistant-message']",
  "[class*='message-assistant']",
  "[class*='answer']",
  "[class*='response']",
  "[class*='qwen-message']",
];

const COPY_ACTION_ANCHORS = [
  "[data-testid='action-bar-copy']",
  "[data-testid*='action-copy']",
  "[data-testid*='copy']",
  "[aria-label*='copy' i]",
];

const ROLE_ANCESTOR_HINTS = [
  "[data-role]",
  "[data-author]",
  "[data-message-author-role]",
  "[data-testid*='user']",
  "[data-testid*='assistant']",
  "[data-testid*='answer']",
  "[data-testid*='response']",
  "[class*='user-message']",
  "[class*='assistant-message']",
  "[class*='message-user']",
  "[class*='message-assistant']",
  "[class*='question']",
  "[class*='answer']",
  "[class*='response']",
];

const SELECTORS = {
  userRoleAnchors: USER_ROLE_ANCHORS,
  assistantRoleAnchors: ASSISTANT_ROLE_ANCHORS,
  hardMessageRoots: ['[data-testid="message-block-container"]'],
  roleAnchors: [
    '[data-testid="message-block-container"]',
    ".bubble-element",
    "[data-testid*='message']",
    ...USER_ROLE_ANCHORS,
    ...ASSISTANT_ROLE_ANCHORS,
  ],
  copyActionAnchors: COPY_ACTION_ANCHORS,
  roleAncestorHints: ROLE_ANCESTOR_HINTS,
  turnBlocks: [
    '[data-testid="message-block-container"]',
    "[data-msgid]",
    "[data-message-id]",
    ".chat-message-item",
    "[class*='message-item']",
    "[class*='message-row']",
    "[class*='message-block']",
    "article",
    "[role='listitem']",
  ],
  messageContent: [
    '[data-testid="message_text_content"]',
    ".qwen-markdown",
    ".chat-response-message .qwen-markdown",
    ".chat-response-message",
    "[class*='chat-response-message']",
    "[data-testid*='message-content']",
    "[data-testid*='response-content']",
    ".markdown",
    ".prose",
    "div[class*='markdown']",
    "div[class*='content']",
    ".bubble-element",
    "[class*='bubble']",
  ],
  preferredMessageContent: [
    '[data-testid="message_text_content"]',
    ".qwen-markdown",
    ".chat-response-message",
    "[class*='chat-response-message']",
    "[data-testid*='message-content']",
    "[data-testid*='response-content']",
    ".markdown",
    ".prose",
    "div[class*='markdown']",
  ],
  discardContainers: [
    ".qwen-chat-ui-packages-siblings",
    ".qwen-chat-search-card",
    ".header-desktop",
    ".header-content",
    ".chat-item-drag-web",
    ".sidebar-user",
    ".qwen-chat-layout-help",
    ".chat-container-statement",
    "[class*='packages-siblings']",
    "[class*='search-card']",
    "[class*='edit-history']",
    "[data-testid*='edit-history']",
    "[data-testid*='history-switch']",
    "hr",
    "[class*='divider']",
    "[class*='separator']",
  ],
  inlineNoiseSelectors: [
    ".qwen-chat-ui-packages-siblings",
    ".qwen-chat-ui-packages-siblings-text",
    ".qwen-chat-search-card",
    "[class*='packages-siblings']",
    "[class*='search-card']",
    "[class*='edit-history']",
    "[data-testid*='edit-history']",
    "[data-testid*='history-switch']",
    ".response-message-footer",
    ".qwen-chat-package-comp-new-action-control",
    ".qwen-markdown-table-header",
    ".qwen-markdown-table-header-action-item",
    ".qwen-markdown-code-header-actions",
    ".qwen-markdown-code-header-action-item",
    ".qwen-chat-thinking-tool-status-card-wraper",
    ".qwen-chat-tool-status-card",
    ".qwen-chat-thinking-status-card-content",
    ".qwen-chat-thinking-status-card-title",
    ".qwen-chat-thinking-status-card-title-text",
    ".qwen-chat-status-card-after",
    ".copy-response-button",
    ".qwen-thinking-selector",
    ".message-input-right-button",
    ".message-input-container",
    ".chat-layout-input-container",
    ".chat-container-statement",
    "#voice-input-button",
    ".monaco-aria-container",
    ".monaco-alert",
    ".monaco-status",
    "[data-testid*='action-bar']",
    "[data-testid='action-bar-copy']",
    "[data-testid*='action-copy']",
    "[data-testid*='copy']",
    "button",
    "svg",
  ],
  dividerSelectors: [
    "hr",
    "[class*='divider']",
    "[class*='separator']",
    "[class*='border-b']",
  ],
  title: [
    ".conversation-title",
    ".chat-title",
    ".session-title",
    ".header-title",
    "[role='heading']",
    "h1",
    "title",
  ],
  generating: [
    "[data-is-streaming='true']",
    "[data-testid*='stream']",
    "[data-testid*='typing']",
    "[class*='typing']",
    "[class*='stream']",
  ],
  noiseContainers: [
    "form",
    "footer",
    "nav",
    "aside",
    "[role='complementary']",
    "[role='navigation']",
    "[class*='history']",
    "[class*='sidebar']",
    "[class*='session-list']",
    ".header-desktop",
    ".header-content",
    ".chat-item-drag-web",
    ".sidebar-user",
    ".qwen-chat-layout-help",
    ".chat-container-statement",
    "[id*='history']",
    "[id*='sidebar']",
    "[data-testid*='composer']",
    "[contenteditable='true']",
  ],
  noiseTextPatterns: [
    /^new chat$/i,
    /^retry$/i,
    /^edit$/i,
    /^copy$/i,
    /^edit history$/i,
    /^\u7f16\u8f91\u5386\u53f2$/i,
    /^\d+\s*\/\s*\d+$/i,
    /^references?\s*[:\uff1a]?\s*\d+$/i,
    /^(?:\u53c2\u8003\u94fe\u63a5|\u5f15\u7528)\s*[:\uff1a]?\s*\d+$/i,
    /^show more$/i,
    /^done$/i,
    /^thought for\s+\d+s/i,
    /^qwen can make mistakes\.?/i,
  ],
  sourceTimes: ["time[datetime]", "article time[datetime]"],
};

const ROOT_SELECTORS = [
  "main",
  "[role='main']",
  "[class*='chat-window']",
  "[class*='thread']",
  "[class*='conversation-content']",
  "[class*='conversation']",
];

const ROOT_MESSAGE_HINTS = [
  '[data-testid="message-block-container"]',
  "[data-testid='send_message']",
  "[data-testid='receive_message']",
  ".questionItem",
  ".bubble-element",
  "[data-role='user']",
  "[data-role='assistant']",
  "[data-message-author-role='assistant']",
  "[data-testid*='message']",
];

const ROOT_HISTORY_KEYWORDS = [
  "history",
  "sidebar",
  "session-list",
  "conversation-list",
  "menu-list",
];

const TITLE_USER_SELECTORS = [
  ".questionItem",
  "[data-role='user']",
  "[data-author='user']",
  "[data-message-author-role='user']",
  "[class*='user-message']",
  "[class*='question']",
  "[data-testid*='user-message']",
  "[data-testid*='question']",
];

const SESSION_ID_QUERY_KEYS = [
  "conversation",
  "conversation_id",
  "chat",
  "chat_id",
  "session",
  "session_id",
  "id",
];

const SESSION_ID_PATTERNS = [
  /\/c\/([a-zA-Z0-9_-]{8,})/i,
  /\/chat\/([a-zA-Z0-9_-]{8,})/i,
  /\/conversation\/([a-zA-Z0-9_-]{8,})/i,
];

const INVALID_SESSION_IDS = new Set([
  "chat",
  "new",
  "conversation",
  "session",
  "search",
  "history",
]);
const INVALID_TITLES = new Set(["qwen chat", "qwen", "download app", "qwen3-max"]);
const MAX_TITLE_LENGTH = 120;
const TITLE_BOUNDARY_CHARS = ["\u3002", "\uff01", "\uff1f", "!", "?", "."];
const MONACO_CODE_WRAPPER_SELECTORS = [
  ".qwen-markdown-code-body",
  "[class*='markdown-code-body']",
  "[class*='markdown-code-block']",
  "[class*='code-block']",
  "[class*='codeBlock']",
  "[class*='monaco-wrapper']",
  "figure",
];
const MONACO_LANGUAGE_NOISE_TOKENS = new Set([
  "copy",
  "copied",
  "run",
  "running",
  "done",
  "share",
  "retry",
  "regenerate",
  "code",
  "editor",
  "monaco",
  "plain",
  "plaintext",
  "text",
]);
const MONACO_LANGUAGE_HINT_TOKENS = new Set([
  "python",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "java",
  "go",
  "rust",
  "sql",
  "html",
  "css",
  "scss",
  "sass",
  "json",
  "yaml",
  "yml",
  "xml",
  "markdown",
  "md",
  "bash",
  "shell",
  "sh",
  "powershell",
  "ps1",
  "c",
  "cpp",
  "c++",
  "csharp",
  "cs",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "scala",
  "r",
  "lua",
  "perl",
  "dockerfile",
  "makefile",
]);
const MONACO_LANGUAGE_EXCLUDE_SELECTORS = [
  "button",
  "[role='button']",
  "pre",
  "code",
  ".monaco-editor",
  ".view-lines",
  ".view-line",
  ".margin",
  ".margin-view-overlays",
  "[aria-hidden='true']",
].join(", ");

type MessageRole = "user" | "ai";
type ExtractionSource = "selector" | "anchor";

interface ParserStats {
  source: ExtractionSource;
  totalCandidates: number;
  keptMessages: number;
  roleDistribution: Record<MessageRole, number>;
  droppedNoise: number;
  droppedUnknownRole: number;
  rootSelector: string;
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
  totalCandidates: number;
  droppedNoise: number;
  droppedUnknownRole: number;
  messages: ParsedMessage[];
  degradedNodesCount: number;
  astNodeCount: number;
}

interface ParsedNodeResult {
  message: ParsedMessage;
  degradedNodesCount: number;
  astNodeCount: number;
}

export class QwenParser implements IParser {
  private latestMessages: ParsedMessage[] = [];

  detect(): Platform | null {
    const host = window.location.hostname;
    if (host.includes("chat.qwen.ai")) {
      return "Qwen";
    }
    return null;
  }

  getConversationTitle(): string {
    const messageTitle = this.buildTitleFromFirstUserMessage();
    if (messageTitle) return messageTitle;

    const documentTitle = this.toConciseTitle(document.title || "");
    if (this.isUsableDocumentTitle(documentTitle)) {
      return documentTitle;
    }

    const fallbackTitle = this.toConciseTitle(safeTextContent(queryFirst(SELECTORS.title)));
    if (this.isUsableDocumentTitle(fallbackTitle)) {
      return fallbackTitle;
    }

    return "Untitled Conversation";
  }

  getMessages(): ParsedMessage[] {
    const startedAt = performance.now();
    const perfMode = astPerfModeController.getMode("Qwen");
    const rootContext = this.resolveConversationRoot();
    const selectorResult = this.extractUsingSelectorStrategy(rootContext.root, perfMode);
    const anchorResult = this.extractUsingAnchorStrategy(rootContext.root, perfMode);
    const chosen = this.chooseBestExtraction(selectorResult, anchorResult);
    const deduped = this.dedupeNearDuplicates(chosen.messages);
    const parseDurationMs = Math.round(performance.now() - startedAt);
    const modeUpdate = astPerfModeController.record("Qwen", parseDurationMs);

    const stats: ParserStats = {
      source: chosen.source,
      totalCandidates: chosen.totalCandidates,
      keptMessages: deduped.length,
      roleDistribution: { user: 0, ai: 0 },
      droppedNoise: chosen.droppedNoise + (chosen.messages.length - deduped.length),
      droppedUnknownRole: chosen.droppedUnknownRole,
      rootSelector: rootContext.selector,
      parse_duration_ms: parseDurationMs,
      perf_mode: perfMode,
      next_perf_mode: modeUpdate.mode,
      degraded_nodes_count: chosen.degradedNodesCount,
      ast_node_count: chosen.astNodeCount,
      message_count: deduped.length,
      platform: "Qwen",
    };

    if (modeUpdate.switched) {
      logger.debug("parser", "Qwen AST perf mode switched", {
        platform: "Qwen",
        from: modeUpdate.previousMode,
        to: modeUpdate.mode,
        parse_duration_ms: parseDurationMs,
        message_count: deduped.length,
      });
    }

    for (const message of deduped) {
      stats.roleDistribution[message.role] += 1;
    }

    this.latestMessages = deduped;
    this.logStats(stats, deduped);
    return deduped;
  }

  isGenerating(): boolean {
    return queryFirst(SELECTORS.generating) !== null;
  }

  getSessionUUID(): string | null {
    try {
      const url = new URL(window.location.href);

      for (const key of SESSION_ID_QUERY_KEYS) {
        const value = url.searchParams.get(key);
        const normalized = this.normalizeSessionId(value);
        if (normalized) return normalized;
      }

      for (const pattern of SESSION_ID_PATTERNS) {
        const match = url.pathname.match(pattern);
        const normalized = this.normalizeSessionId(match?.[1] ?? null);
        if (normalized) return normalized;
      }
    } catch {
      return null;
    }

    return null;
  }

  getSourceCreatedAt(): number | null {
    return extractEarliestTimeFromSelectors(SELECTORS.sourceTimes);
  }

  private extractUsingSelectorStrategy(root: Element, perfMode: AstPerfMode): ExtractionResult {
    const hardBoundaryRoots = this.queryAllUniqueWithin(root, SELECTORS.hardMessageRoots);
    const rawCandidates = this.collectMessageCandidates(root, hardBoundaryRoots);
    const normalized = normalizeCandidateNodes(rawCandidates, {
      minTextLength: 2,
      noiseContainerSelectors: SELECTORS.noiseContainers,
      noiseTextPatterns: SELECTORS.noiseTextPatterns,
    });

    const messages: ParsedMessage[] = [];
    let droppedUnknownRole = 0;
    let droppedNoise = normalized.droppedNoise;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of normalized.nodes) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (!parsed.message.textContent.trim() || this.isLikelyNoiseText(parsed.message.textContent)) {
        droppedNoise += 1;
        continue;
      }

      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "selector",
      totalCandidates: rawCandidates.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private extractUsingAnchorStrategy(root: Element, perfMode: AstPerfMode): ExtractionResult {
    const hardBoundaryRoots = this.queryAllUniqueWithin(root, SELECTORS.hardMessageRoots);
    const anchors = hardBoundaryRoots.length > 0
      ? hardBoundaryRoots
      : this.queryAllUniqueWithin(root, SELECTORS.roleAnchors);
    if (anchors.length === 0) {
      return {
        source: "anchor",
        totalCandidates: 0,
        droppedNoise: 0,
        droppedUnknownRole: 0,
        messages: [],
        degradedNodesCount: 0,
        astNodeCount: 0,
      };
    }

    const resolved =
      hardBoundaryRoots.length > 0
        ? collapseNodesToNearestRoots(anchors, SELECTORS.hardMessageRoots)
        : uniqueNodesInDocumentOrder(
            anchors.map((anchor) => this.resolveAnchorNode(anchor)).filter(Boolean) as Element[],
          );

    const messages: ParsedMessage[] = [];
    let droppedNoise = 0;
    let droppedUnknownRole = 0;
    let degradedNodesCount = 0;
    let astNodeCount = 0;

    for (const node of resolved) {
      const parsed = this.parseMessageNode(node, perfMode);
      if (!parsed) {
        droppedUnknownRole += 1;
        continue;
      }
      if (!parsed.message.textContent.trim() || this.isLikelyNoiseText(parsed.message.textContent)) {
        droppedNoise += 1;
        continue;
      }
      messages.push(parsed.message);
      degradedNodesCount += parsed.degradedNodesCount;
      astNodeCount += parsed.astNodeCount;
    }

    return {
      source: "anchor",
      totalCandidates: resolved.length,
      droppedNoise,
      droppedUnknownRole,
      messages,
      degradedNodesCount,
      astNodeCount,
    };
  }

  private resolveAnchorNode(anchor: Element): Element | null {
    let current: Element | null = anchor;
    while (current) {
      if (SELECTORS.turnBlocks.some((selector) => current?.matches(selector))) {
        return current;
      }
      current = current.parentElement;
    }
    return anchor;
  }

  private collectMessageCandidates(root: Element, hardBoundaryRoots: Element[]): Element[] {
    if (hardBoundaryRoots.length > 0) {
      return collapseNodesToNearestRoots(
        [
          ...hardBoundaryRoots,
          ...this.queryAllUniqueWithin(root, SELECTORS.roleAnchors),
          ...this.collectCopyActionCandidates(root),
          ...this.queryAllUniqueWithin(root, SELECTORS.turnBlocks),
        ],
        SELECTORS.hardMessageRoots,
      );
    }

    const combinedCandidates: Element[] = [...this.queryAllUniqueWithin(root, SELECTORS.roleAnchors)];
    combinedCandidates.push(...this.collectCopyActionCandidates(root));

    for (const turnNode of this.queryAllUniqueWithin(root, SELECTORS.turnBlocks)) {
      const splitNodes = queryAllWithinUnique(turnNode, SELECTORS.roleAnchors);
      if (splitNodes.length > 0) {
        combinedCandidates.push(...splitNodes);
        continue;
      }
      if (this.isLikelyMessageCandidate(turnNode)) {
        combinedCandidates.push(turnNode);
      }
    }

    return uniqueNodesInDocumentOrder(
      combinedCandidates.filter((candidate) => this.isLikelyMessageCandidate(candidate)),
    );
  }

  // Reverse-locate assistant message containers when explicit assistant role markers drift.
  private collectCopyActionCandidates(root: Element): Element[] {
    const actionAnchors = this.queryAllUniqueWithin(root, SELECTORS.copyActionAnchors);
    const resolvedNodes: Element[] = [];

    for (const anchor of actionAnchors) {
      const resolved = this.resolveActionAnchorMessageNode(anchor);
      if (resolved) {
        resolvedNodes.push(resolved);
      }
    }

    const deduped = uniqueNodesInDocumentOrder(resolvedNodes);
    const collapsed = collapseNodesToNearestRoots(deduped, SELECTORS.hardMessageRoots);
    return collapsed.length > 0 ? collapsed : deduped;
  }

  private resolveActionAnchorMessageNode(anchor: Element): Element | null {
    let current: Element | null = anchor.parentElement;

    while (current) {
      if (SELECTORS.noiseContainers.some((selector) => current?.matches(selector))) {
        return null;
      }

      const contentEl = this.resolveContentElement(current, "ai");
      const text = this.extractSanitizedText(contentEl ?? current);
      if (!text || text.length < 12 || text.length > 12000) {
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

  private isLikelyMessageCandidate(node: Element): boolean {
    if (this.isDiscardNode(node)) {
      return false;
    }

    if (SELECTORS.noiseContainers.some((selector) => node.closest(selector) !== null)) {
      return false;
    }

    const hasRoleMarker = this.hasUserMarker(node) || this.hasAssistantMarker(node);
    const preferredContent = queryFirstWithin(node, SELECTORS.preferredMessageContent);
    if (!hasRoleMarker && !preferredContent) {
      return false;
    }

    const contentEl = preferredContent ?? queryFirstWithin(node, SELECTORS.messageContent);
    const normalizedText = this.extractSanitizedText(contentEl ?? node);
    if (normalizedText.length < 2) {
      return false;
    }

    return !this.isLikelyNoiseText(normalizedText);
  }

  private queryAllUniqueWithin(root: Element, selectors: string[]): Element[] {
    const nodes: Element[] = [];
    for (const selector of selectors) {
      if (root.matches(selector)) {
        nodes.push(root);
      }
      root.querySelectorAll(selector).forEach((node) => nodes.push(node));
    }
    return uniqueNodesInDocumentOrder(nodes);
  }

  private resolveConversationRoot(): { root: Element; selector: string } {
    let best:
      | {
          root: Element;
          selector: string;
          score: number;
        }
      | undefined;

    for (const selector of ROOT_SELECTORS) {
      const candidates = Array.from(document.querySelectorAll(selector));
      for (const candidate of candidates) {
        const score = this.scoreConversationRoot(candidate, selector);
        if (!best || score > best.score) {
          best = { root: candidate, selector, score };
        }
      }
    }

    if (best && best.score > 0) {
      return { root: best.root, selector: best.selector };
    }

    if (document.body) {
      return { root: document.body, selector: "document.body" };
    }

    return { root: document.documentElement, selector: "document.documentElement" };
  }

  private scoreConversationRoot(root: Element, selector: string): number {
    let score = 0;

    if (selector === "main" || selector === "[role='main']") {
      score += 10;
    }

    for (const hintSelector of ROOT_MESSAGE_HINTS) {
      const matchCount = root.querySelectorAll(hintSelector).length;
      score += Math.min(matchCount, 8);
    }

    if (root.closest("aside, [role='complementary']")) {
      score -= 20;
    }

    if (this.isLikelyHistoryContainer(root)) {
      score -= 30;
    }

    return score;
  }

  private isLikelyHistoryContainer(root: Element): boolean {
    const marker = [
      root.id,
      root.className?.toString() ?? "",
      root.getAttribute("data-testid") ?? "",
      root.getAttribute("aria-label") ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return ROOT_HISTORY_KEYWORDS.some((keyword) => marker.includes(keyword));
  }

  private buildTitleFromFirstUserMessage(): string | null {
    const firstUserMessage = this.latestMessages.find(
      (message) => message.role === "user" && message.textContent.trim().length > 3,
    );
    if (firstUserMessage) {
      return this.toConciseTitle(firstUserMessage.textContent);
    }

    return this.getFirstUserMessageFromDOM();
  }

  private getFirstUserMessageFromDOM(): string | null {
    const rootContext = this.resolveConversationRoot();
    const userNodes = this.queryAllUniqueWithin(rootContext.root, TITLE_USER_SELECTORS);
    for (const node of userNodes) {
      const contentNode = queryFirstWithin(node, SELECTORS.messageContent);
      const candidate = this.toConciseTitle(safeTextContent(contentNode ?? node));
      if (candidate.length > 3) {
        return candidate;
      }
    }

    return null;
  }

  private toConciseTitle(rawTitle: string): string {
    const normalized = rawTitle.replace(/\s+/g, " ").trim();
    if (!normalized) return "";

    let boundaryIndex = -1;
    for (const boundary of TITLE_BOUNDARY_CHARS) {
      const index = normalized.indexOf(boundary);
      if (index <= 10) continue;
      if (boundaryIndex === -1 || index < boundaryIndex) {
        boundaryIndex = index;
      }
    }

    const concise = boundaryIndex >= 0 ? normalized.slice(0, boundaryIndex + 1) : normalized;
    return concise.slice(0, MAX_TITLE_LENGTH).trim();
  }

  private isUsableDocumentTitle(title: string): boolean {
    if (!title) return false;
    const normalized = title.toLowerCase();
    for (const invalidTitle of INVALID_TITLES) {
      if (normalized === invalidTitle || normalized.includes(invalidTitle)) {
        return false;
      }
    }
    return true;
  }

  private parseMessageNode(node: Element, perfMode: AstPerfMode): ParsedNodeResult | null {
    if (this.isDiscardNode(node)) {
      return null;
    }

    const role = this.inferRole(node);
    if (!role) return null;

    const contentEl = this.resolveContentElement(node, role);
    if (contentEl && this.isDiscardNode(contentEl)) {
      return null;
    }

    const sanitizedContent = this.sanitizeContentElement(contentEl ?? node);
    const ast = extractAstFromElement(sanitizedContent, {
      platform: "Qwen",
      perfMode,
    });
    const fallbackText = this.cleanExtractedText(this.extractVisibleText(sanitizedContent));
    const textContent = resolveCanonicalMessageText({
      fallbackText,
      ast: ast.root,
      normalizeAstText: (value: string) => this.cleanExtractedText(value),
    });

    return {
      message: {
        role,
        textContent,
        contentAst: ast.root,
        contentAstVersion: ast.root ? "ast_v2" : null,
        degradedNodesCount: ast.degradedNodesCount,
        htmlContent: sanitizedContent.innerHTML,
      },
      degradedNodesCount: ast.degradedNodesCount,
      astNodeCount: ast.astNodeCount,
    };
  }

  private resolveContentElement(node: Element, role: MessageRole): Element | null {
    const preferred = queryFirstWithin(node, SELECTORS.preferredMessageContent);
    if (preferred) {
      return preferred;
    }

    if (role === "ai") {
      const aiSpecific = queryFirstWithin(node, [
        ".qwen-markdown",
        ".chat-response-message",
        "[class*='chat-response-message']",
        "div[class*='response']",
        "div[class*='answer']",
      ]);
      if (aiSpecific) {
        return aiSpecific;
      }
    }

    return queryFirstWithin(node, SELECTORS.messageContent);
  }

  private sanitizeContentElement(source: Element): Element {
    const { clone } = cloneAndSanitizeMessageContent(
      source,
      getCitationNoiseProfile("Qwen"),
    );

    for (const selector of SELECTORS.inlineNoiseSelectors) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    }

    this.normalizeMonacoCodeBlocks(clone);
    this.normalizeQwenMarkdownBlocks(clone);

    for (const selector of SELECTORS.dividerSelectors) {
      clone.querySelectorAll(selector).forEach((divider) => {
        divider.replaceWith(document.createTextNode("\n"));
      });
    }

    return clone;
  }

  private normalizeMonacoCodeBlocks(root: Element): void {
    const editors = Array.from(root.querySelectorAll(".monaco-editor"));
    const processedTargets = new Set<Element>();

    for (const editor of editors) {
      const target = this.resolveMonacoCodeReplacementTarget(editor, root);
      if (processedTargets.has(target)) {
        continue;
      }

      const normalizedBlock = this.buildNormalizedMonacoCodeBlock(target, editor);
      if (!normalizedBlock) {
        continue;
      }

      processedTargets.add(target);
      target.replaceWith(normalizedBlock);
    }
  }

  private normalizeQwenMarkdownBlocks(root: Element): void {
    root.querySelectorAll("div.qwen-markdown-space").forEach((node) => node.remove());

    root.querySelectorAll("div.qwen-markdown-paragraph").forEach((paragraph) => {
      const normalizedParagraph = document.createElement("p");

      while (paragraph.firstChild) {
        normalizedParagraph.appendChild(paragraph.firstChild);
      }

      paragraph.replaceWith(normalizedParagraph);
    });
  }

  private resolveMonacoCodeReplacementTarget(editor: Element, root: Element): Element {
    let current: Element | null = editor.parentElement;

    while (current && current !== root) {
      if (MONACO_CODE_WRAPPER_SELECTORS.some((selector) => current?.matches(selector))) {
        return current;
      }
      current = current.parentElement;
    }

    return editor;
  }

  private buildNormalizedMonacoCodeBlock(target: Element, editor: Element): HTMLElement | null {
    const code = this.extractMonacoCodeText(editor);
    if (!code.trim()) {
      return null;
    }

    const language = this.inferMonacoLanguage(target, editor);
    const pre = document.createElement("pre");
    const codeElement = document.createElement("code");

    if (language) {
      pre.setAttribute("data-language", language);
      codeElement.setAttribute("data-language", language);
      codeElement.classList.add(`language-${language}`);
    }

    codeElement.textContent = code;
    pre.appendChild(codeElement);
    return pre;
  }

  private extractMonacoCodeText(editor: Element): string {
    const lineNodes = Array.from(editor.querySelectorAll(".view-lines .view-line"));
    const lines = (lineNodes.length > 0 ? lineNodes : Array.from(editor.querySelectorAll(".view-line")))
      .map((line) => this.extractMonacoLineText(line));

    if (lines.length === 0) {
      return "";
    }

    return lines.join("\n").replace(/\r/g, "").replace(/[\u200b-\u200d\ufeff]/g, "").trimEnd();
  }

  private extractMonacoLineText(line: Element): string {
    const raw = line instanceof HTMLElement ? line.innerText || "" : safeTextContent(line);
    return raw.replace(/\r?\n/g, "").replace(/\u00a0/g, " ").replace(/[\u200b-\u200d\ufeff]/g, "");
  }

  private inferMonacoLanguage(target: Element, editor: Element): string | null {
    const attrCandidates = [
      target.getAttribute("data-language"),
      target.getAttribute("data-lang"),
      editor.getAttribute("data-language"),
      editor.getAttribute("data-lang"),
    ];

    for (const candidate of attrCandidates) {
      const token = this.normalizeMonacoLanguageToken(candidate);
      if (token) {
        return token;
      }
    }

    const classCandidates = [target.className?.toString() ?? "", editor.className?.toString() ?? ""];
    for (const candidate of classCandidates) {
      const token = this.extractMonacoLanguageFromClassName(candidate);
      if (token) {
        return token;
      }
    }

    return this.collectMonacoLanguageFromNearbyLabel(target, editor);
  }

  private extractMonacoLanguageFromClassName(value: string): string | null {
    const classTokens = value.split(/\s+/).filter(Boolean);

    for (const token of classTokens) {
      const normalized = token.toLowerCase();
      const explicit = normalized.match(/(?:^|[-_])(language|lang)[-_]?([a-z0-9+#.-]+)/i);
      if (explicit?.[2]) {
        const resolved = this.normalizeMonacoLanguageToken(explicit[2]);
        if (resolved) {
          return resolved;
        }
      }

      if (MONACO_LANGUAGE_HINT_TOKENS.has(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  private collectMonacoLanguageFromNearbyLabel(target: Element, editor: Element): string | null {
    const candidates = Array.from(target.querySelectorAll("*"));

    for (const candidate of candidates) {
      if (candidate === editor || candidate.closest(".monaco-editor") !== null) {
        continue;
      }
      if (candidate.matches(MONACO_LANGUAGE_EXCLUDE_SELECTORS)) {
        continue;
      }

      const text = (candidate.textContent ?? "").trim();
      if (!text || text.length > 24 || /\s/.test(text)) {
        continue;
      }

      const token = this.normalizeMonacoLanguageToken(text);
      if (token) {
        return token;
      }
    }

    return null;
  }

  private normalizeMonacoLanguageToken(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized.length > 24) {
      return null;
    }

    const prefixed = normalized.match(/^(?:language|lang)[:_\-\s]*([a-z0-9+#.-]{1,24})$/i);
    const token = (prefixed?.[1] ?? normalized).toLowerCase();

    if (!/^[a-z0-9+#.-]{1,24}$/i.test(token)) {
      return null;
    }
    if (MONACO_LANGUAGE_NOISE_TOKENS.has(token)) {
      return null;
    }
    return token;
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

  private extractSanitizedText(source: Element): string {
    const normalizedSource = this.sanitizeContentElement(source);
    const rawText = this.extractVisibleText(normalizedSource);
    return this.cleanExtractedText(rawText);
  }

  private isDiscardNode(node: Element): boolean {
    return SELECTORS.discardContainers.some((selector) => node.matches(selector));
  }

  private inferRole(node: Element): MessageRole | null {
    const attrRole =
      this.roleFromAttribute(node.getAttribute("data-message-author-role")) ??
      this.roleFromAttribute(node.getAttribute("data-role")) ??
      this.roleFromAttribute(node.getAttribute("data-author")) ??
      this.roleFromAttribute(node.getAttribute("role"));
    if (attrRole) return attrRole;

    const testIdRole = this.roleFromTestId(node.getAttribute("data-testid"));
    if (testIdRole) return testIdRole;

    const classRole = this.roleFromHint(node.className?.toString() ?? "");
    if (classRole) return classRole;

    if (this.hasUserMarker(node)) return "user";
    if (this.hasAssistantMarker(node)) return "ai";

    const descendantRole = this.roleFromDescendants(node);
    if (descendantRole) return descendantRole;

    const ancestor = node.parentElement
      ? closestAnySelector(node.parentElement, SELECTORS.roleAncestorHints)
      : null;
    if (ancestor) {
      const ancestorRole =
        this.roleFromAttribute(ancestor.getAttribute("data-message-author-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-role")) ??
        this.roleFromAttribute(ancestor.getAttribute("data-author")) ??
        this.roleFromTestId(ancestor.getAttribute("data-testid")) ??
        this.roleFromHint(ancestor.className?.toString() ?? "");
      if (ancestorRole) return ancestorRole;

      if (this.hasUserMarker(ancestor)) return "user";
      if (this.hasAssistantMarker(ancestor)) return "ai";
    }

    return null;
  }

  private roleFromAttribute(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "user" || normalized === "human") return "user";
    if (
      normalized === "assistant" ||
      normalized === "model" ||
      normalized === "ai" ||
      normalized === "qwen"
    ) {
      return "ai";
    }
    return null;
  }

  private roleFromTestId(value: string | null): MessageRole | null {
    if (!value) return null;
    const normalized = value.toLowerCase();

    if (/(^|[-_:])(user|human|prompt|query|question|send_message)([-_:]|$)/.test(normalized)) {
      return "user";
    }

    if (
      /(^|[-_:])(assistant|model|qwen|ai|answer|reply|response|receive_message)([-_:]|$)/.test(
        normalized,
      )
    ) {
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

    if (/(^|[-_:])(assistant|model|qwen|ai|answer|reply|response)([-_:]|$)/.test(normalized)) {
      return "ai";
    }

    if (
      normalized.includes("user") ||
      normalized.includes("human") ||
      normalized.includes("prompt") ||
      normalized.includes("query") ||
      normalized.includes("question")
    ) {
      return "user";
    }
    if (
      normalized.includes("assistant") ||
      normalized.includes("model") ||
      normalized.includes("qwen") ||
      normalized.includes("reply") ||
      normalized.includes("response")
    ) {
      return "ai";
    }
    return null;
  }

  private hasUserMarker(node: Element): boolean {
    const selector = SELECTORS.userRoleAnchors.join(", ");
    return node.matches(selector) || node.querySelector(selector) !== null;
  }

  private hasAssistantMarker(node: Element): boolean {
    const selector = SELECTORS.assistantRoleAnchors.join(", ");
    if (node.matches(selector) || node.querySelector(selector) !== null) {
      return true;
    }
    return this.hasCopyAction(node);
  }

  private hasCopyAction(node: Element): boolean {
    const selector = SELECTORS.copyActionAnchors.join(", ");
    return node.matches(selector) || node.querySelector(selector) !== null;
  }

  private roleFromDescendants(node: Element): MessageRole | null {
    const userSelector = SELECTORS.userRoleAnchors.join(", ");
    const assistantSelector = SELECTORS.assistantRoleAnchors.join(", ");
    const copySelector = SELECTORS.copyActionAnchors.join(", ");

    const hasUserDescendant = node.querySelector(userSelector) !== null;
    const hasAssistantDescendant =
      node.querySelector(assistantSelector) !== null || node.querySelector(copySelector) !== null;

    if (hasUserDescendant && !hasAssistantDescendant) return "user";
    if (hasAssistantDescendant && !hasUserDescendant) return "ai";
    return null;
  }

  private cleanExtractedText(rawText: string): string {
    let text = rawText;

    text = text.replace(/\r/g, "");
    text = text.replace(/^Thought for\s+\d+s[\s\S]*?Show more\s*Done\s*/i, "");
    text = text.replace(/^Thought for\s+\d+s\s*/i, "");
    text = text.replace(/^Show more\s*Done\s*/i, "");
    text = text.replace(/^Show more\s*/i, "");
    text = text.replace(/^Done\s*/i, "");

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^(copy|edit|retry|regenerate|share)\s+/i, "")
      .trim();

    text = text
      .replace(
        /(?:^|\n)\s*(?:show more|done|edit history|\u7f16\u8f91\u5386\u53f2)\s*(?=\n|$)/gi,
        "\n",
      )
      .replace(/(?:^|\n)\s*\d+\s*\/\s*\d+\s*(?=\n|$)/g, "\n")
      .replace(
        /(?:^|\n)\s*(?:references?|\u53c2\u8003\u94fe\u63a5|\u5f15\u7528)\s*[:\uff1a]?\s*\d+\s*(?=\n|$)/gi,
        "\n",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text;
  }

  private isLikelyNoiseText(text: string): boolean {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return true;
    }

    if (SELECTORS.noiseTextPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }

    return /^(show more|done|copy|edit|retry|regenerate)$/i.test(normalized);
  }

  private dedupeNearDuplicates(messages: ParsedMessage[]): ParsedMessage[] {
    const deduped: ParsedMessage[] = [];

    for (const message of messages) {
      const signature = `${message.role}|${message.textContent.replace(/\s+/g, " ").trim()}`;
      const isDuplicate = deduped.slice(Math.max(0, deduped.length - 2)).some((existing) => {
        const existingSignature = `${existing.role}|${existing.textContent
          .replace(/\s+/g, " ")
          .trim()}`;
        return existingSignature === signature;
      });

      if (!isDuplicate) {
        deduped.push(message);
      }
    }

    return deduped;
  }

  private chooseBestExtraction(
    selectorResult: ExtractionResult,
    anchorResult: ExtractionResult,
  ): ExtractionResult {
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

  private normalizeSessionId(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim();
    if (normalized.length < 8) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) return null;
    if (INVALID_SESSION_IDS.has(normalized.toLowerCase())) return null;
    return normalized;
  }

  private logStats(stats: ParserStats, messages: ParsedMessage[]): void {
    logger.info("parser", "Qwen parse stats", stats);

    if (stats.totalCandidates > 200 || stats.keptMessages > 80) {
      logger.debug("parser", "Qwen parser candidate scope may be polluted", {
        rootSelector: stats.rootSelector,
        totalCandidates: stats.totalCandidates,
        keptMessages: stats.keptMessages,
        roleDistribution: stats.roleDistribution,
      });
    }

    if (messages.length === 0) {
      logger.debug("parser", "Qwen parser kept zero messages", {
        rootSelector: stats.rootSelector,
        source: stats.source,
        totalCandidates: stats.totalCandidates,
        droppedNoise: stats.droppedNoise,
        droppedUnknownRole: stats.droppedUnknownRole,
      });
      return;
    }

    const hasSingleRole = stats.roleDistribution.user === 0 || stats.roleDistribution.ai === 0;
    if (hasSingleRole) {
      logger.debug("parser", "Qwen parser captured only one role", {
        rootSelector: stats.rootSelector,
        source: stats.source,
        roleDistribution: stats.roleDistribution,
        samples: messages
          .slice(0, 3)
          .map((message) => message.textContent.replace(/\s+/g, " ").slice(0, 120)),
      });
    }
  }
}

